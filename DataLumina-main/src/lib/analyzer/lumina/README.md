# DataLumina engine (on-device)

Answers questions about uploaded tables and text files. It runs entirely in the browser:
no network call, no model, no API key. Every number comes from the files.

## What it does

- **Reads every row** a file contains (up to the 8 MB upload limit; 200,000 rows per file).
  If a file is ever cut short, the answer says so.
- **Cleans and types each column**: money (currency symbols, `1.234,56`, `(45.00)`, `5k`),
  dates (ISO, `05/01/2026` with day/month order inferred from the column, `Oct 5, 2026`,
  Unix times, Excel serials), yes/no flags, categories with spelling variants merged
  (`F`, `female`, `Woman`), names (`Park, Mina` is shown as `Mina Park`), emails, IPs, IDs.
- **Drops rows that are not data**: blank rows, repeated header rows, note lines, summary
  rows (`Total`, `Grand total`), exact duplicates, and rows whose ID breaks the file's ID
  pattern (for example `subscription` or `credit_limit` sitting in a transaction table).
  Each of these is counted and reported.
- **Joins tables** through shared IDs (`employee_id`) or matching names, including chains
  (roster → ledger → devices).
- **Computes exactly**: sums, averages, medians and percentages use decimal arithmetic, so a
  total is correct to the cent.

## Questions it understands

| Kind | Examples |
| --- | --- |
| Totals and averages | `What's the total Visa spend?` · `Average amount per merchant` · `median amount` |
| Counts | `How many transactions are over $50?` · `How many people were born before 1990?` |
| Shares | `What percentage of Visa spend is over $50?` (population = the Visa spend) |
| Filters | `female staff in Orbital Finance`, `excluding refunds and subscriptions`, `over $25`, `between $10 and $90`, `on or after 2026-05-01`, `in April`, `before 1990`, `ends in .corp`, `use a lumina.test email` |
| People and reporting lines | `Who reports to Sora Venn?` (direct) · `Who is under Mina Park?` (whole chain) |
| Lookups | `What is Ava Meridian's email?` · `What is Jules's public IP?` (first names match) |
| Groups and rankings | `Spend by employee` · `Group people by employer` · `Top 3 merchants by spend` · `Who has the most transactions?` |
| Largest or smallest row | `What's the largest Visa transaction and who made it?` |
| Comparisons | `Compare Amelia Rourke and Jules Park` · `Compare the two people named Alex Kim` |
| Multi-part | `…? Then total Apple Pay spend… Then the public IP.` · `…, and what is their public IP?` |

Words such as `those`, `them`, `their` and `the public IP` refer to the people from the
previous part.

## Guarantees

- A name, merchant or ID that is not in the files produces `No record in the files mentions “X”.`
  Nothing is guessed.
- Amounts in another currency (`0.42 ETH`) are never added to dollars; the answer says how
  many were left out.
- Every answer carries a **Basis** note listing the filters used, and a short list of data
  quality findings (for example an employee ID that matches no roster row).
- Defaults for spend questions: balances, limits, deposits, refunds and reversals are not
  charges. A question that names one of them (for example `holdings`) includes it.

## Limits

- Relations need a shared key (`employee_id`) or matching names. If the files cannot link
  two tables, the answer says so instead of guessing.
- Questions outside this grammar are answered by the category report, which says what it
  could not interpret.
- The category report scans the first 2,400 rows per file and the first 2 MB of text for
  its heuristic findings. Question answers use all rows.

## Files

- `values.ts`: parsing and formatting for numbers, dates, booleans, names and exact decimals.
- `table.ts`: builds typed tables, the cleaning log, duplicate and summary detection, and
  join keys between tables.
- `query.ts`: reads a question, grounds each term in the data, runs the plan and writes the answer.
- `index.ts`: links each report to its workbook (built on the first question, not on upload).
- `lumina.test.ts`: behaviour tests with values checked by hand against the samples.

## Tests

```
node --experimental-strip-types --test src/lib/analyzer/engine.test.ts src/lib/analyzer/lumina/lumina.test.ts
```
