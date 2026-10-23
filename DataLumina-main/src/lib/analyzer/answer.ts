import { answerLumina, workbookFor } from "./lumina/index.ts";
import { CATEGORIES, CATEGORY_BY_ID, GROUP_LABEL, normalizeKey } from "./categories.ts";
import { parseNumber } from "./patterns.ts";
import { executeComplex } from "./plan.ts";
import type {
  AnalysisReport,
  AnswerTable,
  CategoryHit,
  DataRecord,
  QueryIntent,
} from "./types.ts";

const HELP_TEXT = `DataLumina reads files you attach and answers from the values inside them.

Everything runs on your device with no API key. Supported shapes: CSV, TSV, JSON, NDJSON, logs, XML, HAR, and key/value text.

You can also paste a question with the data under it:

Who spent the most?

merchant,amount
Umbra Coffee,4.80
Helios Fuel,62.10`;

const STOP = new Set([
  "the", "and", "for", "with", "from", "that", "this", "what", "show", "list", "give",
  "please", "about", "into", "are", "was", "were", "how", "many", "any", "all", "can",
  "you", "file", "files", "data", "extract", "clean", "report", "summarize", "summary",
  "who", "where", "which", "when", "does", "did", "has", "have", "her", "his", "their",
  "she", "him", "they", "them", "its", "our", "tell", "me", "get", "find", "look",
  "there", "here", "just", "some", "only", "also",
]);

const GENERIC_TERMS = new Set([
  "email", "phone", "name", "amount", "score", "total", "spend", "public",
  "address", "value", "data", "record", "column", "field", "list",
]);

const PROPER_STOP = new Set([
  "What", "Who", "Where", "When", "Which", "How", "Show", "List", "Give", "Tell",
  "Extract", "Summarize", "Export", "Total", "Average", "Please", "The", "Find",
]);

const FIELD_ALIASES: Record<string, string[]> = {
  email: ["email", "email_address", "mail", "e_mail"],
  phone: ["phone", "mobile", "tel", "telephone", "cell"],
  name: ["full_name", "fullname", "name", "legal_name", "given_name"],
  dob: ["dob", "date_of_birth", "birthdate", "birthday"],
  employer: ["employer", "company", "workplace", "org", "organization"],
  title: ["job_title", "title", "role", "position"],
  manager: ["manager", "reports_to", "boss"],
  amount: ["amount", "spend", "payment_amount", "price", "total", "cost", "debit"],
  merchant: ["merchant", "vendor", "payee", "description"],
  score: ["score", "rating", "rank", "points"],
  balance: ["account_balance", "balance", "available_credit"],
  payment: ["payment_method", "checkout", "card_type"],
  ip: ["ip", "public_ip", "local_ip", "ip_address"],
  gps: ["latitude", "longitude", "lat", "lng", "lon", "gps", "coords"],
  ssid: ["ssid", "wifi"],
  mac: ["mac", "mac_address"],
};

function includesAny(hay: string, needles: string[]): boolean {
  return needles.some((n) => hay.includes(n));
}

function tokenize(q: string): string[] {
  return q
    .toLowerCase()
    .replace(/[^a-z0-9@.]+/g, " ")
    .split(" ")
    .map((t) => t.trim())
    .filter((t) => t.length > 2 && !STOP.has(t));
}

function fieldKey(name: string): string {
  return normalizeKey(name);
}

function getField(rec: DataRecord, aliases: string[], prefer: string[] = []): string | undefined {
  const map = new Map<string, string>();
  for (const [k, v] of Object.entries(rec.fields)) {
    if (v) map.set(fieldKey(k), v);
  }
  let best: { value: string; score: number } | null = null;
  for (const [k, v] of map) {
    let score = 0;
    for (const a of aliases) {
      const ak = fieldKey(a);
      if (!ak) continue;
      if (k === ak) score = Math.max(score, 100 + ak.length);
      else if (k.startsWith(`${ak}_`) || k.endsWith(`_${ak}`)) score = Math.max(score, 50 + ak.length);
      else if (ak.length >= 5 && k.includes(ak)) score = Math.max(score, 20 + ak.length);
    }
    for (const p of prefer) {
      if (p && k.includes(fieldKey(p))) score += 12;
    }
    if (score > 0 && (!best || score > best.score)) best = { value: v, score };
  }
  return best?.value;
}

