# Feishu purchase supplier fallback design

## Context

The Feishu inventory reply already omits internal product codes, formats one answer item per physical line, preserves actual remarks, and uses native group mentions. Live verification on 2026-08-03 exposed one remaining mismatch: migrated products such as `6001ZZ` have no rows in the new structured supplier-source tables, so the current implementation omits every supplier even though the migrated purchase ledger contains actual supplier names.

Read-only inspection confirmed that `ListBuy.Prod_ID` associates a product with `MasterBill`, while `MasterBill.Unit_ID` resolves the actual supplier name in `Units`. It also confirmed that the literal `上海涂众轴承` is not present in the live supplier data and must remain only a formatting example. The presentation view `b_vw_master` exposes equivalent fields but joins many unrelated display tables and exceeded 20 seconds for 20 matched products; the direct structured-table query completed in about 85 milliseconds.

## Approved behavior

Supplier selection has two levels:

1. An active structured inventory source in `erp_inventory_source_projection` joined to an enabled, non-deleted supplier in `erp_partner_overlay` remains authoritative. Its source-specific quantity is displayed, and no purchase fallback is added.
2. If no active structured supplier source exists, select the same product's latest reliable migrated purchase supplier. A reliable row is approved (`MasterBill.BillState=3`), not red-letter (`MasterBill.s_Syb=0`), has a positive purchase quantity, and has a non-empty `Units.u_Name`. Select exactly one row by purchase date descending, bill ID descending, then line ID descending. Display that supplier beside the product's current total inventory from `Storage`.

If neither source is reliable, omit the supplier. Never substitute a fixed example or infer a supplier from names, remarks, or free text.

The fallback identifies the latest actual supplier used for the product; it does not claim that all current stock is traceably owned by that supplier. Historical purchases cannot reconstruct remaining supplier-specific quantities after sales, returns, and adjustments.

## Data flow

The MySQL adapter keeps the existing product, shelf, and structured-source reads and adds one fixed parameterized purchase-supplier read limited to the already selected product IDs. The adapter converts the result to an identifier-free fallback object containing only the internal match key and supplier name. The mapper uses that key only to combine rows, then emits the existing `InventoryAnswerItem` without IDs.

The deterministic formatter and Feishu delivery path remain unchanged. Each result is still one plain-text physical line, multiple results are joined with `\n`, group replies use a native mention, and direct replies do not mention a requester. Feishu's collapsed topic preview may visually flatten those newlines, but the sent and stored message body retains them.

## Failure behavior

The startup schema preflight must require the exact purchase tables/views and columns. Any missing or incompatible dependency fails closed. Malformed purchase rows fail the complete inventory query instead of producing a partial answer. Database errors remain sanitized, and no password, connection string, internal product ID, bill ID, supplier ID, or query implementation detail is returned to Feishu.

## Testing

Tests will first fail against the current implementation, then cover:

- fallback supplier with current product total;
- structured source precedence over purchase history;
- rejection of unapproved, red-letter, non-positive, or unnamed purchase rows by the SQL template;
- deterministic latest-row selection;
- omission when no reliable supplier exists;
- strict schema preflight and query-template versioning;
- identifier-free final formatting and actual per-item remarks;
- a live read-only contract check for the observed `6001ZZ` rows;
- full package tests, type checking, lint, OpenSpec validation, and a safe gateway restart.
