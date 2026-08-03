# Standard Product Synchronization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Synchronize the approved 10,560-row workbook into a reversible authoritative MySQL product dataset, safely correct mapped legacy Product fields and shelf relations, and make Feishu inventory answers read the authoritative supplier and shelves.

**Architecture:** A Python read-only bridge converts XLSX cells to JSON; a tested TypeScript module validates and reconciles rows, stages a versioned run, backs up and updates only approved legacy fields and shelf relations in one transaction, and exposes active-run views. The Feishu reader switches from legacy Product plus purchase-supplier fallback to the authoritative views while retaining live Storage totals for mapped rows.

**Tech Stack:** Bun 1.3, TypeScript, `mysql2/promise@3.14.4`, Python 3.11 with `openpyxl@3.1.5`, MySQL 8.4, Bun test, OpenSpec.

## Global Constraints

- Target schema is exactly `t1_full_20260717_133707` on MySQL 8.4.x; verify `DATABASE()`, `VERSION()`, `CURRENT_USER()`, and `@@read_only` before writes.
- The authoritative workbook headers are exactly `原始行号`, `商品编码`, `商品名称`, `产地`, `数量`, `货架号`, `规格`, `型号`, `备注` and the approved file currently has 10,560 unique non-empty codes.
- Workbook `规格` maps to `Product.ProdType`; workbook `型号` maps to `Product.ProdSpec`; workbook blanks clear only the five approved Product display fields.
- Never modify `Storage`, purchase bills, `Units`, product keys, `s_ParentID`, or any non-approved Product field.
- Missing and unresolved duplicate legacy products remain authoritative-only; never invent `s_ParentID` or update multiple Product candidates.
- Every Apply and Rollback write/high-risk invariant must validate at 100%; failure blocks robot cutover.
- Tests and `bun typecheck` run from `packages/feishu`, never the repository root.

---

### Task 1: Workbook contract and deterministic reconciliation

**Files:**
- Create: `packages/feishu/test/standard-product-sync.test.ts`
- Create: `packages/feishu/src/standard-product-sync.ts`
- Create: `packages/feishu/scripts/read-standard-product-workbook.py`

**Interfaces:**
- Consumes: raw worksheet rows emitted as JSON by the Python bridge and legacy Product/shelf candidates from MySQL.
- Produces: `STANDARD_PRODUCT_HEADERS`, `StandardProductRow`, `LegacyProductCandidate`, `StandardProductMapping`, `normalizeStandardProductRows(rows)`, `reconcileStandardProducts(rows, candidates)`.

- [ ] **Step 1: Write failing workbook contract tests**

```ts
import { describe, expect, test } from "bun:test"
import {
  normalizeStandardProductRows,
  reconcileStandardProducts,
} from "../src/standard-product-sync"

test("maps approved columns and normalizes shelves", () => {
  const rows = normalizeStandardProductRows([
    ["原始行号", "商品编码", "商品名称", "产地", "数量", "货架号", "规格", "型号", "备注"],
    [13, "001011", "6001ZZ", "虎旺", 363, "A-1-4+A-1-1", null, "12*28*8", null],
  ])
  expect(rows[0]).toEqual({
    sourceRow: 2,
    originalRow: "13",
    code: "001011",
    name: "6001ZZ",
    origin: "虎旺",
    workbookQuantity: "363",
    shelves: ["A-1-1", "A-1-4"],
    specification: null,
    model: "12*28*8",
    remark: null,
    shelfText: "A-1-4+A-1-1",
  })
})

test("rejects duplicate codes and invalid shelves", () => {
  expect(() => normalizeStandardProductRows([
    ["原始行号", "商品编码", "商品名称", "产地", "数量", "货架号", "规格", "型号", "备注"],
    [1, "X", "A", "厂", 1, "A-1-1", null, null, null],
    [2, " X ", "B", "厂", 1, "not-a-shelf", null, null, null],
  ])).toThrow()
})
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `bun test test/standard-product-sync.test.ts` from `packages/feishu`
Expected: FAIL because `../src/standard-product-sync` cannot be resolved.

- [ ] **Step 3: Implement the minimal row types, normalization, and reconciliation**

```ts
export const STANDARD_PRODUCT_HEADERS = [
  "原始行号", "商品编码", "商品名称", "产地", "数量", "货架号", "规格", "型号", "备注",
] as const

export type StandardProductRow = {
  sourceRow: number
  originalRow: string
  code: string
  name: string
  origin: string
  workbookQuantity: string
  shelves: string[]
  specification: string | null
  model: string | null
  remark: string | null
  shelfText: string
}

export type StandardProductMapping = {
  row: StandardProductRow
  status: "MATCHED" | "MISSING" | "AMBIGUOUS"
  productID?: number
  candidateProductIDs: number[]
}
```

Implement strict headers, trimmed codes/text, decimal normalization, A-D three-part shelf extraction with complete-input consumption, sorted unique shelves, authoritative nulls, and deterministic candidate selection. One code candidate maps; multiple candidates map only if one candidate exactly matches approved name, origin, cleaned display fields, remark, and shelf set.

- [ ] **Step 4: Add the XLSX bridge**

```py
from hashlib import sha256
from json import dump
from pathlib import Path
from sys import argv, stdout
from openpyxl import load_workbook

