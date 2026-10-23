import type { ParsedFile } from "./types.ts";

const MAX_CHARS = 8_000_000;
const MAX_ROWS = 200_000;

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function looksJson(text: string): boolean {
  const t = text.trim();
  return t.startsWith("{") || t.startsWith("[");
}

function parseCsv(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let i = 0;
  let inQuotes = false;
  const src = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  while (i < src.length) {
    const ch = src[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      cell += ch;
      i += 1;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === delimiter) {
      row.push(cell);
      cell = "";
      i += 1;
      continue;
    }
    if (ch === "\n") {
      row.push(cell);
      if (row.some((c) => c.trim() !== "")) rows.push(row);
      row = [];
      cell = "";
      i += 1;
      continue;
    }
    cell += ch;
    i += 1;
  }
  row.push(cell);
  if (row.some((c) => c.trim() !== "")) rows.push(row);
  return rows;
}

function detectDelimiter(text: string): string {
  const sample = text.split("\n").slice(0, 12).join("\n");
  const candidates: Array<[string, number]> = [
    [",", (sample.match(/,/g) ?? []).length],
    ["\t", (sample.match(/\t/g) ?? []).length],
    [";", (sample.match(/;/g) ?? []).length],
    ["|", (sample.match(/\|/g) ?? []).length],
  ];
  candidates.sort((a, b) => b[1] - a[1]);
  return candidates[0]![1] > 0 ? candidates[0]![0] : ",";
}

function headerScore(cells: string[]): number {
  if (cells.length < 2) return 0;
  let score = 0;
  for (const c of cells) {
    const t = c.trim();
    if (!t) continue;
    if (/^[A-Za-z][A-Za-z0-9 _/#().-]{1,48}$/.test(t)) score += 2;
    if (/^\d+(\.\d+)?$/.test(t)) score -= 2;
  }
  return score / cells.length;
}

function rowsToObjects(grid: string[][]): {
  columns: string[];
  rows: Record<string, unknown>[];
} {
  if (grid.length === 0) return { columns: [], rows: [] };
  let headerIdx = 0;
  let best = -Infinity;
  const scan = Math.min(grid.length, 8);
  for (let i = 0; i < scan; i += 1) {
    const s = headerScore(grid[i]!);
    if (s > best) {
      best = s;
      headerIdx = i;
    }
  }
  const rawHeader = grid[headerIdx]!;
  const used = new Map<string, number>();
  const columns = rawHeader.map((h, idx) => {
    const base = h.trim() || `column_${idx + 1}`;
    const n = used.get(base) ?? 0;
    used.set(base, n + 1);
    return n === 0 ? base : `${base}_${n + 1}`;
  });
  const rows: Record<string, unknown>[] = [];
  for (let i = headerIdx + 1; i < grid.length && rows.length < MAX_ROWS; i += 1) {
    const line = grid[i]!;
    if (line.every((c) => !c.trim())) continue;
    const obj: Record<string, unknown> = {};
    for (let c = 0; c < columns.length; c += 1) {
      obj[columns[c]!] = (line[c] ?? "").trim();
    }
    rows.push(obj);
  }
  return { columns, rows };
}

function flatten(
  value: unknown,
  prefix: string,
  target: Record<string, unknown>,
  depth: number,
): void {
  if (depth > 8 || value === null || value === undefined) return;
  if (Array.isArray(value)) {
    if (value.every((v) => v !== null && typeof v !== "object")) {
      target[prefix || "list"] = value.map((v) => String(v)).join(", ");
      return;
    }
    value.slice(0, 40).forEach((item, i) => flatten(item, prefix ? `${prefix}.${i}` : String(i), target, depth + 1));
    return;
  }
  if (typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      flatten(v, prefix ? `${prefix}.${k}` : k, target, depth + 1);
    }
    return;
  }
  target[prefix || "value"] = value;
}

function collectObjectArrays(value: unknown, out: Record<string, unknown>[], depth: number): void {
  if (depth > 6 || !value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    if (value.length && value.every((x) => x && typeof x === "object" && !Array.isArray(x))) {
      for (const item of value.slice(0, MAX_ROWS)) out.push(item as Record<string, unknown>);
    }
    return;
  }
  for (const v of Object.values(value as Record<string, unknown>)) {
    collectObjectArrays(v, out, depth + 1);
  }
}
function parseJsonish(text: string): { rows: Record<string, unknown>[]; columns: string[] } | null {
  const trimmed = text.trim();
  try {
    const data = JSON.parse(trimmed) as unknown;
    if (Array.isArray(data)) {
      if (data.length === 0) return { rows: [], columns: [] };
      if (data.every((x) => x && typeof x === "object" && !Array.isArray(x))) {
        const columns = [...new Set(data.flatMap((r) => Object.keys(r as object)))];
        return { rows: data as Record<string, unknown>[], columns };
      }
    }
    if (data && typeof data === "object") {
      const obj = data as Record<string, unknown>;
      for (const key of ["records", "rows", "data", "items", "results", "events", "users", "transactions"]) {
        const inner = obj[key];
        if (Array.isArray(inner) && inner.every((x) => x && typeof x === "object")) {
          const columns = [...new Set(inner.flatMap((r) => Object.keys(r as object)))];
          return { rows: inner as Record<string, unknown>[], columns };
        }
      }
      const nested: Record<string, unknown>[] = [];
      collectObjectArrays(obj, nested, 0);
      const flat: Record<string, unknown> = {};
      flatten(obj, "", flat, 0);
      const rows = [flat, ...nested].slice(0, MAX_ROWS);
      const columns = [...new Set(rows.flatMap((r) => Object.keys(r)))];
      return { rows, columns };
    }
  } catch {
    /* try ndjson */
  }

  const lines = trimmed.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length >= 2 && lines.slice(0, 8).every((l) => l.startsWith("{") || l.startsWith("["))) {
    const rows: Record<string, unknown>[] = [];
    for (const line of lines.slice(0, MAX_ROWS)) {
      try {
        const v = JSON.parse(line) as unknown;
        if (v && typeof v === "object" && !Array.isArray(v)) rows.push(v as Record<string, unknown>);
      } catch {
        /* skip */
      }
    }
    if (rows.length) {
      const columns = [...new Set(rows.flatMap((r) => Object.keys(r)))];
      return { rows, columns };
    }
  }
  return null;
}

