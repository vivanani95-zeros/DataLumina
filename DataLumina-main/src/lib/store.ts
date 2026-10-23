import { create } from "zustand";
import type { AnalysisReport, AnalyzerMode, AnswerTable } from "@/lib/analyzer/types";

export type Attachment = {
  id: string;
  name: string;
  size: number;
  type: string;
  text: string;
};

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  createdAt: number;
  attachmentNames?: string[];
  report?: AnalysisReport;
  filteredIds?: string[];
  table?: AnswerTable;
  showReport?: boolean;
  streaming?: boolean;
  stage?: string;
  notes?: string[];
};

export type HistoryItem = {
  id: string;
  title: string;
  createdAt: number;
  preview: string;
  messages: ChatMessage[];
};

type AppState = {
  privateMode: boolean;
  historyOpen: boolean;
  aboutOpen: boolean;
  mode: AnalyzerMode;
  input: string;
  attachments: Attachment[];
  messages: ChatMessage[];
  history: HistoryItem[];
  busy: boolean;
  lastReport: AnalysisReport | null;
  lastSubject: string | null;
  setPrivateMode: (v: boolean) => void;
  setHistoryOpen: (v: boolean) => void;
  setAboutOpen: (v: boolean) => void;
  setMode: (m: AnalyzerMode) => void;
  setInput: (v: string) => void;
  addAttachments: (files: Attachment[]) => void;
  removeAttachment: (id: string) => void;
  clearAttachments: () => void;
  setBusy: (v: boolean) => void;
  pushMessage: (m: ChatMessage) => void;
  patchMessage: (id: string, patch: Partial<ChatMessage>) => void;
  newChat: () => void;
  loadHistory: (id: string) => void;
  deleteHistory: (id: string) => void;
  persistSession: () => void;
  hydrate: () => void;
  setLastSubject: (v: string | null) => void;
};

const HISTORY_KEY = "datalumina.history.v1";
const PREFS_KEY = "datalumina.prefs.v1";

function uid(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

function loadHistory(): HistoryItem[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as HistoryItem[];
    return Array.isArray(parsed) ? parsed.slice(0, 40) : [];
  } catch {
    return [];
  }
}

export const useAppStore = create<AppState>((set, get) => ({
  privateMode: false,
  historyOpen: false,
  aboutOpen: false,
  mode: "fast",
  input: "",
  attachments: [],
  messages: [],
  history: [],
  busy: false,
  lastReport: null,
  lastSubject: null,

  setPrivateMode: (v) => {
    set({ privateMode: v });
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({ privateMode: v, mode: get().mode }));
    } catch {
      /* ignore */
    }
  },
  setHistoryOpen: (v) => set({ historyOpen: v }),
  setAboutOpen: (v) => set({ aboutOpen: v }),
  setMode: (m) => set({ mode: m }),
  setInput: (v) => set({ input: v }),
  addAttachments: (files) =>
    set((s) => {
      const merged = [...s.attachments];
      for (const f of files) {
        if (merged.length >= 12) break;
        if (merged.some((x) => x.name === f.name && x.size === f.size)) continue;
        merged.push(f);
      }
      return { attachments: merged };
    }),
  removeAttachment: (id) => set((s) => ({ attachments: s.attachments.filter((a) => a.id !== id) })),
  clearAttachments: () => set({ attachments: [] }),
  setBusy: (v) => set({ busy: v }),
  setLastSubject: (v) => set({ lastSubject: v }),
  pushMessage: (m) =>
    set((s) => ({
      messages: [...s.messages, m],
      lastReport: m.report ?? s.lastReport,
    })),
  patchMessage: (id, patch) =>
    set((s) => ({
      messages: s.messages.map((m) => (m.id === id ? { ...m, ...patch } : m)),
      lastReport: patch.report ?? s.lastReport,
    })),
  newChat: () => {
    const { messages, persistSession } = get();
    if (messages.length) persistSession();
    set({ messages: [], attachments: [], input: "", lastReport: null, lastSubject: null });
  },
  loadHistory: (id) => {
    const item = get().history.find((h) => h.id === id);
    if (!item) return;
    const last = [...item.messages].reverse().find((m) => m.report);
    set({
      messages: item.messages,
      lastReport: last?.report ?? null,
      historyOpen: false,
      attachments: [],
    });
  },
  deleteHistory: (id) => {
    const next = get().history.filter((h) => h.id !== id);
    set({ history: next });
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  },
  persistSession: () => {
    const { privateMode, messages } = get();
    if (privateMode || messages.length === 0) return;
    const firstUser = messages.find((m) => m.role === "user");
    const title = (firstUser?.text || firstUser?.attachmentNames?.[0] || "Untitled brief").slice(0, 72);
    const item: HistoryItem = {
      id: uid("h"),
      title,
      createdAt: Date.now(),
      preview: messages.filter((m) => m.role === "assistant").at(-1)?.text.slice(0, 140) ?? "",
      messages: messages.map((m) => ({
        ...m,
        streaming: false,
        stage: undefined,
        report: m.report
          ? {
              ...m.report,
              records: m.report.records?.slice(0, 200) ?? [],
              categories: m.report.categories.map((c) => ({
                ...c,
                findings: c.findings.slice(0, 40),
              })),
            }
          : undefined,
      })),
    };
    const next = [item, ...get().history.filter((h) => h.title !== title)].slice(0, 30);
    set({ history: next });
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  },
  hydrate: () => {
    const history = loadHistory();
    let privateMode = false;
    let mode: AnalyzerMode = "fast";
    try {
      const prefs = JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}") as {
        privateMode?: boolean;
        mode?: AnalyzerMode;
      };
      privateMode = Boolean(prefs.privateMode);
      if (prefs.mode === "thorough" || prefs.mode === "fast") mode = prefs.mode;
    } catch {
      /* ignore */
    }
    set({ history, privateMode, mode });
  },
}));

export { uid };
