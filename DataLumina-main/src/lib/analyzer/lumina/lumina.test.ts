// Behaviour of the on-device question engine. Every expected value below was checked by hand
// against the sample files, so these tests pin correctness, not just the presence of text.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { answerQuestion } from "../answer.ts";
import { extractFromFiles } from "../extract.ts";
import { parseFileText } from "../parse.ts";
import type { ParsedFile } from "../types.ts";
import { buildWorkbook } from "./table.ts";
import { answerLumina } from "./query.ts";
import { workbookFor } from "./index.ts";
import { parseDate, parseNum, fmtDate, inferDateOrder } from "./values.ts";

function load(name: string): ParsedFile {
  const text = readFileSync(new URL(`../../../../public/samples/${name}`, import.meta.url), "utf8");
  return parseFileText(name, text.length, text);
}

function ask(question: string, files: ParsedFile[]) {
  const report = extractFromFiles(files, "thorough");
  return { report, a: answerQuestion(question, report, true) };
}

describe("Lumina engine runs on its own, with no fallback", () => {
  it("builds the workbook for every report and answers from it", () => {
    const files = [load("apex_roster.csv"), load("apex_ledger.csv"), load("apex_ops.json")];
    const report = extractFromFiles(files, "thorough");
    assert.ok(workbookFor(report), "the report has a registered workbook");
    const direct = answerLumina("Who has the most transactions excluding refunds and subscriptions?", buildWorkbook(files), null);
    assert.ok(direct, "the engine itself answers, not the category report");
  });
});

describe("apex trap dataset: exact money, right people, no decoys", () => {
  const Q =
    "Among female staff in the Orbital Finance unit who report to Mina Park and whose work email ends in .corp, what was their combined Mastercard spend over $25 on or after 2026-05-01 excluding refunds, chargebacks, and subscriptions? Then who among those has the most remaining spend, and what is their public IP? Then compare the two people named Alex Kim: titles and units.";
  const files = [load("apex_roster.csv"), load("apex_ledger.csv"), load("apex_ops.json")];

  it("totals $1,394.01 over 7 transactions and names Noor Haddad with her IP", () => {
    const { a } = ask(Q, files);
    assert.match(a.text, /Total spend: \$1,394\.01 across 7 transactions for 3 people\./);
    assert.match(a.text, /Highest spend: Noor Haddad: \$1,230\.50/);
    assert.match(a.text, /Noor Haddad · noor-macbook\.lumen\.corp — public IP: 203\.0\.113\.88/);
  });

  it("compares the two Alex Kims as separate people", () => {
    const { a } = ask(Q, files);
    assert.match(a.text, /Alex Kim \(E-402\) vs Alex Kim \(E-403\)/);
    assert.match(a.text, /title: Controller vs Staff Engineer/);
    assert.match(a.text, /unit: Orbital Finance vs Flight Software/);
  });

  it("never prints the decoy amounts, IPs or people", () => {
    const { a } = ask(Q, files);
    for (const decoy of [/\$1,200\.50/, /\$25\.00/, /\$80\.00/, /\$999/, /\$888/, /\$777/, /\$5,000/, /10\.4\.0\.12/, /Sable Wren/, /Ivy Chen/, /Theo Park/]) {
      assert.doesNotMatch(a.text, decoy);
    }
  });

  it("names the one ledger row whose employee ID does not match the roster", () => {
    const { a } = ask(Q, files);
    assert.ok(a.notes?.some((n) => /T-5119/.test(n)), "an unlinked ledger row is disclosed");
  });

  it("counts a 'holdings' record as a limit, not a charge, unless the question names it", () => {
    const { a } = ask("What is the total spend for Alex Kim (E-402)?", files);
    assert.doesNotMatch(a.text, /5,000/);
  });
});

