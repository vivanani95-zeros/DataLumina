import { normalizeKey } from "./categories.ts";
import { parseNumber } from "./patterns.ts";
import type { AnalysisReport, AnswerTable, DataRecord } from "./types.ts";

type Payload = {
  text: string;
  report?: AnalysisReport;
  table?: AnswerTable;
  showReport?: boolean;
  subject?: string | null;
  recs?: DataRecord[];
};

const FIELD_ALIASES: Record<string, string[]> = {
  email: ["email", "email_address", "mail", "e_mail"],
  phone: ["phone", "mobile", "tel", "telephone", "cell"],
  name: ["full_name", "fullname", "name", "legal_name", "given_name"],
  dob: ["dob", "date_of_birth", "birthdate", "birthday"],
  gender: ["gender", "sex"],
  employer: ["employer", "company", "workplace", "org", "organization"],
  title: ["job_title", "title", "position"],
  manager: ["manager", "reports_to", "boss"],
  amount: ["amount", "spend", "payment_amount", "price", "total", "cost", "debit"],
  merchant: ["merchant", "vendor", "payee", "description"],
  score: ["score", "rating", "rank", "points"],
  balance: ["account_balance", "balance", "available_credit"],
  payment: ["payment_method", "checkout", "card_type"],
  ip: ["ip", "public_ip", "local_ip", "ip_address"],
  gps: ["latitude", "longitude", "lat", "lng", "lon", "gps", "coords"],
  date: ["ts", "timestamp", "date", "datetime", "created_at", "time"],
  unit: ["unit", "department", "org_unit", "team", "division"],
  office: ["office", "location", "site", "city", "campus"],
  status: ["status", "state", "kind", "txn_type"],
};

type Filter =
  | { kind: "text"; field?: string; value: string; mode: "has" | "eq" | "not" | "suffix" }
  | { kind: "num"; field: string; op: "gt" | "lt" | "gte" | "lte" | "eq"; value: number }
  | { kind: "date"; field?: string; op: "before" | "after" | "on" | "since" | "until"; value: number; dateOnly?: boolean }
  | { kind: "between"; field: string; min: number; max: number; date?: boolean }
  | { kind: "under"; boss: string }
  | { kind: "hour"; op: "gte" | "lt" | "between"; a: number; b?: number }
  | { kind: "dow"; weekend: boolean };

type Action = "lookup" | "list" | "count" | "sum" | "avg" | "min" | "max" | "median" | "compare" | "percent" | "rank" | "group";

type Clause = {
  raw: string;
  action: Action;
  subjects: string[];
  fields: string[];
  filters: Filter[];
  groupBy?: string;
  limit?: number;
  txnOnly?: boolean;
  having?: { op: "gt" | "gte" | "lt"; value: number };
  havingCount?: { op: "gte" | "gt"; value: number };
  reportsUnder?: string;
  scopePrev?: boolean;
  rankBy?: "sum" | "count";
};

function nk(s: string): string {
  return normalizeKey(s);
}

function aliases(hint: string): string[] {
  return FIELD_ALIASES[hint] ?? [hint];
}

function getField(rec: DataRecord, hints: string[], prefer: string[] = []): string | undefined {
  const map = new Map<string, string>();
  for (const [k, v] of Object.entries(rec.fields)) {
    if (v) map.set(nk(k), v);
  }
  let best: { value: string; score: number } | null = null;
  for (const [k, v] of map) {
    let score = 0;
    for (const h of hints) {
      for (const a of aliases(h).concat(h)) {
        const ak = nk(a);
        if (!ak) continue;
        if (k === ak) score = Math.max(score, 100 + ak.length);
        else if (k.startsWith(`${ak}_`) || k.endsWith(`_${ak}`)) score = Math.max(score, 50 + ak.length);
        else if (ak.length >= 5 && k.includes(ak)) score = Math.max(score, 20 + ak.length);
      }
    }
    for (const p of prefer) {
      if (p && k.includes(nk(p))) score += 12;
    }
    if (score > 0 && (!best || score > best.score)) best = { value: v, score };
  }
  return best?.value;
}

function blob(rec: DataRecord): string {
  return Object.values(rec.fields).join(" ").toLowerCase();
}

