## Why

The live MySQL product data must follow the latest business-approved workbook `商品信息8.3_结构化清洗.xlsx`: authoritative products, shelf relations, supplier/origin values, inventory dates, and remarks must all match that version before the robot can return reliable results.

## What Changes

- Add a versioned, reversible MySQL synchronization workflow that stages and validates the authoritative workbook before any business table is changed.
- Back up every affected product field and product-shelf relation under one `run_id`, then transactionally synchronize product name, supplier/origin, cleaned specification, cleaned model, and remark while leaving `Storage` inventory untouched.
- Replace each safely matched product's structured shelf relations with the normalized A-D three-part shelf codes from the workbook.
- Admit the latest exact 10-column contract, preserve `盘点日期` and source `备注` separately, and derive the single robot remark by joining their non-empty values with `；` in that order.
- Require explicit reconciliation for duplicate product codes, create approved missing products only when all required `Product` fields can be populated safely, and keep database-only legacy products out of the robot's authoritative query projection without deleting them.
- Validate exact workbook-to-database equality for authoritative product identity, supplier/origin, cleaned display fields, remarks, and shelves; write operations and rollback checks must pass 100%.
- **BREAKING**: Remove latest-purchase supplier fallback from inventory answers. The approved workbook `产地` value, synchronized to the authoritative product projection, is the only supplier display source; blank values are omitted.

## Capabilities

### New Capabilities

- `standard-product-sync`: Versioned workbook staging, identity reconciliation, protected MySQL synchronization, structured shelf replacement, audit evidence, rollback, and exact validation.

### Modified Capabilities

- `mysql-inventory-read`: Product lookup reads only the authoritative synchronized product projection, uses its supplier/origin value, uses synchronized shelf relations, keeps live `Storage` inventory, and never falls back to purchase history for supplier display.

## Impact

- Adds a tested migration utility and audit artifacts for `Product`, `ShelfLocation`, `ProductShelfLocation`, `ProductShelfLocationEvidence`, and the authoritative product query projection in schema `t1_full_20260717_133707`.
- Does not modify `Storage`, purchase bills, suppliers in `Units`, or historical T1/SQL Server sources.
- Changes `packages/feishu` MySQL query/preflight/mapping tests and removes runtime dependency on `ListBuy`, `MasterBill`, and `Units` for supplier display.
- Records source workbook identity, run identity, row counts, raw inventory-date and remark evidence, derived display remark, field-level before/after evidence, transaction outcome, validation, and rollback outcome without logging credentials or connection strings.
