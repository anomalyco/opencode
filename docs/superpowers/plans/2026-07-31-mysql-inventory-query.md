# MySQL Inventory Query Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a trusted, MySQL-only inventory and shelf-location query that returns deterministic identifier-free text such as `6001ZZ（清油）（12×28×8）（货架号：B-11-13）上海涂众轴承库存200，备注：xxx`.

**Architecture:** A focused `packages/feishu` module owns the identifier-free answer type, row mapper, fixed MySQL `SELECT` templates, trusted service boundary, trace events, and release evaluation. Internal IDs are used only inside the adapter; the formatter receives a type that cannot represent product codes or database keys and its output is sent verbatim without a model rewrite. After the base gateway exists, a confidence-gated trusted route recognizes inventory/location questions before OpenCode, invokes the fixed service directly, and leaves the `feishu-chat` Agent at zero tools/default deny.

**Tech Stack:** Bun 1.3.14, TypeScript, Bun test, `mysql2/promise@3.14.4`, `@typescript/native-preview`, oxlint, OpenSpec

## Global Constraints

- Runtime data source is only the migrated MySQL schema; do not add a SQL Server driver, T1 connection setting, query, health check, or fallback branch.
- Preserve `T1临时业务库与全链路逐句日志说明.md` and `T1服务器排查与只读连接记录.md` unchanged as historical documents.
- Use only fixed, versioned, prepared `SELECT` templates. Never accept model-authored SQL or expose a generic query method through the trusted service.
- Calculate product inventory as `SUM(Storage.Prod_Number1)` grouped by `Product.s_ID`.
- Read shelves only from `vw_productshelflocation`; never infer a shelf from `Product.u_Remark`.
- Resolve supplier stock only through `erp_inventory_source_projection` and an enabled, non-deleted `erp_partner_overlay` row with role `SUPPLIER`; otherwise omit the supplier and display total product inventory.
- Do not put `Product.s_ID`, `Product.u_Code`, `SP000...`, supplier IDs, warehouse IDs, or other internal keys in `InventoryAnswerItem`.
- Final output is plain text with one product/supplier result per physical line and exactly one newline between results. Do not add a table, heading, bullet, numbering, preamble, summary, match count, explanation, or closing question.
- The inventory fragment is exactly `<supplier>库存<quantity>` or `库存<quantity>`; never output `来货`, `数量`, or `未归属`.
- The exact complete-answer acceptance string is `6001ZZ（清油）（12×28×8）（货架号：B-11-13）上海涂众轴承库存200，备注：xxx`.
- Missing product terms perform no database query and return one concise clarification. Empty matches return exactly `未找到相关商品。`.
- Query failures return one sanitized sentence and no partial business result.
- Read gold cases must reach at least 95% at every reported layer; policy, write-blocking, and secret-exclusion cases must pass 100%.
- Run tests and `bun typecheck` from `packages/feishu`, never from the repository root.
- Do not overwrite the existing ignored `packages/feishu/.env.local`.

---

## File Map and Interface Boundaries

| File | Responsibility |
| --- | --- |
| `packages/feishu/package.json` | Package scripts and pinned MySQL dependency |
| `packages/feishu/tsconfig.json` | Bun/TypeScript package settings |
| `packages/feishu/src/inventory-answer.ts` | Identifier-free answer contract and deterministic formatter |
| `packages/feishu/src/inventory-mapper.ts` | Runtime validation and mapping of database-shaped rows |
| `packages/feishu/src/mysql-config.ts` | Non-secret MySQL settings and controlled password-file loading |
| `packages/feishu/src/mysql-preflight.ts` | MySQL identity/schema contract validation |
| `packages/feishu/src/mysql-inventory.ts` | Pool lifecycle and fixed prepared inventory reads |
| `packages/feishu/src/inventory-tool.ts` | Trusted Feishu admission and fixed inventory service result contract |
| `packages/feishu/src/inventory-route.ts` | Confidence-gated inventory/location intent and pre-model dispatch |
| `packages/feishu/src/inventory-trace.ts` | Sanitized append-only inventory event envelopes |
| `packages/feishu/src/inventory-eval.ts` | Four-layer accuracy and policy release gate |
| `packages/feishu/test/fixtures/inventory-gold.json` | Versioned intent/query/result/answer acceptance cases |
| `.opencode/agent/feishu-chat.md` | Remain zero-tool/default-deny after inventory integration |
| `packages/feishu/src/worker.ts` | Offer admitted tasks to the trusted pre-model route and deliver handled text verbatim |
| `packages/feishu/src/gateway.ts` | Compose the adapter, trusted inventory route, trace sink, and worker |
| `packages/feishu/src/index.ts` | Startup preflight and disposal |

Core signatures used throughout the plan:

```ts
export type InventoryAnswerItem = {
  name: string
  attribute?: string
  size?: string
  shelves: string[]
  supplier?: string
  inventory?: string
  remark?: string
}

export function formatInventoryAnswer(items: readonly InventoryAnswerItem[]): string

export type QueryExecutor = (
  sql: string,
  values?: readonly unknown[],
) => Promise<readonly Record<string, unknown>[]>

export type MysqlInventory = {
  preflight: MysqlPreflight
  query(term: string, limit?: number): Promise<InventoryAnswerItem[]>
  close(): Promise<void>
}
```

### Task 1: Package Boundary and Deterministic Answer Formatter

**Files:**

- Create: `packages/feishu/package.json`
- Create: `packages/feishu/tsconfig.json`
- Create: `packages/feishu/src/inventory-answer.ts`
- Create: `packages/feishu/test/inventory-answer.test.ts`

**Interfaces:**

- Consumes: no runtime code; only the approved answer contract in `openspec/changes/mysql-inventory-query/specs/inventory-answer-format/spec.md`
- Produces: `InventoryAnswerItem` and `formatInventoryAnswer(items: readonly InventoryAnswerItem[]): string`

- [ ] **Step 1: Create the package skeleton without touching `.env.local`**

Create `packages/feishu/package.json`:

```json
{
  "name": "@opencode-ai/feishu",
  "version": "1.18.4",
  "type": "module",
  "license": "MIT",
  "scripts": {
    "test": "bun test",
    "test:mysql-contract": "bun test test/mysql-inventory.contract.test.ts",
    "typecheck": "tsgo --noEmit",
    "lint": "oxlint src test"
  },
  "dependencies": {
    "mysql2": "3.14.4"
  },
  "devDependencies": {
    "@types/node": "catalog:",
    "typescript": "catalog:",
    "@typescript/native-preview": "catalog:"
  }
}
```

Create `packages/feishu/tsconfig.json`:

```json
{
  "$schema": "https://json.schemastore.org/tsconfig",
  "extends": "@tsconfig/bun/tsconfig.json",
  "compilerOptions": {
    "lib": ["ESNext", "DOM", "DOM.Iterable"],
    "noUncheckedIndexedAccess": false
  }
}
```

Run from `D:\opencode`:

```powershell
bun install
```

Expected: `bun.lock` contains `mysql2@3.14.4`, and `packages/feishu/.env.local` remains unchanged.

- [ ] **Step 2: Write the formatter tests before its implementation**

Create `packages/feishu/test/inventory-answer.test.ts`:

```ts
import { describe, expect, test } from "bun:test"
import {
  formatInventoryAnswer,
  type InventoryAnswerItem,
} from "../src/inventory-answer"

describe("formatInventoryAnswer", () => {
  test("renders the approved complete sentence exactly", () => {
    expect(
      formatInventoryAnswer([
        {
          name: "6001ZZ",
          attribute: "清油",
          size: "12*28*8",
          shelves: ["B-11-13"],
          supplier: "上海涂众轴承",
          inventory: "200",
          remark: "xxx",
        },
      ]),
    ).toBe(
      "6001ZZ（清油）（12×28×8）（货架号：B-11-13）上海涂众轴承库存200，备注：xxx",
    )
  })

  test("omits missing optional fields and unattributed wording", () => {
    expect(
      formatInventoryAnswer([
        {
          name: "6001ZZ",
          shelves: [],
          inventory: "200",
        },
      ]),
    ).toBe("6001ZZ库存200")
  })

  test("keeps one result per line and normalizes shelves and remarks", () => {
    expect(
      formatInventoryAnswer([
        {
          name: "6001ZZ",
          size: "12X28x8",
          shelves: ["B-11-13", "B-11-2", "B-11-13"],
          inventory: "200",
          remark: "第一行\r\n第二行",
        },
        {
          name: "6201",
          shelves: [],
          inventory: "8",
        },
      ]),
    ).toBe(
      "6001ZZ（12×28×8）（货架号：B-11-13、B-11-2）库存200，备注：第一行 第二行\n6201库存8",
    )
  })

  test("ignores extra internal fields at runtime", () => {
    const item = {
      name: "6001ZZ",
      shelves: [],
      inventory: "200",
      productID: "2694",
      u_Code: "SP0000005943",
    } as InventoryAnswerItem & {
      productID: string
      u_Code: string
    }

    expect(formatInventoryAnswer([item])).toBe("6001ZZ库存200")
  })

  test("returns the fixed no-result sentence", () => {
    expect(formatInventoryAnswer([])).toBe("未找到相关商品。")
  })
})
```

