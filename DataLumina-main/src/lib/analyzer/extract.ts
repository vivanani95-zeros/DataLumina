import { registerWorkbook } from "./lumina/index.ts";
import { CATEGORIES, CATEGORY_BY_ID, matchCategoryIds, normalizeKey } from "./categories.ts";
import { analyzeLanguage, cleanValue, harvestPatterns, looksEmpty, parseNumber } from "./patterns.ts";
import type {
  AnalysisReport,
  AnalyzerMode,
  CategoryHit,
  DataRecord,
  Finding,
  NumericStat,
  ParsedFile,
} from "./types.ts";

const MAX_FINDINGS = 2_400;
const MAX_RECORDS = 4_000;
// Heuristic text scans read at most this much of a file. The question engine reads every row.
const REPORT_SCAN_CHARS = 2_000_000;
function scanText(text: string): string {
  return text.length > REPORT_SCAN_CHARS ? text.slice(0, REPORT_SCAN_CHARS) : text;
}

function uid(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
}

function walkLeaves(
  value: unknown,
  path: string,
  visit: (path: string, leaf: unknown) => void,
  depth: number,
): void {
  if (depth > 10 || looksEmpty(value)) return;
  if (Array.isArray(value)) {
    if (value.every((v) => v === null || typeof v !== "object")) {
      visit(path, value.join(", "));
      return;
    }
    value.slice(0, 60).forEach((item, i) => walkLeaves(item, path ? `${path}.${i}` : String(i), visit, depth + 1));
    return;
  }
  if (typeof value === "object" && value) {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      walkLeaves(v, path ? `${path}.${k}` : k, visit, depth + 1);
    }
    return;
  }
  visit(path, value);
}

function addFinding(
  bag: Finding[],
  seen: Set<string>,
  finding: Omit<Finding, "id">,
): void {
  if (bag.length >= MAX_FINDINGS) return;
  const key = `${finding.categoryId}|${finding.field}|${finding.clean.toLowerCase()}`;
  if (seen.has(key)) return;
  if (!finding.clean) return;
  seen.add(key);
  bag.push({ ...finding, id: uid("f") });
}

function rowToFields(row: Record<string, unknown>): Record<string, string> {
  const fields: Record<string, string> = {};
  walkLeaves(
    row,
    "",
    (path, leaf) => {
      if (looksEmpty(leaf)) return;
      const field = path.split(".").filter((p) => !/^\d+$/.test(p)).join(".") || path;
      const clean = cleanValue(field, leaf);
      if (clean) fields[field] = clean;
    },
    0,
  );
  return fields;
}