describe("enterprise dataset: totals, shares, groups and names", () => {
  const files = [load("enterprise_roster.csv"), load("enterprise_ledger.csv"), load("enterprise_ops.json")];

  it("sums Visa spend with refunds out and subscriptions in", () => {
    const { a } = ask("What's the total Visa spend?", files);
    assert.match(a.text, /Total spend: \$388\.74 across 5 transactions for 2 people\./);
  });

  it("uses the Visa spend as the base of a percentage", () => {
    const { a } = ask("What percentage of Visa spend is over $50?", files);
    assert.equal(a.text, "3 of 5 records match (60%).");
  });

  it("answers 'largest Visa transaction and who made it' with one row and its owner", () => {
    const { a } = ask("What's the largest Visa transaction and who made it?", files);
    assert.match(a.text, /Largest transaction: Jules "J\." Park · NightCart Impulse — \$189\.50\./);
  });

  it("covers every April row when the question says 'in April' and records that basis", () => {
    const { a } = ask("What is the total spend in April?", files);
    assert.match(a.text, /Total spend: \$1,026\.14 across 10 transactions for 5 people\./);
    assert.ok(a.notes?.some((n) => /in April 2026/.test(n)));
  });

  it("keeps only the people with at least two qualifying transactions", () => {
    const { a } = ask("Who has at least 2 transactions excluding refunds and subscriptions?", files);
    assert.match(a.text, /Amelia Rourke/);
    assert.match(a.text, /Jules/);
    assert.doesNotMatch(a.text, /Kai Ortega/);
  });

  it("shows 'Last, First' names as 'First Last'", () => {
    const { a } = ask("How many employees are in Lunar Ops?", files);
    assert.match(a.text, /Sora Venn/);
    assert.doesNotMatch(a.text, /Venn, Sora/);
  });

  it("lists the largest merchants with currency and no repeated label", () => {
    const { a } = ask("Which merchants are over $100?", files);
    assert.match(a.text, /amount: \$189\.50/);
    assert.doesNotMatch(a.text, /merchant: NightCart/);
  });

  it("uses the reporting chain for 'under', and direct reports for 'report to'", () => {
    const direct = ask("Who reports to Kai Ortega?", files).a.text;
    assert.match(direct, /Noah Pell/);
    assert.match(direct, /Theo Venn/);
    const chain = ask("How many people are under Sora Venn?", files).a.text;
    assert.match(chain, /^\d+ people/);
  });
});

describe("identity + finance mess: layouts, dates, dollars only", () => {
  const files = [load("identity_dump.csv"), load("finance_messy.csv"), load("device_telemetry.json"), load("comms_log.txt")];

  it("leaves out the non-transaction sections and the ETH row from dollar totals", () => {
    const { a } = ask("What's the total spend?", files);
    assert.match(a.text, /Total spend: \$901\.11 across 7 transactions\./);
    assert.ok(a.notes?.some((n) => /different layout/.test(n)));
  });

  it("answers range questions with both bounds", () => {
    const { a } = ask("How many transactions are over $100 and under $1000?", files);
    assert.equal(a.text, "2 transactions.");
  });

  it("averages per group and never shows a non-dollar row as $0.00", () => {
    const { a } = ask("Average amount per merchant", files);
    assert.match(a.text, /Lumen Brokerage: \$500\.00/);
    assert.doesNotMatch(a.text, /\$0\.00/);
  });

  it("ranks merchants by their total when asked for the top N", () => {
    const { a } = ask("Top 2 merchants by total amount", files);
    assert.match(a.text, /Top 2 by amount:/);
    assert.match(a.text, /Lumen Brokerage: \$500\.00/);
    assert.match(a.text, /NightCart Impulse: \$189\.00/);
    assert.doesNotMatch(a.text, /Helios Fuel/);
  });

  it("reports missing names and merchants instead of inventing values", () => {
    assert.equal(ask("Total spend at Tesla?", files).a.text, "No record in the files mentions “Tesla”.");
    assert.equal(ask("What is Elon Musk's email?", files).a.text, "No record in the files mentions “Elon Musk”.");
  });

  it("answers a three-part brief in one pass with exact values", () => {
    const brief =
      "Which female Helios Dynamics staff reporting to Jonah Hale use a lumina.test email? Then total Apple Pay spend on or after 2026-03-03 excluding subscriptions. Then the public IP.";
    const { a } = ask(brief, files);
    assert.match(a.text, /Ava Meridian — .*email address: ava\.meridian@lumina\.test/);
    assert.match(a.text, /Total spend: \$189\.00 across 1 transaction\./);
    assert.match(a.text, /203\.0\.113\.44/);
  });

  it("answers the median from the dollar amounts only", () => {
    assert.match(ask("What's the median amount?", files).a.text, /Median amount: \$62\.10 across 7 rows\./);
  });
});

