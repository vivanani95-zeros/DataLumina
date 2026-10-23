import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { answerFromRaw } from "./index.ts";
import { answerQuestion } from "./answer.ts";
import { extractFromFiles } from "./extract.ts";
import { parseFileText, splitQuestionAndData } from "./parse.ts";

function load(name: string) {
  const text = readFileSync(new URL(`../../../public/samples/${name}`, import.meta.url), "utf8");
  return parseFileText(name, text.length, text);
}

describe("DataLumina extraction + Q&A", () => {
  const identity = load("identity_dump.csv");
  const finance = load("finance_messy.csv");
  const device = load("device_telemetry.json");
  const comms = load("comms_log.txt");
  const report = extractFromFiles([identity, finance, device, comms], "fast");

  it("indexes real people from the HR dump", () => {
    const names = report.records.map((r) => Object.values(r.fields).join(" ")).join(" | ");
    assert.match(names, /Ava Meridian/);
    assert.match(names, /Jonah Hale/);
    assert.ok(report.records.length >= 5);
  });

  it("answers who / email from file values", () => {
    const a = answerQuestion("What is Ava Meridian's email?", report, true);
    assert.match(a.text, /ava\.meridian@lumina\.test/i);
    const j = answerQuestion("Who is Jonah Hale?", report, true);
    assert.match(j.text, /Jonah Hale/);
    assert.match(j.text, /Director of Launch|Helios Dynamics/i);
  });

  it("sums spend from the amount column", () => {
    const a = answerQuestion("What's the total spend?", report, true);
    assert.match(a.text, /\$/);
    assert.match(a.text, /901|966|4\.80|500/);
  });

  it("finds the largest transaction", () => {
    const a = answerQuestion("Who spent the most?", report, true);
    assert.match(a.text, /Lumen Brokerage|500/);
  });

  it("lists GPS pairs from telemetry", () => {
    const a = answerQuestion("What GPS coordinates are in here?", report, true);
    assert.match(a.text, /33\.92/);
    assert.match(a.text, /-118\.32/);
  });

  it("returns the public IP from the device file", () => {
    const a = answerQuestion("What's the public IP?", report, true);
    assert.match(a.text, /203\.0\.113\.44/);
  });

  it("lists emails actually present", () => {
    const a = answerQuestion("List all emails", report, true);
    assert.match(a.text, /ava\.meridian@lumina\.test/i);
    assert.match(a.text, /jhale@helios\.example/i);
  });

  it("resolves her/his against the last person", () => {
    const first = answerQuestion("Who is Ava Meridian?", report, true);
    assert.ok(first.subject);
    const next = answerQuestion("What is her email?", report, true, first.subject);
    assert.match(next.text, /ava\.meridian@lumina\.test/i);
  });
});

describe("questions pasted with raw data", () => {
  it("splits question then CSV", () => {
    const raw = `Who has the highest score?\n\nname,score\nAda,12\nBen,19\nCam,7`;
    const split = splitQuestionAndData(raw);
    assert.equal(split.question, "Who has the highest score?");
    assert.ok(split.data?.includes("Ben"));
    const { payload } = answerFromRaw(raw);
    assert.match(payload.text, /Ben|19/);
  });

  it("reads CSV then a trailing question", () => {
    const raw = `merchant,amount\nUmbra Coffee,4.80\nHelios Fuel,62.10\nWhat's the total spend?`;
    const { ask, payload } = answerFromRaw(raw);
    assert.match(ask, /total spend/i);
    assert.match(payload.text, /66\.9|\$66/);
  });

  it("answers from fenced JSON", () => {
    const raw = `What's the public IP?\n\`\`\`json\n{"network":{"public_ip":"198.51.100.10","local_ip":"10.0.0.2"}}\n\`\`\``;
    const { payload } = answerFromRaw(raw);
    assert.match(payload.text, /198\.51\.100\.10/);
    assert.doesNotMatch(payload.text, /203\.0\.113\.44/);
  });

  it("looks up a person in pasted identity rows", () => {
    const raw = `What is Maya's email?\nfull_name,email,title\nMaya Chen,maya@orbit.test,Pilot\nJon Hale,jon@helios.test,Director`;
    const { payload } = answerFromRaw(raw);
    assert.match(payload.text, /maya@orbit\.test/i);
    assert.doesNotMatch(payload.text, /jon@helios/);
  });

  it("does not leak answers from a previous dataset", () => {
    const { payload } = answerFromRaw(`Who scored highest?\nname,score\nAda,12\nBen,19`);
    assert.doesNotMatch(payload.text, /Ava Meridian|Jonah Hale/i);
    assert.match(payload.text, /Ben|19/);
  });

  it("counts people in pasted rows", () => {
    const { payload } = answerFromRaw(`How many people are there?\nname,role\nAda,Eng\nBen,PM\nCam,Ops`);
    assert.match(payload.text, /3/);
    assert.match(payload.text, /Ada/);
  });

  it("reads newline-delimited JSON", () => {
    const raw = `What is the public IP?\n{"employee_id":"E-1","network":{"public_ip":"203.0.113.9"}}\n{"employee_id":"E-2","network":{"public_ip":"198.51.100.2"}}`;
    const { payload } = answerFromRaw(raw);
    assert.match(payload.text, /203\.0\.113\.9|198\.51\.100\.2/);
  });
});