export function extractFromFiles(files: ParsedFile[], mode: AnalyzerMode): AnalysisReport {
  const findings: Finding[] = [];
  const seen = new Set<string>();
  const numbers = new Map<string, number[]>();
  const records: DataRecord[] = [];
  const patternBudget = mode === "fast" ? 180 : 400;

  for (const file of files) {
    const rowCap = mode === "fast" ? 800 : files.length > 1 ? 2500 : MAX_FINDINGS;
    const rows = file.rows.slice(0, rowCap);

    rows.forEach((row, recordIndex) => {
      const fields = rowToFields(row);
      if (Object.keys(fields).length && records.length < MAX_RECORDS) {
        records.push({ source: file.name, index: recordIndex, fields });
      }

      walkLeaves(
        row,
        "",
        (path, leaf) => {
          if (looksEmpty(leaf)) return;
          const field = path.split(".").filter((p) => !/^\d+$/.test(p)).pop() ?? path;
          const nkey = normalizeKey(field);
          const raw = typeof leaf === "string" ? leaf : String(leaf);
          const clean = cleanValue(field, leaf);
          const matches = matchCategoryIds(field);
          const n = parseNumber(leaf);
          if (n !== null && nkey) {
            const arr = numbers.get(nkey) ?? [];
            arr.push(n);
            numbers.set(nkey, arr);
          }
          if (matches.length === 0) return;
          const top = matches[0]!;
          if (mode === "fast" && top.score < 0.7) return;
          addFinding(findings, seen, {
            categoryId: top.id,
            field: field || nkey,
            raw,
            clean,
            confidence: Math.min(0.99, top.score),
            source: file.name,
            recordIndex,
            evidence: `column “${field}”`,
          });
        },
        0,
      );
    });

    const harvested = harvestPatterns(scanText(file.text), patternBudget);
    for (const hit of harvested) {
      addFinding(findings, seen, {
        categoryId: hit.categoryId,
        field: hit.kind,
        raw: hit.value,
        clean: hit.clean,
        confidence: 0.78,
        source: file.name,
        evidence: "pattern in file text",
      });
    }

    if (mode === "thorough") {
      const lang = analyzeLanguage(scanText(file.text));
      if (lang.vocab) {
        addFinding(findings, seen, {
          categoryId: "vocab",
          field: "lexical_diversity",
          raw: `${lang.vocab.unique}/${lang.vocab.total}`,
          clean: `TTR ${lang.vocab.ttr} · ${lang.vocab.unique.toLocaleString()} unique / ${lang.vocab.total.toLocaleString()} tokens`,
          confidence: 0.7,
          source: file.name,
          evidence: "computed from free text",
        });
      }
      if (lang.sentiment) {
        addFinding(findings, seen, {
          categoryId: "sentiment",
          field: "polarity",
          raw: String(lang.sentiment.score),
          clean: `${lang.sentiment.polarity} (${lang.sentiment.score})`,
          confidence: 0.62,
          source: file.name,
          evidence: "lexicon polarity",
        });
      }
      if (lang.topics && lang.topics.length) {
        addFinding(findings, seen, {
          categoryId: "topics",
          field: "topics",
          raw: lang.topics.join(", "),
          clean: lang.topics.join(" · "),
          confidence: 0.6,
          source: file.name,
          evidence: "keyword clusters",
        });
      }
      if (lang.slang && (lang.slang.emoji > 0 || lang.slang.dialectHints.length)) {
        addFinding(findings, seen, {
          categoryId: "slang",
          field: "register",
          raw: `${lang.slang.emoji} emoji`,
          clean: [lang.slang.emoji ? `${lang.slang.emoji} emoji` : "", ...lang.slang.dialectHints]
            .filter(Boolean)
            .join(" · "),
          confidence: 0.58,
          source: file.name,
          evidence: "register markers",
        });
      }
      if (lang.syntax) {
        addFinding(findings, seen, {
          categoryId: "syntax",
          field: "avg_sentence_len",
          raw: String(lang.syntax.avgSentence),
          clean: `${lang.syntax.avgSentence} words/sentence`,
          confidence: 0.64,
          source: file.name,
          evidence: "sentence split",
        });
      }
      if (/\b(urgent|verify your|password|gift card|act now|limited time)\b/i.test(scanText(file.text))) {
        addFinding(findings, seen, {
          categoryId: "spam",
          field: "phishing_markers",
          raw: "urgency / credential bait",
          clean: "urgency and credential-bait language detected",
          confidence: 0.66,
          source: file.name,
          evidence: "keyword scan",
        });
      }
    }
  }

  const byCat = new Map<string, Finding[]>();
  for (const f of findings) {
    const list = byCat.get(f.categoryId) ?? [];
    list.push(f);
    byCat.set(f.categoryId, list);
  }

  const categories: CategoryHit[] = CATEGORIES.filter((c) => byCat.has(c.id)).map((c) => {
    const list = (byCat.get(c.id) ?? []).sort((a, b) => b.confidence - a.confidence);
    return {
      id: c.id,
      label: c.label,
      group: c.group,
      description: c.description,
      findings: list.slice(0, 80),
      count: list.length,
    };
  });

  const stats: NumericStat[] = [];
  for (const [field, values] of numbers) {
    if (values.length < 3) continue;
    const min = Math.min(...values);
    const max = Math.max(...values);
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    if (min === max) continue;
    stats.push({
      field,
      count: values.length,
      min: Number(min.toFixed(4)),
      max: Number(max.toFixed(4)),
      mean: Number(mean.toFixed(4)),
    });
  }
  stats.sort((a, b) => b.count - a.count);

  const cleaned: Record<string, Array<Record<string, string>>> = {};
  for (const hit of categories) {
    const grouped = new Map<string, Record<string, string>>();
    for (const f of hit.findings) {
      const k = `${f.source}#${f.recordIndex ?? f.clean}`;
      const row = grouped.get(k) ?? { source: f.source };
      row[f.field] = f.clean;
      grouped.set(k, row);
    }
    cleaned[hit.id] = [...grouped.values()].slice(0, 200);
  }

  const fileSummaries = files.map((f) => ({
    name: f.name,
    size: f.size,
    kind: f.kind,
    rows: f.rows.length,
    warnings: f.warnings,
  }));

  const report: AnalysisReport = {
    id: uid("r"),
    createdAt: Date.now(),
    mode,
    files: fileSummaries,
    categories,
    stats: stats.slice(0, 24),
    coverage: { hit: categories.length, total: CATEGORIES.length },
    cleaned,
    records,
    overview: buildOverview(fileSummaries, categories, mode, records.length),
  };
  try {
    registerWorkbook(report, files);
  } catch {
    /* the category report still answers when the workbook cannot be built */
  }
  return report;
}

function buildOverview(
  files: AnalysisReport["files"],
  categories: CategoryHit[],
  mode: AnalyzerMode,
  recordCount: number,
): string {
  const fileBit = files.length === 1 ? `“${files[0]!.name}”` : `${files.length} files`;
  const signals = categories.reduce((a, c) => a + c.count, 0);
  if (recordCount === 0 && categories.length === 0) {
    return `I read ${fileBit} in ${mode} mode and did not find structured records or mapped domains. Try CSV, JSON, logs, XML, or key/value text.`;
  }
  const top = [...categories].sort((a, b) => b.count - a.count).slice(0, 4);
  const topBit = top.length ? ` Highest density: ${top.map((c) => `${c.label} (${c.count})`).join(", ")}.` : "";
  return `From ${fileBit} I indexed ${recordCount.toLocaleString()} record${recordCount === 1 ? "" : "s"} and ${signals.toLocaleString()} mapped signals across ${categories.length} of ${CATEGORY_BY_ID.size} domains (${mode} pass).${topBit} Answers below use only values present in the file.`;
}