describe("values: numbers, dates and order are read the way people write them", () => {
  it("reads currency, separators, brackets and magnitudes", () => {
    assert.equal(parseNum("$1,200.50", "auto")?.n, 1200.5);
    assert.equal(parseNum("1.234,56", "eu")?.n, 1234.56);
    assert.equal(parseNum("(45.00)", "auto")?.n, -45);
    assert.equal(parseNum("5k", "auto", true)?.n, 5000);
    assert.equal(parseNum("₹1,00,000", "auto")?.n, 100000);
    assert.equal(parseNum("0.42 ETH", "auto"), null, "a crypto amount is not dollars");
  });

  it("reads ISO, slashed and spelled dates, with times and offsets", () => {
    assert.equal(fmtDate(parseDate("2026-05-01T00:00:00")!.t, true), "2026-05-01 00:00");
    assert.equal(fmtDate(parseDate("05/01/2026")!.t), "2026-05-01");
    assert.equal(fmtDate(parseDate("Oct 5, 2026")!.t), "2026-10-05");
    assert.equal(fmtDate(parseDate("2026-05-01T10:00:00+05:30")!.t, true), "2026-05-01 04:30");
    assert.equal(parseDate("2026-02-30"), null);
  });

  it("decides day-first or month-first from the evidence in the column", () => {
    assert.deepEqual(inferDateOrder(["13/02/2026", "03/04/2026"]), { order: "dmy", ambiguous: false });
    assert.equal(inferDateOrder(["01/02/2026"]).ambiguous, true);
  });
});

describe("scale: a 40,000-row ledger stays exact and quick", () => {
  it("sums to the cent and answers several questions without lag", () => {
    const lines = ["txn_id,employee_id,merchant,amount,payment_method,ts,kind"];
    let cents = 0n;
    for (let i = 0; i < 40_000; i += 1) {
      const c = (i * 37) % 10_000;
      cents += BigInt(c);
      const day = String(1 + (i % 28)).padStart(2, "0");
      lines.push(`T-${100_000 + i},E-${100 + (i % 500)},Shop ${i % 40},${(c / 100).toFixed(2)},${i % 3 === 0 ? "Visa" : "Apple Pay"},2026-04-${day} 10:00,charge`);
    }
    const text = lines.join("\n");
    const started = Date.now();
    const file = parseFileText("big_ledger.csv", text.length, text);
    const report = extractFromFiles([file], "fast");
    const questions = [
      "What's the total amount?",
      "What's the average amount?",
      "Top 3 shops by total amount",
      "What percentage of transactions are over $50?",
      "How many transactions were in April?",
    ];
    const answers = questions.map((q) => answerQuestion(q, report, true).text);
    const elapsed = Date.now() - started;

    const dollars = cents / 100n;
    const rest = (cents % 100n).toString().padStart(2, "0");
    const grouped = dollars.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    assert.match(answers[0]!, new RegExp(`Total amount: \\$${grouped}\\.${rest} across 40000 rows\\.`));
    assert.ok(elapsed < 20_000, `five answers over 40,000 rows took ${elapsed} ms`);
  });
});