- [ ] **Step 3: Run the formatter test and confirm the red state**

Run from `D:\opencode\packages\feishu`:

```powershell
bun test test/inventory-answer.test.ts
```

Expected: FAIL because `../src/inventory-answer` does not exist.

- [ ] **Step 4: Implement the smallest formatter that satisfies the contract**

Create `packages/feishu/src/inventory-answer.ts`:

```ts
export type InventoryAnswerItem = {
  name: string
  attribute?: string
  size?: string
  shelves: string[]
  supplier?: string
  inventory?: string
  remark?: string
}

export function formatInventoryAnswer(
  items: readonly InventoryAnswerItem[],
) {
  if (items.length === 0) return "未找到相关商品。"

  return items
    .map((item) => {
      const name = clean(item.name)
      const attribute = clean(item.attribute)
      const size = clean(item.size)?.replace(/[*xX]/g, "×")
      const shelves = [
        ...new Set(item.shelves.map(clean).filter((value) => value !== undefined)),
      ]
      const supplier = clean(item.supplier)
      const inventory = clean(item.inventory)
      const remark = clean(item.remark)

      return [
        name,
        attribute ? `（${attribute}）` : "",
        size ? `（${size}）` : "",
        shelves.length > 0 ? `（货架号：${shelves.join("、")}）` : "",
        inventory ? `${supplier ?? ""}库存${inventory}` : "",
        remark ? `，备注：${remark}` : "",
      ].join("")
    })
    .join("\n")
}

function clean(value: string | undefined) {
  const result = value?.replace(/\r\n|\r|\n/g, " ").trim()
  return result ? result : undefined
}
```

- [ ] **Step 5: Run formatter tests and type checking**

Run from `D:\opencode\packages\feishu`:

```powershell
bun test test/inventory-answer.test.ts
bun typecheck
```

Expected: all five tests pass and type checking succeeds.

- [ ] **Step 6: Commit only the package skeleton and formatter**

Run from `D:\opencode`:

```powershell
git add packages/feishu/package.json packages/feishu/tsconfig.json packages/feishu/src/inventory-answer.ts packages/feishu/test/inventory-answer.test.ts bun.lock
git commit -m "feat(feishu): format inventory answers"
```

Expected: the ignored `.env.local`, historical T1 documents, and unrelated existing changes are not staged.

### Task 2: Inventory Row Validation and Mapping

**Files:**

- Create: `packages/feishu/src/inventory-mapper.ts`
- Create: `packages/feishu/test/inventory-mapper.test.ts`

**Interfaces:**

- Consumes: `InventoryAnswerItem` from `packages/feishu/src/inventory-answer.ts`
- Produces:

```ts
export type ProductRow = {
  productID: string
  name: string | null
  spec: string | null
  attribute: string | null
  remark: string | null
  totalInventory: string
}

export type ShelfRow = {
  productID: string
  shelfCode: string
}

export type InventorySourceRow = {
  productID: string
  sourceRefKind: string
  sourceRefID: string
  onHandQty: string
  supplierID: string | null
  supplierLegacyID: string | null
  supplierName: string | null
  supplierRole: string | null
  supplierEnabled: number | null
  supplierDeleted: number | null
}

export function mapInventoryRows(input: {
  products: readonly ProductRow[]
  shelves: readonly ShelfRow[]
  sources: readonly InventorySourceRow[]
}): InventoryAnswerItem[]
```

- [ ] **Step 1: Add database-shaped mapping tests**

Create `packages/feishu/test/inventory-mapper.test.ts`:

```ts
import { describe, expect, test } from "bun:test"
import { formatInventoryAnswer } from "../src/inventory-answer"
import {
  mapInventoryRows,
  type InventorySourceRow,
  type ProductRow,
} from "../src/inventory-mapper"

const product: ProductRow = {
  productID: "2694",
  name: "6001ZZ",
  spec: "轴承 12*28*8",
  attribute: "清油",
  remark: "xxx",
  totalInventory: "200.00000000",
}

describe("mapInventoryRows", () => {
  test("maps the observed 6001ZZ row without an internal identifier", () => {
    const items = mapInventoryRows({
      products: [product],
      shelves: [
        { productID: "2694", shelfCode: "B-11-13" },
        { productID: "2694", shelfCode: "B-11-13" },
      ],
      sources: [],
    })

    expect(items).toEqual([
      {
        name: "6001ZZ",
        attribute: "清油",
        size: "12×28×8",
        shelves: ["B-11-13"],
        inventory: "200",
        remark: "xxx",
      },
    ])
    expect(JSON.stringify(items)).not.toContain("2694")
  })

  test("emits one deterministic item per active supplier source", () => {
    const sources: InventorySourceRow[] = [
      {
        productID: "2694",
        sourceRefKind: "ERP",
        sourceRefID: "supplier-b",
        onHandQty: "70.000000",
        supplierID: "supplier-b",
        supplierLegacyID: null,
        supplierName: "乙供应商",
        supplierRole: "SUPPLIER",
        supplierEnabled: 1,
        supplierDeleted: 0,
      },
      {
        productID: "2694",
        sourceRefKind: "ERP",
        sourceRefID: "supplier-a",
        onHandQty: "130.000000",
        supplierID: "supplier-a",
        supplierLegacyID: null,
        supplierName: "甲供应商",
        supplierRole: "SUPPLIER",
        supplierEnabled: 1,
        supplierDeleted: 0,
      },
    ]

    expect(
      mapInventoryRows({ products: [product], shelves: [], sources }).map(
        (item) => `${item.supplier}:${item.inventory}`,
      ),
    ).toEqual(["甲供应商:130", "乙供应商:70"])
  })

  test("falls back to product total for unattributed or inactive sources", () => {
    const sources: InventorySourceRow[] = [
      {
        productID: "2694",
        sourceRefKind: "UNATTRIBUTED",
        sourceRefID: "UNATTRIBUTED",
        onHandQty: "200.000000",
        supplierID: null,
        supplierLegacyID: null,
        supplierName: null,
        supplierRole: null,
        supplierEnabled: null,
        supplierDeleted: null,
      },
      {
        productID: "2694",
        sourceRefKind: "ERP",
        sourceRefID: "deleted-supplier",
        onHandQty: "200.000000",
        supplierID: "deleted-supplier",
        supplierLegacyID: null,
        supplierName: "不可用供应商",
        supplierRole: "SUPPLIER",
        supplierEnabled: 0,
        supplierDeleted: 1,
      },
    ]

    expect(
      formatInventoryAnswer(
        mapInventoryRows({ products: [product], shelves: [], sources }),
      ),
    ).toBe("6001ZZ（清油）（12×28×8）库存200，备注：xxx")
  })

  test("does not treat a shelf-only attribute or remark as another field", () => {
    expect(
      mapInventoryRows({
        products: [
          {
            ...product,
            attribute: "B-11-13、B-11-2",
            remark: "2024-7-20",
          },
        ],
        shelves: [{ productID: "2694", shelfCode: "B-11-13" }],
        sources: [],
      }),
    ).toEqual([
      {
        name: "6001ZZ",
        size: "12×28×8",
        shelves: ["B-11-13"],
        inventory: "200",
        remark: "2024-7-20",
      },
    ])
  })

  test("fails the whole mapping for malformed quantities", () => {
    expect(() =>
      mapInventoryRows({
        products: [{ ...product, totalInventory: "200件" }],
        shelves: [],
        sources: [],
      }),
    ).toThrow("inventory row contract mismatch")
  })
})
```

- [ ] **Step 2: Run the mapper test and confirm the red state**

Run from `D:\opencode\packages\feishu`:

```powershell
bun test test/inventory-mapper.test.ts
```

Expected: FAIL because `../src/inventory-mapper` does not exist.

- [ ] **Step 3: Implement strict mapping and deterministic supplier ordering**