function recordBlob(rec: DataRecord): string {
  return Object.values(rec.fields).join(" ").toLowerCase();
}

function scoreRecord(rec: DataRecord, terms: string[]): number {
  const values = Object.values(rec.fields).join(" ").toLowerCase();
  const keys = Object.keys(rec.fields).join(" ").toLowerCase();
  let s = 0;
  for (const t of terms) {
    const needle = t.toLowerCase();
    if (!needle || GENERIC_TERMS.has(needle)) continue;
    if (values.includes(needle)) s += needle.length >= 5 ? 3 : 2;
    else if (needle.length >= 4 && keys.includes(needle)) s += 1;
  }
  return s;
}

function extractSubject(original: string, records: DataRecord[], fallback?: string | null): string | undefined {
  const q = original.trim().replace(/['’]s\b/g, "");
  const quoted = q.match(/["“]([^"”]{2,80})["”]/);
  if (quoted?.[1]) return quoted[1];

  const email = q.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  if (email) return email[0];

  const proper = q.match(/\b([A-Z][a-z]+(?:[,\s]+[A-Z][a-z]+){0,3})\b/g) ?? [];
  const candidates = proper.filter((p) => !PROPER_STOP.has(p.split(/\s+/)[0]!));
  for (const c of candidates) {
    const low = c.toLowerCase();
    if (records.some((r) => recordBlob(r).includes(low))) return c;
  }

  if (/\b(her|his|their|she|he|them)\b/i.test(q) && fallback) return fallback;

  const tokens = tokenize(q).filter((t) => t.length >= 3 && !["email", "phone", "name", "amount"].includes(t));
  if (tokens.length) {
    const hits = records
      .map((r) => ({ r, s: scoreRecord(r, tokens) }))
      .filter((x) => x.s >= 3)
      .sort((a, b) => b.s - a.s);
    if (hits[0] && hits[0].s >= 3) {
      return getField(hits[0].r, aliasesForHint("name")) ?? tokens.slice(0, 2).join(" ");
    }
  }

  return undefined;
}

function detectFieldHints(q: string): string[] {
  const hints: string[] = [];
  const low = q.toLowerCase();
  for (const [hint, aliases] of Object.entries(FIELD_ALIASES)) {
    if (aliases.some((a) => low.includes(a.replace(/_/g, " ")) || low.includes(a))) {
      hints.push(hint);
    }
  }
  if (/\bemails?\b/.test(low) && !hints.includes("email")) hints.push("email");
  if (/\bphones?\b|\bmobiles?\b/.test(low) && !hints.includes("phone")) hints.push("phone");
  if (/\b(full names?|legal names?)\b/.test(low) && !hints.includes("name")) hints.push("name");
  if (/\b(spent|spend|cost|price|amount|total)\b/.test(low) && !hints.includes("amount")) hints.push("amount");
  if (/\b(score|rating|points)\b/.test(low) && !hints.includes("score")) hints.push("score");
  return hints;
}

function aliasesForHint(hint: string): string[] {
  return FIELD_ALIASES[hint] ?? [hint];
}

export function interpretQuery(question: string, report: AnalysisReport | null, lastSubject?: string | null): QueryIntent {
  const original = question.trim();
  const q = original.toLowerCase();
  const terms = tokenize(q);
  const fieldHints = detectFieldHints(q);
  let subject = report ? extractSubject(original, report.records, lastSubject) : undefined;
  if (subject && GENERIC_TERMS.has(subject.toLowerCase())) subject = undefined;
  if (report) {
    const cols = new Set<string>();
    for (const r of report.records ?? []) {
      for (const k of Object.keys(r.fields)) cols.add(fieldKey(k));
    }
    for (const col of cols) {
      if (col.length < 3) continue;
      const phrase = col.replace(/_/g, " ");
      if (q.includes(phrase) || q.includes(col)) {
        if (!fieldHints.includes(col)) fieldHints.push(col);
      }
    }
  }
  const categoryIds: string[] = [];

  if (!q) return { kind: "report", categoryIds, terms, fieldHints, subject };

  if (includesAny(q, ["help", "what can you", "how do you", "what is datalumina"])) {
    return { kind: "help", categoryIds, terms, fieldHints, subject };
  }

  for (const cat of CATEGORIES) {
    const label = cat.label.toLowerCase();
    if (q.includes(label) || (cat.id.length > 4 && q.includes(cat.id.replace(/_/g, " ")))) {
      categoryIds.push(cat.id);
    }
  }
  for (const [group, label] of Object.entries(GROUP_LABEL)) {
    if (q.includes(label.toLowerCase()) || q.includes(group)) {
      for (const c of CATEGORIES) if (c.group === group && !categoryIds.includes(c.id)) categoryIds.push(c.id);
    }
  }
  if (includesAny(q, ["identity", "ssn", "passport"])) {
    if (!categoryIds.includes("legal_identity")) categoryIds.push("legal_identity");
  }
  if (includesAny(q, ["coordinate", "location", "gps", "where"])) {
    if (!categoryIds.includes("gps")) categoryIds.push("gps");
  }
  if (includesAny(q, ["money", "spend", "bank", "finance", "payment", "txn", "transaction"])) {
    for (const id of ["purchasing", "transactions", "payment", "subscriptions", "risk", "investment"]) {
      if (!categoryIds.includes(id)) categoryIds.push(id);
    }
  }
  if (includesAny(q, ["device", "network", "wifi", "browser"])) {
    for (const id of ["hardware", "network", "wifi", "cellular", "browser", "os"]) {
      if (!categoryIds.includes(id)) categoryIds.push(id);
    }
  }

  if (includesAny(q, ["intelligence report", "intelligence brief", "extract a clean", "analyze these", "analyse these"])) {
    return { kind: "report", categoryIds, terms, fieldHints, subject };
  }
  if (includesAny(q, ["report", "summar", "extract", "analyze", "analyse", "brief", "everything"]) && !subject && !fieldHints.length) {
    return { kind: "report", categoryIds, terms, fieldHints, subject };
  }

  const wantsAgg = includesAny(q, ["total", "sum", "average", "avg", "mean", "how much", "spent", "spend"]);
  const wantsList = includesAny(q, ["list", "show all", "all the", "every", "unique"]);
  const wantsCount = includesAny(q, ["how many", "count", "number of"]);
  const wantsLookup =
    Boolean(subject) ||
    includesAny(q, ["who is", "who's", "email of", "phone of", "tell me about"]);

  if (wantsCount && !subject) {
    if (includesAny(q, ["people", "person", "employee", "users", "names"])) {
      return { kind: "count", categoryIds, terms, fieldHints: ["name"], subject };
    }
    if (includesAny(q, ["row", "record", "entries", "lines"])) {
      return { kind: "count", categoryIds: [], terms, fieldHints: ["records"], subject };
    }
    return { kind: "count", categoryIds, terms, fieldHints, subject };
  }
  if (wantsAgg && (fieldHints.includes("amount") || includesAny(q, ["spend", "spent", "total", "sum"]))) {
    const aggregate: QueryIntent["aggregate"] = includesAny(q, ["average", "avg", "mean"])
      ? "avg"
      : includesAny(q, ["min", "lowest", "smallest", "cheapest"])
        ? "min"
        : includesAny(q, ["max", "highest", "most", "largest", "biggest"])
          ? "max"
          : "sum";
    if (!fieldHints.includes("amount")) fieldHints.push("amount");
    return { kind: "aggregate", categoryIds, terms, fieldHints, subject, aggregate };
  }
  if (includesAny(q, ["most", "highest", "largest", "biggest", "max", "top"]) && fieldHints.length) {
    if (!fieldHints.includes("amount") && includesAny(q, ["spend", "spent", "paid"])) fieldHints.push("amount");
    return { kind: "aggregate", categoryIds, terms, fieldHints, subject, aggregate: "max" };
  }
  if (includesAny(q, ["lowest", "smallest", "cheapest", "min", "least"]) && fieldHints.length) {
    return { kind: "aggregate", categoryIds, terms, fieldHints, subject, aggregate: "min" };
  }
  if (wantsLookup) return { kind: "lookup", categoryIds, terms, fieldHints, subject };
  if ((wantsList || includesAny(q, ["what", "where", "which"])) && fieldHints.length && !subject) {
    return { kind: "list", categoryIds, terms, fieldHints, subject };
  }
  if (wantsList && (fieldHints.length || terms.length)) {
    return { kind: "list", categoryIds, terms, fieldHints, subject };
  }
  if (includesAny(q, ["stat", "range", "min", "max"]) && !subject) {
    return { kind: "stats", categoryIds, terms, fieldHints, subject };
  }
  if (includesAny(q, ["export", "download", "normalize"]) || /\bclean(?:ed)? (?:data|records|csv|json)\b/.test(q)) {
    return { kind: "clean", categoryIds, terms, fieldHints, subject };
  }
  if (categoryIds.length && includesAny(q, ["show", "list", "extract"])) {
    return { kind: "category", categoryIds, terms, fieldHints, subject };
  }
  if (includesAny(q, ["report", "summar", "extract", "analyze", "analyse", "brief", "everything"])) {
    return { kind: "report", categoryIds, terms, fieldHints, subject };
  }
  if (subject || terms.length) return { kind: "search", categoryIds, terms, fieldHints, subject };
  return { kind: "report", categoryIds, terms, fieldHints, subject };
}

function matchingRecords(report: AnalysisReport, needles: string[], minScore = 2): DataRecord[] {
  const list = report.records ?? [];
  const terms = needles.map((n) => n.toLowerCase()).filter((n) => n.length > 1);
  if (!terms.length) return [];
  return list
    .map((r) => {
      let s = scoreRecord(r, terms);
      const name = (getField(r, aliasesForHint("name")) ?? "").toLowerCase();
      for (const t of terms) {
        if (name && (name === t || name.includes(t))) s += 8;
      }
      const joined = terms.filter((t) => t.includes(" " ) || t.length > 3).join(" ");
      if (name && joined && name.includes(joined)) s += 12;
      return { r, s };
    })
    .filter((x) => x.s >= minScore)
    .sort((a, b) => b.s - a.s)
    .map((x) => x.r);
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    const k = v.toLowerCase();
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(v);
  }
  return out;
}

function gpsPairs(recs: DataRecord[]): string[] {
  const out: string[] = [];
  for (const rec of recs) {
    const lat = getField(rec, ["latitude", "lat"]);
    const lng = getField(rec, ["longitude", "lng", "lon"]);
    if (lat && lng) out.push(`${lat}, ${lng}`);
  }
  return uniqueStrings(out);
}

function valuesForHint(report: AnalysisReport, hint: string, recs?: DataRecord[], prefer: string[] = []): string[] {
  const src = recs?.length ? recs : (report.records ?? []);
  if (hint === "gps") {
    const pairs = gpsPairs(src);
    if (pairs.length) return pairs;
  }
  const aliases = aliasesForHint(hint);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const rec of src) {
    const v = getField(rec, aliases, prefer);
    if (v) {
      const k = v.toLowerCase();
      if (!seen.has(k)) {
        seen.add(k);
        out.push(v);
      }
    }
  }
  if (!out.length) {
    for (const cat of report.categories) {
      for (const f of cat.findings) {
        if (aliases.some((a) => fieldKey(f.field) === fieldKey(a) || fieldKey(f.field).includes(fieldKey(a)))) {
          const k = f.clean.toLowerCase();
          if (!seen.has(k)) {
            seen.add(k);
            out.push(f.clean);
          }
        }
      }
    }
  }
  return out;
}

function formatRecord(rec: DataRecord): string {
  const name = getField(rec, aliasesForHint("name"));
  const bits: string[] = [];
  const order = ["name", "title", "employer", "email", "phone", "dob", "manager", "amount", "merchant", "ip"];
  const used = new Set<string>();
  if (name) {
    bits.push(name);
    used.add(name.toLowerCase());
  }
  for (const hint of order) {
    if (hint === "name") continue;
    const v = getField(rec, aliasesForHint(hint));
    if (!v || used.has(v.toLowerCase())) continue;
    used.add(v.toLowerCase());
    bits.push(`${hint} ${v}`);
  }
  for (const [k, v] of Object.entries(rec.fields)) {
    if (!v || used.has(v.toLowerCase())) continue;
    if (bits.length >= 8) break;
    used.add(v.toLowerCase());
    bits.push(`${k} ${v}`);
  }
  return bits.join(" · ");
}

function homogeneous(recs: DataRecord[]): DataRecord[] {
  if (recs.length <= 1) return recs;
  const bySource = new Map<string, DataRecord[]>();
  for (const r of recs) {
    const list = bySource.get(r.source) ?? [];
    list.push(r);
    bySource.set(r.source, list);
  }
  return [...bySource.values()].sort((a, b) => {
    const sa = a.length * Math.min(6, new Set(a.flatMap((r) => Object.keys(r.fields))).size);
    const sb = b.length * Math.min(6, new Set(b.flatMap((r) => Object.keys(r.fields))).size);
    return sb - sa;
  })[0] ?? recs;
}

function recordsToTable(recs: DataRecord[], prefer?: string[]): AnswerTable | undefined {
  const src = homogeneous(recs);
  if (!src.length) return undefined;
  const keyCount = new Map<string, number>();
  for (const r of recs) {
    for (const k of Object.keys(r.fields)) keyCount.set(k, (keyCount.get(k) ?? 0) + 1);
  }
  let columns = [...keyCount.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k);
  if (prefer?.length) {
    const prefCols = columns.filter((c) =>
      prefer.some((p) => fieldKey(c).includes(fieldKey(p)) || aliasesForHint(p).includes(fieldKey(c))),
    );
    const rest = columns.filter((c) => !prefCols.includes(c));
    columns = [...prefCols, ...rest];
  }
  columns = columns.slice(0, 6);
  if (!columns.length) return undefined;
  const rows = src.slice(0, 12).map((r) => columns.map((c) => r.fields[c] ?? ""));
  return { columns, rows };
}

function numericSeries(report: AnalysisReport, hint: string, recs?: DataRecord[]): { field: string; values: number[] } | null {
  const aliases = aliasesForHint(hint);
  const src = recs ?? report.records;
  const byField = new Map<string, number[]>();
  for (const rec of src) {
    for (const [k, v] of Object.entries(rec.fields)) {
      const nk = fieldKey(k);
      if (!aliases.some((a) => nk === fieldKey(a) || nk.includes(fieldKey(a)))) continue;
      const n = parseNumber(v);
      if (n === null) continue;
      const arr = byField.get(k) ?? [];
      arr.push(n);
      byField.set(k, arr);
    }
  }
  let best: { field: string; values: number[] } | null = null;
  for (const [field, values] of byField) {
    if (!best || values.length > best.values.length) best = { field, values };
  }
  return best;
}

function money(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function formatNum(field: string, n: number): string {
  if (/amount|price|spend|balance|cost|payment|credit|debit/.test(fieldKey(field))) return money(n);
  if (Number.isInteger(n)) return String(n);
  return String(Number(n.toFixed(4)));
}

export type AnswerPayload = {
  text: string;
  report?: AnalysisReport;
  filtered?: CategoryHit[];
  table?: AnswerTable;
  showReport?: boolean;
  subject?: string | null;
  notes?: string[];
};

function answerLookup(report: AnalysisReport, intent: QueryIntent): AnswerPayload {
  const needles = [intent.subject, ...intent.terms].filter((x): x is string => Boolean(x));
  const recs = matchingRecords(report, needles, 2).slice(0, 8);
  if (!recs.length) {
    return {
      text: `No record in the files mentions “${intent.subject ?? intent.terms.join(" ")}”.`,
      report,
      showReport: false,
    };
  }
  const primary = recs[0]!;
  const prefer = intent.terms;
  const nameOf = getField(primary, aliasesForHint("name")) ?? intent.subject;
  if (intent.fieldHints.length === 1 && intent.fieldHints[0] !== "name") {
    const hint = intent.fieldHints[0]!;
    const focused = recs.filter((r) => {
      const n = (getField(r, aliasesForHint("name")) ?? "").toLowerCase();
      const sub = (intent.subject ?? "").toLowerCase();
      if (!sub) return true;
      return n.includes(sub);
    });
    const values = valuesForHint(report, hint, focused.length ? focused.slice(0, 1) : recs.slice(0, 1), prefer);
    if (values.length) {
      return {
        text: `${nameOf ?? "That record"}: ${hint} ${values.join(", ")}.`,
        report,
        table: recordsToTable(focused.length ? focused.slice(0, 3) : recs.slice(0, 3), intent.fieldHints),
        showReport: false,
        subject: nameOf ?? intent.subject,
      };
    }
  }
  const lines = recs
    .filter((r, i) => i === 0 || (getField(r, aliasesForHint("name")) ?? "") === (nameOf ?? ""))
    .slice(0, 3)
    .map((r) => `• ${formatRecord(r)}`);
  return {
    text: `From the files:\n${lines.join("\n")}`,
    report,
    table: recordsToTable(recs.slice(0, 4)),
    showReport: false,
    subject: nameOf ?? intent.subject,
  };
}

function answerList(report: AnalysisReport, intent: QueryIntent): AnswerPayload {
  const recs = intent.subject || intent.terms.length
    ? matchingRecords(report, [intent.subject, ...intent.terms].filter((x): x is string => Boolean(x)), 2)
    : report.records;
  if (intent.fieldHints.length) {
    const chunks: string[] = [];
    for (const hint of intent.fieldHints) {
      const vals = valuesForHint(report, hint, recs.length ? recs : undefined, intent.terms);
      if (vals.length) chunks.push(`${hint}: ${vals.slice(0, 20).join(", ")}`);
    }
    if (chunks.length) {
      return {
        text: chunks.join("\n"),
        report,
        table: recordsToTable((recs.length ? recs : report.records).slice(0, 12), intent.fieldHints),
        showReport: false,
        subject: intent.subject,
      };
    }
  }
  if (!recs.length) {
    return { text: "No matching rows in the attached files.", report, showReport: false };
  }
  return {
    text: `${recs.length} matching record${recs.length === 1 ? "" : "s"}:`,
    report,
    table: recordsToTable(recs.slice(0, 12), intent.fieldHints),
    showReport: false,
    subject: intent.subject,
  };
}

function answerAggregate(report: AnalysisReport, intent: QueryIntent): AnswerPayload {
  const recs = intent.subject || intent.terms.length
    ? matchingRecords(report, [intent.subject, ...intent.terms].filter((x): x is string => Boolean(x)), 1)
    : report.records;
  const hint = intent.fieldHints.find((h) => h === "amount") ?? intent.fieldHints[0] ?? "amount";
  const series = numericSeries(report, hint, recs.length ? recs : undefined);
  if (!series || !series.values.length) {
    return { text: `No numeric “${hint}” values were found in the files.`, report, showReport: false };
  }
  const vals = series.values;
  const sum = vals.reduce((a, b) => a + b, 0);
  const avg = sum / vals.length;
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const op = intent.aggregate ?? "sum";
  const raw = op === "avg" ? avg : op === "min" ? min : op === "max" ? max : sum;
  const label = formatNum(series.field, raw);
  const verb = op === "avg" ? "Average" : op === "min" ? "Minimum" : op === "max" ? "Maximum" : "Total";
  let extra = "";
  if (op === "max" || op === "min") {
    const target = op === "max" ? max : min;
    const hit = (recs.length ? recs : report.records).find((r) => {
      const v = getField(r, aliasesForHint(hint));
      return v !== undefined && parseNumber(v) === target;
    });
    if (hit) extra = ` — ${formatRecord(hit)}`;
  }
  return {
    text: `${verb} ${series.field}: ${label} across ${vals.length} row${vals.length === 1 ? "" : "s"}${extra}.`,
    report,
    table: recordsToTable((recs.length ? recs : report.records).slice(0, 12), [hint, "merchant", "name"]),
    showReport: false,
    subject: intent.subject,
  };
}

function answerSearch(report: AnalysisReport, intent: QueryIntent, question: string): AnswerPayload {
  const needles = [intent.subject, ...intent.terms].filter((x): x is string => Boolean(x));
  const recs = matchingRecords(report, needles, 2);
  if (recs.length) {
    if (intent.fieldHints.length === 1) {
      const vals = valuesForHint(report, intent.fieldHints[0]!, recs);
      if (vals.length) {
        return {
          text: `${intent.fieldHints[0]}: ${vals.slice(0, 15).join(", ")}.`,
          report,
          table: recordsToTable(recs, intent.fieldHints),
          showReport: false,
          subject: getField(recs[0]!, aliasesForHint("name")) ?? intent.subject,
        };
      }
    }
    const lines = recs.slice(0, 6).map((r) => `• ${formatRecord(r)}`);
    return {
      text: `Matches for “${question.trim()}”:\n${lines.join("\n")}`,
      report,
      table: recordsToTable(recs),
      showReport: false,
      subject: getField(recs[0]!, aliasesForHint("name")) ?? intent.subject,
    };
  }

  const terms = intent.terms;
  const hits = report.categories
    .map((c) => ({
      ...c,
      findings: c.findings.filter((f) => {
        const blob = `${f.field} ${f.raw} ${f.clean} ${c.label}`.toLowerCase();
        return terms.some((t) => blob.includes(t));
      }),
    }))
    .filter((c) => c.findings.length > 0)
    .map((c) => ({ ...c, count: c.findings.length }));

  if (hits.length) {
    const lines = hits.flatMap((c) => c.findings.slice(0, 4).map((f) => `• ${c.label}: ${f.clean}`));
    return {
      text: `From mapped signals:\n${lines.slice(0, 12).join("\n")}`,
      report,
      filtered: hits,
      showReport: true,
    };
  }

  return {
    text: `Nothing in the attached files matches “${question.trim()}”. Ask about a name, email, column, or attach a richer file.`,
    report,
    showReport: false,
  };
}

function luminaFor(question: string, report: AnalysisReport, lastSubject?: string | null): AnswerPayload | null {
  const wb = workbookFor(report);
  if (!wb) return null;
  try {
    const out = answerLumina(question, wb, lastSubject);
    if (!out) return null;
    return { text: out.text, report, table: out.table, showReport: false, subject: out.subject, notes: out.notes };
  } catch {
    return null;
  }
}

export function answerQuestion(
  question: string,
  report: AnalysisReport | null,
  hasFiles: boolean,
  lastSubject?: string | null,
): AnswerPayload {
  const intent = interpretQuery(question, report, lastSubject);

  if (intent.kind === "help" || (!hasFiles && !report)) {
    return { text: HELP_TEXT, showReport: false };
  }

  if (!report) {
    return {
      text: "Attach a CSV, JSON, log, or paste raw data with your question. I only answer from evidence in the files.",
      showReport: false,
    };
  }

  const lumina = luminaFor(question, report, lastSubject);
  if (lumina) return lumina;

  const complex = executeComplex(question, report, lastSubject);
  if (complex) return complex;

  if (intent.kind === "lookup") return answerLookup(report, intent);
  if (intent.kind === "list") return answerList(report, intent);
  if (intent.kind === "aggregate") return answerAggregate(report, intent);
  if (intent.kind === "search") return answerSearch(report, intent, question);

  if (intent.kind === "count") {
    if (intent.fieldHints.includes("records")) {
      return {
        text: `${report.records.length} record${report.records.length === 1 ? "" : "s"} in the files.`,
        report,
        table: recordsToTable(report.records.slice(0, 12)),
        showReport: false,
      };
    }
    if (intent.fieldHints.includes("name")) {
      const names = valuesForHint(report, "name");
      return {
        text: `${names.length} people in the files${names.length ? `: ${names.join(", ")}` : "."}`,
        report,
        table: recordsToTable(report.records, ["name", "email", "title"]),
        showReport: false,
      };
    }
    if (intent.fieldHints.length) {
      const vals = valuesForHint(report, intent.fieldHints[0]!);
      return {
        text: `${vals.length} unique ${intent.fieldHints[0]} value${vals.length === 1 ? "" : "s"} in the files${vals.length ? `: ${vals.slice(0, 12).join(", ")}` : ""}.`,
        report,
        showReport: false,
      };
    }
    const cats = intent.categoryIds.length
      ? report.categories.filter((c) => intent.categoryIds.includes(c.id))
      : report.categories;
    if (!cats.length) {
      return {
        text: `${report.records.length} indexed record${report.records.length === 1 ? "" : "s"} across ${report.files.length} file${report.files.length === 1 ? "" : "s"}.`,
        report,
        showReport: false,
      };
    }
    const lines = cats.map((c) => `• ${c.label}: ${c.count} signal${c.count === 1 ? "" : "s"}`);
    return {
      text: `${report.records.length} records. Mapped counts:\n${lines.join("\n")}`,
      report,
      filtered: cats,
      showReport: true,
    };
  }

  if (intent.kind === "stats") {
    if (!report.stats.length) {
      return { text: "No numeric series with variance were found.", report, showReport: false };
    }
    const lines = report.stats
      .slice(0, 12)
      .map((s) => `• ${s.field}: n=${s.count}, min=${s.min}, mean=${s.mean}, max=${s.max}`);
    return { text: `Numeric ranges from the files:\n${lines.join("\n")}`, report, showReport: false };
  }

  if (intent.kind === "category") {
    const cats = report.categories.filter((c) => intent.categoryIds.includes(c.id));
    if (!cats.length) {
      const wanted = intent.categoryIds.map((id) => CATEGORY_BY_ID.get(id)?.label ?? id).join(", ");
      return {
        text: `Nothing in the attached files mapped to ${wanted}.`,
        report,
        showReport: false,
      };
    }
    const lines = cats.flatMap((c) => c.findings.slice(0, 5).map((f) => `• ${c.label}: ${f.clean}`));
    return {
      text: `${cats.map((c) => c.label).join(", ")} — ${cats.reduce((a, c) => a + c.count, 0)} values:\n${lines.slice(0, 16).join("\n")}`,
      report,
      filtered: cats,
      showReport: true,
    };
  }

  if (intent.kind === "clean") {
    const cats = intent.categoryIds.length
      ? report.categories.filter((c) => intent.categoryIds.includes(c.id))
      : report.categories;
    return {
      text: `Cleaned records from the files. Export JSON or CSV on a domain for a copy.`,
      report,
      filtered: cats,
      table: recordsToTable(report.records.slice(0, 12)),
      showReport: true,
    };
  }

  return {
    text: report.overview,
    report,
    filtered: report.categories,
    table: recordsToTable(report.records.slice(0, 8)),
    showReport: true,
  };
}

export function suggestedFollowups(report: AnalysisReport | null): string[] {
  if (!report || (report.records.length === 0 && report.categories.length === 0)) {
    return ["What can you extract?", "Paste a CSV and ask a question"];
  }
  const out: string[] = [];
  const names = valuesForHint(report, "name").slice(0, 2);
  if (names[0]) out.push(`What is ${names[0]}'s email?`);
  if (valuesForHint(report, "amount").length) out.push("Top 3 transactions by amount");
  if (valuesForHint(report, "employer").length) out.push("Group people by employer");
  if (valuesForHint(report, "email").length && out.length < 4) out.push("List all emails");
  const top = [...report.categories].sort((a, b) => b.count - a.count)[0];
  if (top) out.push(`Show ${top.label.toLowerCase()}`);
  if (out.length < 4) out.push("How many records are there?");
  return out.slice(0, 4);
}

export function reportToJson(report: AnalysisReport, ids?: string[]): string {
  const cats = ids?.length ? report.categories.filter((c) => ids.includes(c.id)) : report.categories;
  const payload = {
    generatedAt: new Date(report.createdAt).toISOString(),
    mode: report.mode,
    files: report.files,
    coverage: report.coverage,
    records: report.records.slice(0, 500),
    domains: cats.map((c) => ({
      id: c.id,
      label: c.label,
      group: c.group,
      count: c.count,
      records: report.cleaned[c.id] ?? [],
    })),
  };
  return JSON.stringify(payload, null, 2);
}

export function reportToCsv(report: AnalysisReport, categoryId: string): string {
  const rows = report.cleaned[categoryId] ?? [];
  if (!rows.length) return "";
  const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const esc = (v: string) => {
    if (/[",\n]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
    return v;
  };
  const lines = [cols.join(",")];
  for (const row of rows) {
    lines.push(cols.map((c) => esc(String(row[c] ?? ""))).join(","));
  }
  return lines.join("\n");
}

export function downloadText(filename: string, text: string, mime: string) {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
