// Typed, cleaned tables built from parsed files. Everything here is deterministic
// and runs on-device: type inference, value cleaning, category canonicalisation,
// summary / duplicate detection and relationship (join key) discovery.

import type { ParsedFile } from "../types.ts";
import {
  booleanPair, clean, epochToTime, excelSerialToTime, fmtDate, inferDateOrder, isMissing, looksLeadingZero, norm,
  parseDate, parseNum, stem, words,
} from "./values.ts";

export type ColType =
  | "number" | "currency" | "percent" | "date" | "boolean" | "category" | "text" | "id" | "email" | "phone" | "url" | "ip";

export type Column = {
  id: number;
  tableId: number;
  name: string;
  key: string;
  tokens: string[];
  type: ColType;
  kind: "measure" | "dimension" | "time" | "id" | "text";
  n: number;
  missing: number;
  text: string[];
  levels: string[];
  codes: Int32Array;
  num: Float64Array;
  time: Float64Array;
  dec: number;
  cur?: string;
  hasTime: boolean;
  flag: boolean;
  year: boolean;
  person: boolean;
  boolTrue?: string;
  dateOrder?: "mdy" | "dmy";
  dateAmbiguous?: boolean;
  bad: string[];
  badCount: number;
  nonSpendHint?: boolean;
};

export type Table = {
  id: number;
  name: string;
  nameTokens: string[];
  source: string;
  n: number;
  cols: Column[];
  skip: Uint8Array;
  dup: Int32Array;
  dupCount: number;
  skipCount: number;
  layoutSkipCount: number;
  log: string[];
  summaryLabels: string[];
};

export type Rel = { a: Table; aCol: Column; b: Table; bCol: Column; coverage: number };

export type Workbook = { tables: Table[]; rels: Rel[]; log: string[]; truncated: boolean; truncatedFiles: string[] };

type RawTable = { name: string; source: string; headers: string[]; cells: string[][]; notes: string[] };

// ---------------------------------------------------------------- header helpers

export function headerTokens(name: string): string[] {
  const spaced = name
    .replace(/\be[- ]?mail\b/gi, "email")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2");
  return words(spaced);
}

const MONEY_WORDS = new Set([
  "amount", "price", "cost", "revenue", "sales", "sale", "salary", "spend", "spent", "fee", "fees", "balance",
  "payment", "income", "profit", "wage", "pay", "debit", "credit", "budget", "charge", "expense", "expenses",
  "earnings", "turnover", "gmv", "tax", "discount", "refund", "mrr", "arr", "ltv", "subtotal", "gross", "net",
]);
const ID_LAST = new Set([
  "id", "uuid", "guid", "code", "sku", "key", "ref", "reference", "number", "no", "num", "zip", "postal", "postcode",
  "isbn", "serial", "ssn", "pin", "hash", "token",
]);
const DATE_WORDS = new Set([
  "date", "time", "timestamp", "datetime", "dob", "birthday", "born", "created", "updated", "modified", "joined",
  "hired", "expires", "expiry", "due", "deadline", "ts",
]);
const PERSON_WORDS = new Set([
  "name", "employee", "customer", "person", "user", "member", "client", "student", "patient", "manager", "owner",
  "author", "contact", "rep", "representative", "assignee", "supervisor", "boss", "staff", "worker", "seller",
  "buyer", "applicant", "candidate", "player", "agent", "teacher", "driver",
]);
const NOT_PERSON = new Set([
  "company", "product", "merchant", "vendor", "org", "organization", "brand", "city", "country", "state", "file",
  "host", "hostname", "project", "team", "department", "category", "business", "store", "device", "item", "region",
  "campaign", "channel", "plan", "service", "app", "site", "domain", "school", "university", "venue", "team",
]);

export function isMoneyHeader(tokens: string[]): boolean {
  return tokens.some((t) => MONEY_WORDS.has(t));
}
function isIdHeader(tokens: string[]): boolean {
  if (!tokens.length) return false;
  return ID_LAST.has(tokens[tokens.length - 1]!) || (tokens[0] === "id" && tokens.length <= 2);
}
function isDateHeader(tokens: string[]): boolean {
  return tokens.some((t) => DATE_WORDS.has(t)) || tokens[tokens.length - 1] === "at";
}

// ---------------------------------------------------------------- canonical keys

function titleCase(s: string): string {
  return s.replace(/\b([a-z])/g, (m) => m.toUpperCase());
}

function genderKey(v: string): string {
  const t = norm(v);
  if (["f", "female", "woman", "women", "girl", "fem"].includes(t)) return "female";
  if (["m", "male", "man", "men", "boy"].includes(t)) return "male";
  if (["nb", "non binary", "nonbinary", "enby", "x"].includes(t)) return "non-binary";
  return t;
}