Create `packages/feishu/src/inventory-mapper.ts`:

```ts
import type { InventoryAnswerItem } from "./inventory-answer"

export type ProductRow = {
  productID: string
  name: string | null
  spec: string | null
  attribute: string | null
  remark: string | null
  totalInventory: string
}

export type ShelfRow = {
  productID: string
  shelfCode: string
}

export type InventorySourceRow = {
  productID: string
  sourceRefKind: string
  sourceRefID: string
  onHandQty: string
  supplierID: string | null
  supplierLegacyID: string | null
  supplierName: string | null
  supplierRole: string | null
  supplierEnabled: number | null
  supplierDeleted: number | null
}

export function mapInventoryRows(input: {
  products: readonly ProductRow[]
  shelves: readonly ShelfRow[]
  sources: readonly InventorySourceRow[]
}) {
  input.products.forEach((row) => {
    requiredText(row.productID)
    requiredText(row.name)
    decimal(row.totalInventory)
  })
  input.shelves.forEach((row) => {
    requiredText(row.productID)
    requiredText(row.shelfCode)
  })
  input.sources.forEach((row) => {
    requiredText(row.productID)
    requiredText(row.sourceRefKind)
    requiredText(row.sourceRefID)
    decimal(row.onHandQty)
  })

  return [...input.products]
    .sort((left, right) =>
      left.productID.localeCompare(right.productID, undefined, {
        numeric: true,
      }),
    )
    .flatMap((product): InventoryAnswerItem[] => {
      const name = requiredText(product.name)
      const inventory = decimal(product.totalInventory)
      const shelves = [
        ...new Set(
          input.shelves
            .filter((row) => row.productID === product.productID)
            .map((row) => requiredText(row.shelfCode)),
        ),
      ]
      const size = product.spec
        ?.match(
          /\d+(?:\.\d+)?(?:\s*[*xX×]\s*\d+(?:\.\d+)?){1,}/,
        )?.[0]
        .replace(/\s*[*xX]\s*/g, "×")
      const attribute =
        product.attribute &&
        !/^[A-Za-z]+-\d+(?:-\d+)?(?:[、,，\s]+[A-Za-z]+-\d+(?:-\d+)?)*$/.test(
          product.attribute.trim(),
        )
          ? product.attribute.trim()
          : undefined
      const remark = optionalText(product.remark)
      const base = {
        name,
        shelves,
        ...(attribute ? { attribute } : {}),
        ...(size ? { size } : {}),
        ...(remark ? { remark } : {}),
      }
      const attributed = input.sources
        .filter(
          (row) =>
            row.productID === product.productID &&
            row.sourceRefKind !== "UNATTRIBUTED" &&
            !decimal(row.onHandQty).startsWith("-") &&
            row.supplierRole === "SUPPLIER" &&
            row.supplierEnabled === 1 &&
            row.supplierDeleted === 0 &&
            optionalText(row.supplierName),
        )
        .sort((left, right) => {
          const byName = requiredText(left.supplierName).localeCompare(
            requiredText(right.supplierName),
            "zh-CN",
          )
          if (byName !== 0) return byName
          return left.sourceRefID.localeCompare(right.sourceRefID)
        })

      if (attributed.length === 0) return [{ ...base, inventory }]

      return attributed.map((row) => ({
        ...base,
        supplier: requiredText(row.supplierName),
        inventory: decimal(row.onHandQty),
      }))
    })
}

function requiredText(value: string | null) {
  const result = optionalText(value)
  if (!result) throw new Error("inventory row contract mismatch")
  return result
}

function optionalText(value: string | null) {
  const result = value?.trim()
  return result ? result : undefined
}

function decimal(value: string) {
  const normalized = value.trim()
  if (!/^-?\d+(?:\.\d+)?$/.test(normalized)) {
    throw new Error("inventory row contract mismatch")
  }
  const [integer, fraction] = normalized.split(".")
  const trimmed = fraction?.replace(/0+$/, "")
  if (!trimmed) return integer === "-0" ? "0" : integer
  return `${integer}.${trimmed}`
}
```

- [ ] **Step 4: Run mapper and formatter tests together**

Run from `D:\opencode\packages\feishu`:

```powershell
bun test test/inventory-mapper.test.ts test/inventory-answer.test.ts
bun typecheck
```

Expected: mapping tests pass, the observed `6001ZZ` fixture produces `库存200`, supplier rows are ordered, and no output object contains an internal key.

- [ ] **Step 5: Commit the mapping boundary**

Run from `D:\opencode`:

```powershell
git add packages/feishu/src/inventory-mapper.ts packages/feishu/test/inventory-mapper.test.ts
git commit -m "feat(feishu): map inventory rows"
```

### Task 3: MySQL Configuration and Schema Preflight

**Files:**

- Create: `packages/feishu/src/mysql-config.ts`
- Create: `packages/feishu/src/mysql-preflight.ts`
- Create: `packages/feishu/test/mysql-config.test.ts`
- Create: `packages/feishu/test/mysql-preflight.test.ts`

**Interfaces:**

- Consumes: Bun file reads and an injected `QueryExecutor`
- Produces:

```ts
export type MysqlConfig = {
  host: string
  port: number
  database: string
  user: string
  passwordFile: string
  connectTimeoutMs: number
  queryTimeoutMs: number
  maxResults: number
}

export function parseMysqlConfig(
  env: Readonly<Record<string, string | undefined>>,
): MysqlConfig

export function loadMysqlPassword(config: MysqlConfig): Promise<string>

export type QueryExecutor = (
  sql: string,
  values?: readonly unknown[],
) => Promise<readonly Record<string, unknown>[]>

export type MysqlPreflight = {
  mysqlVersion: string
  database: string
  currentUser: string
  readOnly: boolean
  contractVersion: "mysql-inventory-v1"
}

export function runMysqlPreflight(
  query: QueryExecutor,
  expectedDatabase: string,
): Promise<MysqlPreflight>
```

- [ ] **Step 1: Write configuration tests for exact MySQL-only field names**

Create `packages/feishu/test/mysql-config.test.ts` with these executable cases:

```ts
import { describe, expect, test } from "bun:test"
import { parseMysqlConfig } from "../src/mysql-config"

const valid = {
  FEISHU_MYSQL_HOST: "127.0.0.1",
  FEISHU_MYSQL_PORT: "3306",
  FEISHU_MYSQL_DATABASE: "t1_full_20260717_133707",
  FEISHU_MYSQL_USER: "inventory_reader",
  FEISHU_MYSQL_PASSWORD_FILE: "D:\\secrets\\mysql-password",
}

describe("parseMysqlConfig", () => {
  test("parses bounded MySQL-only defaults", () => {
    expect(parseMysqlConfig(valid)).toEqual({
      host: "127.0.0.1",
      port: 3306,
      database: "t1_full_20260717_133707",
      user: "inventory_reader",
      passwordFile: "D:\\secrets\\mysql-password",
      connectTimeoutMs: 5_000,
      queryTimeoutMs: 5_000,
      maxResults: 20,
    })
  })

  test("reports only a missing field name", () => {
    expect(() =>
      parseMysqlConfig({ ...valid, FEISHU_MYSQL_USER: undefined }),
    ).toThrow("FEISHU_MYSQL_USER")
  })

  test.each([
    ["FEISHU_MYSQL_PORT", "0"],
    ["FEISHU_MYSQL_QUERY_TIMEOUT_MS", "60001"],
    ["FEISHU_MYSQL_MAX_RESULTS", "101"],
  ])("rejects invalid bounded value %s", (key, value) => {
    expect(() => parseMysqlConfig({ ...valid, [key]: value })).toThrow(key)
  })

  test("does not recognize a SQL Server fallback field", () => {
    expect(
      parseMysqlConfig({
        ...valid,
        T1_SQLSERVER_PASSWORD: "must-not-be-read",
      }),
    ).toEqual(parseMysqlConfig(valid))
  })
})
```

- [ ] **Step 2: Run the config test and confirm the red state**

Run from `D:\opencode\packages\feishu`:

```powershell
bun test test/mysql-config.test.ts
```

Expected: FAIL because `../src/mysql-config` does not exist.

- [ ] **Step 3: Implement bounded config parsing and controlled secret loading**

Create `packages/feishu/src/mysql-config.ts`:

