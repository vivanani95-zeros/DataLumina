export type PatternHit = {
  kind: string;
  categoryId: string;
  value: string;
  clean: string;
};

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const IPV4 = /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/g;
const MAC = /\b[0-9A-F]{2}(?:[:-][0-9A-F]{2}){5}\b/gi;
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi;
const URL = /\bhttps?:\/\/[^\s"'<>]+/gi;
const PHONE = /\b(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)\d{3}[-.\s]?\d{4}\b/g;
const SSN = /\b\d{3}-\d{2}-\d{4}\b/g;
const LATLNG =
  /\b(-?(?:[1-8]?\d(?:\.\d+)?|90(?:\.0+)?))\s*[ ,]\s*(-?(?:1[0-7]\d(?:\.\d+)?|180(?:\.0+)?|[1-9]?\d(?:\.\d+)?))\b/g;
const ISO_DATE = /\b\d{4}-\d{2}-\d{2}(?:[T\s]\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?Z?)?\b/g;
const US_DATE = /\b(?:0?[1-9]|1[0-2])[/-](?:0?[1-9]|[12]\d|3[01])[/-](?:19|20)\d{2}\b/g;
const USER_AGENT = /Mozilla\/5\.0\s*\([^\)]+\)[^\n]{10,220}/g;
const SSID = /\bSSID[=:]\s*["']?([^\s"',;]+)/gi;
const BTC = /\b(?:bc1|[13])[a-zA-HJ-NP-Z0-9]{25,62}\b/g;
const ETH = /\b0x[a-fA-F0-9]{40}\b/g;
const UA_SIMPLE = /\b(?:Chrome|Firefox|Safari|Edg)\/[\d.]+/g;

function luhn(num: string): boolean {
  const digits = num.replace(/\D/g, "");
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let n = Number(digits[i]);
    if (alt) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alt = !alt;
  }
  return sum % 10 === 0;
}

const CARD = /\b(?:\d[ -]*?){13,19}\b/g;

function uniquePush(out: PatternHit[], hit: PatternHit, seen: Set<string>) {
  const key = `${hit.categoryId}|${hit.clean.toLowerCase()}`;
  if (seen.has(key)) return;
  seen.add(key);
  out.push(hit);
}

