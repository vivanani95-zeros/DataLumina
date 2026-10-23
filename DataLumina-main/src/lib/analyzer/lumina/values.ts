// Value-level helpers for the on-device engine: cleaning, number / date / boolean
// parsing, text normalisation and exact decimal arithmetic. Pure functions, no
// dependencies, erasable TypeScript only.

const INVISIBLE = /[\u200b-\u200d\u2060\ufeff]/g;
const ODD_SPACE = /[\u00a0\u2000-\u200a\u202f\u205f\u3000]/g;

const PLAIN_ASCII = /^[\x20-\x7e]*$/;

export function clean(input: unknown): string {
  if (input === null || input === undefined) return "";
  let s = typeof input === "string" ? input : typeof input === "object" ? JSON.stringify(input) : String(input);
  // Fast path: plain printable ASCII needs no Unicode folding.
  if (PLAIN_ASCII.test(s)) return s.replace(/\s+/g, " ").trim();
  s = s.normalize("NFKC").replace(INVISIBLE, "").replace(ODD_SPACE, " ");
  s = s.replace(/[\u2018\u2019\u02bc]/g, "'").replace(/[\u201c\u201d]/g, '"').replace(/[\u2013\u2014\u2212]/g, "-");
  return s.replace(/\s+/g, " ").trim();
}

const HARD_MISSING = new Set([
  "", "n/a", "na", "n.a.", "n.a", "nan", "null", "nil", "none", "#n/a", "#na", "#null!", "#value!", "#div/0!",
  "#ref!", "#name?", "#num!", "-", "--", "---", "?", "??", "undefined", "(blank)", "(null)", "<null>", "<na>",
  "<blank>", "missing", "not available", "not applicable", "blank", "empty", "void",
]);
const SOFT_MISSING = new Set(["unknown", "unspecified", "not specified", "tbd", "tba", "no data", "not provided", "n/d", "nd"]);

export function isMissing(s: string, soft = false): boolean {
  const t = s.toLowerCase();
  return HARD_MISSING.has(t) || (soft && SOFT_MISSING.has(t));
}

// ---------------------------------------------------------------- text keys

export function stripAccents(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

/** Lower-case, accent-free, punctuation-free key used for matching. */
export function norm(s: string): string {
  return stripAccents(s).toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim();
}

export function stem(w: string): string {
  if (w.length <= 3) return w;
  if (/ies$/.test(w) && w.length > 4) return `${w.slice(0, -3)}y`;
  if (/(sses|xes|ches|shes)$/.test(w)) return w.slice(0, -2);
  if (/(ss|us|is)$/.test(w)) return w;
  if (/s$/.test(w)) return w.slice(0, -1);
  return w;
}

export function words(s: string): string[] {
  const n = norm(s);
  return n ? n.split(" ") : [];
}

export function stemKey(s: string): string {
  return words(s).map(stem).join(" ");
}

/** Bounded Damerau-Levenshtein distance; returns max+1 when the bound is exceeded. */
export function editDistance(a: string, b: string, max = 2): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const prev2: number[] = [];
  let prev: number[] = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const cur: number[] = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2]! + 1);
      cur[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    for (let j = 0; j <= b.length; j += 1) prev2[j] = prev[j]!;
    prev = cur;
  }
  return prev[b.length]!;
}

const NUMBER_WORDS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18,
  nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
  hundred: 100, dozen: 12,
};

export function numberWord(w: string): number | null {
  const v = NUMBER_WORDS[w.toLowerCase()];
  return v === undefined ? null : v;
}

// ---------------------------------------------------------------- numbers

export type Num = { n: number; dec: number; kind: "number" | "currency" | "percent"; cur?: string };

const CUR_SYMBOLS = "$€£¥₹₩₽₺₫฿₪₦₱";
const CUR_CODES: Record<string, string> = {
  usd: "$", eur: "€", gbp: "£", inr: "₹", jpy: "¥", cny: "¥", cad: "CA$", aud: "A$", nzd: "NZ$", chf: "CHF ",
  mxn: "MX$", brl: "R$", zar: "R", sgd: "S$", hkd: "HK$", sek: "SEK ", nok: "NOK ", dkk: "DKK ", aed: "AED ",
  sar: "SAR ", rub: "₽", krw: "₩", try: "₺", pln: "PLN ", rs: "₹",
};
const MULT: Record<string, number> = {
  k: 1e3, thousand: 1e3, m: 1e6, mm: 1e6, mn: 1e6, million: 1e6, b: 1e9, bn: 1e9, billion: 1e9, lakh: 1e5, crore: 1e7,
};