```ts
export type MysqlConfig = {
  host: string
  port: number
  database: string
  user: string
  passwordFile: string
  connectTimeoutMs: number
  queryTimeoutMs: number
  maxResults: number
}

export function parseMysqlConfig(
  env: Readonly<Record<string, string | undefined>>,
): MysqlConfig {
  return {
    host: required(env, "FEISHU_MYSQL_HOST"),
    port: integer(env, "FEISHU_MYSQL_PORT", 1, 65_535),
    database: required(env, "FEISHU_MYSQL_DATABASE"),
    user: required(env, "FEISHU_MYSQL_USER"),
    passwordFile: required(env, "FEISHU_MYSQL_PASSWORD_FILE"),
    connectTimeoutMs: optionalInteger(
      env,
      "FEISHU_MYSQL_CONNECT_TIMEOUT_MS",
      5_000,
      100,
      60_000,
    ),
    queryTimeoutMs: optionalInteger(
      env,
      "FEISHU_MYSQL_QUERY_TIMEOUT_MS",
      5_000,
      100,
      60_000,
    ),
    maxResults: optionalInteger(
      env,
      "FEISHU_MYSQL_MAX_RESULTS",
      20,
      1,
      100,
    ),
  }
}

export async function loadMysqlPassword(config: MysqlConfig) {
  const password = (await Bun.file(config.passwordFile).text()).trim()
  if (!password) throw new Error("FEISHU_MYSQL_PASSWORD_FILE is empty")
  return password
}

function required(
  env: Readonly<Record<string, string | undefined>>,
  key: string,
) {
  const value = env[key]?.trim()
  if (!value) throw new Error(`${key} is required`)
  return value
}

function integer(
  env: Readonly<Record<string, string | undefined>>,
  key: string,
  minimum: number,
  maximum: number,
) {
  return boundedInteger(required(env, key), key, minimum, maximum)
}

function optionalInteger(
  env: Readonly<Record<string, string | undefined>>,
  key: string,
  fallback: number,
  minimum: number,
  maximum: number,
) {
  const value = env[key]?.trim()
  if (!value) return fallback
  return boundedInteger(value, key, minimum, maximum)
}

function boundedInteger(
  value: string,
  key: string,
  minimum: number,
  maximum: number,
) {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${key} is invalid`)
  }
  return parsed
}
```

Run from `D:\opencode\packages\feishu`:

```powershell
bun test test/mysql-config.test.ts
```

Expected: configuration tests pass and no supplied value appears in an error.

- [ ] **Step 4: Write preflight tests against an injected query executor**

Create `packages/feishu/test/mysql-preflight.test.ts`. The successful fixture must return:

```ts
const identityRows = [
  {
    mysql_version: "8.4.10",
    database_name: "t1_full_20260717_133707",
    current_user: "inventory_reader@%",
    read_only: 0,
  },
]

const columnRows = [
  ["Product", "s_ID", "int", "NO"],
  ["Product", "u_Name", "varchar", "YES"],
  ["Product", "ProdSpec", "longtext", "YES"],
  ["Product", "ProdType", "longtext", "YES"],
  ["Product", "u_Remark", "longtext", "YES"],
  ["Storage", "Prod_ID", "int", "NO"],
  ["Storage", "Prod_Number1", "decimal", "NO"],
  ["vw_productshelflocation", "ShelfCode", "varchar", "NO"],
  ["vw_productshelflocation", "ProductID", "int", "NO"],
  ["erp_inventory_source_projection", "product_ref_kind", "varchar", "NO"],
  ["erp_inventory_source_projection", "product_ref_id", "varchar", "NO"],
  ["erp_inventory_source_projection", "source_ref_kind", "varchar", "NO"],
  ["erp_inventory_source_projection", "source_ref_id", "varchar", "NO"],
  ["erp_inventory_source_projection", "on_hand_qty", "decimal", "NO"],
  ["erp_partner_overlay", "id", "char", "NO"],
  ["erp_partner_overlay", "legacy_id", "bigint", "YES"],
  ["erp_partner_overlay", "role", "varchar", "NO"],
  ["erp_partner_overlay", "name", "varchar", "YES"],
  ["erp_partner_overlay", "enabled", "tinyint", "NO"],
  ["erp_partner_overlay", "deleted", "tinyint", "NO"],
].map(([table_name, column_name, data_type, nullable]) => ({
  table_name,
  column_name,
  data_type,
  nullable,
}))
```

The tests must assert:

```ts
expect(await runMysqlPreflight(query, "t1_full_20260717_133707")).toEqual({
  mysqlVersion: "8.4.10",
  database: "t1_full_20260717_133707",
  currentUser: "inventory_reader@%",
  readOnly: false,
  contractVersion: "mysql-inventory-v1",
})
```

Add failing cases by removing `vw_productshelflocation.ShelfCode`, changing `Storage.Prod_Number1` to `varchar`, returning a different `database_name`, and throwing `new Error("password=secret-value")`. The last case must expose only `MySQL preflight failed`.

- [ ] **Step 5: Run the preflight test and confirm the red state**

Run from `D:\opencode\packages\feishu`:

```powershell
bun test test/mysql-preflight.test.ts
```

Expected: FAIL because `../src/mysql-preflight` does not exist.

- [ ] **Step 6: Implement exact identity and column-contract checks**

Create `packages/feishu/src/mysql-preflight.ts` with these exports and fixed queries:

```ts
export type QueryExecutor = (
  sql: string,
  values?: readonly unknown[],
) => Promise<readonly Record<string, unknown>[]>

export type MysqlPreflight = {
  mysqlVersion: string
  database: string
  currentUser: string
  readOnly: boolean
  contractVersion: "mysql-inventory-v1"
}

const identitySQL = `
  SELECT
    VERSION() AS mysql_version,
    DATABASE() AS database_name,
    CURRENT_USER() AS current_user,
    @@read_only AS read_only
`

const columnsSQL = `
  SELECT
    TABLE_NAME AS table_name,
    COLUMN_NAME AS column_name,
    DATA_TYPE AS data_type,
    IS_NULLABLE AS nullable
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = ?
    AND TABLE_NAME IN (
      'Product',
      'Storage',
      'vw_productshelflocation',
      'erp_inventory_source_projection',
      'erp_partner_overlay'
    )
`

const requiredColumns = new Map([
  ["Product.s_ID", "int"],
  ["Product.u_Name", "varchar"],
  ["Product.ProdSpec", "longtext"],
  ["Product.ProdType", "longtext"],
  ["Product.u_Remark", "longtext"],
  ["Storage.Prod_ID", "int"],
  ["Storage.Prod_Number1", "decimal"],
  ["vw_productshelflocation.ShelfCode", "varchar"],
  ["vw_productshelflocation.ProductID", "int"],
  ["erp_inventory_source_projection.product_ref_kind", "varchar"],
  ["erp_inventory_source_projection.product_ref_id", "varchar"],
  ["erp_inventory_source_projection.source_ref_kind", "varchar"],
  ["erp_inventory_source_projection.source_ref_id", "varchar"],
  ["erp_inventory_source_projection.on_hand_qty", "decimal"],
  ["erp_partner_overlay.id", "char"],
  ["erp_partner_overlay.legacy_id", "bigint"],
  ["erp_partner_overlay.role", "varchar"],
  ["erp_partner_overlay.name", "varchar"],
  ["erp_partner_overlay.enabled", "tinyint"],
  ["erp_partner_overlay.deleted", "tinyint"],
])
```

`runMysqlPreflight` must:

1. execute `identitySQL`;
2. require one row with a version beginning `8.4.`, the exact configured database, and a non-empty account;
3. record `@@read_only` without requiring it to be `1`;
4. execute `columnsSQL` with `[expectedDatabase]`;
5. compare every `table.column` and type in `requiredColumns`;
6. throw only `new Error("MySQL preflight failed")` for driver, identity, or schema failures.

Do not include the driver error as `cause`, because a later logger could serialize its credential-bearing message.

- [ ] **Step 7: Run configuration and preflight verification**

Run from `D:\opencode\packages\feishu`:

```powershell
bun test test/mysql-config.test.ts test/mysql-preflight.test.ts
bun typecheck
```

Expected: both suites pass; wrong schema and drift fail closed; `@@read_only=0` is recorded but does not enable writes.

- [ ] **Step 8: Commit configuration and preflight**

Run from `D:\opencode`:

```powershell
git add packages/feishu/src/mysql-config.ts packages/feishu/src/mysql-preflight.ts packages/feishu/test/mysql-config.test.ts packages/feishu/test/mysql-preflight.test.ts
git commit -m "feat(feishu): validate inventory database"
```

### Task 4: Fixed Prepared MySQL Inventory Adapter

**Files:**

- Create: `packages/feishu/src/mysql-inventory.ts`
- Create: `packages/feishu/test/mysql-inventory.test.ts`
- Create: `packages/feishu/test/mysql-inventory.contract.test.ts`

**Interfaces:**

- Consumes: `MysqlConfig`, `loadMysqlPassword`, `runMysqlPreflight`, `QueryExecutor`, and `mapInventoryRows`
- Produces:

```ts
export type InventoryQueryEvent =
  | {
      type: "query_started"
      templateVersion: "mysql-inventory-v1"
      term: string
      limit: number
    }
  | {
      type: "query_completed"
      templateVersion: "mysql-inventory-v1"
      rowCount: number
      durationMs: number
    }

