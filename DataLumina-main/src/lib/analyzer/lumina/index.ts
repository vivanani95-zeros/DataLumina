// Registry that ties each parsed workbook (full rows, not the capped report sample) to the
// analysis report it was built from. The index is built lazily, on the first question, so
// uploads return at once. Keyed by the report object, so nothing is evicted and a question
// never falls back to the category report for lack of its workbook.
import type { AnalysisReport, ParsedFile } from "../types.ts";
import { buildWorkbook, type Workbook } from "./table.ts";

export { answerLumina } from "./query.ts";
export type { LuminaOutput } from "./query.ts";

type Entry = { files: ParsedFile[]; workbook?: Workbook };
const registry = new WeakMap<AnalysisReport, Entry>();

export function registerWorkbook(report: AnalysisReport, files: ParsedFile[]): void {
  registry.set(report, { files });
}

export function workbookFor(report: AnalysisReport): Workbook | undefined {
  const entry = registry.get(report);
  if (!entry) return undefined;
  if (!entry.workbook) entry.workbook = buildWorkbook(entry.files);
  return entry.workbook;
}
