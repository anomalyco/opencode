# Standard Product Synchronization Design

The business-approved workbook `商品信息(1)_结构化清洗.xlsx` is the authoritative source for product name, supplier/origin, cleaned specification, cleaned model, remark, and shelf locations. The migration stores the complete workbook as a versioned MySQL dataset, safely overwrites those five display fields for legacy products that map to one proven `Product.s_ID`, and replaces their structured shelf relations. `Storage` inventory is never modified.

The workbook cannot safely create the 106 missing legacy `Product` rows because `Product` has 97 columns and requires `s_ParentID`, which the workbook does not provide. Those products therefore remain fully represented in the authoritative dataset and query projection, while missing or ambiguous legacy mappings use the workbook quantity. Database-only legacy products remain untouched but are excluded from robot results.

Apply is run-scoped and reversible: stage and validate the workbook, store complete Product and shelf before-state evidence, perform bounded DML in one transaction, activate the new run, then require exact 100% validation. Rollback restores the backed-up fields and shelf records and reactivates the previous run. Credentials and complete connection strings never enter reports.

The Feishu reader switches to the authoritative product and shelf projections. Supplier display comes only from workbook `产地`; the existing latest-purchase supplier fallback is removed. Live inventory is retained for mapped products, and the workbook quantity is used only when no unique legacy identity exists.
