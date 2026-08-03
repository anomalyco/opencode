## Context

The approved workbook `商品信息(1)_结构化清洗.xlsx` contains 10,560 non-empty rows with unique product codes and normalized A-D three-part shelf codes. The live MySQL 8.4 schema `t1_full_20260717_133707` contains 10,958 `Product` rows, 106 approved codes are absent, 65 approved codes resolve to multiple legacy rows, and 411 non-empty legacy code groups plus seven blank-code rows are outside the workbook. Among the 10,389 one-to-one code matches, 1,120 shelf sets and 30 `ProdArea` supplier/origin values differ.

The legacy `Product` table has 97 columns and requires `s_ParentID`, which the workbook does not contain. Creating the 106 missing rows directly in `Product` would therefore invent hierarchy data. The workbook's display fields are also structurally cleaned: workbook `规格` maps to legacy `Product.ProdType`, workbook `型号` maps to `Product.ProdSpec`, and shelves no longer belong in either text field.

The current Feishu inventory reader queries `Product`, `Storage`, `vw_productshelflocation`, and a latest-purchase supplier fallback. That fallback is semantically wrong because the approved supplier is the workbook `产地` value.

## Goals / Non-Goals

**Goals:**

- Store every approved workbook row and shelf relation in MySQL as a versioned authoritative dataset.
- Safely overwrite the approved display fields of every uniquely mapped legacy `Product` row and replace its structured shelf relations.
- Preserve complete before-state evidence and provide deterministic rollback by `run_id`.
- Exclude database-only legacy rows from robot results without deleting them.
- Serve all approved workbook products through one authoritative read view, using live `Storage` inventory when a unique legacy product mapping exists and the workbook quantity only when no live mapping exists.
- Make workbook supplier/origin the only supplier display source and keep `Storage` unchanged.
- Require 100% validation for every write, mapping decision, and rollback invariant.

**Non-Goals:**

- Updating `Storage`, purchase history, `Units`, or any SQL Server/T1 source.
- Guessing `Product.s_ParentID` or inserting incomplete legacy `Product` rows.
- Deleting database-only products or automatically merging duplicate legacy rows.
- Treating workbook quantity as supplier-attributed stock.

## Decisions

### 1. Add a versioned authoritative product dataset

Create `erp_standard_product_sync_run`, `erp_standard_product`, `erp_standard_product_shelf`, and `erp_standard_product_map`. A run stores the workbook file name, SHA-256, exact headers, row count, status, previous active run, timestamps, and validation result. Product rows use `(run_id, source_row)` identity and require one unique normalized `product_code` per run. Shelf rows use normalized `A-<n>-<n>` through `D-<n>-<n>` codes.

Alternative considered: update `Product` directly from Excel without staging. This cannot represent missing rows safely, cannot explain duplicate codes, and provides no durable source/version boundary.

### 2. Map legacy products conservatively

One legacy row with the normalized code maps automatically. Multiple legacy rows map only when exactly one candidate is selected by deterministic comparison of approved name, origin, cleaned specification/model, remark, and existing shelves; otherwise the row remains `AMBIGUOUS`. No legacy row produces `MISSING`. Candidate evidence is stored for review. A mapping may never be guessed from row order or inventory quantity.

Alternative considered: update every row sharing the code. That can corrupt distinct products because `Product.u_Code` is not a unique key.

### 3. Overwrite only approved legacy display fields

For `MATCHED` mappings, synchronize `u_Name`, `ProdArea`, `ProdType`, `ProdSpec`, and `u_Remark`. Workbook blank cells are authoritative and become SQL `NULL`. Mapping is intentionally `规格 -> ProdType` and `型号 -> ProdSpec`, matching the observed legacy data semantics. `u_Code`, `s_ID`, `s_ParentID`, the other 90 legacy columns, and all `Storage` rows remain unchanged.

Before updates, store the complete old values in `erp_standard_product_backup`. Do not insert missing `Product` rows because the workbook lacks the required legacy hierarchy field.

### 4. Replace mapped shelf relations from the workbook

For each `MATCHED` product, back up existing `ProductShelfLocation` and `ProductShelfLocationEvidence`, delete only that product's existing relations/evidence, then insert the workbook shelf set. Evidence uses `source_field=StandardWorkbook`, the source shelf cell, source row, workbook hash, and run ID. Existing shared `ShelfLocation` dictionary rows may be reused; unused dictionary rows are retained.

Alternative considered: continue extracting shelves from `ProdSpec` and `ProdType`. Those fields contain stale shelf tokens and produced the observed 1,120 differences.

### 5. Use an authoritative query projection

Create `vw_standard_inventory_product` and `vw_standard_product_shelf` over the single active applied run. The inventory view exposes the standard product identity and fields, optional mapped `Product.s_ID`, live `SUM(Storage.Prod_Number1)` for mapped rows, and workbook quantity only for unmapped rows. Database-only legacy products do not appear.

The Feishu adapter queries this projection, obtains shelves from the standard shelf view, and maps supplier from `origin`. It no longer queries `erp_inventory_source_projection`, `erp_partner_overlay`, `ListBuy`, `MasterBill`, or `Units` for supplier display.

### 6. Separate DDL setup from transactional apply

Idempotent setup creates only the new authoritative/audit objects and views. Apply then runs one DML transaction: lock the active-run row, stage and validate the new run, back up affected legacy values and shelf records, update matched products, replace mapped shelf relations, activate the run, and mark the previous run superseded. Any error rolls back the whole DML transaction.

### 7. Make rollback and evidence first-class

Rollback requires an applied `run_id`, restores backed-up legacy fields and shelf relations, marks the run rolled back, and reactivates its recorded previous run in one transaction. Reports and database audit rows contain counts, sanitized object names, hashes, mapping statuses, and validation outcomes, never credentials or complete connection strings.

## Risks / Trade-offs

- [The workbook cannot create complete legacy Product rows] -> Keep all rows in the authoritative dataset, do not invent `s_ParentID`, and use workbook quantity for unmapped rows.
- [Duplicate codes can represent distinct products] -> Block ambiguous mapping and keep candidate evidence; the authoritative dataset still preserves the approved row once.
- [Blank approved cells erase legacy display text] -> Treat blanks as authoritative only for the five approved display fields, after database-side backup.
- [Replacing shelf relations invalidates old extraction evidence] -> Back up evidence and write explicit `StandardWorkbook` evidence for every replacement.
- [A newer workbook may arrive] -> Require a new hash/run and exact preview; never edit an applied run in place.
- [The live MySQL account is writable] -> Restrict the utility to named tables, parameterized statements, expected affected-row bounds, transaction checks, and explicit modes.

## Migration Plan

1. Verify MySQL identity, version, schema, writable state, Product schema, shelf objects, and source workbook hash/header/row uniqueness.
2. Run Preview to populate no tables and emit exact missing, ambiguous, extra, field, and shelf differences.
3. Run idempotent setup for authoritative, mapping, backup, and audit objects.
4. Apply one versioned run only when all invariants and affected-row bounds pass.
5. Validate all 10,560 authoritative rows, unique codes, shelf equality, mapping statuses, Product field equality for mapped rows, unchanged Storage fingerprint/counts, query projections, and rollback evidence at 100%.
6. Switch and test the Feishu reader, then restart the gateway only after database and package verification pass.
7. If validation or robot acceptance fails, rollback by the same `run_id`, revalidate the restored state, and keep the failed run evidence.

## Open Questions

None. The approved workbook is authoritative, workbook blanks clear approved display fields, missing legacy rows remain canonical-only because their required hierarchy is unavailable, and inventory is never written.
