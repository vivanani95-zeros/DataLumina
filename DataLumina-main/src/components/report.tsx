import { ChevronDown, Download } from "lucide-react";
import { useMemo, useState } from "react";
import { GROUP_LABEL } from "@/lib/analyzer/categories";
import { downloadText, reportToCsv, reportToJson } from "@/lib/analyzer/answer";
import type { AnalysisReport, CategoryHit, CategoryGroup } from "@/lib/analyzer/types";
import { cn } from "@/lib/cn";

const GROUP_ORDER: CategoryGroup[] = [
  "biometric",
  "device",
  "spatial",
  "clickstream",
  "language",
  "financial",
  "social",
  "psychological",
  "training",
];

function confidenceLabel(n: number): string {
  if (n >= 0.85) return "high";
  if (n >= 0.7) return "medium";
  return "inferred";
}

export function ReportView({
  report,
  filtered,
}: {
  report: AnalysisReport;
  filtered?: CategoryHit[];
}) {
  const cats = filtered ?? report.categories;
  const grouped = useMemo(() => {
    const map = new Map<CategoryGroup, CategoryHit[]>();
    for (const c of cats) {
      const list = map.get(c.group) ?? [];
      list.push(c);
      map.set(c.group, list);
    }
    return GROUP_ORDER.filter((g) => map.has(g)).map((g) => ({
      group: g,
      label: GROUP_LABEL[g],
      items: map.get(g)!,
    }));
  }, [cats]);

  if (cats.length === 0) {
    return (
      <p className="mt-4 text-sm leading-6 text-muted">
        No matching domains in this pass. Try Thorough mode or a file with headers.
      </p>
    );
  }

  return (
    <div className="mt-5 space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-pill bg-composer px-3 py-1 text-xs tabular-nums text-muted">
          {report.coverage.hit}/{report.coverage.total} domains
        </span>
        <span className="rounded-pill bg-composer px-3 py-1 text-xs capitalize text-muted">{report.mode}</span>
        <button
          type="button"
          className="inline-flex h-8 items-center gap-1.5 rounded-pill px-3 text-xs text-muted transition-colors hover:bg-composer hover:text-fg"
          onClick={() =>
            downloadText(
              "datalumina-report.json",
              reportToJson(report, cats.map((c) => c.id)),
              "application/json",
            )
          }
        >
          <Download className="size-3.5" strokeWidth={1.75} />
          Export JSON
        </button>
      </div>

      {grouped.map((g) => (
        <section key={g.group} className="space-y-2">
          <h3 className="px-0.5 text-xs font-medium uppercase tracking-[0.14em] text-subtle">{g.label}</h3>
          {g.items.map((c) => (
            <CategoryCard key={c.id} hit={c} report={report} />
          ))}
        </section>
      ))}
    </div>
  );
}

function CategoryCard({ hit, report }: { hit: CategoryHit; report: AnalysisReport }) {
  const [open, setOpen] = useState(false);
  const preview = hit.findings.slice(0, 3).map((f) => f.clean).join(" · ");

  return (
    <article className="overflow-hidden rounded-lg bg-surface shadow-border">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-3 px-4 py-3.5 text-left"
      >
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium text-fg">{hit.label}</span>
          <span className="mt-0.5 block truncate text-xs leading-5 text-muted">{open ? hit.description : preview}</span>
        </span>
        <span className="tabular-nums text-xs text-subtle">{hit.count}</span>
        <ChevronDown
          className={cn(
            "size-4 shrink-0 text-muted transition-transform duration-150",
            open ? "rotate-180" : "rotate-0",
          )}
        />
      </button>

      {open ? (
        <div className="border-t border-hairline px-4 pb-4 pt-3">
          <p className="mb-3 text-xs leading-5 text-subtle">{hit.description}</p>
          <ul className="space-y-2">
            {hit.findings.slice(0, 24).map((f) => (
              <li key={f.id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 text-sm">
                <div className="min-w-0">
                  <p className="truncate font-medium text-fg">{f.clean}</p>
                  <p className="truncate font-mono text-xs text-subtle">
                    {f.field}
                    {f.raw !== f.clean ? ` · raw ${f.raw}` : ""} · {f.source}
                  </p>
                </div>
                <span className="self-start text-[11px] uppercase tracking-wide text-faint">
                  {confidenceLabel(f.confidence)}
                </span>
              </li>
            ))}
          </ul>
          {hit.findings.length > 24 ? (
            <p className="mt-3 text-xs text-subtle">Showing 24 of {hit.count}. Export for the rest.</p>
          ) : null}
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              className="h-8 rounded-pill px-3 text-xs text-muted hover:bg-composer hover:text-fg"
              onClick={(e) => {
                e.stopPropagation();
                downloadText(`${hit.id}.csv`, reportToCsv(report, hit.id), "text/csv");
              }}
            >
              CSV
            </button>
          </div>
        </div>
      ) : null}
    </article>
  );
}
