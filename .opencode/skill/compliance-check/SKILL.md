---
name: compliance-check
description: Use this when reviewing accounting treatments for compliance with GAAP, IFRS, or regulatory requirements — rev rec, leases, impairment, stock comp, and other technical standards.
---

## Use this when

The user asks you to verify whether a transaction, journal entry, or accounting policy complies with applicable standards. Common triggers: revenue recognition questions, lease classification, asset impairment testing, stock-based compensation measurement, new standard adoption, or general "is this GAAP-compliant?" inquiries.

## Workflow

1. **Identify the applicable framework.** Ask or confirm: US GAAP, IFRS, or local statutory. Never assume — the treatment often differs.
2. **Pull ledger data.** Use `pennylane_ledger_accounts_list` to identify relevant accounts. Use `pennylane_ledger_entries_list` with date filters to retrieve the entries under review. Use `pennylane_fiscal_years_list` to confirm the reporting period boundaries.
3. **Map to the authoritative standard.**
   - Revenue: ASC 606 / IFRS 15 — apply the five-step model (identify contract, identify performance obligations, determine transaction price, allocate price, recognize on satisfaction).
   - Leases: ASC 842 / IFRS 16 — classify as finance vs operating (GAAP) or single-model right-of-use (IFRS). Check discount rate, lease term including renewal options, and variable payments.
   - Impairment: ASC 350/360 / IAS 36 — determine the unit of account, identify triggering events, compare carrying amount to fair value (GAAP) or recoverable amount (IFRS).
   - Stock comp: ASC 718 / IFRS 2 — measure grant-date fair value, determine classification (equity vs liability), recognize over requisite service period.
   - Other: identify the specific ASC topic or IAS/IFRS standard before proceeding.
4. **Evaluate the current treatment** against the standard's recognition, measurement, presentation, and disclosure requirements.
5. **Classify each finding** as: (a) non-compliant — must correct, (b) aggressive but defensible — document rationale, (c) compliant, or (d) insufficient information to conclude.
6. **Draft output** in the required format below.

## Accounting Judgment

- Default to the conservative position. If two treatments are defensible, prefer the one that results in later revenue recognition or earlier expense recognition.
- Distinguish mandatory requirements ("shall") from guidance ("should consider") and best practice (no authoritative basis).
- When GAAP and IFRS diverge, state both treatments explicitly; never blend them.
- Materiality is not a license to ignore standards. A misstatement below materiality still requires correction if it is intentional or shifts a trend.
- For principles-based standards (IFRS especially), document the economic substance supporting the chosen treatment.

## Output Format

```
CONCLUSION: [Compliant / Non-compliant / Insufficient information]
TREATMENT: [Current treatment applied] → [Required treatment under <standard>]
RISKS: [Restatement risk, audit adjustment, regulatory penalty, or disclosure gap]
MISSING INFO: [Data or judgments still needed to finalize]
NEXT ACTION: [Correct entry / Prepare memo / Engage external advisor / No action required]
```

Always cite the specific standard paragraph (e.g., ASC 606-10-25-27, IFRS 15.35) when referencing a requirement.

## Edge Cases

- **Multi-element arrangements (bundled contracts):** Allocate transaction price using standalone selling prices. If observable prices are unavailable, use adjusted market approach or expected cost plus margin. Never use the residual method unless criteria in ASC 606-10-32-34 are met.
- **Modification vs new contract:** Assess whether remaining goods/services are distinct and whether pricing reflects standalone selling price. A failed modification test means cumulative catch-up, not prospective treatment.
- **Embedded leases:** Service contracts may contain a lease component under ASC 842-10-15. Check whether the contract conveys the right to control an identified asset.
- **Triggering events for impairment:** A decline in market cap below book value is a triggering event, not an automatic write-down. The quantitative test must still be performed.
- **Award modifications (stock comp):** Compare fair value immediately before and after modification. Incremental compensation cost is recognized over the remaining service period.

## Guardrails

- Never issue a final compliance opinion. State findings as "assessment based on information provided" and recommend external review for material or complex items.
- Do not fabricate standard references. If you are uncertain of the precise paragraph, say so and recommend the user verify.
- Flag any item where the applicable standard was updated after your knowledge cutoff and recommend checking the FASB/IASB codification directly.
- If the user's jurisdiction has local GAAP that overrides IFRS (e.g., French PCG, German HGB), note that your analysis covers IFRS/US GAAP only and local statutory compliance requires specialist review.
- Refuse to advise on structuring transactions to avoid a particular accounting outcome. The role is to assess compliance, not to engineer treatments.
