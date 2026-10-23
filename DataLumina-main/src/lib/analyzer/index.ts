import { answerQuestion } from "./answer.ts";
import { extractFromFiles } from "./extract.ts";
import { parseFileText, readAsText, splitQuestionAndData } from "./parse.ts";
import type { AnalysisReport, AnalyzerMode, ParsedFile } from "./types.ts";
import type { AnswerPayload } from "./answer.ts";

export async function ingestFiles(files: File[]): Promise<ParsedFile[]> {
  const parsed: ParsedFile[] = [];
  for (const file of files) {
    const text = await readAsText(file);
    parsed.push(parseFileText(file.name, file.size, text));
  }
  return parsed;
}

export function analyze(files: ParsedFile[], mode: AnalyzerMode): AnalysisReport {
  return extractFromFiles(files, mode);
}

export function answerFromRaw(raw: string, mode: AnalyzerMode = "fast"): { ask: string; payload: AnswerPayload } {
  const { question, data } = splitQuestionAndData(raw);
  const ask = question || "Extract a clean intelligence report";
  if (!data) return { ask, payload: answerQuestion(ask, null, false) };
  const parsed = parseFileText("paste.txt", data.length, data);
  const report = extractFromFiles([parsed], mode);
  return { ask, payload: answerQuestion(ask, report, true) };
}

export { parseFileText, readAsText, splitQuestionAndData, looksLikeData } from "./parse.ts";
export { extractFromFiles } from "./extract.ts";
export { answerQuestion, interpretQuery, suggestedFollowups, reportToCsv, reportToJson, downloadText } from "./answer.ts";
export { CATEGORIES, GROUP_LABEL, CATEGORY_BY_ID } from "./categories.ts";
export type { AnalysisReport, AnalyzerMode, CategoryHit, Finding, ParsedFile, AnswerTable, DataRecord } from "./types.ts";
export type { AnswerPayload } from "./answer.ts";
