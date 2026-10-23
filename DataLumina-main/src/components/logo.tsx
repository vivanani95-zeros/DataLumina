import { cn } from "@/lib/cn";

type LogoProps = {
  className?: string;
  markClassName?: string;
  wordmark?: boolean;
  size?: "sm" | "md" | "lg";
};

export function Logo({ className, markClassName, wordmark = true, size = "md" }: LogoProps) {
  const mark = size === "lg" ? "size-11" : size === "sm" ? "size-6" : "size-8";
  const type = size === "lg" ? "text-[2.15rem]" : size === "sm" ? "text-base" : "text-2xl";

  return (
    <div className={cn("flex items-center gap-2.5 text-fg", className)}>
      <span className={cn("relative inline-flex shrink-0", mark, markClassName)} aria-hidden="true">
        <svg viewBox="0 0 32 32" className="size-full" fill="none">
          <circle cx="16" cy="16" r="12.2" stroke="currentColor" strokeWidth="1.7" />
          <path
            d="M20.4 5.8a12.2 12.2 0 0 1 0 20.4"
            stroke="currentColor"
            strokeWidth="3.2"
            strokeLinecap="round"
          />
          <circle cx="13.2" cy="16" r="2.15" fill="currentColor" />
        </svg>
      </span>
      {wordmark ? (
        <span className={cn("font-medium tracking-[-0.04em] leading-none", type)}>DataLumina</span>
      ) : (
        <span className="sr-only">DataLumina</span>
      )}
    </div>
  );
}