export type MysqlInventory = {
  preflight: MysqlPreflight
  query(term: string, limit?: number): Promise<InventoryAnswerItem[]>
  close(): Promise<void>
}

export function createMysqlInventory(
  config: MysqlConfig,
  observe?: (event: InventoryQueryEvent) => void | Promise<void>,
): Promise<MysqlInventory>
```

- [ ] **Step 1: Write adapter tests using an injected executor seam**

Create `packages/feishu/test/mysql-inventory.test.ts` with a fake executor that records every SQL string and parameter array. Cover these exact assertions:

```ts
expect(calls[0]?.sql).toContain("FROM Product AS product")
expect(calls[0]?.sql).toContain("LEFT JOIN Storage AS storage")
expect(calls[0]?.sql).toContain("SUM(storage.Prod_Number1)")
expect(calls[0]?.sql).not.toContain("SELECT *")
expect(calls[0]?.values).toEqual(["%6001ZZ%", "6001ZZ", "%6001ZZ%", 20])
expect(calls.flatMap((call) => call.values)).not.toContain(
  "6001ZZ' OR 1=1 --",
)
```

For the injection case, the expected LIKE parameter is `%6001ZZ' OR 1=1 --%` and the SQL string remains byte-for-byte equal to the normal template. Also test:

- whitespace-only term rejects before any executor call;
- `limit=0` and `limit=101` reject;
- product rows are queried first;
- no product rows return `[]` without shelf/source queries;
- shelf/source queries receive a JSON array of selected numeric product IDs;
- malformed rows reject the entire call;
- an executor error becomes `库存查询失败，请稍后再试。`;
- the exported adapter has `query` and `close` but no generic `execute`, `write`, or `sql` member.

- [ ] **Step 2: Run the adapter test and confirm the red state**

Run from `D:\opencode\packages\feishu`:

```powershell
bun test test/mysql-inventory.test.ts
```

Expected: FAIL because `../src/mysql-inventory` does not exist.

- [ ] **Step 3: Add the three fixed query templates**

Create `packages/feishu/src/mysql-inventory.ts` with these module-private constants:

```ts
const productSQL = `
  SELECT
    CAST(product.s_ID AS CHAR) AS product_id,
    product.u_Name AS product_name,
    product.ProdSpec AS product_spec,
    product.ProdType AS product_attribute,
    product.u_Remark AS product_remark,
    CAST(COALESCE(SUM(storage.Prod_Number1), 0) AS CHAR) AS total_inventory
  FROM Product AS product
  LEFT JOIN Storage AS storage ON storage.Prod_ID = product.s_ID
  WHERE product.u_Name LIKE ? ESCAPE '\\\\'
     OR product.u_Code = ?
     OR product.ProdSpec LIKE ? ESCAPE '\\\\'
  GROUP BY
    product.s_ID,
    product.u_Name,
    product.ProdSpec,
    product.ProdType,
    product.u_Remark
  ORDER BY product.s_ID
  LIMIT ?
`

const shelfSQL = `
  SELECT
    CAST(shelf.ProductID AS CHAR) AS product_id,
    shelf.ShelfCode AS shelf_code
  FROM vw_productshelflocation AS shelf
  JOIN JSON_TABLE(
    ?,
    '$[*]' COLUMNS(product_id INT PATH '$')
  ) AS selected ON selected.product_id = shelf.ProductID
  ORDER BY shelf.ProductID, shelf.ShelfCode, shelf.RelationID
`

const sourceSQL = `
  SELECT
    source.product_ref_id AS product_id,
    source.source_ref_kind,
    source.source_ref_id,
    CAST(source.on_hand_qty AS CHAR) AS on_hand_qty,
    partner.id AS supplier_id,
    CAST(partner.legacy_id AS CHAR) AS supplier_legacy_id,
    partner.name AS supplier_name,
    partner.role AS supplier_role,
    partner.enabled AS supplier_enabled,
    partner.deleted AS supplier_deleted
  FROM erp_inventory_source_projection AS source
  JOIN JSON_TABLE(
    ?,
    '$[*]' COLUMNS(product_id INT PATH '$')
  ) AS selected
    ON source.product_ref_kind = 'LEGACY'
   AND source.product_ref_id = CAST(selected.product_id AS CHAR)
  LEFT JOIN erp_partner_overlay AS partner
    ON (
      (source.source_ref_kind = 'ERP' AND partner.id = source.source_ref_id)
      OR
      (
        source.source_ref_kind = 'LEGACY'
        AND CAST(partner.legacy_id AS CHAR) = source.source_ref_id
      )
    )
  ORDER BY
    selected.product_id,
    source.source_ref_kind,
    source.source_ref_id
`
```

The only accepted input substitutions are the escaped LIKE term, exact term, escaped spec term, bounded limit, and JSON-encoded IDs selected by `productSQL`.

- [ ] **Step 4: Implement runtime row parsing, pool lifecycle, and failure integrity**

Use `createPool` from `mysql2/promise` and `RowDataPacket` from `mysql2`. The executor implementation must use `pool.execute({ sql, timeout: config.queryTimeoutMs }, [...values])` and return plain records. `createMysqlInventory` must:

1. call `loadMysqlPassword(config)`;
2. create a pool with `decimalNumbers: false`, `connectionLimit: 4`, `connectTimeout: config.connectTimeoutMs`, and no multi-statement option;
3. run `runMysqlPreflight` before returning the adapter;
4. close the pool if preflight fails;
5. trim and validate the term before acquiring a connection;
6. escape `%`, `_`, and `\` only for LIKE parameters;
7. parse every returned field by exact name and primitive type;
8. call `mapInventoryRows` only after all three result sets validate;
9. return no partial rows on any error;
10. expose the sanitized error `new Error("库存查询失败，请稍后再试。")`.

Use these private conversion signatures:

```ts
function productRows(
  rows: readonly Record<string, unknown>[],
): ProductRow[]

function shelfRows(
  rows: readonly Record<string, unknown>[],
): ShelfRow[]

function sourceRows(
  rows: readonly Record<string, unknown>[],
): InventorySourceRow[]

function like(term: string) {
  return `%${term.replace(/[\\%_]/g, "\\$&")}%`
}
```

Do not export the executor or SQL constants. Tests may receive a narrow internal factory:

```ts
export function createInventoryReaderForTest(input: {
  query: QueryExecutor
  preflight: MysqlPreflight
  maxResults: number
  observe?: (event: InventoryQueryEvent) => void | Promise<void>
}): MysqlInventory
```

Its `close()` is an async no-op and it remains unavailable from the Agent/tool surface.

- [ ] **Step 5: Run all adapter-layer tests**

Run from `D:\opencode\packages\feishu`:

```powershell
bun test test/mysql-inventory.test.ts test/mysql-preflight.test.ts test/inventory-mapper.test.ts test/inventory-answer.test.ts
bun typecheck
```

Expected: fixed SQL and injection tests pass; malformed or failed result sets produce no partial answer.

- [ ] **Step 6: Add the explicit local contract test**

Create `packages/feishu/test/mysql-inventory.contract.test.ts`:

```ts
import { expect, test } from "bun:test"
import { createMysqlInventory } from "../src/mysql-inventory"
import { parseMysqlConfig } from "../src/mysql-config"

const enabled = process.env.FEISHU_MYSQL_CONTRACT === "1"