describe("complex business questions", () => {
  const identity = load("identity_dump.csv");
  const finance = load("finance_messy.csv");
  const device = load("device_telemetry.json");
  const comms = load("comms_log.txt");
  const report = extractFromFiles([identity, finance, device, comms], "fast");

  it("filters female Helios staff reporting to Jonah Hale", () => {
    const a = answerQuestion(
      "List female employees at Helios Dynamics who report to Jonah Hale",
      report,
      true,
    );
    assert.match(a.text, /Ava Meridian/);
    assert.match(a.text, /Lila|Chen/);
    assert.doesNotMatch(a.text, /Noah Pell/);
    assert.doesNotMatch(a.text, /Rin Okonkwo/);
  });

  it("sums Apple Pay spend only", () => {
    const a = answerQuestion("What's the total Apple Pay spend, excluding subscriptions?", report, true);
    assert.match(a.text, /193\.80|\$193/);
  });

  it("ranks the three largest transactions", () => {
    const a = answerQuestion("Top 3 transactions by amount", report, true);
    assert.match(a.text, /Lumen Brokerage/);
    assert.match(a.text, /NightCart/);
    assert.match(a.text, /500/);
  });

  it("compares two people field by field", () => {
    const a = answerQuestion("Compare Ava Meridian and Jonah Hale", report, true);
    assert.match(a.text, /Ava Meridian/);
    assert.match(a.text, /Jonah Hale/);
    assert.match(a.text, /vs/i);
    assert.match(a.text, /Staff Propulsion Engineer|Director of Launch/);
  });

  it("computes the share of transactions over $50", () => {
    const a = answerQuestion("What percentage of transactions were over $50?", report, true);
    assert.equal(a.text, "4 of 7 records match (57.1%).");
  });

  it("counts people born before 1990", () => {
    const a = answerQuestion("How many people were born before 1990?", report, true);
    assert.match(a.text, /^3 people:/);
    assert.match(a.text, /Ava Meridian/);
    assert.match(a.text, /Jonah Hale/);
    assert.match(a.text, /Lila|Chen/);
    assert.doesNotMatch(a.text, /Noah Pell/);
    assert.doesNotMatch(a.text, /Rin Okonkwo/);
  });

  it("groups staff by employer", () => {
    const a = answerQuestion("Group people by employer", report, true);
    assert.match(a.text, /Helios Dynamics: 4/);
    assert.match(a.text, /Pell Analytics: 1/);
    assert.match(a.text, /Noah Pell/);
  });

  it("answers a two-part question", () => {
    const a = answerQuestion(
      "What is Ava Meridian's email? Then what's the public IP?",
      report,
      true,
    );
    assert.match(a.text, /ava\.meridian@lumina\.test/);
    assert.doesNotMatch(a.text, /P-44920183/);
    assert.match(a.text, /203\.0\.113\.44/);
  });

  it("nails a compound analyst brief with exact values", () => {
    const a = answerQuestion(
      "Which female Helios Dynamics staff reporting to Jonah Hale use a lumina.test email? Then total Apple Pay spend on or after 2026-03-03 excluding subscriptions. Then the public IP.",
      report,
      true,
    );
    assert.match(a.text, /ava\.meridian@lumina\.test/);
    assert.match(a.text, /lila\.chen@lumina\.test/);
    assert.doesNotMatch(a.text, /rin\.okonkwo/i);
    assert.doesNotMatch(a.text, /noah\.pell/i);
    assert.match(a.text, /\$189\.00/);
    assert.match(a.text, /203\.0\.113\.44/);
    assert.doesNotMatch(a.text, /\$4\.80/);
  });

  it("does not invent a decimal or domain that is not in the file", () => {
    const a = answerQuestion("What is Elon Musk's email, and the total spend at Tesla?", report, true);
    assert.doesNotMatch(a.text, /@tesla|elon@/i);
    assert.doesNotMatch(a.text, /\$4\.81/);
  });
});

