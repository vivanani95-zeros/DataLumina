// Lumina query engine. It runs entirely on-device: no network, no model, no API key.
// A question is split into parts, every term is grounded against values that really
// exist in the files, tables are joined through shared keys, and numbers are summed
// with exact decimal arithmetic. Anything it cannot ground is reported, never guessed.

import type { AnswerTable } from "../types.ts";
import { displayCell, liveRows, type Column, type Table, type Workbook } from "./table.ts";
import {
  divRound, fmtNum, fmtScaled, MONTH_NAMES, monthIndex, nameKey, parseDate, parseNum, pct, stem, stemKey, toScaled, utc, withCur, words,
} from "./values.ts";

// ---------------------------------------------------------------- public types

export type PersonRef = { tableId: number; row: number };
export type Cond = { tableId: number; label: string; test: (row: number) => boolean };
export type LuminaOutput = { text: string; table?: AnswerTable; notes: string[]; subject: string | null };

type Ctx = { people: PersonRef[] | null; scope: Cond[]; subject: string | null };
type LexHit = { tableId: number; colId: number; code: number; person: boolean };
type Link = { from: number; fromCol: number; to: number; toCol: number; kind: "key" | "name" };
type Term = { text: string; words: string[]; tableId: number; colId: number; codes: number[]; person: boolean };
type Lit = { used: number; kind: "date" | "num"; a: string; b?: string };
type Pending = { kind: "time" | "num"; test: (v: number) => boolean; label: string; month?: number };
type Having = { test: (n: number) => boolean; label: string };
type Model = {
  tables: Table[];
  lex: Map<string, LexHit[]>;
  wordIdx: Map<string, LexHit[]>;
  links: Link[];
  colWords: Set<string>;
  live: Map<number, number[]>;
};
type PartResult = {
  text: string;
  table?: AnswerTable;
  notes: string[];
  subject?: string | null;
  people?: PersonRef[];
  scope?: Cond[];
};

// ---------------------------------------------------------------- vocabulary

const FILLER = `the a an and or of to in on at for from with by per who whom what which when where how many much is are
was were be been being has have had did do does so if then than that this these those them they their her his its she he
it me my our you your please show list give tell find get all any some each every both either just only also more most
least top bottom highest lowest biggest largest smallest first last over under above below between after before since
until excluding except without other not no can could would should will about into onto out up down off there here
total totals sum average avg mean count number amount spend spent spending paid pay combined overall altogether records
record rows row transactions transaction entries entry files file data field fields column columns value values people
person persons employee employees staff user users customer customers name names email emails public local vpn ip gps
date dates time title titles unit units manager managers employer company merchant payment status reports report reported
reporting directly compare versus vs group grouped split broken sorted sort rank ranked among remaining same looks look
tell there's its`;
const STOP = new Set(FILLER.split(/\s+/).filter(Boolean).map((w) => stem(w)));

const MONTH_WORDS = new Set([
  "january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november",
  "december", "jan", "feb", "mar", "apr", "jun", "jul", "aug", "sep", "sept", "oct", "nov", "dec",
]);
const CALENDAR_CAP = new Set([
  "what", "who", "which", "where", "when", "how", "why", "show", "list", "give", "tell", "then", "compare", "group",
  "top", "total", "average", "please", "the", "find", "summarize", "export", "also", "of", "and", "for", "in", "on", "at",
  "among", "do", "does", "did", "is", "are", "was", "were", "can", "could", "would", "should", "will", "my", "our", "your",
  "their", "her", "his", "its", "both", "each", "every", "all", "any", "some", "monday", "tuesday", "wednesday", "thursday",
  "friday", "saturday", "sunday", "usd", "eur", "gbp", "inr", "csv", "json", "ip", "gps", "id", "mr", "mrs", "ms", "dr",
  "i", "we", "it", "this", "that", "these", "those", "there", "here", "if", "so", "as", "by", "with", "from", "to",
  "january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december",
]);

const GENERIC_COL = new Set(["name", "id", "value", "data", "date", "time", "record", "row", "column", "number", "code"]);
const MONEY_ASK = [
  "spend", "spent", "spending", "paid", "pay", "cost", "amount", "price", "revenue", "sales", "salary", "balance", "fee",
  "charge", "dollar", "money", "total", "value", "budget", "income", "wage", "earn",
];
const MONEY_COLS = [
  "amount", "spend", "price", "cost", "revenue", "sales", "salary", "balance", "fee", "charge", "debit", "credit", "total",
  "paid", "value", "budget", "income", "wage", "payment",
];
const FLOW_WORDS = ["amount", "spend", "price", "cost", "paid", "charge", "payment", "total", "sales", "revenue", "fee", "spent"];
const STOCK_WORDS = ["balance", "limit", "budget", "available", "rate", "score", "fico", "percent"];
const NON_SPEND_STEMS = new Set(["holding", "limit", "balance", "statement", "deposit", "refund", "chargeback", "reversal", "dispute", "adjustment", "transfer", "payout"].map((w) => stem(w)));
const KIND_WORDS = ["kind", "type", "category", "class", "entry", "action", "status", "event", "txn"];
const DOB_COLS = ["dob", "birthday", "birth", "birthdate", "born", "birthdate"];
const LABEL_WORDS = [
  "merchant", "vendor", "payee", "name", "title", "hostname", "label", "description", "item", "product", "store",
  "employer", "company", "city", "region", "status",
];
const GENERIC_PREFIX = new Set(["network", "device", "fleet", "data", "info", "details", "record"]);
const CAT_TYPES = new Set(["category", "person", "id", "email", "ip", "boolean"]);
const MANAGER_WORDS = ["manager", "boss", "supervisor", "reports", "lead", "owner"];
const ID_FAMILIES: string[][] = [
  ["subscription", "recurring", "renewal", "membership"],
  ["refund", "reversal", "refunded"],
  ["chargeback", "dispute", "disputed"],
];

type Concept = { id: string; ask: string[]; cols: string[] };
const CONCEPTS: Concept[] = [
  { id: "email", ask: ["email", "mail", "address"], cols: ["email", "mail"] },
  { id: "phone", ask: ["phone", "mobile", "telephone", "tel", "cell"], cols: ["phone", "mobile", "tel", "telephone", "cell"] },
  { id: "title", ask: ["title", "role", "position", "job"], cols: ["title", "role", "position", "job"] },
  { id: "unit", ask: ["unit", "department", "team", "division"], cols: ["unit", "department", "team", "division"] },
  { id: "manager", ask: ["manager", "boss", "supervisor"], cols: MANAGER_WORDS },
  {
    id: "employer", ask: ["employer", "company", "organisation", "organization", "workplace"],
    cols: ["employer", "company", "organisation", "organization", "workplace", "org"],
  },
  { id: "dob", ask: ["birthday", "birth", "born", "dob", "birthdate"], cols: DOB_COLS },
  { id: "ip", ask: ["ip", "ipv4"], cols: ["ip", "ipv4"] },
  {
    id: "geo", ask: ["gps", "coordinates", "coordinate", "location", "latitude", "longitude", "lat", "lng", "lon"],
    cols: ["gps", "coords", "coordinates", "location", "latitude", "longitude", "lat", "lng", "lon"],
  },
  { id: "host", ask: ["hostname", "laptop", "device", "computer", "machine"], cols: ["hostname", "host", "device", "machine"] },
  { id: "mac", ask: ["mac"], cols: ["mac"] },
  { id: "ssid", ask: ["ssid", "wifi"], cols: ["ssid", "wifi"] },
];
const CONCEPT_ASK_STEMS = CONCEPTS.map((c) => ({ id: c.id, ask: new Set(c.ask.map(stem)), cols: new Set(c.cols.map(stem)) }));
const CONCEPT_WORD_STEMS = new Set([...CONCEPT_ASK_STEMS.flatMap((c) => [...c.ask, ...c.cols])]);

const MONTHS_RE =
  "jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?";
const DATE_LIT = [
  String.raw`\d{4}-\d{1,2}-\d{1,2}(?:[t ]\d{1,2}:\d{2}(?::\d{2})?)?`,
  String.raw`\d{1,2}/\d{1,2}/\d{2,4}`,
  `(?:${MONTHS_RE})\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?(?:,?\\s*\\d{4})?`,
  `\\d{1,2}(?:st|nd|rd|th)?\\s+(?:${MONTHS_RE})\\.?(?:,?\\s*\\d{4})?`,
  `(?:${MONTHS_RE})\\.?,?\\s+\\d{4}`,
  String.raw`\b(?:19|20)\d{2}\b`,
  `(?:${MONTHS_RE})(?![a-z])`,
].join("|");
const NUM_LIT = String.raw`[-+]?\d[\d,]*(?:\.\d+)?(?:\s?(?:k|m|mm|bn|million|thousand))?`;
const CUR = String.raw`(?:\$|€|£|₹|usd\s*|eur\s*|gbp\s*|inr\s*)?\s*`;