function unique(values: string[]): string[] {
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

function paymentFamily(raw: string): string {
  const compact = raw.toLowerCase().replace(/\*[\w]+/g, " ").replace(/\d+/g, " ").replace(/[^a-z]+/g, "");
  if (compact.startsWith("visa")) return "visa";
  if (compact === "mc" || compact.startsWith("master")) return "mastercard";
  if (compact.includes("amex") || compact.includes("americanexpress")) return "amex";
  if (compact.includes("applepay")) return "applepay";
  return compact;
}

function normGender(raw: string): string {
  const t = raw.toLowerCase().trim();
  if (["f", "female", "woman", "women", "w"].includes(t)) return "female";
  if (["m", "male", "man", "men"].includes(t)) return "male";
  return t;
}

function namesMatch(a: string, b: string): boolean {
  const norm = (s: string) =>
    s.toLowerCase().replace(/["'.]/g, " ").replace(/,/g, " ").replace(/\s+/g, " ").trim();
  const na = norm(a);
  const nb = norm(b);
  if (!na || !nb) return false;
  if (na === nb || na.includes(nb) || nb.includes(na)) return true;
  const sa = na.split(" ").filter(Boolean).sort().join(" ");
  const sb = nb.split(" ").filter(Boolean).sort().join(" ");
  return sa === sb && sa.length > 0;
}

function nameVariants(name: string): string[] {
  const t = name.replace(/"/g, "").trim();
  const out = [t];
  const m = t.match(/^([^,]+),\s*(.+)$/);
  if (m) out.push(`${m[2]!.trim()} ${m[1]!.trim()}`);
  return unique(out);
}

function catalog(records: DataRecord[]) {
  const col = (hint: string) =>
    unique(records.map((r) => getField(r, [hint])).filter((v): v is string => Boolean(v)));
  const columns = unique(records.flatMap((r) => Object.keys(r.fields)));
  return {
    names: col("name"),
    employers: col("employer"),
    units: col("unit"),
    offices: col("office"),
    payments: col("payment"),
    merchants: col("merchant"),
    titles: col("title"),
    emails: col("email"),
    managers: col("manager"),
    columns,
  };
}

function orgUnder(records: DataRecord[], boss: string): Set<string> {
  const found = new Set<string>();
  let frontier = [boss];
  const people = records.filter((r) => getField(r, ["name"]));
  let guard = 0;
  while (frontier.length && guard++ < 8) {
    const next: string[] = [];
    for (const p of people) {
      const mgr = getField(p, ["manager"]) ?? "";
      const nm = getField(p, ["name"]) ?? "";
      if (!nm || found.has(nm.toLowerCase())) continue;
      if (!frontier.some((b) => namesMatch(mgr, b))) continue;
      found.add(nm.toLowerCase());
      next.push(nm);
    }
    frontier = next;
  }
  return found;
}

function recJoinId(rec: DataRecord): string {
  const direct =
    rec.fields.employee_id ??
    rec.fields.emp_id ??
    rec.fields.staff_id ??
    rec.fields.user_id ??
    rec.fields.account_id ??
    rec.fields.device_id;
  if (direct) return direct.toLowerCase();
  for (const [k, v] of Object.entries(rec.fields)) {
    const key = nk(k);
    if ((key.endsWith("employee_id") || key.endsWith("user_id") || key.endsWith("account_id") || key === "hostname") && v) {
      return v.toLowerCase();
    }
  }
  return "";
}

function enrichRecords(records: DataRecord[]): DataRecord[] {
  const byEmp = new Map<string, DataRecord>();
  const byEmail = new Map<string, DataRecord>();
  const byName = new Map<string, DataRecord>();
  for (const r of records) {
    if (!getField(r, ["name"])) continue;
    const id = recJoinId(r);
    const email = (getField(r, ["email"]) ?? "").toLowerCase();
    const name = (getField(r, ["name"]) ?? "").toLowerCase();
    if (id && getField(r, ["title"])) byEmp.set(id, r);
    else if (id && !byEmp.has(id)) byEmp.set(id, r);
    if (email) byEmail.set(email, r);
    if (name) byName.set(name, r);
  }
  return records.map((r) => {
    if (getField(r, ["name"]) && getField(r, ["title"]) && getField(r, ["email"])) return r;
    const id = recJoinId(r);
    const email = (getField(r, ["email"]) ?? "").toLowerCase();
    const name = (getField(r, ["name"]) ?? "").toLowerCase();
    const person =
      (id ? byEmp.get(id) : undefined) ||
      (email ? byEmail.get(email) : undefined) ||
      (name ? byName.get(name) : undefined);
    if (!person || person === r) return r;
    return { ...r, fields: { ...person.fields, ...r.fields } };
  });
}

export function parseClauseForTest(raw: string, records: DataRecord[], lastSubject?: string | null) {
  return parseClause(raw, records, lastSubject);
}

function parseDate(raw: string): { t: number; dateOnly: boolean } | null {
  const s = raw.trim();
  const iso = s.match(/^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2}(?::\d{2})?))?/);
  if (iso) {
    const stamp = iso[2] ? `${iso[1]}T${iso[2]}` : iso[1]!;
    const t = Date.parse(stamp);
    return Number.isNaN(t) ? null : { t, dateOnly: !iso[2] };
  }
  const us = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (us) {
    const t = Date.parse(`${us[3]}-${us[1]!.padStart(2, "0")}-${us[2]!.padStart(2, "0")}`);
    return Number.isNaN(t) ? null : { t, dateOnly: true };
  }
  if (/^(19|20)\d{2}$/.test(s)) {
    const t = Date.parse(`${s}-01-01`);
    return Number.isNaN(t) ? null : { t, dateOnly: true };
  }
  const months = "january,february,march,april,may,june,july,august,september,october,november,december".split(",");
  const named = s.match(/\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2})(?:,\s*)?(\d{4})?/i);
  if (named) {
    const m = months.indexOf(named[1]!.toLowerCase()) + 1;
    const yearN = named[3] ?? "2026";
    const t = Date.parse(`${yearN}-${String(m).padStart(2, "0")}-${named[2]!.padStart(2, "0")}`);
    return Number.isNaN(t) ? null : { t, dateOnly: true };
  }
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : { t, dateOnly: false };
}

function recDate(rec: DataRecord): number | null {
  for (const hint of ["date", "dob", "ts"]) {
    const v = getField(rec, [hint]);
    if (!v) continue;
    const d = parseDate(v);
    if (d) return d.t;
  }
  for (const v of Object.values(rec.fields)) {
    if (/\d{4}-\d{2}-\d{2}/.test(v) || /\d{1,2}\/\d{1,2}\/\d{4}/.test(v)) {
      const d = parseDate(v);
      if (d) return d.t;
    }
  }
  return null;
}

function recNum(rec: DataRecord, field: string): number | null {
  const v = getField(rec, [field]);
  return v ? parseNumber(v) : null;
}

function isTxn(rec: DataRecord): boolean {
  const amount = recNum(rec, "amount");
  if (amount === null) return false;
  const id = (getField(rec, ["id"]) ?? rec.fields.txn_id ?? rec.fields.kind ?? "").toLowerCase();
  const text = `${id} ${blob(rec)}`;
  if (/holdings|credit_limit|wallet|fico/.test(text)) return false;
  if (/subscription|monthly|recurring/.test(text) && !/^t-/.test(id)) return false;
  return true;
}

function recStamp(rec: DataRecord): Date | null {
  const t = recDate(rec);
  if (t === null) return null;
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? null : d;
}

function matchFilter(rec: DataRecord, f: Filter): boolean {
  if (f.kind === "under") {
    return namesMatch(getField(rec, ["manager"]) ?? "", f.boss);
  }
  if (f.kind === "hour") {
    const d = recStamp(rec);
    if (!d) return false;
    const h = d.getHours() + d.getMinutes() / 60;
    if (f.op === "gte") return h >= f.a;
    if (f.op === "lt") return h < f.a;
    return h >= f.a && h < (f.b ?? 24);
  }
  if (f.kind === "dow") {
    const d = recStamp(rec);
    if (!d) return false;
    const w = d.getDay();
    const isWe = w === 0 || w === 6;
    return f.weekend ? isWe : !isWe;
  }
  if (f.kind === "between") {
    if (f.date) {
      const d = recDate(rec);
      if (d === null) return false;
      return d >= f.min && d <= f.max;
    }
    const n = recNum(rec, f.field);
    if (n === null) return false;
    return n >= f.min && n <= f.max;
  }
  if (f.kind === "text") {
    const val = f.field ? (getField(rec, [f.field]) ?? "") : blob(rec);
    const hay = val.toLowerCase();
    const n = f.value.toLowerCase();
    let hit = false;
    if (f.mode === "suffix") hit = hay.endsWith(n);
    else if (f.field === "gender") hit = normGender(val) === normGender(f.value);
    else if (f.field === "payment") hit = paymentFamily(val) === paymentFamily(f.value) || hay.includes(n);
    else if (f.mode === "eq") hit = hay === n;
    else hit = hay.includes(n);
    if (!hit && (f.field === "manager" || f.field === "name")) hit = namesMatch(val, f.value);
    return f.mode === "not" ? !hit : hit;
  }
  if (f.kind === "num") {
    const n = recNum(rec, f.field);
    if (n === null) return false;
    if (f.op === "gt") return n > f.value;
    if (f.op === "lt") return n < f.value;
    if (f.op === "gte") return n >= f.value;
    if (f.op === "lte") return n <= f.value;
    return n === f.value;
  }
  if (f.kind !== "date") return true;
  const d = f.field ? (() => {
    const v = getField(rec, [f.field]);
    if (!v) return null;
    return parseDate(v)?.t ?? null;
  })() : recDate(rec);
  if (d === null) return false;
  if (f.op === "before" || f.op === "until") return d < f.value;
  if (f.op === "since") return d >= f.value;
  if (f.op === "after") {
    const cut = f.dateOnly ? f.value + 86_400_000 - 1 : f.value;
    return d > cut;
  }
  const day = 86_400_000;
  return d >= f.value && d < f.value + day;
}