export function harvestPatterns(text: string, limit = 400): PatternHit[] {
  const out: PatternHit[] = [];
  const seen = new Set<string>();
  const clip = text.slice(0, 400_000);

  const take = (re: RegExp, fn: (m: string, g1?: string) => PatternHit | null) => {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(clip)) && out.length < limit) {
      const hit = fn(m[0], m[1]);
      if (hit) uniquePush(out, hit, seen);
    }
  };

  take(EMAIL, (m) => ({
    kind: "email",
    categoryId: "legal_identity",
    value: m,
    clean: m.toLowerCase(),
  }));
  take(PHONE, (m) => {
    const d = m.replace(/\D/g, "");
    if (d.length < 10) return null;
    const last10 = d.slice(-10);
    return {
      kind: "phone",
      categoryId: "legal_identity",
      value: m,
      clean: `+1 ${last10.slice(0, 3)}-${last10.slice(3, 6)}-${last10.slice(6)}`,
    };
  });
  take(SSN, (m) => ({
    kind: "ssn",
    categoryId: "legal_identity",
    value: m,
    clean: m,
  }));
  take(IPV4, (m) => ({
    kind: "ip",
    categoryId: "network",
    value: m,
    clean: m,
  }));
  take(MAC, (m) => ({
    kind: "mac",
    categoryId: "network",
    value: m,
    clean: m.toUpperCase().replace(/-/g, ":"),
  }));
  take(LATLNG, (m) => {
    const parts = m.split(/[ ,]+/).map(Number);
    if (parts.length < 2 || Number.isNaN(parts[0]) || Number.isNaN(parts[1])) return null;
    if (Math.abs(parts[0]!) > 90 || Math.abs(parts[1]!) > 180) return null;
    if (parts[0] === 0 && parts[1] === 0) return null;
    return {
      kind: "gps",
      categoryId: "gps",
      value: m,
      clean: `${parts[0]!.toFixed(6)}, ${parts[1]!.toFixed(6)}`,
    };
  });
  take(ISO_DATE, (m) => {
    const year = Number(m.slice(0, 4));
    if (year < 1920 || year > 2015) return null;
    return {
      kind: "date",
      categoryId: "legal_identity",
      value: m,
      clean: m.slice(0, 10),
    };
  });
  take(US_DATE, (m) => {
    const [a, b, y] = m.split(/[/-]/);
    const year = Number(y);
    if (year < 1920 || year > 2015) return null;
    const iso = `${y}-${String(a).padStart(2, "0")}-${String(b).padStart(2, "0")}`;
    return { kind: "date", categoryId: "legal_identity", value: m, clean: iso };
  });
  take(URL, (m) => ({
    kind: "url",
    categoryId: "spam",
    value: m,
    clean: m.replace(/[),.;]+$/, ""),
  }));
  take(USER_AGENT, (m) => ({
    kind: "ua",
    categoryId: "browser",
    value: m,
    clean: m.trim(),
  }));
  take(UA_SIMPLE, (m) => ({
    kind: "ua",
    categoryId: "browser",
    value: m,
    clean: m,
  }));
  take(SSID, (_m, g1) =>
    g1
      ? { kind: "ssid", categoryId: "wifi", value: g1, clean: g1 }
      : null,
  );
  take(ETH, (m) => ({
    kind: "eth",
    categoryId: "investment",
    value: m,
    clean: m.toLowerCase(),
  }));
  take(BTC, (m) =>
    m.length >= 26
      ? { kind: "btc", categoryId: "investment", value: m, clean: m }
      : null,
  );
  take(UUID, (m) => ({
    kind: "uuid",
    categoryId: "labels",
    value: m,
    clean: m.toLowerCase(),
  }));
  take(CARD, (m) => {
    if (!luhn(m)) return null;
    const digits = m.replace(/\D/g, "");
    return {
      kind: "card",
      categoryId: "purchasing",
      value: m.trim(),
      clean: `${digits.slice(0, 4)} •••• •••• ${digits.slice(-4)}`,
    };
  });

  return out;
}

const POS = [
  "good", "great", "love", "happy", "excellent", "win", "hope", "calm", "safe", "thanks",
  "grateful", "excited", "ok", "okay", "fine", "pleased", "joy",
];
const NEG = [
  "bad", "hate", "angry", "sad", "worst", "fear", "anxious", "stress", "broke", "urgent",
  "scam", "worried", "pain", "sick", "debt", "lonely", "tired",
];

const TOPICS: Array<[string, string[]]> = [
  ["health", ["symptom", "doctor", "pain", "sleep", "diet", "clinic", "rx"]],
  ["finance", ["bank", "loan", "credit", "invest", "tax", "salary", "rent"]],
  ["work", ["meeting", "deadline", "manager", "office", "shift", "promo"]],
  ["relationships", ["dating", "breakup", "partner", "family", "wedding"]],
  ["politics", ["election", "vote", "senate", "policy", "campaign"]],
  ["travel", ["flight", "hotel", "airport", "booking", "visa"]],
  ["shopping", ["cart", "discount", "order", "shipping", "refund"]],
];