export function paymentFamily(raw: string): string {
  const compact = raw
    .toLowerCase()
    .replace(/(?:\*+|x{2,}|#|ending(?: in)?\s*|last\s*4\s*)\s*\d{2,}/g, " ")
    .replace(/\d+/g, " ")
    .replace(/[^a-z]+/g, "");
  if (compact.startsWith("visa")) return "Visa";
  if (compact === "mc" || compact.startsWith("master")) return "Mastercard";
  if (compact.includes("amex") || compact.includes("americanexpress")) return "American Express";
  if (compact.includes("applepay")) return "Apple Pay";
  if (compact.includes("googlepay") || compact === "gpay") return "Google Pay";
  if (compact.includes("paypal")) return "PayPal";
  if (compact.includes("discover")) return "Discover";
  if (compact.includes("debit")) return "Debit";
  return "";
}

function personKey(v: string): string {
  return norm(v).split(" ").sort().join(" ");
}

/** "Venn, Sora" -> "Sora Venn": a comma between two short name parts. */
function flipLastFirst(label: string): string {
  const m = /^([^,\d]{1,30}),\s*([^,\d]{1,30})$/.exec(label.trim());
  return m ? `${m[2]!.trim()} ${m[1]!.trim()}` : label;
}

type CanonMode = "plain" | "person" | "gender" | "payment";

function canonicalize(
  text: string[],
  mode: CanonMode,
): { levels: string[]; codes: Int32Array; merges: Array<[string, string[]]> } {
  const keyFn = (v: string): string => {
    if (mode === "gender") return genderKey(v);
    if (mode === "payment") return paymentFamily(v).toLowerCase() || norm(v) || v.toLowerCase();
    if (mode === "person") return personKey(v) || v.toLowerCase();
    return norm(v) || v.toLowerCase();
  };
  const groups = new Map<string, { variants: Map<string, number>; idx: number }>();
  const keys = new Array<string>(text.length);
  const cache = new Map<string, string>();
  for (let i = 0; i < text.length; i += 1) {
    const v = text[i]!;
    if (!v) {
      keys[i] = "";
      continue;
    }
    let k = cache.get(v);
    if (k === undefined) {
      k = keyFn(v);
      cache.set(v, k);
    }
    keys[i] = k;
    let g = groups.get(k);
    if (!g) {
      g = { variants: new Map(), idx: groups.size };
      groups.set(k, g);
    }
    g.variants.set(v, (g.variants.get(v) ?? 0) + 1);
  }
  const levels: string[] = new Array(groups.size);
  const index = new Map<string, number>();
  const merges: Array<[string, string[]]> = [];
  for (const [k, g] of groups) {
    let label = "";
    let best = -1;
    for (const [variant, count] of g.variants) {
      const proper = /^[A-Z][a-z]/.test(variant) ? 2 : /[a-z]/.test(variant) && /[A-Z]/.test(variant) ? 1 : 0;
      const personBonus = mode === "person" && !variant.includes(",") ? 5 : 0;
      const score = count * 10 + proper + personBonus;
      if (score > best) {
        best = score;
        label = variant;
      }
    }
    if (mode === "gender") label = genderKey(label) === "non-binary" ? "non-binary" : genderKey(label) || label;
    if (mode === "payment") label = paymentFamily(label) || label;
    if (mode === "person") label = flipLastFirst(label);
    if (mode === "gender" && ["female", "male"].includes(label)) label = label;
    levels[g.idx] = label;
    index.set(k, g.idx);
    if (g.variants.size > 1) merges.push([label, [...g.variants.keys()].filter((v) => v !== label)]);
  }
  const codes = new Int32Array(text.length);
  for (let i = 0; i < text.length; i += 1) codes[i] = keys[i] ? index.get(keys[i]!)! : -1;
  // gender/payment labels may collide after relabelling; merge duplicate labels
  const seen = new Map<string, number>();
  const remap = new Int32Array(levels.length);
  const finalLevels: string[] = [];
  levels.forEach((lab, i) => {
    const hit = seen.get(lab);
    if (hit !== undefined) remap[i] = hit;
    else {
      seen.set(lab, finalLevels.length);
      remap[i] = finalLevels.length;
      finalLevels.push(lab);
    }
  });
  if (finalLevels.length !== levels.length) for (let i = 0; i < codes.length; i += 1) if (codes[i]! >= 0) codes[i] = remap[codes[i]!]!;
  return { levels: finalLevels, codes, merges };
}

// ---------------------------------------------------------------- column inference

const SAMPLE_MAX = 3000;
const EMAIL = /^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/;
const URL_RE = /^(?:https?:\/\/|www\.)\S+$/i;
const IPV4 = /^(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)$/;
const ID_PATTERN = /^(?:[A-Za-z]{1,6}[-_ ]?\d{2,}|[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$/;
const PERSON_VALUE = /^(?:[\p{Lu}][\p{L}'.-]+(?:\s+[\p{Lu}][\p{L}'.-]+){0,3}|[\p{Lu}][\p{L}'.-]+,\s*[\p{Lu}][\p{L}'.-]+(?:\s+[\p{Lu}]\.?)?)$/u;

function sampleOf(vals: string[]): string[] {
  if (vals.length <= SAMPLE_MAX) return vals;
  const step = vals.length / SAMPLE_MAX;
  return Array.from({ length: SAMPLE_MAX }, (_, i) => vals[Math.floor(i * step)]!);
}

function share(vals: string[], test: (s: string) => boolean): number {
  if (!vals.length) return 0;
  let ok = 0;
  for (const v of vals) if (test(v)) ok += 1;
  return ok / vals.length;
}

function detectLocale(sample: string[]): "us" | "eu" {
  let us = 0;
  let eu = 0;
  for (const s of sample) {
    const t = s.replace(/[^\d.,]/g, "");
    if (/^\d{1,3}(?:\.\d{3})+,\d+$/.test(t) || /^\d+,\d{1,2}$/.test(t) || /^\d{1,3}(?:\.\d{3}){2,}$/.test(t)) eu += 1;
    else if (/^\d{1,3}(?:,\d{3})+\.\d+$/.test(t) || /^\d+\.\d{1,2}$/.test(t) || /^\d{1,3}(?:,\d{3}){2,}$/.test(t)) us += 1;
  }
  return eu > us ? "eu" : "us";
}

function emptyColumn(tableId: number, id: number, name: string, tokens: string[], n: number): Column {
  return {
    id, tableId, name, key: tokens.join("_") || `column_${id + 1}`, tokens, type: "text", kind: "text", n, missing: 0,
    text: [], levels: [], codes: new Int32Array(0), num: new Float64Array(0), time: new Float64Array(0), dec: 0,
    hasTime: false, flag: false, year: false, person: false, bad: [], badCount: 0,
  };
}

function buildColumn(tableId: number, id: number, headerRaw: string, cells: string[], notes: string[]): Column {
  const name = clean(headerRaw) || `column_${id + 1}`;
  const tokens = headerTokens(name);
  const n = cells.length;
  const col = emptyColumn(tableId, id, name, tokens, n);

  // "NA" can be a real code (Namibia / North America): keep it when siblings look like codes.
  let keepNA = false;
  {
    const codes = new Set<string>();
    for (const c of cells) if (/^[A-Z]{2}$/.test(c) && c !== "NA") codes.add(c);
    keepNA = codes.size >= 2;
  }
  const text = new Array<string>(n);
  let missing = 0;
  for (let i = 0; i < n; i += 1) {
    const c = cells[i]!;
    if (keepNA && c === "NA") text[i] = c;
    else if (isMissing(c)) {
      text[i] = "";
      missing += 1;
    } else text[i] = c;
  }
  col.text = text;
  col.missing = missing;
  const present = text.filter(Boolean);
  const sample = sampleOf(present);
  const idHeader = isIdHeader(tokens);
  const dateHeader = isDateHeader(tokens);
  const moneyHeader = isMoneyHeader(tokens);

  if (!present.length) {
    col.type = "text";
    col.kind = "text";
    return col;
  }

  // ---- fixed-pattern types
  if (share(sample, (s) => EMAIL.test(s)) >= 0.8) return finishText(col, "email", "plain", notes);
  if (share(sample, (s) => IPV4.test(s)) >= 0.8) return finishText(col, "ip", "plain", notes);
  if (share(sample, (s) => URL_RE.test(s)) >= 0.8) return finishText(col, "url", "plain", notes);
  if (tokens.some((t) => ["phone", "mobile", "tel", "telephone", "cell", "fax"].includes(t)) && share(sample, (s) => /^[+()\d][\d\s().+-]{6,}$/.test(s)) >= 0.8) {
    return finishText(col, "phone", "plain", notes);
  }

  // ---- booleans (text pairs)
  const distinctSample = [...new Set(sample.map((s) => s.toLowerCase()))];
  if (distinctSample.length <= 2 && booleanPair(distinctSample)) {
    const canon = canonicalize(text, "plain");
    col.type = "boolean";
    col.kind = "dimension";
    col.levels = canon.levels;
    col.codes = canon.codes;
    const pair = booleanPair(canon.levels.map((l) => l.toLowerCase()))!;
    col.boolTrue = canon.levels.find((l) => l.toLowerCase() === pair[0]) ?? canon.levels[0];
    return col;
  }

  // ---- dates
  const dateStrings = sample.filter((s) => !/^\d+$/.test(s) || (dateHeader && /^\d{8}$/.test(s)));
  if (dateStrings.length / sample.length >= (dateHeader ? 0.5 : 0.9)) {
    const ord = inferDateOrder(dateStrings);
    const okShare = share(dateStrings, (s) => parseDate(s, ord.order) !== null);
    if (okShare >= (dateHeader ? 0.6 : 0.9)) return finishDate(col, ord.order, ord.ambiguous, notes);
  }
  if (dateHeader) {
    const nums = sample.map((s) => parseNum(s)).filter((x): x is NonNullable<typeof x> => x !== null);
    if (nums.length / sample.length >= 0.9) {
      const asEpoch = nums.every((x) => epochToTime(x.n) !== null);
      const asExcel = nums.every((x) => excelSerialToTime(x.n) !== null);
      if (asEpoch || asExcel) return finishSerialDate(col, asEpoch ? "epoch" : "excel", notes);
    }
  }

  // ---- numbers
  const locale = detectLocale(sample);
  let okN = 0;
  let withCur = 0;
  let withPct = 0;
  let zeroLead = 0;
  for (const s of sample) {
    const r = parseNum(s, locale, moneyHeader);
    if (!r) continue;
    okN += 1;
    if (r.cur) withCur += 1;
    if (r.kind === "percent") withPct += 1;
    if (looksLeadingZero(s)) zeroLead += 1;
  }
  const numericShare = okN / sample.length;
  const numericNeeded = moneyHeader ? 0.6 : 0.9; // money columns may hold a few non-dollar or note values
  if (numericShare >= numericNeeded && zeroLead / sample.length < 0.2) {
    const yearLike = tokens.includes("year") || tokens.includes("yr");
    if (!(idHeader && !moneyHeader)) {
      return finishNumber(col, locale, moneyHeader, withCur / okN, withPct / okN, yearLike, notes);
    }
  }

  // ---- ids / categories / text
  const distinct = new Set(present).size;
  const ratio = distinct / present.length;
  const idShaped = share(sample, (s) => ID_PATTERN.test(s) || /^\d{3,}$/.test(s)) >= 0.9;
  if (idHeader || (idShaped && ratio >= 0.9)) return finishText(col, "id", "plain", notes);

  const personish =
    tokens.some((t) => PERSON_WORDS.has(t)) &&
    !tokens.some((t) => NOT_PERSON.has(t)) &&
    share(sample, (s) => PERSON_VALUE.test(s)) >= 0.7;
  if (personish) {
    col.person = true;
    return finishText(col, "text", "person", notes);
  }
  const avgLen = present.reduce((a, s) => a + s.length, 0) / present.length;
  const tooWide = avgLen > 60 || (ratio > 0.9 && present.length > 50 && avgLen > 30);
  if (tooWide) {
    col.type = "text";
    col.kind = "text";
    return col;
  }
  const tokenSet = tokens.join(" ");
  const mode: CanonMode = /\b(gender|sex)\b/.test(tokenSet) ? "gender" : /\b(payment|card|checkout|tender)\b/.test(tokenSet) || share(sample, (s) => paymentFamily(s) !== "") >= 0.7 ? "payment" : "plain";
  const isCategory = distinct <= Math.max(30, Math.floor(present.length * 0.2)) || (distinct <= 120 && ratio < 0.5);
  return finishText(col, isCategory ? "category" : "text", mode, notes);
}

function finishText(col: Column, type: ColType, mode: CanonMode, notes: string[]): Column {
  const canon = canonicalize(col.text, mode);
  col.type = type;
  col.kind = type === "id" ? "id" : "dimension";
  col.levels = canon.levels;
  col.codes = canon.codes;
  if (canon.merges.length && type !== "id") {
    const shown = canon.merges.slice(0, 3).map(([label, vars]) => `${vars.slice(0, 4).map((v) => `“${v}”`).join(", ")} → “${label}”`);
    notes.push(`Standardised ${canon.merges.length} spelling group${canon.merges.length === 1 ? "" : "s"} in ${col.name}: ${shown.join("; ")}${canon.merges.length > 3 ? "…" : ""}`);
  }
  return col;
}

function finishDate(col: Column, order: "mdy" | "dmy", ambiguous: boolean, notes: string[]): Column {
  const time = new Float64Array(col.n).fill(Number.NaN);
  let bad = 0;
  let withTime = false;
  for (let i = 0; i < col.n; i += 1) {
    const s = col.text[i]!;
    if (!s) continue;
    const d = /^\d+$/.test(s) && !/^\d{8}$/.test(s) ? null : parseDate(s, order);
    if (d) {
      time[i] = d.t;
      if (d.time) withTime = true;
    } else {
      bad += 1;
      if (col.bad.length < 3) col.bad.push(s);
    }
  }
  col.type = "date";
  col.kind = "time";
  col.time = time;
  col.hasTime = withTime;
  col.dateOrder = order;
  col.dateAmbiguous = ambiguous;
  col.badCount = bad;
  if (bad) notes.push(`${bad} value${bad === 1 ? "" : "s"} in ${col.name} are not valid dates (e.g. “${col.bad[0]}”) and were left blank.`);
  if (ambiguous) notes.push(`Dates in ${col.name} like 01/02/2026 are ambiguous; read as month/day/year. Tell me if they are day/month.`);
  return col;
}

function finishSerialDate(col: Column, mode: "epoch" | "excel", notes: string[]): Column {
  const time = new Float64Array(col.n).fill(Number.NaN);
  for (let i = 0; i < col.n; i += 1) {
    const r = col.text[i] ? parseNum(col.text[i]!) : null;
    if (!r) continue;
    const t = mode === "epoch" ? epochToTime(r.n) : excelSerialToTime(r.n);
    if (t !== null) time[i] = t;
  }
  col.type = "date";
  col.kind = "time";
  col.time = time;
  col.hasTime = true;
  notes.push(`Converted ${mode === "epoch" ? "Unix timestamps" : "Excel serial dates"} in ${col.name} to calendar dates.`);
  return col;
}

function finishNumber(
  col: Column, locale: "us" | "eu", allowMult: boolean, curShare: number, pctShare: number, yearLike: boolean, notes: string[],
): Column {
  const num = new Float64Array(col.n).fill(Number.NaN);
  const curCount = new Map<string, number>();
  let dec = 0;
  let bad = 0;
  let softGone = 0;
  const distinctVals = new Set<number>();
  for (let i = 0; i < col.n; i += 1) {
    const s = col.text[i]!;
    if (!s) continue;
    if (isMissing(s, true)) {
      col.text[i] = "";
      col.missing += 1;
      softGone += 1;
      continue;
    }
    const r = parseNum(s, locale, allowMult);
    if (r) {
      num[i] = r.n;
      if (r.dec > dec) dec = r.dec;
      if (r.cur) curCount.set(r.cur, (curCount.get(r.cur) ?? 0) + 1);
      if (distinctVals.size < 3) distinctVals.add(r.n);
    } else {
      bad += 1;
      col.text[i] = "";
      col.missing += 1;
      if (col.bad.length < 3) col.bad.push(s);
    }
  }
  col.num = num;
  col.dec = Math.min(6, dec);
  col.badCount = bad;
  col.kind = "measure";
  const money = isMoneyHeader(col.tokens);
  col.type = pctShare >= 0.5 ? "percent" : curShare >= 0.3 || money ? "currency" : "number";
  if (col.type === "currency" && !money && curShare < 0.3) col.type = "number";
  if (col.type === "number" && col.tokens[col.tokens.length - 1] === "total" && col.dec >= 1) col.type = "currency";
  let best = 0;
  for (const [c, k] of curCount) if (k > best) {
    best = k;
    col.cur = c;
  }
  const vals = [...distinctVals];
  col.flag = vals.length <= 2 && vals.every((v) => v === 0 || v === 1) && col.n - col.missing > 0;
  if (col.flag) col.kind = "dimension";
  if (yearLike) {
    let allYears = true;
    for (let i = 0; i < col.n; i += 1) {
      const v = num[i]!;
      if (!Number.isNaN(v) && !(Number.isInteger(v) && v >= 1800 && v <= 2200)) {
        allYears = false;
        break;
      }
    }
    if (allYears) {
      col.year = true;
      col.kind = "dimension";
      col.type = "number";
    }
  }
  if (bad) notes.push(`${bad} value${bad === 1 ? "" : "s"} in ${col.name} are not numbers (e.g. “${col.bad[0]}”) and were ignored.`);
  if (softGone) notes.push(`${softGone} placeholder value${softGone === 1 ? "" : "s"} in ${col.name} (like “unknown”) treated as blank.`);
  if (col.type === "currency" && curShare >= 0.3) notes.push(`Read currency symbols and separators in ${col.name} as plain numbers.`);
  if (col.type === "percent") notes.push(`Read ${col.name} as percentages (12% = 12).`);
  if (locale === "eu") notes.push(`Read ${col.name} with comma decimals (1.234,56 = 1234.56).`);
  return col;
}

// ---------------------------------------------------------------- raw table extraction

function flattenInto(v: unknown, prefix: string, out: Map<string, string>, depth: number): void {
  if (v === null || v === undefined || depth > 8) return;
  if (Array.isArray(v)) {
    if (v.every((x) => x === null || typeof x !== "object")) out.set(prefix || "value", v.map((x) => String(x ?? "")).join(", "));
    else out.set(`${prefix || "value"}`, JSON.stringify(v).slice(0, 400));
    return;
  }
  if (typeof v === "object") {
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) flattenInto(x, prefix ? `${prefix}.${k}` : k, out, depth + 1);
    return;
  }
  out.set(prefix || "value", typeof v === "string" ? v : String(v));
}

function objectsToRaw(name: string, source: string, objs: Record<string, unknown>[], notes: string[] = []): RawTable | null {
  if (!objs.length) return null;
  const headers: string[] = [];
  const seen = new Map<string, number>();
  const flat: Array<Map<string, string>> = [];
  for (const o of objs) {
    const m = new Map<string, string>();
    flattenInto(o, "", m, 0);
    flat.push(m);
    for (const k of m.keys()) {
      if (!seen.has(k)) {
        seen.set(k, headers.length);
        headers.push(k);
      }
    }
  }
  const cells = flat.map((m) => headers.map((h) => m.get(h) ?? ""));
  return { name, source, headers, cells, notes };
}

function collectArrays(v: unknown, path: string, out: Array<{ path: string; rows: Record<string, unknown>[] }>, depth: number): void {
  if (depth > 6 || v === null || typeof v !== "object") return;
  if (Array.isArray(v)) {
    const objs = v.filter((x) => x && typeof x === "object" && !Array.isArray(x)) as Record<string, unknown>[];
    if (objs.length >= 1 && objs.length >= v.length * 0.8) {
      out.push({ path, rows: objs });
      return;
    }
    return;
  }
  const obj = v as Record<string, unknown>;
  const vals = Object.values(obj);
  const keys = Object.keys(obj);
  if (keys.length >= 3 && vals.every((x) => x && typeof x === "object" && !Array.isArray(x))) {
    const first = Object.keys(vals[0] as object).sort().join("|");
    const similar = vals.filter((x) => Object.keys(x as object).sort().join("|") === first).length;
    if (similar >= vals.length * 0.8) {
      out.push({ path, rows: keys.map((k) => ({ _key: k, ...(obj[k] as Record<string, unknown>) })) });
      return;
    }
  }
  for (const [k, x] of Object.entries(obj)) collectArrays(x, path ? `${path}.${k}` : k, out, depth + 1);
}

function baseName(file: string): string {
  return file.replace(/^.*[\\/]/, "").replace(/\.[A-Za-z0-9]{1,5}$/, "");
}

function rawTablesFromFile(file: ParsedFile): RawTable[] {
  const base = baseName(file.name);
  const out: RawTable[] = [];
  if (file.kind === "json") {
    let data: unknown = null;
    try {
      data = JSON.parse(file.text.trim());
    } catch {
      const rows: Record<string, unknown>[] = [];
      for (const line of file.text.split("\n")) {
        const t = line.trim();
        if (!t.startsWith("{")) continue;
        try {
          const v = JSON.parse(t) as unknown;
          if (v && typeof v === "object" && !Array.isArray(v)) rows.push(v as Record<string, unknown>);
        } catch {
          /* skip bad line */
        }
      }
      data = rows;
    }
    const arrays: Array<{ path: string; rows: Record<string, unknown>[] }> = [];
    collectArrays(data, "", arrays, 0);
    if (!arrays.length && data && typeof data === "object" && !Array.isArray(data)) {
      // parallel arrays: {"a":[1,2],"b":[3,4]}
      const entries = Object.entries(data as Record<string, unknown>);
      const arrs = entries.filter(([, v]) => Array.isArray(v) && (v as unknown[]).every((x) => x === null || typeof x !== "object"));
      if (arrs.length >= 2 && new Set(arrs.map(([, v]) => (v as unknown[]).length)).size === 1 && (arrs[0]![1] as unknown[]).length >= 2) {
        const len = (arrs[0]![1] as unknown[]).length;
        const rows = Array.from({ length: len }, (_, i) => Object.fromEntries(arrs.map(([k, v]) => [k, (v as unknown[])[i]])));
        arrays.push({ path: "", rows });
      } else {
        const single = objectsToRaw(base, file.name, [data as Record<string, unknown>]);
        if (single) out.push(single);
      }
    }
    arrays.forEach((a) => {
      const nm = arrays.length === 1 ? base : `${base} ${a.path.replace(/\./g, " ")}`.trim();
      const raw = objectsToRaw(nm, file.name, a.rows);
      if (raw) out.push(raw);
    });
    return out;
  }
  if (file.rows.length && file.columns.length) {
    if (file.kind === "table") {
      const headers = file.columns;
      // Values are cleaned once, in buildTable; here they only need to be strings.
      const cells = file.rows.map((r) => headers.map((h) => (r[h] === undefined || r[h] === null ? "" : String(r[h]))));
      return [{ name: base, source: file.name, headers, cells, notes: [] }];
    }
    const raw = objectsToRaw(base, file.name, file.rows);
    return raw ? [raw] : [];
  }
  return out;
}

// ---------------------------------------------------------------- table assembly

const SUMMARY_QUICK = new Set(["total", "totals", "subtotal", "sub total", "grand total", "overall", "overall total", "net total", "sum", "average", "mean", "count", "all"]);
const SUMMARY_LABEL = /^(?:grand total|total|totals|subtotal|sub total|overall|overall total|sum|average|mean|count|all|net total)$/;

function buildTable(raw: RawTable, tableId: number): Table | null {
  const notes: string[] = [...raw.notes];
  const headers = raw.headers.map((h, i) => clean(h) || `column_${i + 1}`);
  let rows = raw.cells;
  const width = headers.length;

  // Drop blank rows, repeated header rows and one-cell note rows.
  const headerNorm = headers.map((h) => norm(h));
  const headerLower = headers.map((h) => h.trim().toLowerCase());
  let repeated = 0;
  let noteRows = 0;
  let touched = 0;
  const kept: string[][] = [];
  for (const r of rows) {
    const cells = r.map((c) => {
      const cc = clean(c);
      if (cc !== c.trim()) touched += 1;
      return cc;
    });
    const filled = cells.filter((c) => !isMissing(c));
    if (!filled.length) continue;
    let same = 0;
    for (let c = 0; c < width; c += 1) if (cells[c] && cells[c]!.toLowerCase() === headerLower[c]) same += 1;
    if (same >= Math.max(2, Math.ceil(filled.length * 0.6)) && width > 1) {
      repeated += 1;
      continue;
    }
    if (width >= 4 && filled.length === 1 && !/^[-\d.,$%()\s]+$/.test(filled[0]!)) {
      noteRows += 1;
      continue;
    }
    while (cells.length < width) cells.push("");
    kept.push(cells.slice(0, width));
  }
  rows = kept;
  if (!rows.length) return null;
  if (repeated) notes.push(`Removed ${repeated} repeated header row${repeated === 1 ? "" : "s"} found inside the data.`);
  if (noteRows) notes.push(`Skipped ${noteRows} note/footer line${noteRows === 1 ? "" : "s"} that were not data rows.`);
  if (touched) notes.push(`Trimmed stray spaces and hidden characters in ${touched.toLocaleString()} cell${touched === 1 ? "" : "s"}.`);

  const n = rows.length;
  const colNotes: string[] = [];
  const cols: Column[] = headers.map((h, c) => buildColumn(tableId, c, h, rows.map((r) => r[c]!), colNotes));
  const table: Table = {
    id: tableId,
    name: norm(raw.name) || `table ${tableId + 1}`,
    nameTokens: words(raw.name).map(stem),
    source: raw.source,
    n,
    cols,
    skip: new Uint8Array(n),
    dup: new Int32Array(n).fill(-1),
    dupCount: 0,
    skipCount: 0,
    layoutSkipCount: 0,
    log: [...notes, ...colNotes],
    summaryLabels: [],
  };

  // Summary / total rows must not be double counted.
  const labelCols = cols.filter((c) => c.kind === "dimension" || c.kind === "text" || c.kind === "id").slice(0, 3);
  const measureCols = cols.filter((c) => c.kind === "measure");
  if (labelCols.length && measureCols.length) {
    for (let i = 0; i < n; i += 1) {
      const label = labelCols
        .filter((c) => SUMMARY_QUICK.has(c.text[i]!.toLowerCase().trim()))
        .map((c) => norm(c.text[i]!))
        .find((t) => SUMMARY_LABEL.test(t));
      if (!label) continue;
      if (!measureCols.some((c) => !Number.isNaN(c.num[i]!))) continue;
      table.skip[i] = 1;
      table.skipCount += 1;
      table.summaryLabels.push(label);
    }
    if (table.skipCount) table.log.push(`Excluded ${table.skipCount} summary row${table.skipCount === 1 ? "" : "s"} (${[...new Set(table.summaryLabels)].join(", ")}) so totals are not counted twice.`);
  }

  // Mixed-section files: rows whose ID is a plain label (e.g. "subscription") rather than the file's ID pattern.
  const idc = cols.find((c) => c.kind === "id");
  if (idc && n >= 4) {
    const shapeOf = (v: string) => v.replace(/[A-Za-z]+/g, "A").replace(/\d+/g, "9");
    const shapes = new Map<string, { count: number; example: string }>();
    let filled = 0;
    for (let i = 0; i < n; i += 1) {
      const v = idc.text[i];
      if (!v || table.skip[i]) continue;
      filled += 1;
      const sh = shapeOf(v);
      const e = shapes.get(sh);
      if (e) e.count += 1;
      else shapes.set(sh, { count: 1, example: v });
    }
    const top = [...shapes.entries()].sort((a, b) => b[1].count - a[1].count)[0];
    if (top && top[0].includes("9") && filled && top[1].count / filled >= 0.6 && top[1].count < filled) {
      let sample = "";
      for (let i = 0; i < n; i += 1) {
        const v = idc.text[i];
        if (!v || table.skip[i]) continue;
        if (shapeOf(v) !== top[0] && /^[A-Za-z][A-Za-z _-]{2,}$/.test(v)) {
          table.skip[i] = 1;
          table.layoutSkipCount += 1;
          sample = sample || v;
        }
      }
      if (table.layoutSkipCount) {
        table.log.push(
          `${table.layoutSkipCount} row${table.layoutSkipCount === 1 ? "" : "s"} use “${sample}” where ${idc.name} values look like “${top[1].example}”, so they look like a different section of the file and were left out of totals.`,
        );
      }
    }
  }

  // Exact duplicate rows.
  const seen = new Map<string, number>();
  const useCols = cols.filter((c) => !c.tokens.every((t) => t === "unnamed"));
  for (let i = 0; i < n; i += 1) {
    if (table.skip[i]) continue;
    const sig = useCols.map((c) => c.text[i]).join("\u0001");
    const first = seen.get(sig);
    if (first === undefined) seen.set(sig, i);
    else {
      table.dup[i] = first;
      table.dupCount += 1;
    }
  }
  if (table.dupCount) table.log.push(`${table.dupCount} exact duplicate row${table.dupCount === 1 ? "" : "s"} found (kept in counts; say “ignore duplicates” to drop them).`);

  const miss = cols.filter((c) => c.missing > 0 && c.missing / n >= 0.05);
  if (miss.length) {
    table.log.push(`Columns with 5%+ blanks: ${miss.slice(0, 5).map((c) => `${c.name} (${Math.round((c.missing / n) * 100)}%)`).join(", ")}.`);
  }
  return table;
}

// ---------------------------------------------------------------- relationships

function keySet(col: Column, table: Table): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i < col.n && out.size < 60_000; i += 1) {
    if (table.skip[i]) continue;
    const code = col.codes[i];
    if (code === undefined || code < 0) continue;
    out.add(norm(col.levels[code]!));
  }
  return out;
}

