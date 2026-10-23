import { useAppStore } from "@/lib/store";

export function PromoCard() {
  const setAboutOpen = useAppStore((s) => s.setAboutOpen);

  return (
    <div className="flex w-full items-center gap-3.5 rounded-[22px] px-4 py-3.5 shadow-border sm:gap-4 sm:px-5 sm:py-4">
      <span
        className="relative inline-flex size-11 shrink-0 items-center justify-center rounded-full bg-fg text-accent-fg sm:size-12"
        aria-hidden="true"
      >
        <span className="absolute left-[13px] top-[15px] size-1.5 rounded-full bg-accent-fg sm:left-3.5 sm:top-4 sm:size-1.5" />
        <span className="absolute right-[13px] top-[15px] size-1.5 rounded-full bg-accent-fg sm:right-3.5 sm:top-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium leading-snug text-fg sm:text-[15px]">
          Get DataLumina for Business
        </p>
        <p className="mt-0.5 text-[13px] leading-5 text-muted">
          Give every team a private analyst. Drop messy CSVs, logs, and dumps —
          DataLumina reads them on your device and returns clean data, exact answers, and an exportable brief.
        </p>
      </div>
      <button
        type="button"
        onClick={() => setAboutOpen(true)}
        className="inline-flex h-10 shrink-0 items-center rounded-pill bg-fg px-3.5 text-sm font-medium text-accent-fg transition-transform duration-150 ease-out hover:opacity-90 active:scale-[0.96] sm:px-4"
      >
        Learn more
      </button>
    </div>
  );
}
