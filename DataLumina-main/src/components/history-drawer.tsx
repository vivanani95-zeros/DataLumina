import { Trash2, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { useAppStore } from "@/lib/store";

function timeLabel(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function HistoryDrawer() {
  const open = useAppStore((s) => s.historyOpen);
  const setOpen = useAppStore((s) => s.setHistoryOpen);
  const history = useAppStore((s) => s.history);
  const privateMode = useAppStore((s) => s.privateMode);
  const loadHistory = useAppStore((s) => s.loadHistory);
  const deleteHistory = useAppStore((s) => s.deleteHistory);

  return (
    <div
      className={cn(
        "fixed inset-0 z-40 overflow-hidden",
        open ? "pointer-events-auto" : "pointer-events-none invisible",
      )}
      aria-hidden={!open}
    >
      <button
        type="button"
        tabIndex={open ? 0 : -1}
        className={cn(
          "absolute inset-0 bg-bg/50 transition-opacity duration-200",
          open ? "opacity-100" : "opacity-0",
        )}
        aria-label="Close history"
        onClick={() => setOpen(false)}
      />
      <aside
        className={cn(
          "absolute right-0 top-0 flex h-full w-80 max-w-full flex-col bg-elevated shadow-border transition-transform duration-200 ease-out",
          open ? "translate-x-0" : "translate-x-full",
        )}
      >
        <div className="flex items-center justify-between px-4 py-4">
          <h2 className="text-sm font-medium text-fg">History</h2>
          <button
            type="button"
            className="inline-flex size-10 items-center justify-center rounded-pill text-muted hover:bg-composer hover:text-fg"
            onClick={() => setOpen(false)}
            aria-label="Close"
          >
            <X className="size-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-2 pb-6 scrollbar-thin">
          {privateMode ? (
            <p className="px-3 py-6 text-sm leading-6 text-muted">
              Private is on. New briefs are not written to this device.
            </p>
          ) : history.length === 0 ? (
            <p className="px-3 py-6 text-sm leading-6 text-muted">No briefs yet. Attach a file and ask.</p>
          ) : (
            <ul className="space-y-0.5">
              {history.map((h) => (
                <li key={h.id} className="group relative">
                  <button
                    type="button"
                    onClick={() => loadHistory(h.id)}
                    className="w-full rounded-md px-3 py-3 text-left hover:bg-composer"
                  >
                    <span className="block truncate text-sm text-fg">{h.title}</span>
                    <span className="mt-0.5 block text-xs tabular-nums text-subtle">{timeLabel(h.createdAt)}</span>
                  </button>
                  <button
                    type="button"
                    className="absolute right-2 top-2 inline-flex size-9 items-center justify-center rounded-pill text-muted opacity-0 hover:text-fg group-hover:opacity-100"
                    aria-label="Delete"
                    onClick={() => deleteHistory(h.id)}
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>
    </div>
  );
}