path = Path(argv[1]).resolve(strict=True)
workbook = load_workbook(path, read_only=True, data_only=True)
sheet = workbook["清洗结果"]
dump({
    "fileName": path.name,
    "sha256": sha256(path.read_bytes()).hexdigest(),
    "rows": [[cell for cell in row] for row in sheet.iter_rows(values_only=True)],
}, stdout, ensure_ascii=False, default=str)
```

- [ ] **Step 5: Run tests and typecheck for GREEN**

Run: `bun test test/standard-product-sync.test.ts && bun typecheck` from `packages/feishu`
Expected: all focused tests pass and typecheck exits 0.

### Task 2: Versioned schema, transaction planner, and rollback

**Files:**
- Modify: `packages/feishu/src/standard-product-sync.ts`
- Modify: `packages/feishu/test/standard-product-sync.test.ts`
- Create: `packages/feishu/scripts/standard-product-sync.ts`
- Modify: `packages/feishu/package.json`
- Modify: `packages/feishu/README.md`

**Interfaces:**
- Consumes: `MysqlConfig`, a validated workbook payload, expected workbook hash/counts, and an injected `StandardProductConnection` with query/transaction methods.
- Produces: `previewStandardProductSync`, `applyStandardProductSync`, `validateStandardProductSync`, `rollbackStandardProductSync`, and CLI modes `Preview|Apply|Validate|Rollback`.

- [ ] **Step 1: Write failing planner and safety tests**

```ts
test("apply plan never writes Storage or unapproved Product columns", () => {
  const statements = standardProductApplyStatements()
  expect(statements.some((sql) => /UPDATE\s+Storage|INSERT\s+INTO\s+Storage/i.test(sql))).toBeFalse()
  expect(statements.filter((sql) => /UPDATE\s+Product/i.test(sql))).toHaveLength(1)
  expect(statements.find((sql) => /UPDATE\s+Product/i.test(sql))).toMatch(
    /u_Name.*ProdArea.*ProdType.*ProdSpec.*u_Remark/s,
  )
})

