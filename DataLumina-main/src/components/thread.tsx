import { Logo } from "@/components/logo";
import { ReportView } from "@/components/report";
import type { AnswerTable } from "@/lib/analyzer/types";
import type { ChatMessage } from "@/lib/store";
import { cn } from "@/lib/cn";
import { suggestedFollowups } from "@/lib/analyzer/answer";

export function Thread({
  messages,
  onFollowup,
}: {
  messages: ChatMessage[];
  onFollowup: (q: string) => void;
}) {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 pb-4 pt-4">
      {messages.map((m) =>
        m.role === "user" ? (
          <UserBubble key={m.id} message={m} />
        ) : (
          <AssistantBlock key={m.id} message={m} onFollowup={onFollowup} />
        ),
      )}
    </div>
  );
}

function UserBubble({ message }: { message: ChatMessage }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-bubble rounded-xl bg-composer px-4 py-3 text-[15px] leading-6 text-fg">
        {message.attachmentNames && message.attachmentNames.length > 0 ? (
          <p className="mb-1.5 text-xs text-muted">{message.attachmentNames.join(" · ")}</p>
        ) : null}
        <p className="whitespace-pre-wrap">{message.text}</p>
      </div>
    </div>
  );
}

function AssistantBlock({
  message,
  onFollowup,
}: {
  message: ChatMessage;
  onFollowup: (q: string) => void;
}) {
  const filtered = message.report && message.filteredIds
    ? message.report.categories.filter((c) => message.filteredIds!.includes(c.id))
    : message.report?.categories;
  const showReport = Boolean(message.report && message.showReport !== false && !message.streaming);
  const chips = message.report && !message.streaming ? suggestedFollowups(message.report) : [];

  return (
    <div className="flex gap-3">
      <div className="mt-0.5 hidden sm:block">
        <Logo size="sm" wordmark={false} />
      </div>
      <div className="min-w-0 flex-1">
        {message.streaming && message.stage ? (
          <p className="shimmer-text text-[15px]">{message.stage}</p>
        ) : (
          <div className="space-y-3 text-[15px] leading-7 text-fg">
            {message.text.split("\n").map((line, i) => (
              <p key={i} className={cn(line.startsWith("•") ? "pl-1 text-[14px] leading-6" : "")}>
                {line || "\u00a0"}
              </p>
            ))}
          </div>
        )}
        {message.table && !message.streaming ? <ResultTable table={message.table} /> : null}
        {message.notes && message.notes.length > 0 && !message.streaming ? (
          <div className="mt-4 space-y-1 border-t border-hairline pt-3">
            {message.notes.map((n) => (
              <p key={n} className="text-xs leading-5 text-subtle">
                {n}
              </p>
            ))}
          </div>
        ) : null}
        {showReport ? (
          <ReportView report={message.report!} filtered={filtered} />
        ) : null}
        {chips.length ? (
          <div className="mt-5 flex flex-wrap gap-2">
            {chips.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => onFollowup(c)}
                className="h-9 rounded-pill px-3.5 text-xs text-muted shadow-border transition-colors duration-150 hover:bg-composer hover:text-fg"
              >
                {c}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ResultTable({ table }: { table: AnswerTable }) {
  return (
    <div className="mt-4 overflow-x-auto rounded-lg bg-surface shadow-border scrollbar-thin">
      <table className="text-left text-sm">
        <thead>
          <tr>
            {table.columns.map((c) => (
              <th key={c} className="whitespace-nowrap px-3 py-2 text-xs font-medium text-subtle">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row, i) => (
            <tr key={i} className="border-t border-hairline">
              {row.map((cell, j) => (
                <td key={j} className="max-w-56 truncate px-3 py-2 text-fg">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