const CMP_RE = new RegExp(
  String.raw`\b(on or after|on or before|more than|greater than|higher than|bigger than|larger than|over|above|exceeding|exceeds|at least|no less than|minimum of|minimum|at most|no more than|maximum of|up to|less than|fewer than|lower than|smaller than|under|below|exactly|equal to|between|after|since|before|until|through|by|during|in|from|starting)\b`,
  "i",
);
const NUM_WORD_OP: Record<string, string> = {
  "more than": "gt", "greater than": "gt", "higher than": "gt", "bigger than": "gt", "larger than": "gt", over: "gt",
  above: "gt", exceeding: "gt", exceeds: "gt", "at least": "gte", "no less than": "gte", "minimum of": "gte", minimum: "gte",
  "at most": "lte", "no more than": "lte", "maximum of": "lte", "up to": "lte", "less than": "lt", "fewer than": "lt",
  "lower than": "lt", "smaller than": "lt", under: "lt", below: "lt", exactly: "eq", "equal to": "eq", between: "between",
};
const DATE_WORD_OP: Record<string, string> = {
  "on or after": "onafter", "on or before": "onbefore", after: "after", since: "since", from: "since", starting: "since",
  before: "before", until: "before", through: "through", by: "through", in: "in", during: "in",
};
const DATE_PREPS = new Set(Object.keys(DATE_WORD_OP));
const REL_RE =
  /\b(?:directly\s+)?(?:report(?:s|ing)?|reported)\s+(?:directly\s+)?(?:to|into)\b|\bdirect\s+reports?\s+of\b|\breports?\s+of\b|\bsubordinates?\s+of\b|\bmanaged\s+by\b|\bworks?\s+(?:for|under)\b|\bunder\b/i;
const EXCL_RE = /\b(?:excluding|excludes|except for|except|without|other than|not including|but not)\b/i;
const BOUNDARY = /\s(?:then|of those|among those|who|where|with|that|whose|on or|on|after|before|since|over|under|above|below|from|between|at least|at most|and what|and who|and which|and how|and list|and show|and the|and their|among|for each|by|of|which)\b|[?;]|\.\s|\.$/i;

// ---------------------------------------------------------------- small helpers

function escRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stemSet(text: string): Set<string> {
  return new Set(words(text).map(stem));
}

function sliceTo(s: string, re: RegExp = BOUNDARY): string {
  const m = re.exec(s);
  return m ? s.slice(0, m.index) : s;
}
const EXCL_BOUNDARY = /\s(?:for|from|with|who|whose|that|where|reporting|report|reports|on|of|among|in|at|by|over|under|above|below|between|after|before|since|until|than|then|which|when|while|and what|and who|and which|and how|and list|and show|and the|and their)\b|[?;]|\.\s|\.$/i;

/** Scan `t`, call `fn` for each match (blanking the match and the consumed tail). Length-preserving. */
function takeAll(t: string, re: RegExp, fn: (m: RegExpExecArray, rest: string) => number): string {
  const r = new RegExp(re.source, re.flags.includes("i") ? "gi" : "g");
  let out = t;
  let m: RegExpExecArray | null;
  while ((m = r.exec(out))) {
    const start = m.index;
    const end = start + m[0].length;
    const used = fn(m, out.slice(end));
    if (used < 0) {
      r.lastIndex = end;
      continue;
    }
    const stop = end + used;
    out = out.slice(0, start) + " ".repeat(stop - start) + out.slice(stop);
    r.lastIndex = Math.max(stop, start + 1);
  }
  return out;
}