test("transaction failure rolls back and never activates the run", async () => {
  const connection = recordingConnection({ failOn: "replace_shelves" })
  await expect(applyStandardProductSync(input, connection)).rejects.toThrow("replace_shelves")
  expect(connection.events).toContain("rollback")
  expect(connection.events).not.toContain("activate_run")
})
```

- [ ] **Step 2: Verify RED**

Run: `bun test test/standard-product-sync.test.ts -t "apply plan|transaction failure"` from `packages/feishu`
Expected: FAIL because the planner/executor exports do not exist.

- [ ] **Step 3: Implement idempotent setup objects and views**

Create explicit DDL statements for:

```text
erp_standard_product_sync_run
erp_standard_product
erp_standard_product_shelf
erp_standard_product_map
erp_standard_product_backup
erp_standard_shelf_relation_backup
erp_standard_shelf_evidence_backup
vw_standard_inventory_product
vw_standard_product_shelf
```

The active inventory view joins the single `APPLIED` run, its standard rows and mapping, a grouped Storage total for mapped Product IDs, and uses workbook quantity only when mapping is absent. All table identifiers are fixed constants; workbook values use parameters.

- [ ] **Step 4: Implement bounded Apply and Rollback transactions**

Apply sequence: lock active run, assert expected hash/counts, insert run/products/shelves/mappings in bounded batches, back up matched Product fields and shelf relation/evidence rows, update only five Product columns, replace only mapped shelf evidence/relations, activate new run, supersede previous run, run in-transaction counts, commit. Rollback restores backups and prior run status in reverse order and commits only after exact assertions.

- [ ] **Step 5: Implement CLI argument and secret handling**

The CLI requires `--mode`, `--workbook` for Preview/Apply, `--expected-sha256` and `--expected-row-count` for Apply, and `--run-id` for Validate/Rollback. It uses `parseMysqlConfig`/`loadMysqlPassword`, never prints the password file or connection string, and emits one sanitized JSON report.

- [ ] **Step 6: Verify GREEN and documentation**

Run: `bun test test/standard-product-sync.test.ts test/readme.test.ts && bun typecheck` from `packages/feishu`
Expected: all tests pass, typecheck exits 0, and README documents Preview-before-Apply plus rollback.

### Task 3: Live Preview, Apply, Validate, and rollback proof

**Files:**
- Modify only through the tested CLI: target MySQL authoritative/audit objects and approved Product/shelf rows.
- No repository file is written by Preview; JSON reports go to the configured local runtime report directory.

**Interfaces:**
- Consumes: `D:\opencode\商品信息(1)_结构化清洗.xlsx`, gateway MySQL configuration, controlled password file.
- Produces: sanitized Preview/Apply/Validate/Rollback reports and one active authoritative run.

- [ ] **Step 1: Run Preview and capture exact guards**

Run from `packages/feishu` with launcher-derived environment:

```powershell
bun run standard-product:preview -- --workbook "D:\opencode\商品信息(1)_结构化清洗.xlsx"
```

Expected: 10,560 unique rows, MySQL 8.4/schema identity, mapping counts, field/shelf differences, Storage fingerprint, workbook SHA-256, and `databaseWrites: 0`.

- [ ] **Step 2: Run Apply with Preview guards**

```powershell
$preview = bun run standard-product:preview -- --workbook "D:\opencode\商品信息(1)_结构化清洗.xlsx" | ConvertFrom-Json
$applyRun = bun run standard-product:apply -- --workbook "D:\opencode\商品信息(1)_结构化清洗.xlsx" --expected-sha256 $preview.workbook.sha256 --expected-row-count $preview.workbook.rowCount | ConvertFrom-Json
```

Expected: one committed run ID, complete backup counts, bounded Product updates, shelf replacements, one active run, and unchanged Storage fingerprint.

- [ ] **Step 3: Validate exact database state**

```powershell
bun run standard-product:validate -- --run-id $applyRun.runId
```

Expected: 10,560 authoritative rows, zero duplicate standard codes, exact active-view fields and shelves, exact mapped Product fields, zero shelf orphans/duplicates, unchanged Storage, and `validationPass: true`.

- [ ] **Step 4: Prove rollback on a reversible validation run**

Apply a second identical run, validate it, rollback that second run, validate restoration of the first run, then leave the first approved run active. Never rollback the only approved run without a previous active run.

### Task 4: Switch the Feishu reader to authoritative views

**Files:**
- Modify: `packages/feishu/test/mysql-inventory.test.ts`
- Modify: `packages/feishu/test/mysql-preflight.test.ts`
- Modify: `packages/feishu/test/inventory-mapper.test.ts`
- Modify: `packages/feishu/test/mysql-inventory.contract.test.ts`
- Modify: `packages/feishu/test/fixtures/inventory-gold.json`
- Modify: `packages/feishu/src/mysql-inventory.ts`
- Modify: `packages/feishu/src/mysql-preflight.ts`
- Modify: `packages/feishu/src/inventory-mapper.ts`

**Interfaces:**
- Consumes: `vw_standard_inventory_product` and `vw_standard_product_shelf`.
- Produces: existing identifier-free `InventoryAnswerItem[]` and unchanged one-line formatter contract.

- [ ] **Step 1: Write RED query and supplier tests**

Assert the product SQL selects authoritative name/specification/model/remark/origin/inventory, shelf SQL uses standard product identity, supplier comes from origin, and no SQL contains `ListBuy`, `MasterBill`, `Units`, `erp_inventory_source_projection`, or `erp_partner_overlay`.

- [ ] **Step 2: Verify RED**

Run: `bun test test/mysql-inventory.test.ts test/mysql-preflight.test.ts test/inventory-mapper.test.ts` from `packages/feishu`
Expected: FAIL because production still uses Product and purchase fallback queries.

- [ ] **Step 3: Implement the minimal authoritative query path**

Use one product query and one shelf query. Map `origin` directly to `supplier`, standard `specification` to attribute, standard `model` to normalized size, and the projection quantity to inventory. Remove purchase/source fallback row types and runtime queries.

- [ ] **Step 4: Verify focused and contract tests**

Run: `bun test test/mysql-inventory.test.ts test/mysql-preflight.test.ts test/inventory-mapper.test.ts test/mysql-inventory.contract.test.ts` from `packages/feishu`
Expected: all tests pass; the explicit contract case for `001011` returns `虎旺`, `A-1-1` and `A-1-4`, and no internal code is formatted.

### Task 5: Full verification and rollout

**Files:**
- Modify: `openspec/changes/standard-product-sync/tasks.md` checkboxes only as each verified task completes.

**Interfaces:**
- Consumes: completed database run and authoritative Feishu code.
- Produces: fresh verification evidence and a restarted gateway.

- [ ] **Step 1: Run package verification**

Run from `packages/feishu`:

```powershell
bun test
bun typecheck
bun run lint
```

Expected: zero failures, zero type errors, zero lint errors/warnings.

- [ ] **Step 2: Run repository and OpenSpec verification**

Run from `D:\opencode`:

```powershell
openspec-cn validate standard-product-sync --type change --strict --json
git diff --check
```

Expected: valid change, exit code 0, no whitespace errors. Then run the `openspec-verify-change` workflow and compare every requirement to test/database evidence.

- [ ] **Step 3: Restart and smoke-test the gateway**

Stop only the verified gateway launcher/process pair, start `C:\Users\Administrator\AppData\Local\OpenCode\FeishuGateway\start-gateway.ps1` hidden, wait for a fresh WebSocket-ready event, verify no post-ready stderr, then query `6001ZZ` in Feishu. Expected lines use approved standard fields, supplier, shelf relations, live-or-workbook inventory, no product code, and ordinary group reply delivery.