describe("enterprise join + exact cents", () => {
  const roster = load("enterprise_roster.csv");
  const ledger = load("enterprise_ledger.csv");
  const ops = load("enterprise_ops.json");
  const report = extractFromFiles([roster, ledger, ops], "thorough");

  it("indexes quoted names and employee ids", () => {
    const blob = report.records.map((r) => Object.values(r.fields).join(" ")).join(" | ");
    assert.match(blob, /Sora Venn|Venn, Sora/);
    assert.match(blob, /Jules/);
    assert.match(blob, /E-218/);
    assert.match(blob, /198\.51\.100\.77/);
  });

  it("nails the hardest compound question to the cent", () => {
    const q =
      "Among female staff in the Lunar Ops unit who report to Sora Venn and whose work email ends in .aero, what was their combined Visa spend over $40 on or after 2026-04-02 excluding refunds and subscriptions? Then compare Sora Venn and Kai Ortega's titles and managers. Then the public IP on Kai Ortega's laptop.";
    const a = answerQuestion(q, report, true);
    assert.match(a.text, /\$332\.75/);
    assert.doesNotMatch(a.text, /\$332\.76/);
    assert.doesNotMatch(a.text, /\$40\.00/);
    assert.doesNotMatch(a.text, /\$12\.40/);
    assert.doesNotMatch(a.text, /\$500\.00/);
    assert.doesNotMatch(a.text, /-\$40|\$-40/);
    assert.match(a.text, /Director of Lunar Ops/);
    assert.match(a.text, /Principal Avionics/);
    assert.match(a.text, /198\.51\.100\.77/);
    assert.doesNotMatch(a.text, /203\.0\.113\.90/);
    assert.doesNotMatch(a.text, /192\.0\.2\.44/);
    assert.doesNotMatch(a.text, /noah\.pell/i);
    assert.doesNotMatch(a.text, /rin\.okonkwo/i);
  });

  it("does not count the \$40.00 Visa charge as over \$40", () => {
    const a = answerQuestion(
      "Total Visa spend over $40 on or after 2026-04-02 excluding refunds and subscriptions for female Lunar Ops staff reporting to Sora Venn with .aero email",
      report,
      true,
    );
    assert.match(a.text, /\$332\.75/);
    assert.doesNotMatch(a.text, /\$372\.75/);
  });

  it("ORs Visa and Apple Pay instead of requiring both on one row", () => {
    const a = answerQuestion(
      "Total Visa or Apple Pay spend excluding refunds and subscriptions",
      report,
      true,
    );
    assert.match(a.text, /\$426\.15/);
  });

  it("rolls spend up by employee", () => {
    const a = answerQuestion("Spend by employee excluding refunds and subscriptions", report, true);
    assert.match(a.text, /Jules/);
    assert.match(a.text, /\$230\.50/);
    assert.match(a.text, /Amelia/);
    assert.match(a.text, /\$195\.65/);
  });

  it("lists the org under Sora Venn", () => {
    const a = answerQuestion("Who is under Sora Venn?", report, true);
    assert.match(a.text, /Kai Ortega/);
    assert.match(a.text, /Amelia Rourke/);
    assert.match(a.text, /Jules/);
    assert.match(a.text, /Theo Venn/);
    assert.doesNotMatch(a.text, /Rin Okonkwo/);
  });

  it("chains of-those: female Lunar Ops then Visa total", () => {
    const a = answerQuestion(
      "Which female Lunar Ops staff report to Sora Venn? Of those, total Visa spend excluding refunds and subscriptions",
      report,
      true,
    );
    assert.match(a.text, /Amelia Rourke/);
    assert.match(a.text, /Jules/);
    assert.match(a.text, /\$372\.75/);
    assert.doesNotMatch(a.text, /\$500\.00/);
  });

  it("keeps people with at least two transactions", () => {
    const a = answerQuestion("Who has at least 2 transactions excluding refunds and subscriptions?", report, true);
    assert.match(a.text, /Amelia/);
    assert.match(a.text, /Jules/);
    assert.doesNotMatch(a.text, /Kai Ortega/);
  });

  it("ranks who has the most transactions", () => {
    const a = answerQuestion("Who has the most transactions excluding refunds and subscriptions?", report, true);
    assert.match(a.text, /Amelia/);
  });
});

