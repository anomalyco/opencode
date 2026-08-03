# Standard Product Inventory Date and Remark Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Safely synchronize the latest 10-column standard workbook while preserving inventory date and source remark evidence and exposing their approved combined remark.

**Architecture:** Extend the existing strict workbook parser and versioned standard-product schema without changing the Feishu answer interface. Store `inventoryDate`, `sourceRemark`, and the derived `remark`; apply and validate the derived value through the existing protected Product/view path.

**Tech Stack:** Bun 1.3, TypeScript, Bun test, Python 3.11/openpyxl, mysql2, MySQL 8.4, OpenSpec.

## Global Constraints

- Target only `t1_full_20260717_133707` on `127.0.0.1:13310` after identity and writable-state checks.
- Accept only the exact 10-column header and preserve 10,572 unique non-empty product rows.
- Join non-empty trimmed `盘点日期` and source `备注` with `；`; never parse or reformat dates.
- Never modify `Storage`, product keys, hierarchy, purchase history, or non-approved Product fields.
- Apply requires exact Preview guards and must roll back on any failed invariant.
- Run tests, typecheck, and lint from `packages/feishu`, never the repository root.

---

### Task 1: Parser and evidence contract

**Files:**
- Modify: `packages/feishu/test/standard-product-sync.test.ts`
- Modify: `packages/feishu/src/standard-product-sync.ts`

**Interfaces:**
- Consumes: raw rows with `盘点日期` at index 5 and source `备注` at index 9.
- Produces: `StandardProductRow.inventoryDate`, `StandardProductRow.sourceRemark`, and existing `StandardProductRow.remark` as the derived display value.

- [ ] **Step 1: Write failing parser tests**

Add an exact 10-column fixture and assert `inventoryDate: "2019-05-21"`, `sourceRemark: "来货；白字"`, and `remark: "2019-05-21；来货；白字"`. Add separate cases for date-only, remark-only, and both blank.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `bun test test/standard-product-sync.test.ts -t "inventory date|approved columns"`

Expected: FAIL because the current parser rejects the 10-column header or does not expose the new evidence fields.

- [ ] **Step 3: Implement the minimal parser change**

Insert `盘点日期` into `STANDARD_PRODUCT_HEADERS`, shift shelf/specification/model/remark indexes, trim both raw values with `optionalText`, and set `remark` from `[inventoryDate, sourceRemark].filter(...) .join("；") || null` without date conversion.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `bun test test/standard-product-sync.test.ts -t "inventory date|approved columns"`

Expected: all selected tests pass.

### Task 2: Additive schema and transaction path

**Files:**
- Modify: `packages/feishu/test/standard-product-sync.test.ts`
- Modify: `packages/feishu/src/standard-product-sync.ts`
- Modify: `packages/feishu/README.md`

**Interfaces:**
- Consumes: `StandardProductRow.inventoryDate`, `sourceRemark`, and derived `remark`.
- Produces: nullable `erp_standard_product.inventory_date`, `source_remark`, and existing `remark`, with unchanged `vw_standard_inventory_product.remark` contract.

- [ ] **Step 1: Write failing SQL planner tests**

Assert setup additively handles both evidence columns, staging SQL names and parameterizes all three values, Product update still touches only the five approved fields, and validation compares `Product.u_Remark` to derived `standard.remark`.

- [ ] **Step 2: Run the SQL tests and verify RED**

Run: `bun test test/standard-product-sync.test.ts -t "staging|setup|apply never"`

Expected: FAIL because current DDL and staging omit the two evidence columns.

- [ ] **Step 3: Implement the minimal schema/staging change**

Add nullable columns to new-table DDL plus idempotent `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` statements for existing deployments. Stage raw inventory date, raw source remark, and derived remark while leaving views, backups, rollback, and protected Storage behavior intact.

- [ ] **Step 4: Update operator documentation and verify GREEN**

Document the latest workbook and merge rule in `packages/feishu/README.md`, then run `bun test test/standard-product-sync.test.ts test/readme.test.ts`, `bun typecheck`, and `bun run lint` from `packages/feishu`.

Expected: zero failures, type errors, lint warnings, or errors.

### Task 3: Preview, apply, validate, and rollout

**Files:**
- Modify only through the tested CLI: target MySQL authoritative/audit objects and approved Product/shelf rows.
- No source workbook or `Storage` rows are modified.

**Interfaces:**
- Consumes: `D:\opencode\商品信息8.3_结构化清洗.xlsx` and launcher-derived controlled MySQL configuration.
- Produces: one new validated active run and a restarted gateway using it.

- [ ] **Step 1: Run write-free Preview**

Run `bun run standard-product:preview --workbook "D:\opencode\商品信息8.3_结构化清洗.xlsx"` and capture the SHA-256, 10,572 rows, mapping counts, active run, differences, shelf count, and Storage fingerprint. Require `databaseWrites: 0`.

- [ ] **Step 2: Apply with exact guards**

Run `standard-product:apply` with the exact Preview hash, row count, `MATCHED`/`MISSING`/`AMBIGUOUS` counts, and active run. Require a committed run ID and unchanged Storage fingerprint.

- [ ] **Step 3: Validate database equality**

Run `standard-product:validate --run-id <new-run-id>` and require exact standard rows, mapping rows, raw/derived remarks, matched Product fields, shelves, one active run, and the Preview Storage fingerprint.

- [ ] **Step 4: Verify and restart**

Run the enabled MySQL contract, full `bun test`, `bun typecheck`, `bun run lint`, strict OpenSpec validation, and `git diff --check`. Restart only the verified gateway launcher/process pair and confirm a fresh ready event, empty new stderr, and representative authoritative replies including `6001ZZ`.