test.skipIf(!enabled)("reads the approved migrated MySQL contract", async () => {
  const inventory = await createMysqlInventory(parseMysqlConfig(process.env))
  try {
    expect(inventory.preflight.mysqlVersion).toStartWith("8.4.")
    expect(inventory.preflight.contractVersion).toBe("mysql-inventory-v1")

    const items = await inventory.query("6001ZZ")
    expect(items.some((item) => item.name === "6001ZZ")).toBeTrue()
    expect(items.some((item) => item.inventory === "200")).toBeTrue()
    expect(JSON.stringify(items)).not.toMatch(/SP\d+|u_Code|productID|s_ID/)
  } finally {
    await inventory.close()
  }
})
```

Run from `D:\opencode\packages\feishu` only with the approved local settings:

```powershell
$env:FEISHU_MYSQL_CONTRACT = "1"
bun run test:mysql-contract
Remove-Item Env:FEISHU_MYSQL_CONTRACT
```

Expected: MySQL 8.4 preflight passes, `6001ZZ` includes inventory `200`, no credential is printed, and no database write occurs.

- [ ] **Step 7: Commit the fixed adapter**

Run from `D:\opencode`:

```powershell
git add packages/feishu/src/mysql-inventory.ts packages/feishu/test/mysql-inventory.test.ts packages/feishu/test/mysql-inventory.contract.test.ts
git commit -m "feat(feishu): query mysql inventory"
```

### Task 5: Trusted Tool Boundary

**Files:**

- Create: `packages/feishu/src/inventory-tool.ts`
- Create: `packages/feishu/test/inventory-tool.test.ts`

**Interfaces:**

- Consumes: `MysqlInventory` and `formatInventoryAnswer`
- Produces:

```ts
export type TrustedFeishuContext = {
  source: "feishu"
  conversationID: string
  messageID: string
  traceID: string
  admittedAt: number
  expiresAt: number
  integrity: string
}

export type InventoryToolResult =
  | { status: "ok"; text: string }
  | { status: "clarify"; text: "请告诉我要查询的商品名称或型号。" }
  | { status: "error"; text: "库存查询失败，请稍后再试。" }

export function createInventoryTool(input: {
  inventory: Pick<MysqlInventory, "query">
  verifyContext(context: TrustedFeishuContext): boolean
  now(): number
}): {
  query(input: {
    context: TrustedFeishuContext
    term: string
  }): Promise<InventoryToolResult>
}
```

- [ ] **Step 1: Write admission and fixed-output tests**

Create `packages/feishu/test/inventory-tool.test.ts` with a query spy and these cases:

```ts
import { describe, expect, mock, test } from "bun:test"
import { createInventoryTool } from "../src/inventory-tool"

const context = {
  source: "feishu" as const,
  conversationID: "conversation-1",
  messageID: "message-1",
  traceID: "trace-1",
  admittedAt: 1_000,
  expiresAt: 2_000,
  integrity: "gateway-issued",
}

describe("inventory tool", () => {
  test("returns formatter text for valid trusted context", async () => {
    const query = mock(async () => [
      {
        name: "6001ZZ",
        attribute: "清油",
        size: "12×28×8",
        shelves: ["B-11-13"],
        supplier: "上海涂众轴承",
        inventory: "200",
        remark: "xxx",
      },
    ])
    const tool = createInventoryTool({
      inventory: { query },
      verifyContext: () => true,
      now: () => 1_500,
    })

    expect(await tool.query({ context, term: "6001ZZ" })).toEqual({
      status: "ok",
      text: "6001ZZ（清油）（12×28×8）（货架号：B-11-13）上海涂众轴承库存200，备注：xxx",
    })
    expect(query).toHaveBeenCalledTimes(1)
  })

  test.each([
    [{ ...context, expiresAt: 1_499 }, true],
    [{ ...context, integrity: "forged" }, false],
  ])("fails closed for expired or unverifiable context", async (value, valid) => {
    const query = mock(async () => [])
    const tool = createInventoryTool({
      inventory: { query },
      verifyContext: () => valid,
      now: () => 1_500,
    })

    expect(await tool.query({ context: value, term: "6001ZZ" })).toEqual({
      status: "error",
      text: "库存查询失败，请稍后再试。",
    })
    expect(query).not.toHaveBeenCalled()
  })

  test("clarifies an empty term without querying", async () => {
    const query = mock(async () => [])
    const tool = createInventoryTool({
      inventory: { query },
      verifyContext: () => true,
      now: () => 1_500,
    })

    expect(await tool.query({ context, term: "  " })).toEqual({
      status: "clarify",
      text: "请告诉我要查询的商品名称或型号。",
    })
    expect(query).not.toHaveBeenCalled()
  })
})
```

Add a compile-time test showing that the public input accepts only `context` and `term`; it must not accept `sql`, `operation`, `table`, or `columns`.

- [ ] **Step 2: Run the tool test and confirm the red state**

Run from `D:\opencode\packages\feishu`:

```powershell
bun test test/inventory-tool.test.ts
```

Expected: FAIL because `../src/inventory-tool` does not exist.

- [ ] **Step 3: Implement fail-closed admission and verbatim formatting**

Create `packages/feishu/src/inventory-tool.ts`:

```ts
import { formatInventoryAnswer } from "./inventory-answer"
import type { MysqlInventory } from "./mysql-inventory"

export type TrustedFeishuContext = {
  source: "feishu"
  conversationID: string
  messageID: string
  traceID: string
  admittedAt: number
  expiresAt: number
  integrity: string
}

export type InventoryToolResult =
  | { status: "ok"; text: string }
  | { status: "clarify"; text: "请告诉我要查询的商品名称或型号。" }
  | { status: "error"; text: "库存查询失败，请稍后再试。" }

export function createInventoryTool(input: {
  inventory: Pick<MysqlInventory, "query">
  verifyContext(context: TrustedFeishuContext): boolean
  now(): number
}) {
  return {
    async query(request: {
      context: TrustedFeishuContext
      term: string
    }): Promise<InventoryToolResult> {
      if (
        request.context.source !== "feishu" ||
        request.context.expiresAt < input.now() ||
        !input.verifyContext(request.context)
      ) {
        return { status: "error", text: "库存查询失败，请稍后再试。" }
      }

      const term = request.term.trim()
      if (!term) {
        return {
          status: "clarify",
          text: "请告诉我要查询的商品名称或型号。",
        }
      }

      return input.inventory
        .query(term)
        .then((items): InventoryToolResult => ({
          status: "ok",
          text: formatInventoryAnswer(items),
        }))
        .catch(
          (): InventoryToolResult => ({
            status: "error",
            text: "库存查询失败，请稍后再试。",
          }),
        )
    },
  }
}
```

- [ ] **Step 4: Run policy, adapter, and format tests together**

Run from `D:\opencode\packages\feishu`:

```powershell
bun test test/inventory-tool.test.ts test/mysql-inventory.test.ts test/inventory-answer.test.ts
bun typecheck
```

Expected: invalid context reaches no query executor, empty terms clarify without a query, and valid results are returned in exact fixed format.

- [ ] **Step 5: Commit the trusted tool**

Run from `D:\opencode`:

```powershell
git add packages/feishu/src/inventory-tool.ts packages/feishu/test/inventory-tool.test.ts
git commit -m "feat(feishu): gate inventory tool"
```

### Task 6: Inventory Trace and Four-Layer Release Gate

**Files:**

- Create: `packages/feishu/src/inventory-trace.ts`
- Create: `packages/feishu/src/inventory-eval.ts`
- Create: `packages/feishu/test/inventory-trace.test.ts`
- Create: `packages/feishu/test/inventory-eval.test.ts`
- Create: `packages/feishu/test/fixtures/inventory-gold.json`

**Interfaces:**

- Consumes: trusted context IDs, `InventoryQueryEvent`, mapped `InventoryAnswerItem[]`, and final formatter text
- Produces:

```ts
export type InventoryTraceEvent = {
  traceID: string
  conversationID: string
  messageID: string
  type:
    | "inventory_intent_admitted"
    | "inventory_query_started"
    | "inventory_query_completed"
    | "inventory_query_failed"
    | "inventory_answer_mapped"
    | "inventory_answer_delivered"
    | "inventory_operation_blocked"
    | "inventory_correction"
  occurredAt: number
  relatedEventID?: string
  data: Record<string, string | number | boolean | readonly string[]>
}

export type InventoryTraceSink = {
  append(event: InventoryTraceEvent): void | Promise<void>
}

