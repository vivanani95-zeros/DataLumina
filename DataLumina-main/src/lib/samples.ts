export const SAMPLE_FILES = [
  {
    path: "/samples/identity_dump.csv",
    name: "identity_dump.csv",
    type: "text/csv",
  },
  {
    path: "/samples/device_telemetry.json",
    name: "device_telemetry.json",
    type: "application/json",
  },
  {
    path: "/samples/finance_messy.csv",
    name: "finance_messy.csv",
    type: "text/csv",
  },
  {
    path: "/samples/comms_log.txt",
    name: "comms_log.txt",
    type: "text/plain",
  },
  {
    path: "/samples/enterprise_roster.csv",
    name: "enterprise_roster.csv",
    type: "text/csv",
  },
  {
    path: "/samples/enterprise_ledger.csv",
    name: "enterprise_ledger.csv",
    type: "text/csv",
  },
  {
    path: "/samples/enterprise_ops.json",
    name: "enterprise_ops.json",
    type: "application/json",
  },
  {
    path: "/samples/apex_roster.csv",
    name: "apex_roster.csv",
    type: "text/csv",
  },
  {
    path: "/samples/apex_ledger.csv",
    name: "apex_ledger.csv",
    type: "text/csv",
  },
  {
    path: "/samples/apex_ops.json",
    name: "apex_ops.json",
    type: "application/json",
  },
] as const;

export async function loadSampleAttachments(): Promise<
  Array<{ name: string; size: number; type: string; text: string }>
> {
  const out: Array<{ name: string; size: number; type: string; text: string }> = [];
  for (const sample of SAMPLE_FILES) {
    const res = await fetch(sample.path);
    const text = await res.text();
    out.push({
      name: sample.name,
      size: new Blob([text]).size,
      type: sample.type,
      text,
    });
  }
  return out;
}