function parseLogRecords(text: string): Record<string, unknown>[] {
  const rows: Record<string, unknown>[] = [];
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const kv: Record<string, unknown> = {};
    const ts = t.match(/^(\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?)/);
    if (ts) kv.timestamp = ts[1];
    const re = /\b([A-Za-z][A-Za-z0-9_]{1,32})[:=](?:"([^"]*)"|'([^']*)'|([^\s,;]+))/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(t))) {
      kv[m[1]!] = (m[2] ?? m[3] ?? m[4] ?? "").trim();
    }
    const gps = t.match(/\bGPS\s+(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/i);
    if (gps) {
      kv.latitude = gps[1];
      kv.longitude = gps[2];
    }
    const mac = t.match(/\bMAC\s+([0-9A-Fa-f]{2}(?::[0-9A-Fa-f]{2}){5})/i);
    if (mac) kv.mac_address = mac[1];
    const quoted = t.match(/\b(?:chat|q|query|search_query)\s*[:=]\s*"([^"]+)"/i);
    if (quoted) kv.message = quoted[1];
    if (Object.keys(kv).length >= 2) rows.push(kv);
  }
  return rows;
}

function parseKvLines(text: string): Record<string, unknown>[] {
  const rows: Record<string, unknown>[] = [];
  let current: Record<string, unknown> = {};
  for (const line of text.split("\n")) {
    const m = line.match(/^\s*([A-Za-z][\w ./-]{1,40})\s*[:=]\s*(.+)$/);
    if (m) {
      current[m[1]!.trim()] = m[2]!.trim();
      continue;
    }
    if (!line.trim() && Object.keys(current).length) {
      rows.push(current);
      current = {};
    }
  }
  if (Object.keys(current).length) rows.push(current);
  return rows;
}

