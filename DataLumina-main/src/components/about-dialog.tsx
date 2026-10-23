import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { GROUP_LABEL } from "@/lib/analyzer/categories";
import { useAppStore } from "@/lib/store";

export function AboutDialog() {
  const open = useAppStore((s) => s.aboutOpen);
  const setOpen = useAppStore((s) => s.setAboutOpen);

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-bg/70" />
        <Dialog.Content className="fixed inset-x-3 top-[8%] z-50 mx-auto max-h-[84vh] max-w-lg overflow-y-auto rounded-xl bg-elevated p-6 shadow-border scrollbar-thin sm:inset-x-auto sm:left-1/2 sm:w-full sm:max-w-lg sm:-translate-x-1/2 sm:p-8">
          <div className="flex items-start justify-between gap-4">
            <div>
              <Dialog.Title className="text-xl font-medium tracking-tight text-fg">
                How DataLumina works
              </Dialog.Title>
              <Dialog.Description className="mt-2 text-sm leading-6 text-muted">
                DataLumina runs entirely in your browser. Files are read, cleaned, and
                analysed on this device: no AI service and no API keys.
                Every answer is calculated from the values in your files, and each one
                shows how your question was understood.
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <button
                type="button"
                className="inline-flex size-10 items-center justify-center rounded-pill text-muted hover:bg-composer hover:text-fg"
                aria-label="Close"
              >
                <X className="size-4" strokeWidth={1.75} />
              </button>
            </Dialog.Close>
          </div>

          <ul className="mt-6 space-y-3">
            {Object.entries(GROUP_LABEL).map(([id, label]) => (
              <li key={id} className="border-t border-hairline pt-3 first:border-t-0 first:pt-0">
                <p className="text-sm font-medium text-fg">{label}</p>
                <p className="mt-0.5 text-xs leading-5 text-muted">
                  Returned only when headers, values, or patterns in the file match.
                </p>
              </li>
            ))}
          </ul>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
