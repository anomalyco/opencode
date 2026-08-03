# Feishu Purchase Supplier Fallback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Return each migrated product's actual latest reliable purchase supplier when structured supplier-source stock is absent, while preserving structured-source precedence, current inventory totals, actual remarks, identifier-free text, and native Feishu mentions.

**Architecture:** Add a narrow `PurchaseSupplierRow` input at the inventory mapper boundary. The MySQL adapter performs one fixed parameterized lookup over the already-selected product IDs, selects one reliable latest purchase supplier per product, and passes those rows beside products, shelves, and structured sources. Startup preflight and trace template versions move to `mysql-inventory-v2`; formatting and Feishu delivery remain unchanged.

**Tech Stack:** TypeScript, Bun test runner, `mysql2/promise@3.14.4`, MySQL 8.4 window functions, OpenSpec.

## Global Constraints

- Structured `erp_inventory_source_projection` supplier rows always override purchase history and keep their `on_hand_qty`.
- Purchase fallback requires `MasterBill.BillState=3`, `MasterBill.s_Syb=0`, positive `ListBuy.Prod_Number`, and non-empty `Units.u_Name`.
- Select one fallback per product by `BillDate DESC`, `AutoID DESC`, then `List_ID DESC`.
- A purchase fallback displays the product's current total `SUM(Storage.Prod_Number1)`, not the historical purchase quantity.
- Omit the supplier when neither structured source nor reliable purchase fallback exists; never hard-code `上海涂众轴承`.
- Never expose product IDs, product codes, supplier IDs, bill IDs, warehouse IDs, SQL, tables, or credentials in the answer.
- Keep plain-text one-result-per-line formatting and actual per-item `Product.u_Remark` unchanged.
- Run tests and `bun typecheck` only from `packages/feishu`.

---

### Task 1: Mapper fallback and precedence

**Files:**
- Modify: `packages/feishu/test/inventory-mapper.test.ts`
- Modify: `packages/feishu/src/inventory-mapper.ts`
- Modify: `openspec/changes/mysql-inventory-query/tasks.md`

**Interfaces:**
- Consumes: existing `ProductRow`, `ShelfRow`, `InventorySourceRow`, and `mapInventoryRows(...)`.
- Produces: `PurchaseSupplierRow = { productID: string; supplierName: string }` and `mapInventoryRows({ products, shelves, sources, purchaseSuppliers })`.

- [x] **Step 1: Write failing mapper tests**

Add a `purchaseSuppliers` row for `6001ZZ` and assert the supplier is combined with current total inventory:

```ts
expect(
  formatInventoryAnswer(
    mapInventoryRows({
      products: [product],
      shelves: [],
      sources: [],
      purchaseSuppliers: [{ productID: "2694", supplierName: "天宇轴承" }],
    }),
  ),
).toBe("6001ZZ（清油）（12×28×8）天宇轴承库存200，备注：xxx")
```

Add a second assertion with an active structured source and the fallback together; expect only the structured supplier and its source quantity. Update existing calls to pass `purchaseSuppliers: []`.

- [x] **Step 2: Run the mapper test and verify RED**

Run: `bun test test/inventory-mapper.test.ts`

Expected: TypeScript/test failure because `purchaseSuppliers` is not accepted or ignored and the fallback supplier is absent.

- [x] **Step 3: Implement the minimal mapper behavior**

Add:

```ts
export type PurchaseSupplierRow = {
  productID: string
  supplierName: string
}
```

Validate each fallback row with `requiredText`. When `attributed.length === 0`, select the one fallback matching `product.productID` and return `{ ...base, supplier, inventory }`; otherwise preserve the current attributed-source mapping. The adapter guarantees at most one fallback row per product.

- [x] **Step 4: Run focused tests and verify GREEN**

Run: `bun test test/inventory-mapper.test.ts test/inventory-answer.test.ts`

Expected: PASS; output contains the actual fallback supplier, structured sources still win, and `JSON.stringify(items)` contains no internal product ID.

- [x] **Step 5: Mark OpenSpec tasks 8.1 and 8.2 complete**

Change only those two checkboxes in `openspec/changes/mysql-inventory-query/tasks.md`.

### Task 2: Fixed purchase query and adapter mapping

**Files:**
- Modify: `packages/feishu/test/mysql-inventory.test.ts`
- Modify: `packages/feishu/src/mysql-inventory.ts`
- Modify: `openspec/changes/mysql-inventory-query/tasks.md`

**Interfaces:**
- Consumes: `PurchaseSupplierRow` from Task 1 and the existing injected `QueryExecutor`.
- Produces: a fourth fixed query, strict `purchaseSupplierRows(...)`, and query events with `templateVersion: "mysql-inventory-v2"`.

- [x] **Step 1: Write failing adapter tests**

Add a fourth executor response after products, shelves, and structured sources:

```ts
[{ product_id: "2694", supplier_name: "天宇轴承" }]
```

Assert the final item contains `supplier: "天宇轴承"`, there are four calls, and the fourth SQL includes:

```text
FROM ListBuy AS purchase
JOIN MasterBill AS bill ON bill.AutoID = purchase.Bill_ID
JOIN Units AS supplier ON supplier.s_ID = bill.Unit_ID
bill.BillState = 3
bill.s_Syb = 0
purchase.Prod_Number > 0
ROW_NUMBER() OVER
ORDER BY bill.BillDate DESC, bill.AutoID DESC, purchase.List_ID DESC
```

Assert the fourth values are `['[2694]']`, malformed `supplier_name` fails the whole query, and events use `mysql-inventory-v2`.

- [x] **Step 2: Run the adapter test and verify RED**