function applyFilters(records: DataRecord[], filters: Filter[], txnOnly?: boolean): DataRecord[] {
  let src = txnOnly ? records.filter(isTxn) : records;
  const orBuckets = new Map<string, Filter[]>();
  const rest: Filter[] = [];
  for (const f of filters) {
    if (f.kind === "text" && f.mode === "has" && f.field) {
      const k = `has:${f.field}`;
      const arr = orBuckets.get(k) ?? [];
      arr.push(f);
      orBuckets.set(k, arr);
    } else {
      rest.push(f);
    }
  }
  for (const group of orBuckets.values()) {
    if (group.length === 1) src = src.filter((r) => matchFilter(r, group[0]!));
    else src = src.filter((r) => group.some((f) => matchFilter(r, f)));
  }
  for (const f of rest) src = src.filter((r) => matchFilter(r, f));
  return src;
}

function longestMentions(hay: string, values: string[]): string[] {
  const ql = hay.toLowerCase();
  const hits: string[] = [];
  const sorted = [...values].sort((a, b) => b.length - a.length);
  const used: Array<[number, number]> = [];
  for (const v of sorted) {
    if (v.length < 3) continue;
    const i = ql.indexOf(v.toLowerCase());
    if (i < 0) continue;
    const j = i + v.length;
    if (used.some(([a, b]) => i < b && j > a)) continue;
    used.push([i, j]);
    hits.push(v);
  }
  return hits;
}

function contextBefore(q: string, value: string): string {
  const i = q.toLowerCase().indexOf(value.toLowerCase());
  if (i < 0) return "";
  return q.slice(Math.max(0, i - 32), i).toLowerCase();
}

function splitClauses(question: string): string[] {
  const parts = question
    .split(/\s*(?:;|\n+|\bthen\b|\bof those[,.]?\s*|\bamong them[,.]?\s*|\bfrom those[,.]?\s*|\band also\b|\badditionally\b|\bafter that\b|\bfurthermore\b|\bplus\b(?=\s+(?:list|show|what|who|total|how)))\s*/i)
    .map((p) => p.trim())
    .filter((p) => p.length > 3);
  return parts.length ? parts : [question.trim()];
}