function parseXmlish(text: string): Record<string, unknown>[] {
  const rows: Record<string, unknown>[] = [];
  const tag = /<([A-Za-z][\w:-]*)[^>]*>([^<]{1,400})<\/\1>/g;
  const bag: Record<string, unknown> = {};
  let m: RegExpExecArray | null;
  while ((m = tag.exec(text))) {
    const key = m[1]!;
    const val = m[2]!.trim();
    if (val) bag[key] = bag[key] ? `${String(bag[key])}, ${val}` : val;
  }
  if (Object.keys(bag).length) rows.push(bag);
  return rows;
}

function unwrapFences(text: string): string {
  return text
    .replace(/```(?:csv|json|tsv|txt|log|xml|yaml|yml|js|javascript|ndjson)?\s*\n([\s\S]*?)```/gi, "\n$1\n")
    .replace(/```([\s\S]*?)```/g, "\n$1\n")
    .trim();
}

function isQuestionLine(line: string): boolean {
  const t = line.trim();
  if (!t || t.length > 280) return false;
  if (/^[{\[]/.test(t) || looksLikeData(t)) return false;
  if (/\?$/.test(t)) return true;
  return /^(who|what|where|when|which|how|why|list|show|give|tell|sum|total|count|extract|find|get)\b/i.test(t);
}

export function looksLikeData(text: string): boolean {
  const t = unwrapFences(text).trim();
  if (t.length < 8) return false;
  if (t.startsWith("{") || t.startsWith("[")) return true;
  const lines = t.split("\n").filter((l) => l.trim() && !l.trim().startsWith("#"));
  if (lines.length < 2) return false;
  if (lines.length <= 3 && lines.every((l) => isQuestionLine(l))) return false;
  const commaCounts = lines.slice(0, 12).map((l) => (l.match(/,/g) ?? []).length);
  const commaRows = commaCounts.filter((n) => n >= 1);
  if (commaRows.length >= 2 && commaRows[0] === commaRows[1]) return true;
  const commas = commaCounts.filter((n) => n >= 2).length;
  const tabs = lines.slice(0, 8).filter((l) => l.includes("\t")).length;
  const kv = lines.slice(0, 8).filter((l) => /^[A-Za-z][\w ./-]{1,40}\s*[:=]\s*.+/.test(l)).length;
  return commas >= 2 || tabs >= 2 || kv >= 3;
}

export function splitQuestionAndData(text: string): { question: string; data: string | null } {
  const t = unwrapFences(text);
  if (!t) return { question: "", data: null };

  const firstBreak = t.search(/\n/);
  if (firstBreak > 0) {
    const first = t.slice(0, firstBreak).trim();
    const rest = t.slice(firstBreak + 1).trim();
    const restIsData = looksLikeData(rest) || rest.startsWith("{") || rest.startsWith("[");
    if (first.length <= 280 && restIsData && !looksLikeData(first) && isQuestionLine(first)) {
      return { question: first, data: rest };
    }
  }

  const blocks = t.split(/\n\s*\n/);
  if (blocks.length >= 2) {
    const last = blocks[blocks.length - 1]!.trim();
    const head = blocks.slice(0, -1).join("\n\n").trim();
    if (looksLikeData(last) && head.length > 0 && head.length < 800 && !looksLikeData(head)) {
      return { question: head.replace(/\s+/g, " "), data: last };
    }
    const firstBlock = blocks[0]!.trim();
    const restBlocks = blocks.slice(1).join("\n\n").trim();
    if (looksLikeData(firstBlock) && restBlocks.length > 0 && restBlocks.length < 800 && !looksLikeData(restBlocks)) {
      return { question: restBlocks.replace(/\s+/g, " "), data: firstBlock };
    }
  }

  const lines = t.split("\n").map((l) => l.trimEnd());
  const lastLine = lines.at(-1)?.trim() ?? "";
  if (lines.length >= 3 && isQuestionLine(lastLine)) {
    const body = lines.slice(0, -1).join("\n").trim();
    if (looksLikeData(body)) return { question: lastLine, data: body };
  }
  const firstLine = lines[0]?.trim() ?? "";
  if (lines.length >= 3 && isQuestionLine(firstLine)) {
    const body = lines.slice(1).join("\n").trim();
    if (looksLikeData(body) || body.startsWith("{") || body.startsWith("[")) {
      return { question: firstLine, data: body };
    }
  }

  if (looksLikeData(t)) {
    const qMark = t.indexOf("?");
    if (qMark < 0 || qMark > 180) {
      return { question: "Extract a clean intelligence report", data: t };
    }
  }

  return { question: t, data: null };
}

export function parseFileText(name: string, size: number, raw: string): ParsedFile {
  const warnings: string[] = [];
  let truncated = false;
  let text = stripBom(raw);
  if (text.length > MAX_CHARS) {
    text = text.slice(0, MAX_CHARS);
    truncated = true;
    warnings.push(`File truncated for analysis (first ${Math.round(MAX_CHARS / 1_000_000)} MB kept).`);
  }

  const lower = name.toLowerCase();
  const json = parseJsonish(text);
  if (json && (looksJson(text) || lower.endsWith(".json") || lower.endsWith(".ndjson") || lower.endsWith(".har"))) {
    return {
      name,
      size,
      kind: "json",
      rows: json.rows.slice(0, MAX_ROWS),
      columns: json.columns,
      text,
      warnings,
      truncated,
    };
  }

  const looksLog =
    lower.endsWith(".log") ||
    /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:/.test(text) ||
    (text.match(/\b[A-Za-z][\w]{1,24}=/g) ?? []).length >= 8;

  if (looksLog) {
    const logRows = parseLogRecords(text);
    if (logRows.length >= 2) {
      const columns = [...new Set(logRows.flatMap((r) => Object.keys(r)))];
      return {
        name,
        size,
        kind: "log",
        rows: logRows.slice(0, MAX_ROWS),
        columns,
        text,
        warnings,
        truncated,
      };
    }
  }

  const isTabularExt = /\.(csv|tsv|txt|log|dat)$/i.test(lower);
  const delimiter = lower.endsWith(".tsv") ? "\t" : detectDelimiter(text);
  const grid = parseCsv(text, delimiter);
  const avgWidth = grid.length ? grid.reduce((a, r) => a + r.length, 0) / grid.length : 0;

  if (grid.length >= 2 && avgWidth >= 2 && (isTabularExt || avgWidth >= 3)) {
    const table = rowsToObjects(grid);
    if (table.rows.length) {
      return {
        name,
        size,
        kind: "table",
        rows: table.rows,
        columns: table.columns,
        text,
        warnings,
        truncated,
      };
    }
  }

  if (/<[a-zA-Z][\s\S]{20,}<\/[a-zA-Z]/.test(text)) {
    const xmlRows = parseXmlish(text);
    if (xmlRows.length && Object.keys(xmlRows[0]!).length >= 3) {
      return {
        name,
        size,
        kind: "text",
        rows: xmlRows,
        columns: Object.keys(xmlRows[0]!),
        text,
        warnings,
        truncated,
      };
    }
  }

  const kv = parseKvLines(text);
  if (kv.length) {
    const columns = [...new Set(kv.flatMap((r) => Object.keys(r)))];
    return {
      name,
      size,
      kind: /\.(log|txt)$/i.test(lower) ? "log" : "text",
      rows: kv,
      columns,
      text,
      warnings,
      truncated,
    };
  }

  return {
    name,
    size,
    kind: /\.log$/i.test(lower) ? "log" : "text",
    rows: [],
    columns: [],
    text,
    warnings,
    truncated,
  };
}

export async function readAsText(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return new TextDecoder("utf-16le").decode(bytes);
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return new TextDecoder("utf-16be").decode(bytes);
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}