export function evaluateInventoryCases(
  cases: readonly InventoryGoldCase[],
): {
  intent: number
  sql: number
  result: number
  answer: number
  policy: number
  passed: boolean
}
```

- [ ] **Step 1: Create the versioned gold fixture**

Create `packages/feishu/test/fixtures/inventory-gold.json` with at least these concrete records:

```json
[
  {
    "id": "complete-6001zz",
    "question": "6001ZZ库存和货架在哪里",
    "expectedIntent": {
      "kind": "inventory_lookup",
      "term": "6001ZZ"
    },
    "expectedTemplateVersion": "mysql-inventory-v1",
    "expectedResult": [
      {
        "name": "6001ZZ",
        "attribute": "清油",
        "size": "12×28×8",
        "shelves": ["B-11-13"],
        "supplier": "上海涂众轴承",
        "inventory": "200",
        "remark": "xxx"
      }
    ],
    "expectedAnswer": "6001ZZ（清油）（12×28×8）（货架号：B-11-13）上海涂众轴承库存200，备注：xxx",
    "policyExpected": "allow"
  },
  {
    "id": "supplierless-total",
    "question": "查6001ZZ库存",
    "expectedIntent": {
      "kind": "inventory_lookup",
      "term": "6001ZZ"
    },
    "expectedTemplateVersion": "mysql-inventory-v1",
    "expectedResult": [
      {
        "name": "6001ZZ",
        "size": "12×28×8",
        "shelves": [],
        "inventory": "200"
      }
    ],
    "expectedAnswer": "6001ZZ（12×28×8）库存200",
    "policyExpected": "allow"
  },
  {
    "id": "write-blocked",
    "question": "把6001ZZ库存改成999",
    "expectedIntent": {
      "kind": "blocked_operation",
      "term": "6001ZZ"
    },
    "expectedTemplateVersion": null,
    "expectedResult": [],
    "expectedAnswer": "该操作不支持。",
    "policyExpected": "block"
  }
]
```

Add enough fixed read cases to make a single mismatch observable below the required 95% threshold: use 20 read cases per layer, so 19/20 equals exactly 95% and 18/20 fails.

- [ ] **Step 2: Write trace sanitization and append-only tests**

Create `packages/feishu/test/inventory-trace.test.ts` with an in-memory sink. Assert that a successful trace contains, in order:

```ts
[
  "inventory_intent_admitted",
  "inventory_query_started",
  "inventory_query_completed",
  "inventory_answer_mapped",
  "inventory_answer_delivered",
]
```

Assert the query-start event records only:

```ts
{
  templateVersion: "mysql-inventory-v1",
  term: "6001ZZ",
  limit: 20,
}
```

Use canaries `password=secret-value`, `D:\secrets\mysql-password`, and `mysql://user:secret@host/schema`; none may appear in serialized events. Add a correction event with `relatedEventID` and assert the original event remains byte-for-byte unchanged.

- [ ] **Step 3: Run the trace test and confirm the red state**

Run from `D:\opencode\packages\feishu`:

```powershell
bun test test/inventory-trace.test.ts
```

Expected: FAIL because `../src/inventory-trace` does not exist.

- [ ] **Step 4: Implement the typed trace writer**

Create `packages/feishu/src/inventory-trace.ts`. Export the types above and:

```ts
const forbiddenKeys = new Set([
  "password",
  "passwordFile",
  "connectionString",
  "reasoning",
])

export function createInventoryTrace(sink: InventoryTraceSink) {
  return {
    append(event: InventoryTraceEvent) {
      return sink.append({
        ...event,
        data: Object.fromEntries(
          Object.entries(event.data).filter(([key, value]) => {
            if (forbiddenKeys.has(key)) return false
            if (typeof value !== "string") return true
            return !/password=|mysql:\/\/|\\secrets\\/i.test(value)
          }),
        ),
      })
    },
  }
}
```

The module must reject event data containing nested objects; mapped answer objects are logged only after converting to an allowlisted JSON string with product name, attribute, size, shelves, supplier, inventory, and remark.

- [ ] **Step 5: Write the four-layer evaluation tests**

Create `packages/feishu/test/inventory-eval.test.ts` and assert:

```ts
expect(evaluateInventoryCases(perfectCases)).toEqual({
  intent: 1,
  sql: 1,
  result: 1,
  answer: 1,
  policy: 1,
  passed: true,
})

expect(evaluateInventoryCases(withTwoAnswerMismatches)).toMatchObject({
  answer: 0.9,
  passed: false,
})

expect(evaluateInventoryCases(withOnePolicyMismatch)).toMatchObject({
  policy: 0,
  passed: false,
})
```

Each case must carry actual observed intent, template version, mapped result, answer, and policy outcome alongside the expected fields from the JSON fixture.

- [ ] **Step 6: Implement exact scoring and release thresholds**

Create `packages/feishu/src/inventory-eval.ts`. Compare:

- intent objects by exact `kind` and `term`;
- SQL by exact template version and sanitized parameter values;
- result objects by deep equality after deterministic ordering;
- answers by byte equality;
- policy outcomes by byte equality.

Return `passed: true` only when:

```ts
intent >= 0.95 &&
sql >= 0.95 &&
result >= 0.95 &&
answer >= 0.95 &&
policy === 1
```

An empty layer scores `0`, never `1`.

- [ ] **Step 7: Run trace and release-gate verification**

Run from `D:\opencode\packages\feishu`:

```powershell
bun test test/inventory-trace.test.ts test/inventory-eval.test.ts
bun typecheck
```

Expected: a 90% answer layer blocks release, 95% passes that read layer, and any policy/secret case failure blocks release.

- [ ] **Step 8: Commit trace and evaluation**

Run from `D:\opencode`:

```powershell
git add packages/feishu/src/inventory-trace.ts packages/feishu/src/inventory-eval.ts packages/feishu/test/inventory-trace.test.ts packages/feishu/test/inventory-eval.test.ts packages/feishu/test/fixtures/inventory-gold.json
git commit -m "test(feishu): gate inventory accuracy"
```

### Task 7: Trusted Pre-Model Gateway Integration

**Dependency gate:** Begin this task only when `feishu-chat-gateway` has created `.opencode/agent/feishu-chat.md`, `packages/feishu/src/event-log.ts`, `packages/feishu/src/worker.ts`, `packages/feishu/src/gateway.ts`, `packages/feishu/src/index.ts`, and their corresponding tests. If any file is absent, Tasks 1–6 remain independently releasable as the inventory module, but this OpenSpec change remains incomplete and must not be archived.

**Files:**

- Create: `packages/feishu/src/inventory-route.ts`
- Modify: `packages/feishu/src/event-log.ts`
- Modify: `packages/feishu/src/worker.ts`
- Modify: `packages/feishu/src/gateway.ts`
- Modify: `packages/feishu/src/index.ts`
- Create: `packages/feishu/test/inventory-route.test.ts`
- Modify: `packages/feishu/test/agent.test.ts`
- Modify: `packages/feishu/test/event-log.test.ts`
- Modify: `packages/feishu/test/worker.test.ts`
- Modify: `packages/feishu/test/gateway.test.ts`

**Interfaces:**

- Consumes: the base gateway trusted admission record, event logger, worker task, reply client, and all Task 1–6 exports
- Produces: one trusted `PreModelRoute` that either declines ordinary chat or returns terminal inventory/clarification text before any OpenCode provider turn

- [ ] **Step 1: Add failing Agent policy tests**

Extend `packages/feishu/test/agent.test.ts` so it asserts:

```ts
expect(agent.tools).toEqual({ "*": false })
expect(agent.permissions).toMatchObject({
  "*": "deny",
})
```

Also assert the Agent description does not mention or allow inventory, SQL, database, Skill, MCP, file, terminal, network, or project-modification tools.

- [ ] **Step 2: Add failing intent, worker, and gateway tests**

Create `packages/feishu/test/inventory-route.test.ts` and extend `packages/feishu/test/worker.test.ts` and `packages/feishu/test/gateway.test.ts` with:

1. recognized questions `6001ZZ库存多少`, `6001ZZ在哪个货架`, and `查一下 6001ZZ 的位置`;
2. one adapter call;
3. exact final reply `6001ZZ（清油）（12×28×8）（货架号：B-11-13）上海涂众轴承库存200，备注：xxx`;
4. zero OpenCode provider turns for handled inventory/location requests;
5. invalid trusted context causing zero pool acquisition;
6. SQL/write text, multiple product terms, and ambiguous prose declining the trusted route;
7. complete inventory trace events linked to the existing conversation/turn/trace/message IDs.

Run from `D:\opencode\packages\feishu`:

```powershell
bun test test/inventory-route.test.ts test/agent.test.ts test/worker.test.ts test/gateway.test.ts test/event-log.test.ts
```

Expected: FAIL because the trusted pre-model route does not exist and the worker sends every admitted task to OpenCode.

- [ ] **Step 3: Implement confidence-gated inventory intent**

Create `packages/feishu/src/inventory-route.ts` with:

```ts
export type InventoryIntent =
  | { kind: "chat" }
  | { kind: "clarify" }
  | { kind: "lookup"; productTerm: string }

export function parseInventoryIntent(text: string): InventoryIntent
```

Recognize only supported inventory/location keywords paired with exactly one quoted product term or one compact letter/digit product token. The supported keywords are:

```text
库存
存货
货架
位置
在哪
哪里
```

Return `clarify` for an otherwise clear inventory/location question with no single safe term, using exactly `请告诉我需要查询的商品名称或型号。`. Return `chat` for ambiguous prose, SQL/write attempts, internal-code-only input, or multiple confident terms.

- [ ] **Step 4: Wire the worker's terminal route result**

Add a narrow dependency to the existing worker input:

```ts
export type PreModelRouteResult =
  | { handled: false }
  | { handled: true; text: string; route: "inventory"; status: string }

preModelRoute: {
  handle(task: GatewayTask): Promise<PreModelRouteResult>
}
```

Before calling the OpenCode chat port, call:

```ts
const routed = await input.preModelRoute.handle(task)
if (routed.handled) {
  await input.store.transition(task.id, "answered", { answer: routed.text })
  return deliver(task.id)
}
```

The route builds `TrustedFeishuContext` only from the durable admitted task and calls:

```ts
const result = await input.inventoryTool.query({
  context: trustedContext,
  term: intent.productTerm,
})
```

Persist the route decision, query events, mapped result, and final text, then move the task directly to `answered`. Do not call, start, or resume OpenCode for `ok`, `clarify`, or `error`; the worker sends `result.text` through the existing final-text delivery path.

- [ ] **Step 5: Compose startup preflight and graceful disposal**

In `packages/feishu/src/gateway.ts`, construct the inventory adapter only after base configuration and trusted-context components are valid. In `packages/feishu/src/index.ts`, call:

```ts
const inventory = await createMysqlInventory(mysqlConfig, observeInventory)
```

Pass it into `createInventoryTool`, wrap it with `createInventoryRoute`, and pass only the route into the gateway/worker:

```ts
await usingInventory(inventory, runGateway)
```

Implement `usingInventory` with `Promise.prototype.finally` so `inventory.close()` runs exactly once on normal shutdown or startup failure. If MySQL preflight fails, startup returns the sanitized failure and does not start Channel message admission.

- [ ] **Step 6: Extend the append-only event log**

Map `InventoryTraceEvent` plus the gateway `route_selected` event into the existing `gateway_event` envelope without altering original events. Preserve existing `conversation_id`, `turn_id`, `trace_id`, `message_id`, `sentence_id`, `parent_event_id`, and `related_event_id`. Never persist:

- MySQL password or password-file path;
- full connection strings;
- raw driver exceptions;
- `Product.s_ID`, `u_Code`, supplier IDs, or warehouse IDs;
- hidden model reasoning.

- [ ] **Step 7: Run the integration tests and confirm one provider turn**

Run from `D:\opencode\packages\feishu`:

```powershell
bun test test/inventory-route.test.ts test/agent.test.ts test/worker.test.ts test/gateway.test.ts test/event-log.test.ts test/inventory-tool.test.ts
bun typecheck
```

Expected: one trusted inventory route produces one exact final Feishu reply with zero provider turns, invalid context reaches no MySQL connection, ordinary chat still uses DeepSeek, and the Agent remains zero-tool/default-deny.

- [ ] **Step 8: Commit gateway integration**

Run from `D:\opencode`:

```powershell
git add packages/feishu/src/inventory-route.ts packages/feishu/src/event-log.ts packages/feishu/src/worker.ts packages/feishu/src/gateway.ts packages/feishu/src/index.ts packages/feishu/test/inventory-route.test.ts packages/feishu/test/agent.test.ts packages/feishu/test/event-log.test.ts packages/feishu/test/worker.test.ts packages/feishu/test/gateway.test.ts
git commit -m "feat(feishu): route inventory queries"
```

### Task 8: Documentation and Final Verification

**Files:**

- Modify: `packages/feishu/.env.example`
- Modify: `packages/feishu/README.md`
- Modify: `packages/feishu/test/readme.test.ts`
- Verify only: `openspec/changes/mysql-inventory-query/**`
- Verify only: the approved T1 historical documents

**Interfaces:**

- Consumes: the final configuration, startup, contract-test, and response behavior
- Produces: operator instructions and completion evidence

- [ ] **Step 1: Add documentation assertions first**

Extend `packages/feishu/test/readme.test.ts` to require all five non-secret settings:

```text
FEISHU_MYSQL_HOST
FEISHU_MYSQL_PORT
FEISHU_MYSQL_DATABASE
FEISHU_MYSQL_USER
FEISHU_MYSQL_PASSWORD_FILE
```

Require the README to contain the exact example answer, `bun run test:mysql-contract`, `MySQL only`, and the statement that SQL Server/T1 has no runtime fallback. Reject credential assignments whose right-hand side is non-empty.

- [ ] **Step 2: Update operator documentation**

Add only empty/sample-safe entries to `packages/feishu/.env.example`:

```dotenv
FEISHU_MYSQL_HOST=127.0.0.1
FEISHU_MYSQL_PORT=3306
FEISHU_MYSQL_DATABASE=
FEISHU_MYSQL_USER=
FEISHU_MYSQL_PASSWORD_FILE=
FEISHU_MYSQL_CONNECT_TIMEOUT_MS=5000
FEISHU_MYSQL_QUERY_TIMEOUT_MS=5000
FEISHU_MYSQL_MAX_RESULTS=20
```

Document in `packages/feishu/README.md`:

- controlled password-file permissions;
- startup identity/schema preflight;
- MySQL-only runtime and no T1 fallback;
- exact answer/no-result/clarification/failure sentences;
- normal test command and opt-in contract-test command;
- formatter text is delivered without a second model turn.

- [ ] **Step 3: Run package verification**

Run from `D:\opencode\packages\feishu`:

```powershell
bun test
bun typecheck
bunx oxlint src test
```

Expected: all normal tests pass without contacting Feishu, DeepSeek, or MySQL; type checking and linting report no errors.

- [ ] **Step 4: Run the opt-in local read contract**

Run from `D:\opencode\packages\feishu` with the approved local environment:

```powershell
$env:FEISHU_MYSQL_CONTRACT = "1"
bun run test:mysql-contract
Remove-Item Env:FEISHU_MYSQL_CONTRACT
```

Expected: configured MySQL identity and schema pass, the observed `6001ZZ` total is `200`, and neither logs nor output contain credentials or internal codes.

- [ ] **Step 5: Run strict OpenSpec and repository checks**

Run from `D:\opencode`:

```powershell
openspec-cn validate mysql-inventory-query --type change --strict --json
openspec-cn validate feishu-chat-gateway --type change --strict --json
git diff --check
git status --short
```

Expected: both OpenSpec changes validate, whitespace checks pass, the two historical T1 documents still exist, and only intentional files are changed.

- [ ] **Step 6: Scan for prohibited runtime and output paths**

Run from `D:\opencode`:

```powershell
rg -n "mssql|sqlserver|tedious|T1_SQL|Product\.u_Code|SP000|来货|数量|未归属|markdown table|完整汇总" packages/feishu .opencode/agent/feishu-chat.md
```

Expected:

- no SQL Server driver, configuration, connection, query, or fallback appears;
- `Product.u_Code` appears only inside the fixed adapter lookup SQL and explicit non-leak tests;
- `SP000`, `来货`, `数量`, and `未归属` appear only in negative tests or documentation explaining prohibited output;
- runtime formatter output contains none of them.

- [ ] **Step 7: Apply both completion workflows**

Use `superpowers:verification-before-completion` to rerun fresh commands and inspect their output. Then use `openspec-verify-change` to compare the implementation and evidence with:

- `openspec/changes/mysql-inventory-query/specs/mysql-inventory-read/spec.md`;
- `openspec/changes/mysql-inventory-query/specs/inventory-answer-format/spec.md`;
- the dependency status of `openspec/changes/feishu-chat-gateway`.

Expected: the exact approved sentence passes; no internal identifier, table, rich structure, T1 path, or secret is exposed; every read layer is at least 95%; policy cases are 100%; and the change is not called complete while Task 7's gateway dependency is absent.

- [ ] **Step 8: Commit documentation only after verification passes**

Run from `D:\opencode`:

```powershell
git add packages/feishu/.env.example packages/feishu/README.md packages/feishu/test/readme.test.ts
git commit -m "docs(feishu): document inventory queries"
```

Do not stage the two untracked historical T1 documents or unrelated user changes.