const RE_US = /^(?:\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?|\.\d+)$/;
const RE_EU = /^(?:\d{1,3}(?:\.\d{3})+(?:,\d+)?|\d+,\d+)$/;
const RE_SPACED = /^\d{1,3}(?:[ '\u2019]\d{3})+(?:[.,]\d+)?$/;
const RE_SCI = /^\d+(?:\.\d+)?[eE][+-]?\d+$/;
const RE_INDIAN = /^\d{1,2}(?:,\d{2})+,\d{3}(?:\.\d+)?$/;

function curFrom(token: string): string | undefined {
  if (token.length === 1 && CUR_SYMBOLS.includes(token)) return token;
  return CUR_CODES[token.toLowerCase()];
}

export function parseNum(raw: string, locale: "us" | "eu" | "auto" = "auto", allowMult = false): Num | null {
  let s = raw.replace(/\u2212/g, "-").trim();
  if (!s || s.length > 40) return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) {
    neg = true;
    s = s.slice(1, -1).trim();
  }
  if (s.startsWith("-")) {
    neg = true;
    s = s.slice(1).trim();
  } else if (s.startsWith("+")) s = s.slice(1).trim();
  if (/\d\s*-$/.test(s)) {
    neg = true;
    s = s.slice(0, -1).trim();
  }

  let cur: string | undefined;
  let m = s.match(/^([$€£¥₹₩₽₺₫฿₪₦₱]|[A-Za-z]{2,3}(?![A-Za-z]))\s*/);
  if (m) {
    const c = curFrom(m[1]!);
    if (c) {
      cur = c;
      s = s.slice(m[0].length);
      if (s.startsWith("-")) {
        neg = true;
        s = s.slice(1).trim();
      }
    } else if (/^[A-Za-z]/.test(m[1]!)) return null;
  }
  m = s.match(/\s*([$€£¥₹₩₽₺₫฿₪₦₱]|[A-Za-z]{2,3})$/);
  if (m && /\d/.test(s.slice(0, m.index))) {
    const c = curFrom(m[1]!);
    if (c && !cur) {
      cur = c;
      s = s.slice(0, m.index).trim();
    }
  }
  let kind: Num["kind"] = cur ? "currency" : "number";
  if (/%$/.test(s)) {
    kind = "percent";
    s = s.slice(0, -1).trim();
  }
  let mult = 1;
  const mm = s.match(/^(.*\d)\s*(k|m|mm|mn|b|bn|million|billion|thousand|lakh|crore)$/i);
  if (mm && (allowMult || cur)) {
    mult = MULT[mm[2]!.toLowerCase()]!;
    s = mm[1]!;
  }
  if (!s || !/^[\d.,\s'\u2019eE+-]+$/.test(s)) return null;

  let body = s;
  let dec = 0;
  let value: number;
  if (RE_SCI.test(body)) {
    value = Number(body);
  } else {
    let kindOfSep: "us" | "eu";
    if (RE_INDIAN.test(body)) body = body.replace(/,/g, "");
    const us = RE_US.test(body);
    const eu = RE_EU.test(body);
    if (RE_SPACED.test(body)) {
      body = body.replace(/[ '\u2019]/g, "");
      kindOfSep = /,\d{1,2}$/.test(body) ? "eu" : "us";
      if (kindOfSep === "eu") body = body.replace(",", ".");
      dec = (body.split(".")[1] ?? "").length;
      value = Number(body);
    } else if (us && eu) {
      kindOfSep = locale === "eu" ? "eu" : "us";
      if (/^\d{1,3}(?:\.\d{3}){2,}$/.test(body)) kindOfSep = "eu";
      if (/^\d{1,3}(?:,\d{3}){2,}$/.test(body)) kindOfSep = "us";
      if (kindOfSep === "us") {
        body = body.replace(/,(?=\d{3}$)/, "");
        body = body.replace(/,/g, "");
      } else {
        body = body.replace(/\./g, "").replace(",", ".");
      }
      dec = (body.split(".")[1] ?? "").length;
      value = Number(body);
    } else if (us) {
      body = body.replace(/,/g, "");
      dec = (body.split(".")[1] ?? "").length;
      value = Number(body);
    } else if (eu) {
      body = body.replace(/\./g, "").replace(",", ".");
      dec = (body.split(".")[1] ?? "").length;
      value = Number(body);
    } else return null;
  }
  if (!Number.isFinite(value)) return null;
  const decOut = Math.min(8, dec);
  value *= mult;
  if (neg) value = -value;
  if (Object.is(value, -0)) value = 0;
  return { n: value, dec: mult === 1 ? decOut : Math.max(0, decOut - Math.round(Math.log10(mult))), kind, cur };
}

export function looksLeadingZero(raw: string): boolean {
  return /^0\d+$/.test(raw.trim());
}

// ---------------------------------------------------------------- dates

export const MONTH_NAMES = [
  "january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december",
];
export const DAY_NAMES = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

export function monthIndex(w: string): number {
  const t = w.toLowerCase().replace(/\.$/, "");
  if (t === "sept") return 9;
  for (let i = 0; i < 12; i += 1) {
    const full = MONTH_NAMES[i]!;
    if (t === full || (t.length === 3 && full.startsWith(t))) return i + 1;
  }
  return 0;
}

function daysIn(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function utc(y: number, m: number, d: number, hh = 0, mm = 0, ss = 0, ms = 0): number | null {
  if (m < 1 || m > 12 || d < 1 || y < 1000 || y > 2999) return null;
  if (d > daysIn(y, m) || hh > 23 || mm > 59 || ss > 59) return null;
  return Date.UTC(y, m - 1, d, hh, mm, ss, ms);
}

export type Dt = { t: number; time: boolean; prec: "day" | "month" };

const MONTH_RE = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\\.?";
const TIME_TAIL = /(?:[T\s,]+|\s+at\s+)(\d{1,2}):(\d{2})(?::(\d{2})(?:[.,](\d{1,9}))?)?\s*(am|pm)?\s*(Z|UTC|GMT|[+-]\d{2}:?\d{2})?$/i;

function twoDigitYear(y: number): number {
  return y < 100 ? (y < 50 ? 2000 + y : 1900 + y) : y;
}

export function parseDate(raw: string, order: "mdy" | "dmy" = "mdy"): Dt | null {
  let s = raw.trim();
  if (!s || s.length > 48) return null;
  s = s.replace(/^(?:mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)[a-z]*,?\s+/i, "").replace(/(\d)(?:st|nd|rd|th)\b/gi, "$1");
  let hh = 0;
  let mi = 0;
  let ss = 0;
  let ms = 0;
  let hasTime = false;
  let offset = 0;
  const tm = s.match(TIME_TAIL);
  if (tm) {
    hh = Number(tm[1]);
    mi = Number(tm[2]);
    ss = tm[3] ? Number(tm[3]) : 0;
    ms = tm[4] ? Number(`0.${tm[4]}`) * 1000 : 0;
    const ap = tm[5]?.toLowerCase();
    if (ap === "pm" && hh < 12) hh += 12;
    if (ap === "am" && hh === 12) hh = 0;
    if (tm[6] && !/^(z|utc|gmt)$/i.test(tm[6])) {
      const z = tm[6].replace(":", "");
      offset = (z.startsWith("-") ? -1 : 1) * (Number(z.slice(1, 3)) * 60 + Number(z.slice(3, 5)));
    }
    hasTime = true;
    s = s.slice(0, tm.index).trim();
  }
  const done = (t: number | null, prec: Dt["prec"] = "day"): Dt | null =>
    t === null ? null : { t: Math.round(t + ms - offset * 60_000), time: hasTime, prec };

  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (m) return done(utc(+m[1]!, +m[2]!, +m[3]!, hh, mi, ss));
  m = s.match(/^(\d{4})[-/](\d{1,2})$/);
  if (m && !hasTime) return done(utc(+m[1]!, +m[2]!, 1), "month");
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/);
  if (m) {
    const a = +m[1]!;
    const b = +m[2]!;
    const y = twoDigitYear(+m[3]!);
    let month = order === "mdy" ? a : b;
    let day = order === "mdy" ? b : a;
    if (a > 12 && b <= 12) {
      month = b;
      day = a;
    } else if (b > 12 && a <= 12) {
      month = a;
      day = b;
    }
    return done(utc(y, month, day, hh, mi, ss));
  }
  m = s.match(new RegExp(`^${MONTH_RE}\\s+(\\d{1,2})(?:,)?\\s+(\\d{4}|\\d{2})$`, "i"));
  if (m) return done(utc(twoDigitYear(+m[3]!), monthIndex(m[1]!), +m[2]!, hh, mi, ss));
  m = s.match(new RegExp(`^(\\d{1,2})[\\s-]+${MONTH_RE}[\\s,-]+(\\d{4}|\\d{2})$`, "i"));
  if (m) return done(utc(twoDigitYear(+m[3]!), monthIndex(m[2]!), +m[1]!, hh, mi, ss));
  m = s.match(new RegExp(`^${MONTH_RE}[\\s,-]+(\\d{4})$`, "i"));
  if (m && !hasTime) return done(utc(+m[2]!, monthIndex(m[1]!), 1), "month");
  m = s.match(new RegExp(`^(\\d{4})[\\s-]+${MONTH_RE}[\\s-]+(\\d{1,2})$`, "i"));
  if (m) return done(utc(+m[1]!, monthIndex(m[2]!), +m[3]!, hh, mi, ss));
  m = s.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m) return done(utc(+m[1]!, +m[2]!, +m[3]!, hh, mi, ss));
  return null;
}

/** Decide day-first vs month-first from the evidence in a whole column. */
export function inferDateOrder(samples: string[]): { order: "mdy" | "dmy"; ambiguous: boolean } {
  let dmy = 0;
  let mdy = 0;
  let slashed = 0;
  for (const raw of samples) {
    const m = raw.trim().match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})/);
    if (!m) continue;
    slashed += 1;
    if (+m[1]! > 12) dmy += 1;
    else if (+m[2]! > 12) mdy += 1;
  }
  if (!slashed) return { order: "mdy", ambiguous: false };
  if (dmy > 0 && mdy === 0) return { order: "dmy", ambiguous: false };
  if (mdy > 0 && dmy === 0) return { order: "mdy", ambiguous: false };
  return { order: "mdy", ambiguous: dmy === 0 && mdy === 0 };
}

export function excelSerialToTime(n: number): number | null {
  if (!Number.isFinite(n) || n < 20000 || n > 80000) return null;
  return Math.round((n - 25569) * 86_400_000);
}

export function epochToTime(n: number): number | null {
  if (!Number.isFinite(n)) return null;
  if (n >= 946_684_800 && n <= 4_102_444_800) return Math.round(n * 1000);
  if (n >= 946_684_800_000 && n <= 4_102_444_800_000) return Math.round(n);
  return null;
}

export function fmtDate(t: number, withTime = false): string {
  const d = new Date(t);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  if (!withTime) return `${y}-${m}-${day}`;
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mi = String(d.getUTCMinutes()).padStart(2, "0");
  const ss = d.getUTCSeconds();
  return `${y}-${m}-${day} ${hh}:${mi}${ss ? `:${String(ss).padStart(2, "0")}` : ""}`;
}

export function fmtDateLong(t: number): string {
  const d = new Date(t);
  return `${MONTH_NAMES[d.getUTCMonth()]!.replace(/^./, (c) => c.toUpperCase())} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

// ---------------------------------------------------------------- booleans

const BOOL_PAIRS: Array<[string, string]> = [
  ["true", "false"], ["yes", "no"], ["y", "n"], ["t", "f"], ["on", "off"], ["enabled", "disabled"],
  ["active", "inactive"], ["paid", "unpaid"], ["open", "closed"],
];

/** If the distinct values form a boolean pair, return [truthy, falsy] keys. */
export function booleanPair(distinct: string[]): [string, string] | null {
  const keys = [...new Set(distinct.map((d) => d.toLowerCase()))];
  if (keys.length === 0 || keys.length > 2) return null;
  for (const [a, b] of BOOL_PAIRS) {
    if (keys.every((k) => k === a || k === b)) return keys.length === 2 || BOOL_PAIRS.some(([x]) => x === a) ? [a, b] : null;
  }
  return null;
}

// ---------------------------------------------------------------- exact decimals

export function toScaled(v: number, dec: number): bigint {
  return BigInt(Math.round(v * 10 ** dec));
}

export function divRound(a: bigint, n: bigint): bigint {
  if (n === 0n) return 0n;
  const neg = a < 0n !== n < 0n;
  const x = a < 0n ? -a : a;
  const d = n < 0n ? -n : n;
  let q = x / d;
  if ((x % d) * 2n >= d) q += 1n;
  return neg ? -q : q;
}

export function groupDigits(int: string): string {
  return int.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** Format a scaled integer (value * 10^dec) exactly, trimming trailing zeros down to minDec. */
export function fmtScaled(v: bigint, dec: number, minDec = 0): string {
  const neg = v < 0n;
  const digits = (neg ? -v : v).toString().padStart(dec + 1, "0");
  const int = digits.slice(0, digits.length - dec);
  let frac = digits.slice(digits.length - dec);
  while (frac.length > minDec && frac.endsWith("0")) frac = frac.slice(0, -1);
  return `${neg ? "-" : ""}${groupDigits(int)}${frac ? `.${frac}` : ""}`;
}

export function scaledToNumber(v: bigint, dec: number): number {
  return Number(v) / 10 ** dec;
}

export function fmtNum(n: number, maxDec = 2, minDec = 0): string {
  if (!Number.isFinite(n)) return "—";
  const v = Math.abs(n) < 1e-9 ? 0 : n;
  return v.toLocaleString("en-US", { minimumFractionDigits: minDec, maximumFractionDigits: maxDec });
}

export function withCur(text: string, cur: string): string {
  return text.startsWith("-") ? `-${cur}${text.slice(1)}` : `${cur}${text}`;
}

export function pct(part: number, whole: number, dec = 1): string {
  if (!whole) return "0%";
  return `${fmtNum((part / whole) * 100, dec)}%`;
}

export function esc(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Order-insensitive key for person names: "Park, Mina" and "Mina Park" map to the same key. */
export function nameKey(s: string): string {
  return words(s).map(stem).sort().join(" ");
}
