import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { ArrowUp, Check, ChevronDown, Paperclip, Zap } from "lucide-react";
import { useEffect, useRef } from "react";
import { cn } from "@/lib/cn";
import { useAppStore, uid, type Attachment } from "@/lib/store";
import type { AnalyzerMode } from "@/lib/analyzer/types";

function formatSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export async function filesToAttachments(list: File[]): Promise<Attachment[]> {
  const out: Attachment[] = [];
  for (const file of list) {
    if (file.size > 8 * 1024 * 1024) continue;
    const text = await file.text();
    out.push({
      id: uid("a"),
      name: file.name,
      size: file.size,
      type: file.type || "text/plain",
      text,
    });
  }
  return out;
}

export function Composer({
  onSubmit,
  autoFocus,
}: {
  onSubmit: () => void;
  autoFocus?: boolean;
}) {
  const input = useAppStore((s) => s.input);
  const setInput = useAppStore((s) => s.setInput);
  const attachments = useAppStore((s) => s.attachments);
  const addAttachments = useAppStore((s) => s.addAttachments);
  const removeAttachment = useAppStore((s) => s.removeAttachment);
  const mode = useAppStore((s) => s.mode);
  const setMode = useAppStore((s) => s.setMode);
  const busy = useAppStore((s) => s.busy);
  const fileRef = useRef<HTMLInputElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const canSend = !busy && (input.trim().length > 0 || attachments.length > 0);

  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [input]);

  useEffect(() => {
    if (autoFocus) taRef.current?.focus();
  }, [autoFocus]);

  const attachFromList = async (files: FileList | File[] | null) => {
    if (!files) return;
    const arr = Array.from(files);
    const next = await filesToAttachments(arr);
    addAttachments(next);
  };

  return (
    <div
      className="w-full"
      onDragOver={(e) => {
        e.preventDefault();
      }}
      onDrop={(e) => {
        e.preventDefault();
        void attachFromList(e.dataTransfer.files);
      }}
    >
      <input
        ref={fileRef}
        type="file"
        multiple
        className="hidden"
        accept=".csv,.tsv,.json,.ndjson,.txt,.log,.xml,.html,.har,.vcf,.md"
        onChange={(e) => {
          void attachFromList(e.target.files);
          e.currentTarget.value = "";
        }}
      />

      <div className="rounded-[28px] bg-composer shadow-composer transition-[box-shadow,background-color] duration-150 hover:bg-composer-hover">
        {attachments.length > 0 ? (
          <div className="flex flex-wrap gap-2 px-3.5 pt-3">
            {attachments.map((a) => (
              <span
                key={a.id}
                className="inline-flex max-w-full items-center gap-2 rounded-md bg-elevated px-2.5 py-1.5 text-xs text-fg"
              >
                <span className="truncate">{a.name}</span>
                <span className="shrink-0 tabular-nums text-subtle">{formatSize(a.size)}</span>
                <button
                  type="button"
                  className="shrink-0 text-muted transition-colors hover:text-fg"
                  aria-label={`Remove ${a.name}`}
                  onClick={() => removeAttachment(a.id)}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        ) : null}

        <div className="flex items-end gap-1 px-2 py-2">
          <button
            type="button"
            className="mb-0.5 inline-flex size-11 shrink-0 items-center justify-center rounded-pill text-muted transition-colors duration-150 hover:text-fg"
            aria-label="Attach files"
            onClick={() => fileRef.current?.click()}
          >
            <Paperclip className="size-[18px]" strokeWidth={1.75} />
          </button>

          <textarea
            ref={taRef}
            rows={1}
            value={input}
            disabled={busy}
            placeholder="Ask anything — or paste a question with CSV/JSON"
            className="mb-2 max-h-40 min-h-7 flex-1 resize-none bg-transparent py-2 text-[15px] leading-6 text-fg placeholder:text-subtle focus:outline-none disabled:opacity-60"
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                if (canSend) onSubmit();
              }
            }}
          />

          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <button
                type="button"
                className="mb-0.5 inline-flex h-11 shrink-0 items-center gap-1 rounded-pill px-2 text-sm text-muted transition-colors duration-150 hover:text-fg"
                aria-label="Analysis mode"
              >
                <Zap className="size-3.5" strokeWidth={1.9} />
                <span className="hidden capitalize sm:inline">{mode === "fast" ? "Fast" : "Thorough"}</span>
                <ChevronDown className="size-3.5 opacity-70" strokeWidth={2} />
              </button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content
                align="end"
                sideOffset={8}
                className="z-50 min-w-56 rounded-lg bg-elevated p-1 shadow-border"
              >
                {(["fast", "thorough"] as AnalyzerMode[]).map((m) => (
                  <DropdownMenu.Item
                    key={m}
                    className="flex cursor-pointer items-center justify-between rounded-md px-3 py-2.5 text-sm text-fg outline-none data-[highlighted]:bg-composer"
                    onSelect={() => setMode(m)}
                  >
                    <span>
                      <span className="block font-medium capitalize">{m}</span>
                      <span className="block text-xs text-muted">
                        {m === "fast" ? "Headers and strong patterns" : "Full walk, language, inference"}
                      </span>
                    </span>
                    {mode === m ? <Check className="size-4 text-fg" strokeWidth={2} /> : null}
                  </DropdownMenu.Item>
                ))}
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>

          <button
            type="button"
            onClick={() => {
              if (canSend) onSubmit();
            }}
            disabled={!canSend}
            aria-label="Send"
            className={cn(
              "mb-0.5 inline-flex size-10 shrink-0 items-center justify-center rounded-pill transition-[transform,opacity] duration-150 ease-out",
              canSend
                ? "bg-fg text-accent-fg active:scale-[0.96]"
                : "bg-fg/25 text-accent-fg/40",
            )}
          >
            <ArrowUp className="size-4" strokeWidth={2.25} />
          </button>
        </div>
      </div>
    </div>
  );
}