Run: `bun test test/mysql-inventory.test.ts`

Expected: FAIL because only three queries run and events still report `mysql-inventory-v1`.

- [x] **Step 3: Implement the fixed query and strict row mapping**

Add a `purchaseSupplierSQL` CTE that joins selected product IDs through `ListBuy`, `MasterBill`, and `Units`, filters the four reliability conditions, ranks each product with `ROW_NUMBER()`, and returns only `rank_no = 1`. Query shelves, structured sources, and purchase fallbacks together with `Promise.all`, parse `product_id` and `supplier_name` with `requiredString`, and call:

```ts
mapInventoryRows({ products, shelves, sources, purchaseSuppliers })
```

Bump all `InventoryQueryEvent.templateVersion` literals to `mysql-inventory-v2` and include fallback rows in `rowCount`.

- [x] **Step 4: Run adapter and mapper tests and verify GREEN**

Run: `bun test test/mysql-inventory.test.ts test/inventory-mapper.test.ts`

Expected: PASS with four fixed prepared reads for non-empty results and one read for empty results.

- [x] **Step 5: Mark OpenSpec tasks 8.3 and 8.4 complete**

Change only those two checkboxes in `openspec/changes/mysql-inventory-query/tasks.md`.

### Task 3: Preflight, trace version, and documentation consistency

**Files:**
- Modify: `packages/feishu/test/mysql-preflight.test.ts`
- Modify: `packages/feishu/src/mysql-preflight.ts`
- Modify: `packages/feishu/test/inventory-trace.test.ts`
- Modify: `packages/feishu/test/inventory-eval.test.ts`
- Modify: `packages/feishu/test/fixtures/inventory-gold.json`
- Modify: any other `packages/feishu` test fixture that asserts `mysql-inventory-v1`
- Modify: `packages/feishu/README.md`
- Modify: `openspec/changes/mysql-inventory-query/tasks.md`

**Interfaces:**
- Consumes: the existing `runMysqlPreflight(...)`, trace event schema, and gold fixtures.
- Produces: `MysqlPreflight.contractVersion: "mysql-inventory-v2"` and strict presence/type checks for the fallback schema.

- [x] **Step 1: Write failing preflight tests**

Extend the compatible column fixture with the exact `ListBuy`, `MasterBill`, and `Units` columns from the approved spec, expect `contractVersion: "mysql-inventory-v2"`, and add a missing-`Units.u_Name` failure case.

- [x] **Step 2: Run preflight tests and verify RED**

Run: `bun test test/mysql-preflight.test.ts`

Expected: FAIL because the current preflight neither requests the fallback tables nor returns v2.

- [x] **Step 3: Implement the v2 preflight contract**

Add `ListBuy`, `MasterBill`, and `Units` to `columnsSQL`, add exact type/nullability/table-kind expectations to `requiredColumns`, and update the returned contract version to `mysql-inventory-v2`.

- [x] **Step 4: Update trace and gold fixtures**

Replace version assertions and fixture values from `mysql-inventory-v1` to `mysql-inventory-v2`. Update README supplier semantics to state structured-source precedence and latest reliable purchase fallback without promising supplier-specific current stock.

- [x] **Step 5: Run focused compatibility tests and verify GREEN**

Run: `bun test test/mysql-preflight.test.ts test/inventory-trace.test.ts test/inventory-eval.test.ts test/readme.test.ts`

Expected: PASS; schema drift fails closed and all trace/gold records use v2.

- [x] **Step 6: Mark OpenSpec tasks 8.5 and 8.6 complete**

Change only those two checkboxes in `openspec/changes/mysql-inventory-query/tasks.md`.

### Task 4: Live contract, full verification, and gateway restart

**Files:**
- Modify: `packages/feishu/test/mysql-inventory.contract.test.ts` only if the live assertions need the approved supplier fallback fields.
- Modify: `openspec/changes/mysql-inventory-query/tasks.md`
- Runtime only: `%LOCALAPPDATA%\OpenCode\FeishuGateway\start-gateway.ps1`

**Interfaces:**
- Consumes: completed v2 adapter and the existing password-file configuration.
- Produces: live read evidence, clean verification output, and a fresh running gateway process.

- [x] **Step 1: Run the explicit live read-only contract check**

Set the existing local contract environment without printing the password or its path and run `bun run test:mysql-contract` from `packages/feishu`. Confirm the visible `6001ZZ` current-total `177` result uses `虎旺轴承` and the `清油` current-total `200` result uses `天宇轴承`; do not record internal IDs.

- [x] **Step 2: Mark OpenSpec task 8.7 complete**

Change only checkbox 8.7 after the live assertions pass.

- [x] **Step 3: Run complete package verification**

Run separately from `packages/feishu`:

```powershell
bun test
bun typecheck
bunx oxlint src test
```

Expected: all tests pass, typecheck succeeds, and lint reports zero warnings or errors.

- [x] **Step 4: Run repository and OpenSpec verification**

Run separately from `D:\opencode`:

```powershell
openspec-cn validate mysql-inventory-query --type change --strict --json
openspec-cn validate feishu-chat-gateway --type change --strict --json
git diff --check
git status --short
```

Expected: both changes validate, whitespace checks pass, and unrelated user changes remain untouched.

- [x] **Step 5: Restart and verify the gateway safely**

Resolve and inspect the exact current launcher/gateway process pair, stop only those PIDs, run the existing `start-gateway.ps1`, and verify a new parent-child pair plus one fresh `ws client ready` line and no errors after that line. Do not kill by broad process name.

- [x] **Step 6: Mark OpenSpec task 8.8 complete**

Change checkbox 8.8 only after verification and restart evidence is fresh.
