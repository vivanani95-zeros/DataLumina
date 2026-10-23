export type AnalyzerMode = "fast" | "thorough";

export type CategoryGroup =
  | "biometric"
  | "device"
  | "spatial"
  | "clickstream"
  | "language"
  | "financial"
  | "social"
  | "psychological"
  | "training";

export type Finding = {
  id: string;
  categoryId: string;
  field: string;
  raw: string;
  clean: string;
  confidence: number;
  source: string;
  recordIndex?: number;
  evidence: string;
};

export type CategoryHit = {
  id: string;
  label: string;
  group: CategoryGroup;
  description: string;
  findings: Finding[];
  count: number;
};

export type NumericStat = {
  field: string;
  count: number;
  min: number;
  max: number;
  mean: number;
};

export type DataRecord = {
  source: string;
  index: number;
  fields: Record<string, string>;
};

export type AnswerTable = {
  columns: string[];
  rows: string[][];
};

export type ParsedFile = {
  name: string;
  size: number;
  kind: "table" | "json" | "text" | "log";
  rows: Record<string, unknown>[];
  columns: string[];
  text: string;
  warnings: string[];
  truncated: boolean;
};

export type AnalysisReport = {
  id: string;
  createdAt: number;
  mode: AnalyzerMode;
  files: { name: string; size: number; kind: ParsedFile["kind"]; rows: number; warnings: string[] }[];
  categories: CategoryHit[];
  stats: NumericStat[];
  coverage: { hit: number; total: number };
  cleaned: Record<string, Array<Record<string, string>>>;
  records: DataRecord[];
  overview: string;
  unansweredNote?: string;
};

export type QueryIntent = {
  kind: "report" | "category" | "search" | "count" | "clean" | "stats" | "help" | "lookup" | "list" | "aggregate";
  categoryIds: string[];
  terms: string[];
  fieldHints: string[];
  aggregate?: "sum" | "avg" | "min" | "max";
  subject?: string;
};
