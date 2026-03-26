---
name: vat-gst
description: Use this when handling VAT, GST, or sales tax — calculations, returns, reconciliations, or compliance checks.
---

## Use this when

The user asks about value-added tax, goods and services tax, or sales tax — including rate application, input/output reconciliation, return preparation, reverse charge mechanics, cross-border supplies, or error correction. Also triggered by questions about exempt vs zero-rated supplies, registration thresholds, or indirect tax compliance.

## Workflow

1. **Establish jurisdiction.** Always confirm the country, and where applicable the sub-national region (e.g., US state, Canadian province, Indian state for SGST). The entire analysis depends on jurisdiction — never proceed without it.
2. **Identify the tax type.**
   - **VAT (EU, UK, etc.):** Multi-stage tax on value added; businesses reclaim input VAT against output VAT. Governed by EU VAT Directive (2006/112/EC) or local transposition.
   - **GST (Australia, India, Canada, NZ, Singapore):** Functionally similar to VAT. India's GST has CGST/SGST/IGST layers. Canada has GST + provincial HST/PST.
   - **Sales tax (US):** Single-stage tax at point of sale to end consumer. No input credit mechanism. Nexus-based — presence in a state triggers obligation (post-Wayfair economic nexus).
3. **Pull transaction data.** Use `pennylane_transactions_list` with date range and supplier/customer filters to extract invoices. Identify: (a) taxable amount, (b) tax rate applied, (c) tax amount, (d) supply type (goods vs services), (e) counterparty location.
4. **Verify rate correctness.** Cross-check the applied rate against the current statutory rate for the supply type and jurisdiction. Common EU standard rates: France 20%, Germany 19%, Netherlands 21%, Spain 21%. Reduced rates apply to specific categories (food, books, medical — varies by country).
5. **Classify each supply.**
   - **Taxable at standard rate:** Default for most goods and services.
   - **Reduced rate:** Specific goods/services listed in national legislation.
   - **Zero-rated:** Taxable but at 0% — input VAT is still recoverable (e.g., exports, intra-community supplies with valid VAT ID).
   - **Exempt:** Not subject to VAT — input VAT is NOT recoverable (e.g., financial services, insurance, medical services in most EU states). This distinction is critical for input tax recovery.
6. **Apply reverse charge where required.** For B2B cross-border services (EU: Art. 196 VAT Directive), the recipient self-assesses output VAT and simultaneously claims input VAT (net zero if fully taxable). Verify the supplier did not charge VAT on the invoice — if they did, it is not deductible.
7. **Reconcile for the return period.** Output VAT collected minus input VAT deductible = net VAT payable (or refundable). Tie to `pennylane_ledger_entries_list` VAT control accounts. Any difference must be investigated — common causes: timing differences on cash-basis schemes, partial exemption adjustments, bad debt relief.
8. **Draft output.**

## Accounting Judgment

- **Exempt vs zero-rated is not cosmetic.** Exempt supplies block input VAT recovery on related costs. Partially exempt businesses must perform a partial exemption calculation (typically pro-rata based on taxable vs total supplies). Getting this wrong creates an irrecoverable cost.
- **Place of supply rules govern who taxes the transaction.** For services, the default B2B rule is customer location; B2C is supplier location. Exceptions exist for immovable property (location of property), transport, events, and electronic services.
- **VAT invoicing requirements are strict.** Missing or incorrect VAT numbers, wrong rates, or missing reverse charge language can invalidate input tax recovery. Always verify invoice completeness.
- **US sales tax has no input credit mechanism.** Overpaid sales tax requires a refund claim to the state, not an offset. Resale certificates must be on file before the transaction, not after.
- **Bad debt relief:** In most VAT jurisdictions, if a customer does not pay, the supplier can reclaim the output VAT after a defined period (6 months UK, varies by country). The customer must repay their input VAT claim.

## Output Format

```
CONCLUSION: [Compliant / Error identified / Insufficient data to verify]
TREATMENT:
  Jurisdiction: [Country / State]
  Tax type: [VAT / GST / Sales tax]
  Period: [Return period]
  Output tax: [Amount at each rate]
  Input tax (deductible): [Amount]
  Reverse charge self-assessed: [Amount, if applicable]
  Net payable (refundable): [Amount]
RISKS: [Wrong rate applied, missing reverse charge, partial exemption error, late filing penalty, invalid invoice]
MISSING INFO: [Counterparty VAT ID, supply classification, place of supply confirmation, exemption certificates]
NEXT ACTION: [Correct invoice / Adjust return / File voluntary disclosure / No action required]
```

## Edge Cases

- **Triangulation (EU):** In a chain A (country 1) → B (country 2) → C (country 3), the intermediary B can use the simplification under Art. 141 to avoid registering in country 3. All three parties must be VAT-registered in different member states, and the invoice must reference the simplification.
- **Mixed supplies and composite vs multiple supply:** A single transaction with taxable and exempt elements must be analyzed — is it one composite supply taxed at the rate of the principal element, or multiple supplies each taxed separately? The answer determines input VAT recovery.
- **Import VAT / postponed accounting:** Some jurisdictions allow import VAT to be accounted for on the VAT return rather than paid at the border (UK postponed VAT accounting, EU customs procedure 42). Verify the scheme is elected and entries are correct.
- **Digital services (MOSS/OSS):** B2C digital services are taxed in the customer's EU member state. The One-Stop Shop simplification avoids registration in every member state but requires correct rate application per destination country.
- **Credit notes and corrections:** A credit note must reference the original invoice. Under-declared VAT typically requires a voluntary disclosure to the tax authority; over-declared VAT is corrected on the next return (rules vary by jurisdiction).

## Guardrails

- Always state the jurisdiction before giving any rate or rule. VAT rules are never universal.
- Do not file or submit returns. Prepare the data and reconciliation; the user or their advisor files.
- If a cross-border transaction involves a jurisdiction outside your knowledge, flag it for specialist review rather than guessing the rate or rule.
- Never advise on VAT structuring or avoidance schemes. Identify the correct treatment for the actual transaction.
- Penalties for VAT errors can be severe (EU: up to 100% of underpaid tax in some member states). When in doubt, recommend voluntary disclosure over waiting for an audit.
- US sales tax nexus analysis (physical and economic thresholds) requires state-by-state evaluation. Do not generalize — flag for review if multi-state exposure is possible.