describe("apex trap dataset — every decoy must fail", () => {
  const roster = load("apex_roster.csv");
  const ledger = load("apex_ledger.csv");
  const ops = load("apex_ops.json");
  const report = extractFromFiles([roster, ledger, ops], "thorough");

  const Q =
    "Among female staff in the Orbital Finance unit who report to Mina Park and whose work email ends in .corp, what was their combined Mastercard spend over $25 on or after 2026-05-01 excluding refunds, chargebacks, and subscriptions? Then who among those has the most remaining spend, and what is their public IP? Then compare the two people named Alex Kim: titles and units.";

  it("indexes both Alex Kims, F/Woman gender, and comma amounts", () => {
    const blob = report.records.map((r) => Object.values(r.fields).join(" ")).join(" | ");
    assert.match(blob, /Noor Haddad/);
    assert.match(blob, /Jules Okada/);
    assert.match(blob, /203\.0\.113\.88/);
    assert.ok(report.records.some((r) => /1200|1,200/.test(Object.values(r.fields).join(" "))));
  });

  it("nails the trap question to the cent and the right IP", () => {
    const a = answerQuestion(Q, report, true);
    assert.match(a.text, /\$1,394\.01/);
    assert.doesNotMatch(a.text, /\$1,394\.02/);
    assert.doesNotMatch(a.text, /\$1,200\.50/);
    assert.doesNotMatch(a.text, /\$25\.00/);
    assert.doesNotMatch(a.text, /\$80\.00/);
    assert.doesNotMatch(a.text, /\$999/);
    assert.doesNotMatch(a.text, /\$888/);
    assert.doesNotMatch(a.text, /\$777/);
    assert.doesNotMatch(a.text, /\$5,000/);
    assert.doesNotMatch(a.text, /\$44\.00/);
    assert.doesNotMatch(a.text, /\$14\.99/);
    assert.doesNotMatch(a.text, /\$29\.99/);
    assert.match(a.text, /Noor Haddad/);
    assert.match(a.text, /203\.0\.113\.88/);
    assert.doesNotMatch(a.text, /10\.4\.0\.12/);
    assert.doesNotMatch(a.text, /100\.64\.1\.9/);
    assert.doesNotMatch(a.text, /198\.51\.100\.99/);
    assert.doesNotMatch(a.text, /192\.0\.2\.77/);
    assert.doesNotMatch(a.text, /198\.51\.100\.77/);
    assert.doesNotMatch(a.text, /203\.0\.113\.1\b/);
    assert.match(a.text, /Controller/);
    assert.match(a.text, /Staff Engineer/);
    assert.match(a.text, /Orbital Finance/);
    assert.match(a.text, /Flight Software/);
    assert.doesNotMatch(a.text, /Sable Wren/);
    assert.doesNotMatch(a.text, /Ivy Chen/);
    assert.doesNotMatch(a.text, /Theo Park/);
  });
});
