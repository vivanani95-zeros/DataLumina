import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { AboutDialog } from "@/components/about-dialog";
import { Composer, filesToAttachments } from "@/components/composer";
import { HistoryDrawer } from "@/components/history-drawer";
import { Logo } from "@/components/logo";
import { PromoCard } from "@/components/promo";
import { Starfield } from "@/components/starfield";
import { Thread } from "@/components/thread";
import { TopBar } from "@/components/top-bar";
import { analyze, answerQuestion, parseFileText, splitQuestionAndData } from "@/lib/analyzer";
import type { AnalysisReport, ParsedFile } from "@/lib/analyzer/types";
import { loadSampleAttachments } from "@/lib/samples";
import { uid, useAppStore } from "@/lib/store";

export const Route = createFileRoute("/")({ component: Home });

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function Home() {
  const messages = useAppStore((s) => s.messages);
  const mode = useAppStore((s) => s.mode);
  const hydrate = useAppStore((s) => s.hydrate);
  const pushMessage = useAppStore((s) => s.pushMessage);
  const patchMessage = useAppStore((s) => s.patchMessage);
  const setBusy = useAppStore((s) => s.setBusy);
  const setInput = useAppStore((s) => s.setInput);
  const addAttachments = useAppStore((s) => s.addAttachments);
  const clearAttachments = useAppStore((s) => s.clearAttachments);
  const persistSession = useAppStore((s) => s.persistSession);
  const setLastSubject = useAppStore((s) => s.setLastSubject);
  const scroller = useRef<HTMLDivElement>(null);
  const parsedCache = useRef<ParsedFile[]>([]);
  const reportCache = useRef<AnalysisReport | null>(null);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  useEffect(() => {
    if (messages.length === 0) {
      parsedCache.current = [];
      reportCache.current = null;
    }
  }, [messages.length]);

  const run = async (question?: string) => {
    const state = useAppStore.getState();
    const raw = (question ?? state.input).trim();
    if (state.busy) return;
    if (!raw && state.attachments.length === 0) return;

    setBusy(true);
    setInput("");

    const split = splitQuestionAndData(raw);
    const ask = split.question || "Extract a clean intelligence report";
    const pasted = split.data;
    const isolated =
      Boolean(pasted) &&
      Boolean(split.question) &&
      split.question !== "Extract a clean intelligence report";

    const newFiles: ParsedFile[] = state.attachments.map((a) => parseFileText(a.name, a.size, a.text));
    if (pasted) {
      newFiles.push(parseFileText("paste.txt", pasted.length, pasted));
    }

    if (isolated) {
      parsedCache.current = newFiles;
      reportCache.current = null;
    } else if (newFiles.length) {
      for (const f of newFiles) {
        const dup = parsedCache.current.some(
          (p) => p.name === f.name && p.size === f.size && p.text === f.text,
        );
        if (!dup) parsedCache.current.push(f);
      }
      reportCache.current = null;
    }

    const names = [
      ...state.attachments.map((a) => a.name),
      ...(pasted ? ["paste.txt"] : []),
    ];

    const userVisible = pasted && split.question && split.question !== "Extract a clean intelligence report"
      ? split.question
      : pasted && !state.attachments.length
        ? "Pasted dataset — extract a clean intelligence report."
        : ask;

    pushMessage({
      id: uid("m"),
      role: "user",
      text: userVisible,
      createdAt: Date.now(),
      attachmentNames: names.length ? names : undefined,
    });
    clearAttachments();

    const aid = uid("m");
    pushMessage({
      id: aid,
      role: "assistant",
      text: "",
      createdAt: Date.now(),
      streaming: true,
      stage: parsedCache.current.length ? "Reading files…" : "Thinking…",
    });

    try {
      if (parsedCache.current.length && !reportCache.current) {
        await sleep(160);
        patchMessage(aid, { stage: "Indexing records…" });
        await sleep(120);
        reportCache.current = analyze(parsedCache.current, mode);
        patchMessage(aid, { stage: "Reading the answer from the files…" });
        await sleep(40);
      }

      const payload = answerQuestion(
        ask,
        reportCache.current ?? useAppStore.getState().lastReport,
        parsedCache.current.length > 0 || Boolean(useAppStore.getState().lastReport),
        useAppStore.getState().lastSubject,
      );
      if (payload.report) reportCache.current = payload.report;
      if (payload.subject) setLastSubject(payload.subject);

      patchMessage(aid, {
        streaming: false,
        stage: undefined,
        text: payload.text,
        report: payload.report,
        filteredIds: payload.filtered?.map((c) => c.id),
        table: payload.table,
        showReport: payload.showReport,
        notes: payload.notes,
      });
      persistSession();
    } catch (err) {
      patchMessage(aid, {
        streaming: false,
        stage: undefined,
        text: err instanceof Error ? err.message : "Could not read those files. Try CSV, JSON, or a log.",
      });
    } finally {
      setBusy(false);
    }
  };

  const submit = () => {
    void run();
  };

  const loadSamples = async () => {
    if (useAppStore.getState().busy) return;
    const samples = await loadSampleAttachments();
    addAttachments(
      samples.map((s) => ({
        id: uid("a"),
        name: s.name,
        size: s.size,
        type: s.type,
        text: s.text,
      })),
    );
    await run("Extract a clean intelligence report");
  };

  const empty = messages.length === 0;

  return (
    <main
      className="relative min-h-dvh bg-bg text-fg"
      onDragEnter={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragOver={(e) => e.preventDefault()}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        const files = Array.from(e.dataTransfer.files);
        if (files.length) void filesToAttachments(files).then(addAttachments);
      }}
    >
      <Starfield />
      <TopBar showNew={!empty} />
      <HistoryDrawer />
      <AboutDialog />

      {dragging ? (
        <div className="pointer-events-none fixed inset-0 z-20 flex items-center justify-center bg-bg/40">
          <p className="rounded-xl bg-elevated px-5 py-3 text-sm text-fg shadow-border">Drop files to attach</p>
        </div>
      ) : null}

      {empty ? (
        <div className="relative z-10 flex min-h-dvh flex-col items-center justify-center px-4 pb-16 pt-20">
          <div className="flex w-full max-w-composer flex-col items-center">
            <div className="stagger-in mb-10 sm:mb-12" style={{ animationDelay: "40ms" }}>
              <Logo size="lg" />
            </div>
            <div className="stagger-in w-full" style={{ animationDelay: "100ms" }}>
              <Composer onSubmit={submit} autoFocus />
            </div>
            <div className="stagger-in mt-4 w-full" style={{ animationDelay: "180ms" }}>
              <PromoCard />
            </div>
            <button
              type="button"
              onClick={() => void loadSamples()}
              className="stagger-in mt-5 text-sm text-muted transition-colors hover:text-fg"
              style={{ animationDelay: "240ms" }}
            >
              Try a sample pack
            </button>
          </div>
        </div>
      ) : (
        <div className="relative z-10 flex min-h-dvh flex-col">
          <div ref={scroller} className="flex-1 overflow-y-auto pt-16 scrollbar-thin">
            <Thread messages={messages} onFollowup={(q) => void run(q)} />
          </div>
          <div className="sticky bottom-0 z-20 bg-gradient-to-t from-bg via-bg to-transparent px-4 pb-4 pt-6">
            <div className="mx-auto w-full max-w-composer">
              <Composer onSubmit={submit} />
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