function nameAffinity(a: Column, b: Column): boolean {
  if (a.key === b.key) return true;
  const sa = new Set(a.tokens.map(stem));
  return b.tokens.some((t) => t !== "id" && sa.has(stem(t))) && (a.type === "id" || b.type === "id" || a.person || b.person);
}

function detectRels(tables: Table[]): Rel[] {
  const rels: Rel[] = [];
  for (let i = 0; i < tables.length; i += 1) {
    for (let j = i + 1; j < tables.length; j += 1) {
      const a = tables[i]!;
      const b = tables[j]!;
      let best: Rel | null = null;
      let bestScore = 0;
      for (const ca of a.cols) {
        if (ca.kind === "measure" || ca.kind === "time" || !ca.levels.length) continue;
        for (const cb of b.cols) {
          if (cb.kind === "measure" || cb.kind === "time" || !cb.levels.length) continue;
          const near = nameAffinity(ca, cb);
          const keyLike = ca.type === "id" || cb.type === "id" || ca.person || cb.person || ca.type === "email" || cb.type === "email";
          if (!near && !keyLike) continue;
          if (ca.levels.length < 2 && cb.levels.length < 2) continue;
          const sa = keySet(ca, a);
          const sb = keySet(cb, b);
          if (!sa.size || !sb.size) continue;
          let hit = 0;
          for (const k of sa) if (sb.has(k)) hit += 1;
          const overlap = hit / Math.min(sa.size, sb.size);
          const uniqueA = ca.levels.length / Math.max(1, ca.n - ca.missing);
          const uniqueB = cb.levels.length / Math.max(1, cb.n - cb.missing);
          if (Math.max(uniqueA, uniqueB) < 0.9) continue;
          if (overlap < (near ? 0.5 : 0.8) || hit < 2) continue;
          const score = overlap + (near ? 0.5 : 0) + (ca.type === "id" ? 0.1 : 0);
          if (score > bestScore) {
            bestScore = score;
            best = { a, aCol: ca, b, bCol: cb, coverage: overlap };
          }
        }
      }
      if (best) rels.push(best);
    }
  }
  return rels;
}