function detectAction(ql: string): Action {
  if (/\bcompare\b|\bversus\b|\b vs\.? \b|\bdifference between\b/.test(ql)) return "compare";
  if (/\bpercent|percentage|share of|fraction of|proportion\b/.test(ql)) return "percent";
  if (/\bgroup(?:ed)?(?:\s+\w+){0,4}\s+by\b|\bbreak(?:down)? by\b/.test(ql)) return "group";
  if (/\btop\s+\d|\bbottom\s+\d|\b\d+\s+(largest|biggest|highest|smallest|lowest)\b|\b(largest|biggest|highest)\s+\d/.test(ql)) return "rank";
  if (/\baverage\b|\bmean\b|\bavg\b/.test(ql)) return "avg";
  if (/\bhow many\b|\bcount\b|\bnumber of\b/.test(ql)) return "count";
  if (/\b(who|which)\b[\s\S]{0,48}\bmost\b/.test(ql) && /\b(spend|spent|amount)\b/.test(ql)) return "max";
  if (/\bwho spent the most\b|\bhighest remaining\b|\bmost remaining spend\b/.test(ql)) return "max";
  if (/\btotal\b|\bsum\b|\bhow much\b|\bspent\b|\bspend\b/.test(ql) && !/\bwho spent the most\b/.test(ql)) return "sum";
  if (/\bwho spent the most\b|\bhighest\b|\blargest\b|\bmaximum\b|\bmost\b/.test(ql) && /\b(spend|spent|amount|score|cost)\b/.test(ql)) return "max";
  if (/\blowest\b|\bsmallest\b|\bminimum\b/.test(ql) || (/\bleast\b/.test(ql) && !/\bat least\b/.test(ql))) return "min";
  if (/\bwho is\b|\bwhat's\b|\bwhat is\b|\btell me about\b/.test(ql)) return "lookup";
  return "list";
}

function parseClause(raw: string, records: DataRecord[], lastSubject?: string | null): Clause {
  const q = raw.trim();
  const ql = q.toLowerCase();
  const cat = catalog(records);
  const filters: Filter[] = [];
  const subjects: string[] = [];
  const fields: string[] = [];
  let reportsUnder: string | undefined;

  const nameHits = longestMentions(
    q,
    unique([...cat.names, ...cat.managers].flatMap((n) => nameVariants(n))),
  );
  for (const name of nameHits) {
    const before = contextBefore(q, name);
    if (/\breport(?:s|ing)? to\s+$/.test(before) || /\bmanager|\bmanaged|\bto\s+$/.test(before)) {
      filters.push({ kind: "text", field: "manager", value: name, mode: "has" });
    } else if (/\bunder\b|\bteam of\b|\borg(?:anization)? of\b|\bdirect reports of\b/.test(before)) {
      reportsUnder = name;
    } else {
      subjects.push(name);
    }
  }
  if (!subjects.length) {
    for (const n of cat.names) {
      if (filters.some((f) => f.kind === "text" && f.field === "manager" && namesMatch(f.value, n))) continue;
      if (reportsUnder && namesMatch(reportsUnder, n)) continue;
      const western = nameVariants(n).find((v) => !v.includes(",")) ?? n;
      const given = western.split(/\s+/).find((p) => p.length >= 3);
      if (!given) continue;
      if (new RegExp(`\\b${given.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(q)) {
        if (!subjects.some((s) => namesMatch(s, n))) subjects.push(n);
      }
    }
  }
  if (!subjects.length && /\b(her|his|their|she|he)\b/.test(ql) && lastSubject) subjects.push(lastSubject);

  for (const emp of longestMentions(q, cat.employers.concat(cat.units).concat(cat.offices))) {
    const isUnit = cat.units.some((u) => u.toLowerCase() === emp.toLowerCase());
    const isOffice = cat.offices.some((u) => u.toLowerCase() === emp.toLowerCase());
    filters.push({ kind: "text", field: isUnit ? "unit" : isOffice ? "office" : "employer", value: emp, mode: "has" });
  }
  for (const pay of unique(
    cat.payments
      .map((p) => p.replace(/\*[\w]+/g, "").replace(/\d+/g, "").trim())
      .concat(["Visa", "Mastercard", "Apple Pay", "Amex", "Master Card"]),
  )) {
    if (pay.length < 2) continue;
    const re = new RegExp(`\\b${pay.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+")}\\b`, "i");
    if (re.test(q)) filters.push({ kind: "text", field: "payment", value: pay, mode: "has" });
  }
  for (const mer of longestMentions(q, cat.merchants)) {
    if (subjects.some((s) => s.toLowerCase() === mer.toLowerCase())) continue;
    const before = contextBefore(q, mer);
    if (/\bat\b|\bfrom\b|\bvia\b|\bwith\b|\bmerchant\b|\bspent at\b/.test(before) || ql.includes("merchant")) {
      filters.push({ kind: "text", field: "merchant", value: mer, mode: "has" });
    } else if (!cat.names.some((n) => n.toLowerCase() === mer.toLowerCase())) {
      filters.push({ kind: "text", field: "merchant", value: mer, mode: "has" });
    }
  }
  for (const title of longestMentions(q, cat.titles)) {
    filters.push({ kind: "text", field: "title", value: title, mode: "has" });
  }

  if (/\bfemale|\bwomen\b|\bwoman\b/.test(ql)) filters.push({ kind: "text", field: "gender", value: "female", mode: "eq" });
  else if (/\bmale\b|\bmen\b|\bman\b/.test(ql) && !/\bfemale/.test(ql)) filters.push({ kind: "text", field: "gender", value: "male", mode: "eq" });

  const onAfter = ql.match(/\bon or after\s+([a-z0-9, /-]{4,24})/);
  const after = !onAfter ? ql.match(/\b(?:after|since|later than|from)\s+([a-z0-9, /-]{4,24})/) : null;
  if (onAfter) {
    const d = parseDate(onAfter[1]!);
    if (d) filters.push({ kind: "date", op: "since", value: d.t, dateOnly: d.dateOnly });
  } else if (after) {
    const d = parseDate(after[1]!);
    if (d) {
      const since = ql.includes("since") || ql.includes("from");
      filters.push({ kind: "date", op: since ? "since" : "after", value: d.t, dateOnly: d.dateOnly });
    }
  }
  const beforeD = ql.match(/\b(?:before|until|prior to|earlier than)\s+([a-z0-9, /-]{4,24})/);
  if (beforeD) {
    const d = parseDate(beforeD[1]!);
    if (d) filters.push({ kind: "date", field: /\bborn|dob|birth/.test(ql) ? "dob" : undefined, op: "before", value: d.t, dateOnly: d.dateOnly });
  }
  const yearBefore = ql.match(/\bborn before\s+(\d{4})|\bbefore\s+(\d{4})\b/);
  if (yearBefore) {
    const y = yearBefore[1] ?? yearBefore[2]!;
    const d = Date.parse(`${y}-01-01`);
    if (!Number.isNaN(d)) filters.push({ kind: "date", field: "dob", op: "before", value: d });
  }

  const over = ql.match(/\b(?:over|above|greater than|more than|at least|>=)\s*\$?\s*([\d,.]+)/);
  if (over) {
    const tail = ql.slice((over.index ?? 0) + over[0].length, (over.index ?? 0) + over[0].length + 28);
    if (!/\b(transactions?|charges?|payments?|rows?|people|staff)\b/.test(tail)) {
      const n = parseNumber(over[1]!.replace(/,/g, ""));
      if (n !== null) filters.push({ kind: "num", field: /\bscore\b/.test(ql) ? "score" : "amount", op: ql.includes("at least") ? "gte" : "gt", value: n });
    }
  }
  const under = ql.match(/\b(?:under|below|less than|at most|<=)\s*\$?\s*([\d,.]+)/);
  if (under) {
    const n = parseNumber(under[1]!.replace(/,/g, ""));
    if (n !== null) filters.push({ kind: "num", field: /\bscore\b/.test(ql) ? "score" : "amount", op: ql.includes("at most") ? "lte" : "lt", value: n });
  }

  const domain = ql.match(/\b(?:ends in |ending in )\s*\.?([a-z0-9.-]{2,24})\b/) ?? ql.match(/\b(?:@)?\.?([a-z0-9-]+\.(?:test|example|com|org|io|net|aero|corp))\b/);
  if (domain && (/\bemail/.test(ql) || /\bends in\b|\bending in\b/.test(ql) || domain[0]?.includes("."))) {
    const val = domain[1]!.includes(".") ? domain[1]! : `.${domain[1]}`;
    const mode = /\bends in\b|\bending in\b/.test(ql) ? "suffix" : "has";
    filters.push({ kind: "text", field: "email", value: val.startsWith(".") ? val : val, mode });
  }

  const excl = ql.match(/\b(?:exclud(?:e|ing)|except|without|not including)\s+([a-z0-9 _.,/-]{3,80})/);
  if (excl) {
    const parts = excl[1]!.split(/\s*(?:,|&|\/|\band\b)\s*/i).map((s) => s.trim()).filter((s) => s.length > 2);
    for (const val of parts) {
      const stem = val.replace(/s$/, "");
      filters.push({ kind: "text", value: stem, mode: "not" });
      if (/subscrip/.test(stem)) filters.push({ kind: "text", value: "recurring", mode: "not" });
      if (/refund/.test(stem)) filters.push({ kind: "text", value: "chargeback", mode: "not" });
    }
  }

  if (/\bafter hours\b|\bafter[\s-]?hours\b|\blate night\b|\bafter 6\s*p/.test(ql) || /\bafter 18:00\b/.test(ql)) {
    filters.push({ kind: "hour", op: "gte", a: 18 });
  }
  if (/\bbefore hours\b|\bbusiness hours\b|\bduring work/.test(ql)) {
    filters.push({ kind: "hour", op: "between", a: 9, b: 18 });
  }
  if (/\bweekend/.test(ql)) filters.push({ kind: "dow", weekend: true });
  else if (/\bweekday|\bbusiness day/.test(ql)) filters.push({ kind: "dow", weekend: false });

  const months = "january,february,march,april,may,june,july,august,september,october,november,december".split(",");
  const inMonth = ql.match(/\bin (january|february|march|april|may|june|july|august|september|october|november|december)(?:\s+(\d{4}))?/);
  if (inMonth) {
    const m = months.indexOf(inMonth[1]!);
    const y = inMonth[2] ?? "2026";
    const start = Date.parse(`${y}-${String(m + 1).padStart(2, "0")}-01`);
    const endM = m === 11 ? Date.parse(`${Number(y) + 1}-01-01`) : Date.parse(`${y}-${String(m + 2).padStart(2, "0")}-01`);
    if (!Number.isNaN(start)) filters.push({ kind: "between", field: "date", min: start, max: endM - 1, date: true });
  }
  const qtr = ql.match(/\bq([1-4])(?:\s+(\d{4}))?\b/);
  if (qtr) {
    const qn = Number(qtr[1]);
    const y = qtr[2] ?? "2026";
    const startM = (qn - 1) * 3 + 1;
    const start = Date.parse(`${y}-${String(startM).padStart(2, "0")}-01`);
    const endM = startM + 3;
    const end = endM > 12 ? Date.parse(`${Number(y) + 1}-01-01`) : Date.parse(`${y}-${String(endM).padStart(2, "0")}-01`);
    if (!Number.isNaN(start)) filters.push({ kind: "between", field: "date", min: start, max: end - 1, date: true });
  }
  const between = ql.match(/\bbetween\s*\$?\s*([\d,.]+)\s+and\s*\$?\s*([\d,.]+)/);
  if (between) {
    const a = parseNumber(between[1]!.replace(/,/g, ""));
    const b = parseNumber(between[2]!.replace(/,/g, ""));
    if (a !== null && b !== null) filters.push({ kind: "between", field: "amount", min: Math.min(a, b), max: Math.max(a, b) });
  }
  const betweenDates = ql.match(/\bbetween\s+(\d{4}-\d{2}-\d{2})\s+and\s+(\d{4}-\d{2}-\d{2})/);
  if (betweenDates) {
    const a = parseDate(betweenDates[1]!);
    const b = parseDate(betweenDates[2]!);
    if (a && b) filters.push({ kind: "between", field: "date", min: Math.min(a.t, b.t), max: Math.max(a.t, b.t), date: true });
  }

  if (/\babove average|more than (?:the )?average|over (?:the )?average|greater than (?:the )?average/.test(ql)) {
    const uni = records.filter(isTxn);
    const series = amounts(uni);
    if (series && series.values.length) {
      const avg = series.values.reduce((s, x) => s + x.n, 0) / series.values.length;
      filters.push({ kind: "num", field: series.field, op: "gt", value: avg });
    }
  }

  const underName = q.match(/\b(?:under|org(?:anization)? of|team of|direct reports of)\s+([A-Z][A-Za-z.]+(?:\s+[A-Z][A-Za-z.]+){0,3})/);
  if (underName?.[1] && cat.names.concat(cat.managers).some((n) => namesMatch(n, underName[1]!))) {
    reportsUnder = reportsUnder ?? underName[1];
  }

  for (const [hint, keys] of Object.entries(FIELD_ALIASES)) {
    const hit = keys.some((k) => {
      const phrase = k.replace(/_/g, " ");
      if (phrase.length <= 3) return new RegExp(`\\b${phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(ql);
      return ql.includes(phrase);
    });
    if (hit && !fields.includes(hint)) fields.push(hint);
  }

  let groupBy: string | undefined;
  const gb = ql.match(/\b(?:grouped by|group by|break(?:down)? by|per|by)\s+([a-z0-9 _-]{3,32})/);
  if (gb) {
    const g = nk(gb[1]!);
    if (/^(employee|person|people|name|staff)s?$/.test(g)) groupBy = "name";
    else {
      const col = cat.columns.find((c) => nk(c) === g || nk(c).includes(g) || g.includes(nk(c)));
      if (col) groupBy = col;
      else if (FIELD_ALIASES[g]) groupBy = g;
    }
  }

  let limit: number | undefined;
  const top = ql.match(/\btop\s+(\d+)/) ?? ql.match(/\b(\d+)\s+(?:largest|biggest|highest|smallest)/) ?? ql.match(/\b(?:largest|biggest|highest)\s+(\d+)/);
  if (top) limit = Number(top[1]);

  let having: Clause["having"];
  const hav = ql.match(/\b(?:with totals?|whose totals?|having totals?|combined (?:spend|amount))\s+(?:over|above|exceed(?:s|ing)|greater than|more than)\s*\$?\s*([\d,.]+)/);
  if (hav) {
    const n = parseNumber(hav[1]!.replace(/,/g, ""));
    if (n !== null) having = { op: "gt", value: n };
  }

  let havingCount: Clause["havingCount"];
  const hc = ql.match(/\b(?:at least|more than|over|>=)\s+(\d+)\s+(?:transactions?|charges?|payments?|rows?)/);
  if (hc) {
    const n = Number(hc[1]);
    if (n > 0) havingCount = { op: ql.includes("at least") ? "gte" : "gt", value: n };
  }

  const scopePrev = /\bof those\b|\bamong them\b|\bamong those\b|\bfrom those\b|\bthose people\b|\bthe same (?:people|staff|employees)\b|\bfor those\b/.test(ql);

  let action = detectAction(ql);
  if (action === "lookup" && !subjects.length && fields.length) action = "list";
  if (/\bmedian\b/.test(ql)) action = "median";
  let rankBy: Clause["rankBy"];
  if (/\bmost (?:transactions?|charges?|payments?)\b|\b(highest|most) (?:number of|count of) (?:transactions?|charges?)\b/.test(ql)) {
    action = "rank";
    rankBy = "count";
    groupBy = groupBy ?? "name";
  }
  if (havingCount && (action === "min" || action === "max" || action === "lookup")) action = "list";
  if (/\bby (?:employee|person|people|name|staff)\b/.test(ql) && (action === "sum" || action === "avg" || action === "list")) {
    groupBy = groupBy ?? "name";
    if (action === "list") action = "sum";
  }
  const txnOnly = action === "sum" || action === "avg" || action === "median" || action === "percent" || action === "rank" || (action === "max" && fields.includes("amount")) || /\btransaction|spend|spent|merchant|payment\b/.test(ql);

  return { raw: q, action, subjects: unique(subjects), fields, filters, groupBy, limit, txnOnly, having, havingCount, reportsUnder, scopePrev, rankBy };
}

function money(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function fmt(field: string, n: number): string {
  if (/amount|price|spend|balance|cost|payment|credit|debit/.test(nk(field))) return money(n);
  if (Number.isInteger(n)) return String(n);
  return String(Number(n.toFixed(4)));
}

function gpsPair(rec: DataRecord): string | undefined {
  let lat: string | undefined;
  let lng: string | undefined;
  for (const [k, v] of Object.entries(rec.fields)) {
    const key = nk(k);
    if (key === "lat" || key.endsWith("_lat") || key.includes("latitude")) lat = v;
    if (key === "lng" || key === "lon" || key.endsWith("_lng") || key.endsWith("_lon") || key.includes("longitude")) lng = v;
  }
  if (lat && lng) return `${lat}, ${lng}`;
  return lat ?? lng;
}

function formatRecord(rec: DataRecord, prefer: string[] = []): string {
  const name = getField(rec, ["name"]);
  const bits: string[] = [];
  const used = new Set<string>();
  if (name) {
    bits.push(name);
    used.add(name.toLowerCase());
  }
  const order = prefer.length ? prefer : ["title", "employer", "email", "phone", "manager", "amount", "merchant", "payment", "dob", "gender"];
  for (const hint of order) {
    const v = getField(rec, [hint]);
    if (!v || used.has(v.toLowerCase())) continue;
    used.add(v.toLowerCase());
    bits.push(`${hint} ${v}`);
  }
  return bits.join(" · ");
}

function table(recs: DataRecord[], prefer?: string[]): AnswerTable | undefined {
  if (!recs.length) return undefined;
  const keyCount = new Map<string, number>();
  for (const r of recs) for (const k of Object.keys(r.fields)) keyCount.set(k, (keyCount.get(k) ?? 0) + 1);
  let columns = [...keyCount.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k);
  if (prefer?.length) {
    const pref = columns.filter((c) => prefer.some((p) => nk(c).includes(nk(p))));
    columns = [...pref, ...columns.filter((c) => !pref.includes(c))];
  }
  columns = columns.slice(0, 7);
  return {
    columns,
    rows: recs.slice(0, 16).map((r) => columns.map((c) => r.fields[c] ?? "")),
  };
}

function amounts(recs: DataRecord[]): { field: string; values: { rec: DataRecord; n: number }[] } | null {
  const rows: { rec: DataRecord; n: number }[] = [];
  let field = "amount";
  for (const rec of recs) {
    for (const hint of ["amount", "score", "balance"]) {
      const v = getField(rec, [hint]);
      const n = v ? parseNumber(v) : null;
      if (n !== null) {
        field = hint;
        rows.push({ rec, n });
        break;
      }
    }
  }
  return rows.length ? { field, values: rows } : null;
}

function personTotals(recs: DataRecord[]): { name: string; sum: number; recs: DataRecord[] }[] {
  const map = new Map<string, { name: string; sum: number; recs: DataRecord[] }>();
  for (const r of recs) {
    const name = getField(r, ["name"]) ?? getField(r, ["merchant"]) ?? "Unknown";
    const n = recNum(r, "amount") ?? recNum(r, "score");
    if (n === null) continue;
    const cur = map.get(name.toLowerCase()) ?? { name, sum: 0, recs: [] };
    cur.sum += n;
    cur.recs.push(r);
    map.set(name.toLowerCase(), cur);
  }
  return [...map.values()].sort((a, b) => b.sum - a.sum);
}

function executeClause(clause: Clause, report: AnalysisReport, prev?: DataRecord[]): Payload {
  let recs = enrichRecords(report.records ?? []);
  if (clause.scopePrev && prev?.length) {
    recs = prev;
  }
  if (clause.reportsUnder) {
    const tree = orgUnder(recs, clause.reportsUnder);
    recs = recs.filter((r) => {
      const n = getField(r, ["name"]) ?? "";
      const mgr = getField(r, ["manager"]) ?? "";
      return [...tree].some((t) => namesMatch(n, t)) || namesMatch(mgr, clause.reportsUnder!);
    });
  }
  if (clause.subjects.length === 1 && (clause.action === "lookup" || clause.fields.length)) {
    const sub = clause.subjects[0]!;
    const named = recs.filter((r) => namesMatch(getField(r, ["name"]) ?? "", sub));
    if (named.length) {
      const prefer = /\bpublic\b/.test(clause.raw.toLowerCase()) ? ["public"] : [];
      const withField = clause.fields.length
        ? named.filter((r) => clause.fields.some((h) => getField(r, [h], prefer)))
        : [];
      recs = withField.length ? withField : named;
    }
  } else if (clause.subjects.length > 1 && clause.action !== "compare") {
    recs = recs.filter((r) => {
      const n = getField(r, ["name"]) ?? "";
      return clause.subjects.some((s) => namesMatch(n, s));
    });
  }

  recs = applyFilters(recs, clause.filters, clause.txnOnly);
  if (clause.havingCount) {
    const counts = new Map<string, number>();
    for (const r of recs) {
      const n = getField(r, ["name"]);
      if (!n) continue;
      counts.set(n.toLowerCase(), (counts.get(n.toLowerCase()) ?? 0) + 1);
    }
    recs = recs.filter((r) => {
      const n = (getField(r, ["name"]) ?? "").toLowerCase();
      const c = counts.get(n) ?? 0;
      return clause.havingCount!.op === "gte" ? c >= clause.havingCount!.value : c > clause.havingCount!.value;
    });
  }
  if (clause.action === "sum" && !/refund/.test(clause.raw.toLowerCase())) {
    recs = recs.filter((r) => (recNum(r, "amount") ?? 0) >= 0);
  }
  if (clause.groupBy) {
    recs = recs.filter((r) => Boolean(getField(r, [clause.groupBy!]) || r.fields[clause.groupBy!]));
  }
  if (clause.fields.length && !clause.subjects.length && clause.action !== "group") {
    const prefer = /\bpublic\b/.test(clause.raw.toLowerCase()) ? ["public"] : [];
    const withField = recs.filter((r) => clause.fields.some((h) => getField(r, [h], prefer)));
    if (withField.length) recs = withField;
  }

  const payload = (text: string, rows: DataRecord[], extra?: Partial<Payload>): Payload => ({
    text,
    report,
    table: table(rows, clause.fields),
    showReport: false,
    recs: rows,
    subject: getField(rows[0] ?? recs[0] ?? { source: "", index: 0, fields: {} }, ["name"]) ?? clause.subjects[0] ?? null,
    ...extra,
  });

  if (clause.action === "compare") {
    const peopleSrc = enrichRecords(report.records ?? []).filter(
      (r) => getField(r, ["title"]) && getField(r, ["email"]) && recNum(r, "amount") === null,
    );
    let rows: DataRecord[] = [];
    if (clause.subjects.length >= 2) {
      rows = clause.subjects
        .map((s) => peopleSrc.find((r) => namesMatch(getField(r, ["name"]) ?? "", s)))
        .filter((r): r is DataRecord => Boolean(r));
    } else if (clause.subjects.length === 1) {
      const seen = new Set<string>();
      for (const r of peopleSrc) {
        if (!namesMatch(getField(r, ["name"]) ?? "", clause.subjects[0]!)) continue;
        const id = recJoinId(r) || `${getField(r, ["email"]) ?? r.index}`;
        if (seen.has(id)) continue;
        seen.add(id);
        rows.push(r);
      }
    }
    if (rows.length < 2) {
      return { text: `Could not find both people in the files to compare.`, report, showReport: false };
    }
    const keys = unique(rows.flatMap((r) => Object.keys(r.fields))).slice(0, 10);
    const labels = rows.map((r) => getField(r, ["name"]) ?? "Record");
    const lines = keys.map((k) => `• ${k}: ${rows.map((r) => r.fields[k] ?? "—").join("  vs  ")}`);
    return payload(`Comparison of ${labels.join(" vs ")}:\n${lines.join("\n")}`, rows, {
      table: {
        columns: ["field", ...labels],
        rows: keys.map((k) => [k, ...rows.map((r) => r.fields[k] ?? "")]),
      },
    });
  }

  if (clause.action === "group" && clause.groupBy) {
    const series = amounts(recs);
    if (series && (clause.fields.includes("amount") || /\bspend|total|sum\b/.test(clause.raw.toLowerCase()))) {
      const groups = new Map<string, { n: number; recs: DataRecord[] }>();
      for (const x of series.values) {
        const key = getField(x.rec, [clause.groupBy]) ?? x.rec.fields[clause.groupBy] ?? "(blank)";
        const cur = groups.get(key) ?? { n: 0, recs: [] };
        cur.n += x.n;
        cur.recs.push(x.rec);
        groups.set(key, cur);
      }
      let rows = [...groups.entries()].sort((a, b) => b[1].n - a[1].n);
      if (clause.having) rows = rows.filter(([, v]) => (clause.having!.op === "lt" ? v.n < clause.having!.value : v.n > clause.having!.value));
      const lines = rows.map(([k, v]) => `• ${k}: ${fmt(series.field, v.n)} (${v.recs.length} rows)`);
      return payload(`Totals by ${clause.groupBy}:\n${lines.join("\n")}`, rows.flatMap(([, v]) => v.recs));
    }
    const groups = new Map<string, DataRecord[]>();
    for (const r of recs) {
      const key = getField(r, [clause.groupBy]) ?? r.fields[clause.groupBy] ?? "(blank)";
      const list = groups.get(key) ?? [];
      list.push(r);
      groups.set(key, list);
    }
    const lines = [...groups.entries()]
      .sort((a, b) => b[1].length - a[1].length)
      .map(([k, list]) => `• ${k}: ${list.length} — ${list.map((r) => getField(r, ["name"]) ?? getField(r, ["merchant"]) ?? formatRecord(r)).slice(0, 6).join(", ")}`);
    return payload(`Grouped by ${clause.groupBy} (${groups.size} groups):\n${lines.join("\n")}`, recs);
  }

  if (clause.action === "percent") {
    const universe = clause.txnOnly ? (report.records ?? []).filter(isTxn) : (report.records ?? []);
    const matched = applyFilters(universe, clause.filters, clause.txnOnly);
    const pct = universe.length ? (matched.length / universe.length) * 100 : 0;
    return payload(
      `${matched.length} of ${universe.length} records match (${pct.toFixed(1)}%).`,
      matched,
    );
  }

  if (clause.action === "rank" || ((clause.action === "max" || clause.action === "min") && clause.limit)) {
    if (clause.rankBy === "count") {
      const counts = new Map<string, { name: string; n: number; recs: DataRecord[] }>();
      for (const r of recs) {
        const name = getField(r, ["name"]) ?? getField(r, ["merchant"]) ?? "Unknown";
        const cur = counts.get(name.toLowerCase()) ?? { name, n: 0, recs: [] };
        cur.n += 1;
        cur.recs.push(r);
        counts.set(name.toLowerCase(), cur);
      }
      const slice = [...counts.values()].sort((a, b) => b.n - a.n).slice(0, clause.limit ?? 5);
      const lines = slice.map((x, i) => `${i + 1}. ${x.name}: ${x.n} transaction${x.n === 1 ? "" : "s"}`);
      return payload(`Most transactions:\n${lines.join("\n")}`, slice.flatMap((x) => x.recs));
    }
    const people = personTotals(recs).filter((p) => p.name !== "Unknown");
    if (people.length >= 2 && /\b(spend|spent|spender|people|employee|who)\b/.test(clause.raw.toLowerCase())) {
      const n = clause.limit ?? 3;
      const slice = people.slice(0, n);
      const lines = slice.map((x, i) => `${i + 1}. ${x.name}: ${money(x.sum)}`);
      return payload(`Top ${slice.length} by total spend:\n${lines.join("\n")}`, slice.flatMap((x) => x.recs));
    }
    const series = amounts(recs);
    if (!series) return { text: "No numeric values to rank.", report, showReport: false };
    const sorted = [...series.values].sort((a, b) => b.n - a.n);
    const n = clause.limit ?? 3;
    const slice = sorted.slice(0, n);
    const lines = slice.map((x, i) => `${i + 1}. ${fmt(series.field, x.n)} — ${formatRecord(x.rec)}`);
    return payload(`Top ${slice.length} by ${series.field}:\n${lines.join("\n")}`, slice.map((x) => x.rec));
  }

  if (clause.action === "sum" && clause.groupBy) {
    const people = clause.groupBy === "name" ? personTotals(recs) : null;
    if (people) {
      let rows = people;
      if (clause.having) rows = rows.filter((p) => (clause.having!.op === "lt" ? p.sum < clause.having!.value : p.sum > clause.having!.value));
      const lines = rows.map((p) => `• ${p.name}: ${money(p.sum)}`);
      return payload(`Spend by ${clause.groupBy}:\n${lines.join("\n")}`, rows.flatMap((p) => p.recs));
    }
  }

  if (clause.action === "max" && /\b(who|spend|spent)\b/.test(clause.raw.toLowerCase())) {
    const people = personTotals(recs).filter((p) => p.name !== "Unknown");
    if (people.length) {
      const top = people[0]!;
      const prefer = ["public"];
      const fromTxn = top.recs.map((r) => getField(r, ["ip"], prefer)).find(Boolean);
      const fromPerson = enrichRecords(report.records ?? [])
        .filter((r) => namesMatch(getField(r, ["name"]) ?? "", top.name))
        .map((r) => getField(r, ["ip"], prefer))
        .find(Boolean);
      const ip = fromTxn ?? fromPerson;
      const extra = ip ? ` · ip ${ip}` : "";
      return payload(`Highest remaining spend: ${top.name} ${money(top.sum)}${extra}.`, top.recs);
    }
  }

  if (clause.action === "sum" || clause.action === "avg" || clause.action === "min" || clause.action === "max" || clause.action === "median") {
    const series = amounts(recs);
    if (!series) return { text: `No numeric ${clause.fields.includes("amount") ? "amount" : clause.fields[0] ?? "amount"} values matched those filters.`, report, showReport: false };
    const vals = series.values.map((x) => x.n);
    const sum = vals.reduce((a, b) => a + b, 0);
    const sorted = [...vals].sort((a, b) => a - b);
    const mid = sorted[Math.floor(sorted.length / 2)] ?? 0;
    const n = clause.action === "avg" ? sum / vals.length : clause.action === "min" ? Math.min(...vals) : clause.action === "max" ? Math.max(...vals) : clause.action === "median" ? mid : sum;
    const verb = clause.action === "avg" ? "Average" : clause.action === "min" ? "Minimum" : clause.action === "max" ? "Maximum" : clause.action === "median" ? "Median" : "Total";
    let extra = "";
    if (clause.action === "max" || clause.action === "min") {
      const hit = series.values.find((x) => x.n === n);
      if (hit) extra = ` — ${formatRecord(hit.rec)}`;
    }
    const filterBit = clause.filters.length ? ` after filters` : "";
    return payload(`${verb} ${series.field}: ${fmt(series.field, n)} across ${vals.length} row${vals.length === 1 ? "" : "s"}${filterBit}${extra}.`, recs);
  }

  if (clause.action === "count") {
    if (clause.fields.includes("name") || /\bpeople|person|employee/.test(clause.raw.toLowerCase())) {
      const names = unique(recs.map((r) => getField(r, ["name"])).filter((v): v is string => Boolean(v)));
      return payload(`${names.length} people${names.length ? `: ${names.join(", ")}` : "."}`, recs);
    }
    return payload(`${recs.length} matching record${recs.length === 1 ? "" : "s"}.`, recs);
  }

  if (clause.action === "lookup" || (clause.subjects.length && clause.fields.length) || (clause.action === "list" && clause.fields.length && !clause.filters.length && !clause.subjects.length)) {
    if (!recs.length) {
      return { text: `No record matched “${clause.subjects.join(", ") || clause.raw}”.`, report, showReport: false };
    }
    const prefer = /\bpublic\b/.test(clause.raw.toLowerCase()) ? ["public"] : [];
    if (clause.fields.length) {
      const lines = recs.slice(0, 8).map((r) => {
        const who = getField(r, ["name"]) ?? clause.subjects[0] ?? "Record";
        const bits = clause.fields
          .map((h) => {
            if (h === "gps") {
              const g = gpsPair(r);
              return g ? `gps ${g}` : null;
            }
            const v = getField(r, [h], prefer);
            return v ? `${h} ${v}` : null;
          })
          .filter(Boolean);
        return bits.length ? `• ${who}: ${bits.join(" · ")}` : null;
      }).filter((x): x is string => Boolean(x));
      if (lines.length) return payload(lines.join("\n"), recs);
    }
    return payload(recs.slice(0, 5).map((r) => `• ${formatRecord(r)}`).join("\n"), recs);
  }

  if (!recs.length) {
    return { text: "No rows matched those filters in the attached files.", report, showReport: false };
  }
  const lines = recs.slice(0, 8).map((r) => `• ${formatRecord(r, clause.fields)}`);
  return payload(`${recs.length} match${recs.length === 1 ? "" : "es"}:\n${lines.join("\n")}`, recs);
}

export function isStructuredQuestion(question: string, report: AnalysisReport | null): boolean {
  if (!report) return false;
  const q = question.toLowerCase();
  if (q.length < 8) return false;
  if (/\bcompare\b|\bversus\b|\bpercent|\btop\s+\d|\bgroup(?:ed)?(?:\s+\w+){0,4}\s+by\b|\bexclud|\bafter\b|\bbefore\b|\bat least\b|\bgreat(?:er)? than\b|\bfemale|\bmale\b|\breport(?:s|ing)? to\b|\band also\b|\bthen\b|\bon or after\b/.test(q)) return true;
  const cat = catalog(report.records ?? []);
  const mentions = [...cat.employers, ...cat.payments, ...cat.merchants, ...cat.titles].filter((v) => v.length >= 4 && q.includes(v.toLowerCase()));
  if (mentions.length && (/\bwho\b|\blist\b|\bwhich\b|\btotal\b|\bhow many\b|\bstaff\b|\bemployee/.test(q))) return true;
  if ((question.match(/\b[A-Z][a-z]+\s+[A-Z][a-z]+\b/g) ?? []).length >= 2 && /\band\b/.test(q)) return true;
  return false;
}

export function executeComplex(
  question: string,
  report: AnalysisReport,
  lastSubject?: string | null,
): Payload | null {
  const parts = splitClauses(question);
  const enriched = enrichRecords(report.records ?? []);
  const clauses = parts.map((p) => parseClause(p, enriched, lastSubject));
  if (!clauses.length) return null;
  const useful = clauses.some((c) =>
    c.filters.length > 0
    || c.subjects.length > 0
    || Boolean(c.groupBy)
    || Boolean(c.reportsUnder)
    || ["sum", "avg", "min", "max", "median", "percent", "rank", "compare", "count", "group"].includes(c.action)
    || c.fields.length > 0,
  );
  if (!useful) return null;

  const results: Payload[] = [];
  let prev: DataRecord[] | undefined;
  for (let i = 0; i < clauses.length; i += 1) {
    const c = clauses[i]!;
    const r = executeClause(c, report, prev);
    results.push(r);
    prev = r.recs;
  }
  if (results.length === 1) return results[0]!;

  const text = results.map((r, i) => `${i + 1}. ${r.text}`).join("\n\n");
  const tableLast = [...results].reverse().find((r) => r.table)?.table;
  return {
    text,
    report,
    table: tableLast,
    showReport: false,
    subject: results.find((r) => r.subject)?.subject ?? lastSubject,
  };
}
