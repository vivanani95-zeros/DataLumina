import { Ghost, History, SquarePen } from "lucide-react";
import { cn } from "@/lib/cn";
import { Logo } from "@/components/logo";
import { useAppStore } from "@/lib/store";

export function TopBar({ showNew }: { showNew: boolean }) {
  const privateMode = useAppStore((s) => s.privateMode);
  const setPrivateMode = useAppStore((s) => s.setPrivateMode);
  const setHistoryOpen = useAppStore((s) => s.setHistoryOpen);
  const newChat = useAppStore((s) => s.newChat);

  return (
    <header className="pointer-events-none absolute inset-x-0 top-0 z-30 flex items-center justify-between px-3 pt-3 sm:px-5 sm:pt-4">
      <div className="pointer-events-auto flex items-center gap-1">
        {showNew ? (
          <button
            type="button"
            onClick={newChat}
            className="inline-flex h-11 items-center gap-2 rounded-pill px-2.5 text-fg transition-colors duration-150 hover:bg-elevated"
            aria-label="New analysis"
          >
            <Logo size="sm" wordmark={false} />
            <SquarePen className="size-4 text-muted" strokeWidth={1.75} />
          </button>
        ) : (
          <span className="sr-only">DataLumina</span>
        )}
      </div>

      <div className="pointer-events-auto flex items-center gap-0.5">
        <button
          type="button"
          onClick={() => setHistoryOpen(true)}
          className="inline-flex h-11 items-center gap-2 rounded-pill px-3 text-sm font-medium text-fg transition-colors duration-150 hover:bg-elevated"
        >
          <History className="size-4" strokeWidth={1.75} />
          <span className="hidden sm:inline">History</span>
        </button>
        <button
          type="button"
          onClick={() => setPrivateMode(!privateMode)}
          className={cn(
            "inline-flex h-11 items-center gap-2 rounded-pill px-3 text-sm font-medium transition-colors duration-150",
            privateMode ? "bg-elevated text-fg" : "text-fg hover:bg-elevated",
          )}
          aria-pressed={privateMode}
        >
          <Ghost className="size-4" strokeWidth={1.75} />
          <span className="hidden sm:inline">Private</span>
        </button>
      </div>
    </header>
  );
}