export function analyzeLanguage(text: string): {
  vocab?: { unique: number; total: number; ttr: number };
  sentiment?: { polarity: string; score: number };
  topics?: string[];
  slang?: { emoji: number; dialectHints: string[] };
  syntax?: { avgSentence: number; punctuation: Record<string, number> };
} {
  const words = text.toLowerCase().match(/[a-z']{2,}/g) ?? [];
  if (words.length < 12) return {};
  const unique = new Set(words);
  const ttr = unique.size / words.length;
  let pos = 0;
  let neg = 0;
  for (const w of words) {
    if (POS.includes(w)) pos += 1;
    if (NEG.includes(w)) neg += 1;
  }
  const score = (pos - neg) / Math.max(1, pos + neg);
  const polarity = score > 0.15 ? "positive" : score < -0.15 ? "negative" : "neutral";

  const topics: string[] = [];
  for (const [label, keys] of TOPICS) {
    if (keys.some((k) => text.toLowerCase().includes(k))) topics.push(label);
  }

  const emoji = (text.match(/\p{Extended_Pictographic}/gu) ?? []).length;
  const dialectHints: string[] = [];
  if (/\b(yall|y'all|gonna|wanna|ain'?t|hella|lowkey)\b/i.test(text)) dialectHints.push("informal / colloquial");
  if (emoji > 3) dialectHints.push("emoji-heavy");

  const sentences = text.split(/[.!?]+/).map((s) => s.trim()).filter((s) => s.length > 2);
  const avgSentence =
    sentences.length === 0
      ? 0
      : sentences.reduce((a, s) => a + (s.match(/\b\w+\b/g) ?? []).length, 0) / sentences.length;

  const punctuation: Record<string, number> = {
    ".": (text.match(/\./g) ?? []).length,
    "!": (text.match(/!/g) ?? []).length,
    "?": (text.match(/\?/g) ?? []).length,
    ",": (text.match(/,/g) ?? []).length,
  };

  return {
    vocab: { unique: unique.size, total: words.length, ttr: Number(ttr.toFixed(3)) },
    sentiment: { polarity, score: Number(score.toFixed(3)) },
    topics,
    slang: { emoji, dialectHints },
    syntax: { avgSentence: Number(avgSentence.toFixed(1)), punctuation },
  };
}

export function parseNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/[$,%\s]/g, "").replace(/,/g, "").replace(/[()]/g, "");
  if (!cleaned || /[a-z]/i.test(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

export function cleanValue(field: string, raw: unknown): string {
  if (raw === null || raw === undefined) return "";
  if (typeof raw === "object") {
    try {
      return JSON.stringify(raw);
    } catch {
      return String(raw);
    }
  }
  const s = String(raw).trim();
  if (!s) return "";
  const key = field.toLowerCase();

  if (/email/.test(key) && s.includes("@")) return s.toLowerCase();
  if (/(mac)/.test(key) && /[0-9a-f]{2}[:-]/i.test(s)) return s.toUpperCase().replace(/-/g, ":");
  if (/(lat|latitude)/.test(key)) {
    const n = Number(s);
    return Number.isFinite(n) ? n.toFixed(6) : s;
  }
  if (/(lng|lon|longitude)/.test(key)) {
    const n = Number(s);
    return Number.isFinite(n) ? n.toFixed(6) : s;
  }
  if (/(dob|birth|date)/.test(key)) {
    const iso = s.match(/^(\d{4}-\d{2}-\d{2})/);
    if (iso) return iso[1]!;
    const us = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
    if (us) return `${us[3]}-${us[1]!.padStart(2, "0")}-${us[2]!.padStart(2, "0")}`;
  }
  if (/phone|mobile|tel/.test(key)) {
    const d = s.replace(/\D/g, "");
    if (d.length === 11 && d.startsWith("1")) return `+1 ${d.slice(1, 4)}-${d.slice(4, 7)}-${d.slice(7)}`;
    if (d.length === 10) return `+1 ${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
  }
  if (/gender|sex/.test(key)) {
    const g = s.toLowerCase();
    if (["f", "female", "woman", "w"].includes(g)) return "female";
    if (["m", "male", "man"].includes(g)) return "male";
    if (["x", "nonbinary", "non-binary", "nb"].includes(g)) return "non-binary";
    return s;
  }
  if (/amount|balance|limit|price|spend/.test(key)) {
    const n = parseNumber(s);
    if (n !== null) {
      return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
    }
  }
  if (s.length > 240) return `${s.slice(0, 237)}…`;
  return s.replace(/\s+/g, " ");
}

export function looksEmpty(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") return value.trim() === "" || value.trim() === "-" || value.trim().toLowerCase() === "n/a" || value.trim() === "null";
  if (Array.isArray(value)) return value.length === 0;
  return false;
}