function isManagerCol(c: Column): boolean {
  return c.tokens.some((x) => MANAGER_WORDS.includes(x));
}
function nameColsOf(t: Table): Column[] {
  return t.cols.filter((c) => c.person && !isManagerCol(c));
}
function managerColsOf(t: Table): Column[] {
  return t.cols.filter((c) => c.person && isManagerCol(c));
}
function labelCol(t: Table): Column | null {
  const name = nameColsOf(t)[0];
  if (name) return name;
  const byWord = t.cols.find((c) => c.tokens.some((x) => LABEL_WORDS.includes(x)) && c.levels.length > 0);
  if (byWord) return byWord;
  return t.cols.find((c) => c.type === "category" && c.kind !== "id") ?? t.cols[0] ?? null;
}
function humanize(c: Column): string {
  const parts = c.tokens.filter((x) => !GENERIC_PREFIX.has(x));
  const words2 = (parts.length ? parts : c.tokens).map((x) => (x === "ip" ? "IP" : x === "gps" ? "GPS" : x === "dob" ? "date of birth" : x));
  return words2.join(" ") || c.name;
}
const sharedCache = new WeakMap<Table, Map<string, Set<string>>>();
/** Display names that belong to more than one person row in a table (so labels need the employee ID). */
function sharedNames(m: Model, t: Table, nc: Column): Set<string> {
  let per = sharedCache.get(t);
  if (!per) {
    per = new Map();
    sharedCache.set(t, per);
  }
  const hit = per.get(nc.name);
  if (hit) return hit;
  const counts = new Map<string, number>();
  for (const r of liveOf(m, t)) {
    const v = displayCell(nc, r);
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  const out = new Set<string>([...counts].filter(([, n]) => n > 1).map(([v]) => v));
  per.set(nc.name, out);
  return out;
}
function affinity(c: Column, hint: Set<string>): number {
  let s = 0;
  for (const tok of c.tokens) if (hint.has(stem(tok))) s += 1;
  return s;
}
function activeConcepts(tStems: Set<string>): Set<string> {
  const out = new Set<string>();
  for (const c of CONCEPT_ASK_STEMS) for (const a of c.ask) if (tStems.has(a)) out.add(c.id);
  return out;
}
function conceptBonus(c: Column, act: Set<string>): number {
  let s = 0;
  const toks = c.tokens.map(stem);
  for (const cc of CONCEPT_ASK_STEMS) if (act.has(cc.id) && toks.some((x) => cc.cols.has(x))) s += 1.5;
  return s;
}

function liveOf(m: Model, t: Table): number[] {
  let rows = m.live.get(t.id);
  if (!rows) {
    rows = liveRows(t, true);
    m.live.set(t.id, rows);
  }
  return rows;
}

function keyAt(m: Model, tableId: number, colId: number, row: number, kind: "key" | "name"): string {
  const col = m.tables[tableId]!.cols[colId]!;
  const code = col.codes[row];
  if (code === undefined || code < 0) return "";
  const level = col.levels[code]!;
  return kind === "name" ? nameKey(level) : words(level).join(" ");
}

function findPath(m: Model, from: number, to: number): Link[] | null {
  if (from === to) return [];
  const adj = new Map<number, Link[]>();
  const add = (l: Link) => {
    const arr = adj.get(l.from);
    if (arr) arr.push(l);
    else adj.set(l.from, [l]);
  };
  for (const l of m.links) {
    add(l);
    add({ from: l.to, fromCol: l.toCol, to: l.from, toCol: l.fromCol, kind: l.kind });
  }
  const prev = new Map<number, Link>();
  const seen = new Set<number>([from]);
  const queue: number[] = [from];
  for (let qi = 0; qi < queue.length; qi += 1) {
    const cur = queue[qi]!;
    for (const step of adj.get(cur) ?? []) {
      if (seen.has(step.to)) continue;
      seen.add(step.to);
      prev.set(step.to, step);
      queue.push(step.to);
      if (step.to === to) {
        const path: Link[] = [];
        let node = to;
        while (node !== from) {
          const st = prev.get(node)!;
          path.unshift(st);
          node = st.from;
        }
        return path;
      }
    }
  }
  return null;
}

/** For each row of `from`, the rows of `to` it links to (existential joins, multi-hop). */
function mapRows(m: Model, from: Table, rows: number[], to: Table): Map<number, number[]> | null {
  const path = findPath(m, from.id, to.id);
  if (!path) return null;
  let cur = new Map<number, number[]>();
  for (const r of rows) cur.set(r, [r]);
  let node = from.id;
  for (const step of path) {
    const index = new Map<string, number[]>();
    for (const r of liveOf(m, m.tables[step.to]!)) {
      const k = keyAt(m, step.to, step.toCol, r, step.kind);
      if (!k) continue;
      const arr = index.get(k);
      if (arr) arr.push(r);
      else index.set(k, [r]);
    }
    const next = new Map<number, number[]>();
    for (const [orig, here] of cur) {
      const acc = new Set<number>();
      for (const r of here) {
        const k = keyAt(m, node, step.fromCol, r, step.kind);
        if (!k) continue;
        for (const x of index.get(k) ?? []) acc.add(x);
      }
      next.set(orig, [...acc]);
    }
    cur = next;
    node = step.to;
  }
  return cur;
}

function applyConds(m: Model, base: Table, rows: number[], conds: Cond[]): { rows: number[] } | { error: string } {
  let cur = rows;
  const groups = new Map<number, Cond[]>();
  for (const c of conds) {
    const g = groups.get(c.tableId);
    if (g) g.push(c);
    else groups.set(c.tableId, [c]);
  }
  for (const [tid, cs] of groups) {
    if (tid === base.id) {
      cur = cur.filter((r) => cs.every((c) => c.test(r)));
      continue;
    }
    const target = m.tables[tid]!;
    const ok = new Set(liveOf(m, target).filter((r) => cs.every((c) => c.test(r))));
    const mapped = mapRows(m, base, cur, target);
    if (!mapped) {
      return { error: `I can't link ${target.name} to ${base.name} with a shared key, so I can't apply: ${cs.map((c) => c.label).join(", ")}.` };
    }
    cur = cur.filter((r) => (mapped.get(r) ?? []).some((x) => ok.has(x)));
  }
  return { rows: cur };
}

// ---------------------------------------------------------------- model

function buildModel(wb: Workbook): Model {
  const lex = new Map<string, LexHit[]>();
  const wordIdx = new Map<string, LexHit[]>();
  const colWords = new Set<string>();
  const push = (map: Map<string, LexHit[]>, key: string, hit: LexHit) => {
    if (!key) return;
    const arr = map.get(key);
    if (arr) arr.push(hit);
    else map.set(key, [hit]);
  };
  for (const t of wb.tables) {
    for (const c of t.cols) {
      for (const tok of c.tokens) colWords.add(stem(tok));
      const indexable = c.person || CAT_TYPES.has(c.type);
      if (!indexable || !c.levels.length || c.levels.length > 6000) continue;
      c.levels.forEach((level, code) => {
        const hit: LexHit = { tableId: t.id, colId: c.id, code, person: c.person };
        push(lex, stemKey(level), hit);
        if (c.person) push(lex, `@${nameKey(level)}`, hit);
        if (c.person) {
          for (const w of words(level)) if (w.length >= 3 && !STOP.has(stem(w))) push(wordIdx, stem(w), hit);
        }
      });
    }
  }
  const links: Link[] = [];
  for (const r of wb.rels) {
    links.push({ from: r.a.id, fromCol: r.aCol.id, to: r.b.id, toCol: r.bCol.id, kind: "key" });
  }
  const tabs = wb.tables;
  for (let i = 0; i < tabs.length; i += 1) {
    for (let j = i + 1; j < tabs.length; j += 1) {
      const A = tabs[i]!;
      const B = tabs[j]!;
      for (const ca of A.cols.filter((c) => c.person)) {
        for (const cb of B.cols.filter((c) => c.person)) {
          const sa = new Set(ca.levels.map((l) => nameKey(l)));
          const sb = new Set(cb.levels.map((l) => nameKey(l)));
          let shared = 0;
          for (const k of sa) if (sb.has(k)) shared += 1;
          if (shared >= 2 && shared / Math.min(sa.size, sb.size) >= 0.6) {
            links.push({ from: A.id, fromCol: ca.id, to: B.id, toCol: cb.id, kind: "name" });
          }
        }
      }
    }
  }
  return { tables: wb.tables, lex, wordIdx, links, colWords, live: new Map() };
}

// ---------------------------------------------------------------- grounding

function makeTerm(m: Model, h: LexHit, text: string, span: string[], codes?: number[]): Term {
  const col = m.tables[h.tableId]!.cols[h.colId]!;
  return { text, words: span, tableId: h.tableId, colId: h.colId, codes: codes ?? [h.code], person: col.person };
}

function bestTerm(m: Model, hits: LexHit[], phrase: string, span: string[], hint: Set<string>): Term | null {
  const groups = new Map<string, { h: LexHit; codes: number[] }>();
  for (const h of hits) {
    const k = `${h.tableId}:${h.colId}`;
    const g = groups.get(k);
    if (g) {
      if (!g.codes.includes(h.code)) g.codes.push(h.code);
    } else groups.set(k, { h, codes: [h.code] });
  }
  let best: { h: LexHit; codes: number[]; score: number } | null = null;
  for (const g of groups.values()) {
    const col = m.tables[g.h.tableId]!.cols[g.h.colId]!;
    const score = affinity(col, hint) * 3 + (col.person ? 0.5 : 0) + g.codes.length * 0.001;
    if (!best || score > best.score) best = { h: g.h, codes: g.codes, score };
  }
  if (!best) return null;
  return makeTerm(m, best.h, phrase, span, best.codes);
}

function partialTerm(m: Model, w: string): Term | null {
  const s = stem(w);
  if (m.colWords.has(s) || CONCEPT_WORD_STEMS.has(s) || MONTH_WORDS.has(w) || STOP.has(s)) return null;
  const uniq = new Map<string, LexHit>();
  for (const h of m.wordIdx.get(s) ?? []) uniq.set(`${h.tableId}:${h.colId}:${h.code}`, h);
  if (uniq.size !== 1) return null;
  const h = [...uniq.values()][0]!;
  const level = m.tables[h.tableId]!.cols[h.colId]!.levels[h.code]!;
  return makeTerm(m, h, level, words(level));
}

function groundText(m: Model, text: string, hint: Set<string>): Term[] {
  const ws = words(text);
  const out: Term[] = [];
  let i = 0;
  while (i < ws.length) {
    let took = 0;
    for (let len = Math.min(4, ws.length - i); len >= 1 && took === 0; len -= 1) {
      const span = ws.slice(i, i + len);
      if (span.every((w) => STOP.has(stem(w)) || /^\d+$/.test(w))) continue;
      const phrase = span.join(" ");
      const hits = [...(m.lex.get(stemKey(phrase)) ?? []), ...(m.lex.get(`@${nameKey(phrase)}`) ?? [])];
      if (!hits.length) continue;
      const term = bestTerm(m, hits, phrase, span, hint);
      if (term) {
        out.push(term);
        took = len;
      }
    }
    if (took === 0 && ws[i]!.length >= 3) {
      const partial = partialTerm(m, ws[i]!);
      if (partial) {
        out.push(partial);
        took = 1;
      }
    }
    i += took || 1;
  }
  return out;
}

function unknownPhrases(raw: string, m: Model, grounded: Term[]): string[] {
  const covered = new Set<string>();
  for (const g of grounded) for (const w of g.words) covered.add(w);
  const out: string[] = [];
  const phrases = raw.replace(/['’]s\b/g, "").match(/\b[A-Z][A-Za-z'’-]*(?:\s+[A-Z][A-Za-z'’-]*)*/g) ?? [];
  for (const p of phrases) {
    const ws = words(p);
    const relevant = p.split(/\s+/).filter((w) => !CALENDAR_CAP.has(w.toLowerCase()) && !/^[A-Z]{2,}$/.test(w));
    if (!relevant.length) continue;
    const unknown = ws.some((w) => {
      if (covered.has(w)) return false;
      if (STOP.has(stem(w)) || m.colWords.has(stem(w)) || CONCEPT_WORD_STEMS.has(stem(w))) return false;
      if (MONTH_WORDS.has(w)) return false;
      return !m.wordIdx.has(stem(w)) && !m.lex.has(stemKey(w));
    });
    if (unknown) out.push(relevant.join(" "));
  }
  return [...new Set(out)];
}

function valueCond(m: Model, tableId: number, colId: number, codes: number[], negate: boolean): Cond {
  const col = m.tables[tableId]!.cols[colId]!;
  const exp = new Set(codes);
  for (const code of codes) {
    const s = stemKey(col.levels[code]!);
    for (const fam of ID_FAMILIES) {
      if (!fam.some((f) => stem(f) === s)) continue;
      col.levels.forEach((lvl, k) => {
        if (fam.some((f) => stem(f) === stemKey(lvl))) exp.add(k);
      });
    }
  }
  const names = [...exp].map((c) => col.levels[c]!);
  const label = `${col.name} ${negate ? "excludes" : "is"} ${names.slice(0, 3).join(" or ")}`;
  return {
    tableId,
    label,
    test: (r) => {
      const c = col.codes[r]!;
      if (negate) return c < 0 || !exp.has(c);
      return c >= 0 && exp.has(c);
    },
  };
}

// ---------------------------------------------------------------- literals, dates and numbers

function bounds(s: string): { s: number; e: number } | null {
  const t = s.trim();
  if (/^\d{4}$/.test(t)) {
    const a = utc(Number(t), 1, 1);
    const b = utc(Number(t) + 1, 1, 1);
    return a !== null && b !== null ? { s: a, e: b } : null;
  }
  const d = parseDate(t);
  if (!d) return null;
  if (d.prec === "month") {
    const dt = new Date(d.t);
    return { s: d.t, e: Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + 1, 1) };
  }
  if (d.time) return { s: d.t, e: d.t + 1 };
  return { s: d.t, e: d.t + 86_400_000 };
}

function isDateish(s: string): boolean {
  return /[-/]/.test(s) || /[a-z]/i.test(s);
}

function parseLiteral(rest: string, word: string): Lit | null {
  const w = word.toLowerCase();
  if (w === "between") {
    const m = new RegExp(`^\\s*${CUR}(${DATE_LIT}|${NUM_LIT})\\s*(?:and|to|-)\\s*${CUR}(${DATE_LIT}|${NUM_LIT})`, "i").exec(rest);
    if (!m) return null;
    return { used: m[0].length, kind: isDateish(m[1]!) || /^(19|20)\d{2}$/.test(m[1]!) ? "date" : "num", a: m[1]!, b: m[2]! };
  }
  const dm = new RegExp(`^\\s*${CUR}(${DATE_LIT})`, "i").exec(rest);
  if (dm && (DATE_PREPS.has(w) || isDateish(dm[1]!))) return { used: dm[0].length, kind: "date", a: dm[1]! };
  if (DATE_PREPS.has(w)) return null;
  const nm = new RegExp(`^\\s*${CUR}(${NUM_LIT})`, "i").exec(rest);
  if (nm && NUM_WORD_OP[w]) return { used: nm[0].length, kind: "num", a: nm[1]! };
  return null;
}

function literalPred(word: string, lit: Lit): { kind: "time" | "num"; test: (v: number) => boolean; label: string; month?: number } | null {
  const w = word.toLowerCase();
  if (lit.kind === "num") {
    const a = parseNum(lit.a, "auto", true);
    if (!a) return null;
    if (w === "between") {
      const b = parseNum(lit.b ?? "", "auto", true);
      if (!b) return null;
      const lo = Math.min(a.n, b.n);
      const hi = Math.max(a.n, b.n);
      return { kind: "num", test: (v) => v >= lo && v <= hi, label: `between ${lo} and ${hi}` };
    }
    const x = a.n;
    const op = NUM_WORD_OP[w];
    const test =
      op === "gt" ? (v: number) => v > x
      : op === "gte" ? (v: number) => v >= x
      : op === "lt" ? (v: number) => v < x
      : op === "lte" ? (v: number) => v <= x
      : (v: number) => v === x;
    return { kind: "num", test, label: `${w} ${lit.a}` };
  }
  const mo = /^[a-z]+\.?$/i.test(lit.a.trim()) ? monthIndex(lit.a.trim().replace(/\.$/, "")) : 0;
  if (mo) return DATE_WORD_OP[w] === "in" ? { kind: "time", test: () => false, label: `in ${lit.a.trim()}`, month: mo } : null;
  const A = bounds(lit.a);
  if (!A) return null;
  if (w === "between") {
    const B = bounds(lit.b ?? "");
    if (!B) return null;
    return { kind: "time", test: (v) => v >= A.s && v < B.e, label: `between ${lit.a} and ${lit.b}` };
  }
  const dop = DATE_WORD_OP[w];
  const nop = NUM_WORD_OP[w];
  let test: ((v: number) => boolean) | null = null;
  if (dop === "onafter" || dop === "since") test = (v) => v >= A.s;
  else if (dop === "onbefore" || dop === "through") test = (v) => v < A.e;
  else if (dop === "after") test = (v) => v >= A.e;
  else if (dop === "before") test = (v) => v < A.s;
  else if (dop === "in") test = (v) => v >= A.s && v < A.e;
  else if (nop === "gt") test = (v) => v >= A.e;
  else if (nop === "gte") test = (v) => v >= A.s;
  else if (nop === "lt") test = (v) => v < A.s;
  else if (nop === "lte") test = (v) => v < A.e;
  else if (nop === "eq") test = (v) => v >= A.s && v < A.e;
  if (!test) return null;
  return { kind: "time", test, label: `${w} ${lit.a}` };
}

function resolvePending(m: Model, p: Pending, baseId: number | null, hint: Set<string>, act: Set<string>): Cond | null {
  let best: { t: Table; c: Column; score: number } | null = null;
  for (const t of m.tables) {
    for (const c of t.cols) {
      if (p.kind === "time" ? c.type !== "date" : c.kind !== "measure") continue;
      const score = affinity(c, hint) + conceptBonus(c, act) + (t.id === baseId ? 0.5 : 0) + (p.kind === "num" && c.type === "currency" ? 0.2 : 0);
      if (!best || score > best.score) best = { t, c, score };
    }
  }
  if (!best) return null;
  const { t, c } = best;
  if (p.kind === "time" && p.month) {
    // "in April" with no year: use the latest year that holds data in the chosen column.
    const years = new Map<number, number>();
    for (const r of liveOf(m, t)) {
      const v = c.time[r]!;
      if (Number.isNaN(v)) continue;
      const y = new Date(v).getUTCFullYear();
      years.set(y, (years.get(y) ?? 0) + 1);
    }
    if (!years.size) return null;
    const year = Math.max(...years.keys());
    const start = utc(year, p.month, 1);
    const end = p.month === 12 ? utc(year + 1, 1, 1) : utc(year, p.month + 1, 1);
    if (start === null || end === null) return null;
    const monthName = MONTH_NAMES[p.month - 1]!.replace(/^./, (x) => x.toUpperCase());
    const label = `in ${monthName} ${year}${years.size > 1 ? " (latest year in the data)" : ""}`;
    return { tableId: t.id, label, test: (r) => { const v = c.time[r]!; return !Number.isNaN(v) && v >= start && v < end; } };
  }
  if (p.kind === "time") {
    return { tableId: t.id, label: p.label, test: (r) => { const v = c.time[r]!; return !Number.isNaN(v) && p.test(v); } };
  }
  return { tableId: t.id, label: p.label, test: (r) => { const v = c.num[r]!; return !Number.isNaN(v) && p.test(v); } };
}

// ---------------------------------------------------------------- people, relations, emails

function entitySets(m: Model, key: string, loose: boolean): Map<number, Set<number>> {
  const exact = new Map<number, Set<number>>();
  const fuzzy = new Map<number, Set<number>>();
  for (const t of m.tables) {
    const cols = nameColsOf(t);
    if (!cols.length) continue;
    const ex = new Set<number>();
    const fz = new Set<number>();
    for (const r of liveOf(m, t)) {
      for (const c of cols) {
        const code = c.codes[r]!;
        if (code < 0) continue;
        const nk = nameKey(c.levels[code]!);
        if (nk === key) ex.add(r);
        else if (loose && !key.includes(" ") && nk.split(" ").includes(key)) fz.add(r);
      }
    }
    if (ex.size) exact.set(t.id, ex);
    if (fz.size) fuzzy.set(t.id, fz);
  }
  return exact.size || !loose ? exact : fuzzy;
}

function relationSets(m: Model, key: string, transitive: boolean): Map<number, Set<number>> {
  const out = new Map<number, Set<number>>();
  for (const t of m.tables) {
    const mans = managerColsOf(t);
    const names = nameColsOf(t);
    if (!mans.length || !names.length) continue;
    const live = liveOf(m, t);
    const keyOfCol = (r: number, c: Column): string => {
      const code = c.codes[r]!;
      return code >= 0 ? nameKey(c.levels[code]!) : "";
    };
    let direct = new Set<number>();
    for (const r of live) if (mans.some((c) => keyOfCol(r, c) === key)) direct.add(r);
    if (transitive) {
      const all = new Set<number>(direct);
      let frontier = new Set<number>(direct);
      while (frontier.size) {
        const frontierKeys = new Set<string>();
        for (const r of frontier) for (const c of names) frontierKeys.add(keyOfCol(r, c));
        const next = new Set<number>();
        for (const r of live) {
          if (all.has(r)) continue;
          if (mans.some((c) => frontierKeys.has(keyOfCol(r, c)))) next.add(r);
        }
        for (const r of next) all.add(r);
        frontier = next;
      }
      direct = all;
    }
    if (direct.size) out.set(t.id, direct);
  }
  return out;
}

function emailCond(m: Model, suffix: string): Cond | null {
  let best: { t: Table; c: Column; score: number } | null = null;
  for (const t of m.tables) {
    for (const c of t.cols) {
      if (c.type !== "email") continue;
      const score = (nameColsOf(t).length ? 1000 : 0) + liveOf(m, t).length;
      if (!best || score > best.score) best = { t, c, score };
    }
  }
  if (!best) return null;
  const s = suffix.toLowerCase();
  const needle = s.startsWith(".") || s.includes(".") ? s : `.${s}`;
  const { t, c } = best;
  return {
    tableId: t.id,
    label: `email ends in ${needle.startsWith(".") ? needle : `.${needle}`}`,
    test: (r) => {
      const code = c.codes[r]!;
      if (code < 0) return false;
      const v = c.levels[code]!.toLowerCase();
      return v.endsWith(needle) || v.endsWith(s);
    },
  };
}

function peopleConds(people: PersonRef[], label: string): Cond[] {
  const byTable = new Map<number, Set<number>>();
  for (const p of people) {
    const s = byTable.get(p.tableId);
    if (s) s.add(p.row);
    else byTable.set(p.tableId, new Set([p.row]));
  }
  return [...byTable].map(([tableId, set]) => ({ tableId, label, test: (r: number) => set.has(r) }));
}

function pickPersonTable(m: Model): Table | null {
  let best: Table | null = null;
  for (const t of m.tables) {
    if (!nameColsOf(t).length) continue;
    if (!best || liveOf(m, t).length > liveOf(m, best).length) best = t;
  }
  return best;
}

function pickMeasure(m: Model, hint: Set<string>, act: Set<string>, money: boolean): { t: Table; c: Column } | null {
  let best: { t: Table; c: Column; score: number } | null = null;
  for (const t of m.tables) {
    for (const c of t.cols) {
      if (c.kind !== "measure") continue;
      let score = affinity(c, hint) + conceptBonus(c, act);
      if (money && c.type === "currency") score += 2;
      if (money && c.tokens.some((x) => MONEY_COLS.includes(stem(x)))) score += 1;
      if (money && c.tokens.some((x) => FLOW_WORDS.includes(stem(x)))) score += 1.5;
      if (money && c.tokens.some((x) => STOCK_WORDS.includes(x))) score -= 2;
      score += liveOf(m, t).length / 1e6;
      if (!best || score > best.score) best = { t, c, score };
    }
  }
  return best ? { t: best.t, c: best.c } : null;
}

function rowTable(m: Model, measureT: Table | null): Table | null {
  if (measureT) return measureT;
  let best: Table | null = null;
  for (const t of m.tables) if (!best || liveOf(m, t).length > liveOf(m, best).length) best = t;
  return best;
}

function projectionCols(m: Model, tStems: Set<string>, act: Set<string>): Array<{ t: Table; c: Column }> {
  const scored: Array<{ t: Table; c: Column; score: number }> = [];
  for (const t of m.tables) {
    for (const c of t.cols) {
      if (c.kind === "id" || c.person && !isManagerCol(c)) continue;
      const toks = c.tokens.map(stem);
      if (!toks.length) continue;
      let score = 0;
      for (const cc of CONCEPT_ASK_STEMS) if (act.has(cc.id) && toks.some((x) => cc.cols.has(x))) score += 2;
      if (toks.length <= 3 && toks.every((x) => tStems.has(x)) && !GENERIC_COL.has(c.tokens.join(" "))) score += 2;
      if (score) scored.push({ t, c, score });
    }
  }
  if (!scored.length) return [];
  const byTable = new Map<number, number>();
  for (const s of scored) byTable.set(s.t.id, (byTable.get(s.t.id) ?? 0) + s.score);
  const topId = [...byTable].sort((a, b) => b[1] - a[1])[0]![0];
  let cols = scored.filter((s) => s.t.id === topId).sort((a, b) => b.score - a.score).map((s) => s.c);
  if (act.has("ip") && cols.length > 1) {
    const qualifiers = ["public", "local", "vpn"].filter((q) => tStems.has(q));
    const q = cols.filter((c) => c.tokens.some((x) => qualifiers.includes(x)));
    if (q.length) cols = q;
    else {
      const pub = cols.filter((c) => c.tokens.includes("public"));
      if (pub.length) cols = pub;
    }
  }
  const tbl = m.tables[topId]!;
  return cols.slice(0, 8).map((c) => ({ t: tbl, c }));
}

function resolveGroupKey(
  m: Model, phrase: string, hint: Set<string>,
): { kind: "person" } | { kind: "time"; unit: string } | { kind: "col"; t: Table; c: Column } | null {
  const first = words(phrase)[0] ?? "";
  if (/^(employee|person|people|staff|name|user|customer|member|worker|individual|who)/.test(first)) return { kind: "person" };
  if (/^(month|year|day|week|quarter)/.test(first)) return { kind: "time", unit: first };
  const ph = stemSet(phrase);
  let best: { t: Table; c: Column; score: number } | null = null;
  for (const t of m.tables) {
    for (const c of t.cols) {
      if (c.kind === "measure" || c.kind === "time" || !c.levels.length) continue;
      const s = affinity(c, ph);
      if (!s) continue;
      if (!best || s > best.score) best = { t, c, score: s };
    }
  }
  return best ? { kind: "col", t: best.t, c: best.c } : null;
}

const COUNTERPARTY = ["merchant", "vendor", "payee", "name", "title", "store", "employer", "company", "product", "item", "customer", "client", "account", "category"];

/** Person display name; people who share a name are told apart by their employee ID. */
function personLabel(m: Model, p: PersonRef | null): string {
  if (!p) return "";
  const t = m.tables[p.tableId]!;
  const nc = nameColsOf(t)[0];
  if (!nc) return "";
  const name = displayCell(nc, p.row);
  const idc = t.cols.find((c) => c.kind === "id");
  return idc && sharedNames(m, t, nc).has(name) ? `${name} (${displayCell(idc, p.row)})` : name;
}

/** The categorical column a question names (e.g. "merchants"), used for "top N <things> by amount". */
function nounColumn(m: Model, tStems: Set<string>): { t: Table; c: Column } | null {
  let best: { t: Table; c: Column; score: number } | null = null;
  for (const t of m.tables) {
    for (const c of t.cols) {
      if (c.type !== "category" || c.kind === "id" || c.kind === "measure") continue;
      const hit = c.tokens.map(stem).filter((x) => tStems.has(x)).length;
      if (hit && (!best || hit > best.score)) best = { t, c, score: hit };
    }
  }
  return best ? { t: best.t, c: best.c } : null;
}

// ---------------------------------------------------------------- formatting

function fmtM(col: Column, v: bigint, dec: number): string {
  const money = col.type === "currency";
  const body = fmtScaled(v, dec, money ? 2 : 0);
  if (money) return withCur(body, col.cur ?? "$");
  if (col.type === "percent") return `${body}%`;
  return body;
}

/** A cell as the user should read it: money gets its currency symbol and cents. */
function cellText(c: Column, r: number): string {
  if (c.type === "currency") {
    const v = c.num[r]!;
    if (!Number.isNaN(v)) return fmtM(c, toScaled(v, c.dec), c.dec);
  }
  return displayCell(c, r);
}

function stats(col: Column, rows: number[]): { n: number; sum: bigint; vals: number[]; best: number; worst: number } {
  let sum = 0n;
  const vals: number[] = [];
  let best = -1;
  let worst = -1;
  for (const r of rows) {
    const v = col.num[r]!;
    if (Number.isNaN(v)) continue;
    vals.push(v);
    sum += toScaled(v, col.dec);
    if (best < 0 || v > col.num[best]!) best = r;
    if (worst < 0 || v < col.num[worst]!) worst = r;
  }
  return { n: vals.length, sum, vals, best, worst };
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

// ---------------------------------------------------------------- one part of a question

function runPart(raw: string, m: Model, ctx: Ctx): PartResult | null {
  const notes: string[] = [];
  let t = ` ${raw.toLowerCase().replace(/[’‘`]/g, "'").replace(/'s\b/g, " ")} `;
  const hint0 = stemSet(t);
  const conds: Cond[] = [];
  const pendings: Pending[] = [];
  const threshold: Cond[] = [];
  const hv: { h: Having | null } = { h: null };
  const relKeys: Array<{ key: string; label: string; transitive: boolean }> = [];
  const entities = new Map<string, string>();
  const suffixes: string[] = [];
  const excludedCodes = new Map<string, Set<number>>();

  // 1) exclusions: "excluding refunds and subscriptions"
  t = takeAll(t, EXCL_RE, (_m, rest) => {
    const span = sliceTo(rest, EXCL_BOUNDARY);
    for (const term of groundText(m, span, hint0)) {
      if (!term.person) {
        conds.push(valueCond(m, term.tableId, term.colId, term.codes, true));
        const key = `${term.tableId}:${term.colId}`;
        const set = excludedCodes.get(key) ?? new Set<number>();
        for (const code of term.codes) set.add(code);
        excludedCodes.set(key, set);
      }
    }
    return span.length;
  });

  // 2) reporting lines: "who report to Mina Park" (direct) and "under Sora Venn" (whole chain)
  t = takeAll(t, REL_RE, (mm, rest) => {
    const span = sliceTo(rest.slice(0, 120));
    const terms = groundText(m, span, hint0).filter((x) => x.person);
    if (!terms.length) return -1;
    const term = terms[0]!;
    const hit = new RegExp(term.words.map(escRe).join("[^a-z0-9]+")).exec(span);
    relKeys.push({ key: nameKey(term.text), label: term.text, transitive: /under|subordinate/i.test(mm[0]) });
    return hit ? hit.index + hit[0].length : span.length;
  });

  // 3) email suffixes: "whose work email ends in .corp", "use a lumina.test email"
  t = takeAll(t, /\b(?:ends?|ending)\s+(?:in|with)\s+(\.?[a-z0-9][a-z0-9.-]*)/i, (mm) => {
    suffixes.push(mm[1]!.replace(/\.+$/, ""));
    return 0;
  });
  t = takeAll(t, /\b([a-z0-9-]+(?:\.[a-z0-9-]+)+)\s+(?:email|address|domain)s?\b/i, (mm) => {
    suffixes.push(mm[1]!.replace(/\.+$/, ""));
    return 0;
  });

  // 4) numbers and dates: "over $25", "on or after 2026-05-01", "born before 1990", "at least 2 transactions"
  t = takeAll(t, CMP_RE, (mm, rest) => {
    const word = mm[0].toLowerCase();
    const lit = parseLiteral(rest, word);
    if (!lit) return -1;
    const pred = literalPred(word, lit);
    if (!pred) return -1;
    const cnt = /^\s*(transactions?|purchases?|orders?|records?|rows?|times|people|persons?|employees?|items?|charges?|payments?|visits?|entries|lines|customers?|users?|members?)\b/i.exec(rest.slice(lit.used));
    if (cnt && pred.kind === "num" && word !== "between") {
      hv.h = { test: pred.test, label: pred.label };
      return lit.used;
    }
    pendings.push({ kind: pred.kind, test: pred.test, label: pred.label, month: pred.month });
    return lit.used;
  });

  // 5) what is left: entities, values, pronouns
  const hint = new Set([...hint0, ...stemSet(t)]);
  const left = groundText(m, t, hint);
  for (const term of left) if (term.person) entities.set(nameKey(term.text), term.text);
  const colGroups = new Map<string, { tableId: number; colId: number; codes: number[] }>();
  for (const term of left) {
    if (term.person) continue;
    const k = `${term.tableId}:${term.colId}`;
    const g = colGroups.get(k);
    if (g) {
      for (const c of term.codes) if (!g.codes.includes(c)) g.codes.push(c);
    } else {
      colGroups.set(k, { tableId: term.tableId, colId: term.colId, codes: [...term.codes] });
    }
  }
  for (const g of colGroups.values()) conds.push(valueCond(m, g.tableId, g.colId, g.codes, false));

  const unknown = unknownPhrases(raw, m, left);
  if (unknown.length) {
    return { text: unknown.map((u) => `No record in the files mentions “${u}”.`).join(" "), notes: [] };
  }

  const usesPron = /\b(those|them|they|their|theirs|these|that person|that employee|the same|her|his|she|he|its)\b/.test(t);
  if (usesPron && ctx.people && ctx.people.length) conds.push(...peopleConds(ctx.people, "same people as before"));
  else if (usesPron && !entities.size && ctx.subject) entities.set(nameKey(ctx.subject), ctx.subject);
  if (/\b(remaining|those|same|left)\b/.test(t) && ctx.scope.length) conds.push(...ctx.scope);

  // A follow-up such as "the public IP" with no new name refers to the people from the previous part.
  const followPeople = !entities.size && !usesPron && ctx.people && ctx.people.length && t.match(/\bthe\b/) ? ctx.people : null;
  for (const r of relKeys) {
    const sets = relationSets(m, r.key, r.transitive);
    if (!sets.size && !entitySets(m, r.key, true).size) {
      return { text: `No record in the files mentions “${r.label}”.`, notes };
    }
    if (![...m.tables].some((tb) => managerColsOf(tb).length)) {
      return { text: "I can't check reporting lines: the files have no manager column.", notes };
    }
    for (const [tableId, set] of sets) conds.push({ tableId, label: `${r.transitive ? "under" : "reports to"} ${r.label}`, test: (row) => set.has(row) });
  }
  for (const s of suffixes) {
    const c = emailCond(m, s);
    if (c) conds.push(c);
  }

  // 6) operation flags
  const tStems = stemSet(t);
  const act = activeConcepts(tStems);
  const has = (...ws: string[]) => ws.some((w) => tStems.has(stem(w)));
  const flags = {
    share: /\b(percent|percentage|proportion|share|fraction|ratio)\b|%/.test(t),
    distinct: /\b(unique|distinct)\b/.test(t),
    median: /\bmedian\b/.test(t),
    avg: /\b(average|avg|mean)\b/.test(t),
    sum: /\b(total|totals|sum|combined|overall|altogether|add up|how much|together)\b/.test(t),
    count: /\bhow many\b|\bcount\b|\bnumber of\b/.test(t),
    max: /\b(most|highest|largest|biggest|maximum|max|greatest|peak|best|top|higher)\b/.test(t),
    min: /\b(least|lowest|smallest|minimum|min|cheapest|fewest|worst|bottom)\b/.test(t),
    compare: /\b(compare|comparison|compared|versus|vs|difference between)\b/.test(t),
    who: /\bwho\b/.test(t),
    list: /\b(list|show|which|all|every|give|names?|emails?)\b/.test(t),
    countPeople: has("person", "people", "employee", "staff", "user", "customer", "member", "worker"),
    countRows: has("transaction", "purchase", "order", "record", "row", "entry", "charge", "payment", "item", "visit", "event"),
    money: has(...MONEY_ASK),
  };
  const topM = /\b(top|bottom|first|last)\s+(\d+)\b/.exec(t);
  const topN = topM ? Number(topM[2]) : null;
  const grpM = /\b(?:group(?:ed)?\s+by|broken\s+down\s+by|split\s+by|by|per|for\s+each|each)\s+((?:[a-z]+\s?){1,3})/.exec(t);
  const groupPhrase = grpM ? grpM[1]!.trim() : null;
  let groupKey = groupPhrase && !(flags.max || flags.min || topN) ? resolveGroupKey(m, groupPhrase, hint) : null;
  if (!groupKey && topN) {
    const nc = nounColumn(m, tStems);
    if (nc) groupKey = { kind: "col", t: nc.t, c: nc.c };
  }
  const hasEntity = entities.size > 0;
  const projs = projectionCols(m, tStems, act);
  const wantsGroup =
    Boolean(groupKey) ||
    (flags.who && (flags.max || flags.min) && !flags.countPeople) ||
    (flags.who && Boolean(hv.h)) ||
    (flags.countPeople && (flags.max || flags.min)) ||
    (Boolean(topN) && flags.countPeople);

  // "the largest transaction" is one row; "the most transactions" is a count per person.
  const rowExtreme = (flags.max || flags.min) && /\b(largest|biggest|highest|smallest|lowest|greatest|cheapest|maximum|minimum)\b/.test(t) && !/\b(most|least|fewest)\b/.test(t) && (flags.countRows || flags.money) && !groupKey && !topN;
  let op: string | null = null;
  if (flags.share) op = "share";
  else if (flags.distinct) op = "distinct";
  else if (rowExtreme) op = "extreme";
  else if (wantsGroup) op = "group";
  else if (topN) op = "top";
  else if (flags.median || flags.avg || flags.sum) op = "agg";
  else if (flags.count) op = "count";
  else if (flags.max || flags.min) op = "extreme";
  else if (flags.compare || entities.size >= 2) op = "compare";
  else if (hasEntity) op = "lookup";
  else if (flags.list || projs.length || relKeys.length || conds.length || pendings.length) op = "list";
  if (!op) return null;

  // 7) choose the base table: the one the answer is about
  const measure = pickMeasure(m, hint, act, flags.money || flags.countRows || /\$/.test(raw) || op === "agg" || op === "share");
  const personT = pickPersonTable(m);
  const largest = rowTable(m, null);
  let base: Table | null = null;
  if (op === "count" && flags.countPeople) base = personT;
  else if (op === "count") base = rowTable(m, flags.countRows && measure ? measure.t : null);
  else if (op === "agg" || op === "share" || op === "extreme" || op === "top") base = measure ? measure.t : largest;
  else if (op === "group") {
    if (flags.money && measure) base = measure.t;
    else if (flags.countRows) base = rowTable(m, measure ? measure.t : null);
    else if (groupKey && groupKey.kind === "col") base = groupKey.t;
    else base = personT ?? largest;
  } else if (op === "distinct") base = largest;
  else base = projs[0]?.t ?? personT ?? largest;
  if (!base) return null;
  if (op === "agg" || op === "extreme" || op === "top") {
    if (!measure) return { text: "I can't find a numeric column to add up in the files.", notes };
  }
  const measureCol = measure?.c ?? null;
  const mt = measure?.t ?? base;

  // 8) entities, pronouns and pending comparisons now have a base table
  for (const p of pendings) {
    const c = resolvePending(m, p, base.id, hint, act);
    if (c) {
      conds.push(c);
      threshold.push(c);
    } else notes.push(`No column matches “${p.label}”, so that condition was not applied.`);
  }
  for (const [key, label] of entities) {
    const sets = entitySets(m, key, true);
    if (!sets.size) return { text: `No record in the files mentions “${label}”.`, notes };
    for (const [tableId, set] of sets) conds.push({ tableId, label, test: (r) => set.has(r) });
  }

  // Spend and transaction questions do not count balances, limits, deposits or reversals as charges.
  if (flags.money || flags.countRows) {
    for (const t of m.tables) {
      if (t.id !== base.id && !findPath(m, base.id, t.id)) continue;
      for (const c of t.cols) {
        if (c.type !== "category" || !c.tokens.some((x) => KIND_WORDS.includes(stem(x)))) continue;
        const already = excludedCodes.get(`${t.id}:${c.id}`) ?? new Set<number>();
        const codes = c.levels
          .map((lvl, code) => ({ lvl, code }))
          .filter(({ lvl, code }) => NON_SPEND_STEMS.has(stemKey(lvl)) && !already.has(code) && !words(lvl).some((w) => tStems.has(stem(w))))
          .map(({ code }) => code);
        if (!codes.length) continue;
        const cond = valueCond(m, t.id, c.id, codes, true);
        cond.label = `${cond.label} (not spend)`;
        conds.push(cond);
      }
    }
  }

  let applied = applyConds(m, base, liveOf(m, base), followPeople ? [...conds, ...peopleConds(followPeople, "same people as before")] : conds);
  if ("error" in applied && followPeople) {
    notes.push(`The files do not link these records to ${[...new Set(followPeople.map((p) => personLabel(m, p)))].join(", ")}, so every record is listed.`);
    applied = applyConds(m, base, liveOf(m, base), conds);
  }
  if ("error" in applied) return { text: applied.error, notes };
  const rows = applied.rows;
  const baseRows = liveOf(m, base);

  // Link rows to people (for labels, person counts and the people carried into the next part)
  const toPerson = personT && personT.id !== base.id ? mapRows(m, base, baseRows, personT) : null;
  const personOfRow = (r: number): PersonRef | null => {
    if (!personT) return null;
    if (base.id === personT.id) return { tableId: personT.id, row: r };
    const hitRows = toPerson?.get(r) ?? [];
    return hitRows.length ? { tableId: personT.id, row: hitRows[0]! } : null;
  };
  const personName = (p: PersonRef | null): string => personLabel(m, p);
  const lblOf = (r: number): string => {
    const lc = labelCol(base);
    return lc ? displayCell(lc, r) : "";
  };
  const rowText = (r: number): string => {
    const nm = personName(personOfRow(r));
    const lb = lblOf(r);
    if (nm && lb && base.id !== personT?.id) return `${nm} · ${lb}`;
    return nm || lb || `record ${r + 1}`;
  };

  if (conds.length) {
    const scopeBasis = conds.map((c) => c.label).filter((x, i, arr) => arr.indexOf(x) === i);
    if (scopeBasis.length) notes.push(`Basis: ${scopeBasis.slice(0, 12).join("; ")}.`);
  }
  for (const line of base.log.filter((l) => /not numbers|not valid dates|placeholder|Standardised|blank/i.test(l)).slice(0, 2)) {
    notes.push(line);
  }
  if (base.dupCount || base.skipCount || base.layoutSkipCount) {
    const bits: string[] = [];
    if (base.skipCount) bits.push(plural(base.skipCount, "summary row"));
    if (base.dupCount) bits.push(plural(base.dupCount, "exact duplicate row"));
    if (base.layoutSkipCount) bits.push(plural(base.layoutSkipCount, "row with a different layout", "rows with a different layout"));
    notes.push(`Left out ${bits.join(", ")} from ${base.name}, so each transaction is counted once.`);
  }
  if (toPerson) {
    const unlinked = baseRows.filter((r) => !(toPerson.get(r) ?? []).length);
    if (unlinked.length && unlinked.length < baseRows.length) {
      const idCol = base.cols.find((c) => c.kind === "id");
      const sample = idCol && unlinked[0] !== undefined ? displayCell(idCol, unlinked[0]) : "";
      notes.push(
        `${plural(unlinked.length, `${base.name} row`)} could not be matched to a person record${sample ? ` (e.g., ID “${sample}”)` : ""} and were not counted in person-level filters.`,
      );
    }
  }

  // 9) produce the answer
  const subjName = flags.money && has("spend", "spent", "paid", "pay", "spending") ? "spend" : (measureCol?.name ?? "amount");
  const noun = flags.countRows || has("spend", "spent", "spending", "paid", "pay") ? "transaction" : "row";
  const involvedPeople = (rs: number[]): PersonRef[] => {
    const seen = new Map<string, PersonRef>();
    for (const r of rs) {
      const p = personOfRow(r);
      if (p) seen.set(`${p.tableId}:${p.row}`, p);
    }
    return [...seen.values()];
  };

  if (op === "share") {
    const scope = applyConds(m, base, liveOf(m, base), conds.filter((c) => !threshold.includes(c)));
    const pool = "rows" in scope ? scope.rows : baseRows;
    const denom = measure && measure.t.id === base.id ? pool.filter((r) => !Number.isNaN(measure.c.num[r]!)) : pool;
    const skipped = pool.length - denom.length;
    if (skipped > 0) notes.push(`${plural(skipped, "row")} with a non-dollar amount ${skipped === 1 ? "is" : "are"} not in the denominator.`);
    return { text: `${rows.length} of ${denom.length} records match (${pct(rows.length, denom.length)}).`, notes };
  }

  if (op === "distinct") {
    const lc = labelCol(base);
    if (!lc) return { text: "No column to count distinct values in.", notes };
    const vals = [...new Set(rows.map((r) => displayCell(lc, r)).filter(Boolean))];
    return { text: `${vals.length} distinct ${lc.name} value${vals.length === 1 ? "" : "s"}${vals.length ? `: ${vals.slice(0, 20).join(", ")}` : ""}.`, notes };
  }

  if (op === "count") {
    if (flags.countPeople && personT) {
      const people = involvedPeople(rows);
      const names = [...new Set(people.map((p) => personName(p)).filter(Boolean))].sort();
      const n = people.length;
      return {
        text: `${plural(n, "person", "people")}${names.length && names.length <= 12 ? `: ${names.join(", ")}` : ""}.`,
        notes,
        people,
        subject: n === 1 ? names[0] ?? null : null,
        scope: conds,
      };
    }
    return { text: rows.length ? `${plural(rows.length, noun, noun === "row" ? "rows" : "transactions")}.` : "No matching rows.", notes, scope: conds };
  }

  if (op === "agg") {
    const col = measureCol!;
    const st = stats(col, rows);
    if (!st.n) return { text: "No matching rows, so there is nothing to add up.", notes };
    const who = toPerson ? involvedPeople(rows).length : 0;
    const tail = who ? ` for ${plural(who, "person", "people")}` : "";
    if (has("average", "avg", "mean") || flags.avg) {
      const money = col.type === "currency";
      const extra = money ? 0 : 2;
      const avg = divRound(st.sum * 10n ** BigInt(extra), BigInt(st.n));
      return { text: `Average ${subjName}: ${fmtM(col, avg, col.dec + extra)} across ${plural(st.n, noun, noun === "row" ? "rows" : "transactions")}${tail}.`, notes, scope: conds };
    }
    if (flags.median) {
      const sorted = [...st.vals].sort((a, b) => a - b);
      const mid = sorted.length % 2 ? sorted[(sorted.length - 1) / 2]! : (sorted[sorted.length / 2 - 1]! + sorted[sorted.length / 2]!) / 2;
      return { text: `Median ${subjName}: ${col.type === "currency" ? withCur(fmtNum(mid, 2, 2), col.cur ?? "$") : fmtNum(mid, 4, 0)} across ${plural(st.n, noun, noun === "row" ? "rows" : "transactions")}.`, notes, scope: conds };
    }
    return { text: `Total ${subjName}: ${fmtM(col, st.sum, col.dec)} across ${plural(st.n, noun, noun === "row" ? "rows" : "transactions")}${tail}.`, notes, scope: conds };
  }

  if (op === "top") {
    const col = measureCol!;
    const asc = flags.min && !flags.max;
    const withVal = rows.filter((r) => !Number.isNaN(col.num[r]!));
    const sorted = withVal.sort((a, b) => (asc ? col.num[a]! - col.num[b]! : col.num[b]! - col.num[a]!));
    const n = topN ?? 5;
    const pick = sorted.slice(0, Math.max(1, n));
    const lines = pick.map((r, i) => `${i + 1}. ${rowText(r)} — ${fmtM(col, toScaled(col.num[r]!, col.dec), col.dec)}`);
    const table: AnswerTable = {
      columns: ["#", "Item", subjName],
      rows: pick.map((r, i) => [String(i + 1), rowText(r), fmtM(col, toScaled(col.num[r]!, col.dec), col.dec)]),
    };
    return { text: `${asc ? "Smallest" : "Largest"} ${pick.length} by ${col.name}:\n${lines.join("\n")}`, table, notes, scope: conds };
  }

  if (op === "extreme") {
    const col = measureCol!;
    const st = stats(col, rows);
    if (!st.n) return { text: "No matching rows.", notes };
    const hi = flags.max && !flags.min;
    const r = hi ? st.best : st.worst;
    const people = involvedPeople([r]);
    return {
      text: `${hi ? "Largest" : "Smallest"} ${flags.countRows ? "transaction" : subjName}: ${rowText(r)} — ${fmtM(col, toScaled(col.num[r]!, col.dec), col.dec)}.`,
      notes,
      people,
      subject: people[0] ? personName(people[0]) : null,
      scope: conds,
    };
  }

  if (op === "group") {
    const hiSort = !(flags.min && !flags.max);
    const col = flags.money && measureCol ? measureCol : null;
    const avgMode = flags.avg;
    const isPersonBase = personT !== null && base.id === personT.id;
    const colMap = groupKey && groupKey.kind === "col" && groupKey.t.id !== base.id ? mapRows(m, base, rows, groupKey.t) : null;
    const keyOf = (r: number): { key: string; person: PersonRef | null } | null => {
      if (groupKey && groupKey.kind === "time") {
        const tc = base.cols.find((c) => c.type === "date");
        const v = tc ? tc.time[r]! : Number.NaN;
        if (Number.isNaN(v)) return null;
        const d = new Date(v);
        return { key: `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`, person: null };
      }
      if (groupKey && groupKey.kind === "col") {
        const p = personOfRow(r);
        if (groupKey.t.id === base.id) return { key: displayCell(groupKey.c, r), person: p };
        const mapped = colMap?.get(r) ?? [];
        return mapped.length ? { key: displayCell(groupKey.c, mapped[0]!), person: p } : null;
      }
      const p = personOfRow(r);
      const nm = personName(p);
      if (nm) return { key: nm, person: p };
      const lc = labelCol(base);
      return lc && lc.tokens.some((x) => COUNTERPARTY.includes(x)) ? { key: displayCell(lc, r), person: p } : null;
    };
    const groups = new Map<string, { rows: number[]; people: Map<string, PersonRef> }>();
    for (const r of rows) {
      const k = keyOf(r);
      if (!k || !k.key) continue;
      const g = groups.get(k.key) ?? { rows: [], people: new Map<string, PersonRef>() };
      g.rows.push(r);
      if (k.person) g.people.set(`${k.person.tableId}:${k.person.row}`, k.person);
      groups.set(k.key, g);
    }
    if (!groups.size && rows.length) {
      return { text: "I can't tell who these records belong to: the files have no person, merchant or company column that links them.", notes };
    }
    let list = [...groups.entries()]
      .filter(([, g]) => !col || stats(col, g.rows).n > 0)
      .map(([key, g]) => {
        const st = col ? stats(col, g.rows) : null;
        const metric = !col || !st ? BigInt(g.rows.length) : avgMode ? divRound(st.sum, BigInt(st.n)) : st.sum;
        return { key, rows: g.rows, people: [...g.people.values()], count: g.rows.length, metric };
      });
    if (hv.h) {
      const h = hv.h;
      list = list.filter((g) => h.test(g.count));
    }
    if (!list.length) return { text: "No groups match in the files.", notes, scope: conds };
    list.sort((a, b) => {
      if (a.metric === b.metric) return a.key.localeCompare(b.key);
      const aFirst = hiSort ? a.metric > b.metric : a.metric < b.metric;
      return aFirst ? -1 : 1;
    });
    const who = Boolean(flags.who && (flags.max || flags.min) && !topN);
    const topMetric = list[0]!.metric;
    const cap = topN ?? (who ? list.filter((g) => g.metric === topMetric).length : 25);
    const shown = list.slice(0, Math.max(1, cap));
    const metricLabel = (g: { metric: bigint; count: number }): string =>
      col ? fmtM(col, g.metric, col.dec)
      : flags.countRows ? plural(g.count, "transaction", "transactions")
      : isPersonBase ? plural(g.count, "person", "people")
      : plural(g.count, "record", "records");
    const lines = shown.map((g) => {
      const names = [...new Set(g.people.map((p) => personName(p)).filter((n) => n && n !== g.key))];
      const tail = groupKey && groupKey.kind === "col" && names.length && names.length <= 8 ? ` — ${names.join(", ")}` : "";
      return `${g.key}: ${metricLabel(g)}${tail}`;
    });
    const table: AnswerTable = {
      columns: [groupPhrase ? (groupPhrase.split(/\s+/)[0] ?? "group") : "group", col ? subjName : "count"],
      rows: shown.map((g) => [g.key, metricLabel(g)]),
    };
    const top = shown[0]!;
    const lead = shown.length > 1 ? `Tie for ${hiSort ? "highest" : "lowest"}` : hiSort ? "Highest" : "Lowest";
    const topHead = topN ? `Top ${shown.length} ${col ? `by ${subjName}` : "by count"}:` : `${shown.length} group${shown.length === 1 ? "" : "s"}:`;
    const text = who
      ? `${lead} ${col ? subjName : flags.countRows ? "transactions" : "records"}: ${lines.join("; ")}`
      : `${topHead}\n${lines.join("\n")}`;
    return {
      text,
      table,
      notes,
      people: who || shown.length === 1 ? top.people : undefined,
      subject: shown.length === 1 && top.people.length ? personName(top.people[0]!) : null,
      scope: conds,
    };
  }

  if (op === "compare") {
    const ents = [...entities.entries()].slice(0, 3);
    const pt = personT!;
    const cols = (projs.length && projs[0]!.t.id === pt.id ? projs.map((p) => p.c) : defaultFields(pt)).slice(0, 8);
    const sides: Array<{ label: string; rows: number[] }> = [];
    for (const [key, label] of ents) {
      const set = entitySets(m, key, true).get(pt.id);
      const rs = set ? [...set].sort((a, b) => a - b) : [];
      if (!rs.length) return { text: `No record in the files mentions “${label}”.`, notes };
      for (const r of rs) {
        const idc = pt.cols.find((c) => c.kind === "id");
        const idv = idc ? displayCell(idc, r) : "";
        sides.push({ label: `${displayCell(nameColsOf(pt)[0]!, r)}${idv ? ` (${idv})` : ""}`, rows: [r] });
      }
    }
    if (sides.length < 2) return { text: "Name two people to compare.", notes };
    const lines = cols.map((c) => `${humanize(c)}: ${sides.map((s) => cellText(c, s.rows[0]!) || "—").join(" vs ")}`);
    const table: AnswerTable = {
      columns: ["Field", ...sides.map((s) => s.label)],
      rows: cols.map((c) => [humanize(c), ...sides.map((s) => cellText(c, s.rows[0]!) || "—")]),
    };
    return { text: `${sides.map((s) => s.label).join(" vs ")}\n${lines.join("\n")}`, table, notes, people: sides.map((s) => ({ tableId: pt.id, row: s.rows[0]! })) };
  }

  if (op === "lookup" || op === "list") {
    const isPersonBase = personT !== null && base.id === personT.id;
    // The label already names the row, so it is not repeated as a field.
    const lcol = labelCol(base);
    const fields = projs.filter((p) => p.t.id === base.id && p.c !== lcol).map((p) => p.c);
    const extra = base.cols.filter((c) => c !== lcol && c.kind !== "id" && !(c.person && !isManagerCol(c)) && c.missing < c.n);
    const moneyHere = Boolean(measure && measure.t.id === base.id && (flags.money || pendings.length > 0));
    const shownFields = fields.length
      ? fields
      : isPersonBase
        ? defaultFields(base)
        : moneyHere && measure
          ? [measure.c, ...extra.filter((c) => c !== measure.c).slice(0, 2)]
          : extra.slice(0, 3);
    const withValue = shownFields.length && isPersonBase === false ? rows.filter((r) => shownFields.some((c) => displayCell(c, r) !== "")) : rows;
    const ordered = [...withValue].sort((a, b) => rowText(a).localeCompare(rowText(b)));
    const people = involvedPeople(ordered);
    if (!ordered.length) {
      const target = entities.size ? `“${[...entities.values()].join(" and ")}”` : "the files";
      return { text: `No matching ${isPersonBase ? "records" : "rows"} for ${target}${fields.length ? ` (${fields.map(humanize).join(", ")})` : ""}.`, notes, scope: conds };
    }
    if (op === "lookup" && fields.length === 1 && !isPersonBase) {
      const f = fields[0]!;
      const lines = ordered.slice(0, 20).map((r) => `${personName(personOfRow(r)) || rowText(r)}'s ${humanize(f)}: ${cellText(f, r) || "—"}`);
      return { text: lines.join("\n"), notes, people, subject: people.length === 1 ? personName(people[0]!) : null, scope: conds, table: { columns: ["Person", humanize(f)], rows: ordered.slice(0, 50).map((r) => [rowText(r), cellText(f, r)]) } };
    }
    const pairsOf = (r: number) => shownFields.map((c) => `${humanize(c)}: ${cellText(c, r) || "—"}`).join(" · ");
    if (op === "lookup" && isPersonBase && shownFields.length === 1) {
      const f = shownFields[0]!;
      const lines = ordered.map((r) => `${personName({ tableId: base.id, row: r })}'s ${humanize(f)}: ${cellText(f, r) || "—"}`);
      return { text: lines.join("\n"), notes, people, subject: ordered.length === 1 ? personName({ tableId: base.id, row: ordered[0]! }) : null, scope: conds };
    }
    if (shownFields.length === 0) {
      const lines = ordered.slice(0, 25).map((r) => `• ${rowText(r)}`);
      return { text: `${plural(ordered.length, "match", "matches")}:\n${lines.join("\n")}`, notes, people, scope: conds, table: { columns: ["Match"], rows: ordered.slice(0, 50).map((r) => [rowText(r)]) } };
    }
    const lines = ordered.slice(0, 25).map((r) => (op === "lookup" && people.length === 1 ? `${rowText(r)} — ${pairsOf(r)}` : `• ${rowText(r)} — ${pairsOf(r)}`));
    const table: AnswerTable = {
      columns: ["Match", ...shownFields.map(humanize)],
      rows: ordered.slice(0, 50).map((r) => [rowText(r), ...shownFields.map((c) => cellText(c, r))]),
    };
    return {
      text: op === "lookup" && people.length === 1 ? lines.join("\n") : `${plural(ordered.length, "match", "matches")}:\n${lines.join("\n")}`,
      table,
      notes,
      people,
      subject: people.length === 1 ? personName(people[0]!) : null,
      scope: conds,
    };
  }

  return null;
}

function defaultFields(t: Table): Column[] {
  const lc = nameColsOf(t)[0];
  return t.cols
    .filter((c) => c !== lc && c.kind !== "id" && !(c.person && !isManagerCol(c)) && c.missing < c.n)
    .slice(0, 8);
}

// ---------------------------------------------------------------- public entry

function splitParts(q: string): string[] {
  return q
    .split(/\?\s*|;\s*|(?:\band\s+)?\bthen\b[,:]?\s*|\n+/i)
    .map((s) => s.trim())
    .filter((s) => s.length > 1)
    .flatMap((s) => s.split(/,\s*and\s+(?=(?:what|who|which|how|list|show|the|their|its|her|his|then)\b)/i))
    .map((s) => s.trim())
    .filter((s) => s.length > 1);
}

const modelCache = new WeakMap<Workbook, Model>();

/** Answer a question from a workbook. Returns null when the question is not one this engine understands. */
export function answerLumina(question: string, wb: Workbook, lastSubject?: string | null): LuminaOutput | null {
  const q = question.trim();
  if (!q || !wb.tables.length) return null;
  if (/^\s*(help|what can you|how do you|what is datalumina)\b/i.test(q)) return null;
  let m = modelCache.get(wb);
  if (!m) {
    m = buildModel(wb);
    modelCache.set(wb, m);
  }
  const ctx: Ctx = { people: null, scope: [], subject: lastSubject ?? null };
  const texts: string[] = [];
  const notes: string[] = [];
  for (const name of wb.truncatedFiles) {
    notes.push(`Only the first part of ${name} was read: the file is larger than the analysis limit.`);
  }
  let table: AnswerTable | undefined;
  let subject: string | null = null;
  let answered = 0;
  for (const part of splitParts(q)) {
    const r = runPart(part, m, ctx);
    if (!r) {
      texts.push(`I couldn't work out “${part}” from the files.`);
      continue;
    }
    answered += 1;
    texts.push(r.text);
    for (const n of r.notes) if (!notes.includes(n)) notes.push(n);
    if (r.table) table = r.table;
    if (r.people) ctx.people = r.people;
    if (r.scope) ctx.scope = r.scope;
    if (r.subject) {
      subject = r.subject;
      ctx.subject = r.subject;
    }
  }
  if (!answered) return null;
  return { text: texts.join("\n\n"), table, notes: notes.slice(0, 6), subject };
}