// ---------------------------------------------------------------- public API

export function buildWorkbook(files: ParsedFile[]): Workbook {
  const tables: Table[] = [];
  const log: string[] = [];
  let truncated = false;
  const truncatedFiles: string[] = [];
  for (const file of files) {
    if (file.truncated) {
      truncated = true;
      truncatedFiles.push(file.name);
    }
    for (const w of file.warnings) log.push(`${file.name}: ${w}`);
    for (const raw of rawTablesFromFile(file)) {
      const t = buildTable(raw, tables.length);
      if (t && t.cols.length) tables.push(t);
    }
  }
  const names = new Map<string, number>();
  for (const t of tables) {
    const k = names.get(t.name) ?? 0;
    names.set(t.name, k + 1);
    if (k > 0) t.name = `${t.name} ${k + 1}`;
  }
  return { tables, rels: detectRels(tables), log, truncated, truncatedFiles };
}

/** Rows of a table that count in analysis (summary rows always out; duplicates optional). */
export function liveRows(t: Table, dedupe: boolean): number[] {
  const out: number[] = [];
  for (let i = 0; i < t.n; i += 1) {
    if (t.skip[i]) continue;
    if (dedupe && t.dup[i]! >= 0) continue;
    out.push(i);
  }
  return out;
}

export function displayCell(c: Column, i: number): string {
  if (c.type === "date") {
    const t = c.time[i]!;
    return Number.isNaN(t) ? "" : fmtDate(t, c.hasTime);
  }
  if (c.num.length) {
    const v = c.num[i]!;
    if (Number.isNaN(v)) return "";
    return c.dec > 0 ? v.toFixed(c.dec) : String(v);
  }
  const code = c.codes[i];
  if (code !== undefined && code >= 0) return c.levels[code]!;
  return c.text[i] ?? "";
}

function csvCell(v: string): string {
  return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export function tableToCsv(t: Table, dedupe = false): string {
  const cols = t.cols.filter((c) => !c.tokens.every((x) => x === "unnamed"));
  const lines = [cols.map((c) => csvCell(c.name)).join(",")];
  for (const i of liveRows(t, dedupe)) lines.push(cols.map((c) => csvCell(displayCell(c, i))).join(","));
  return lines.join("\n");
}

export function describeColType(c: Column): string {
  if (c.type === "currency") return "money";
  if (c.type === "category") return "category";
  if (c.type === "id") return "id";
  if (c.person) return "name";
  if (c.year) return "year";
  if (c.flag) return "yes/no flag";
  return c.type;
}
