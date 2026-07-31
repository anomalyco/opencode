import { describe, expect, test } from "bun:test"
import {
  createInventoryReaderForTest,
  type InventoryQueryEvent,
} from "../src/mysql-inventory"
import type { QueryExecutor } from "../src/mysql-preflight"

const preflight = {
  mysqlVersion: "8.4.10",
  database: "t1_full_20260717_133707",
  currentUser: "inventory_reader@%",
  readOnly: false,
  contractVersion: "mysql-inventory-v1" as const,
}

const productRows = [
  {
    product_id: "2694",
    product_name: "6001ZZ",
    product_spec: "12*28*8",
    product_attribute: "清油",
    product_remark: "xxx",
    total_inventory: "200.00000000",
  },
]

function executor(responses: readonly (readonly Record<string, unknown>[] | Error)[]) {
  const calls: { sql: string; values: readonly unknown[] }[] = []
  const query: QueryExecutor = async (sql, values = []) => {
    calls.push({ sql, values })
    const response = responses[calls.length - 1]
    if (response instanceof Error) throw response
    if (!response) throw new Error("unexpected query")
    return response
  }
  return { calls, query }
}

describe("MySQL inventory reader", () => {
  test("uses only fixed prepared templates and maps the complete answer", async () => {
    const input = executor([
      productRows,
      [{ product_id: "2694", shelf_code: "B-11-13" }],
      [
        {
          product_id: "2694",
          source_ref_kind: "ERP",
          source_ref_id: "supplier-1",
          on_hand_qty: "200.000000",
          supplier_id: "supplier-1",
          supplier_legacy_id: null,
          supplier_name: "上海涂众轴承",
          supplier_role: "SUPPLIER",
          supplier_enabled: 1,
          supplier_deleted: 0,
        },
      ],
    ])
    const events: InventoryQueryEvent[] = []
    const inventory = createInventoryReaderForTest({
      query: input.query,
      preflight,
      maxResults: 20,
      observe: (event) => {
        events.push(event)
      },
    })

    expect(await inventory.query("6001ZZ")).toEqual([
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
    expect(input.calls).toHaveLength(3)
    expect(input.calls[0]?.sql).toContain("FROM Product AS product")
    expect(input.calls[0]?.sql).toContain("LEFT JOIN Storage AS storage")
    expect(input.calls[0]?.sql).toContain("SUM(storage.Prod_Number1)")
    expect(input.calls[0]?.sql).not.toContain("SELECT *")
    expect(input.calls[0]?.values).toEqual(["%6001ZZ%", "6001ZZ", "%6001ZZ%"])
    expect(input.calls[1]?.values).toEqual(["[2694]"])
    expect(input.calls[2]?.values).toEqual(["[2694]"])
    expect(events.map((event) => event.type)).toEqual(["query_started", "query_completed"])
    expect(events[1]).toMatchObject({ rowCount: 3, templateVersion: "mysql-inventory-v1" })
  })

  test("keeps injection text in parameters and never changes the SQL template", async () => {
    const normal = executor([[], [], []])
    const attempted = executor([[], [], []])
    const normalInventory = createInventoryReaderForTest({
      query: normal.query,
      preflight,
      maxResults: 20,
    })
    const attemptedInventory = createInventoryReaderForTest({
      query: attempted.query,
      preflight,
      maxResults: 20,
    })
    const term = "6001ZZ' OR 1=1 --"

    await normalInventory.query("6001ZZ")
    await attemptedInventory.query(term)

    expect(attempted.calls[0]?.sql).toBe(normal.calls[0]?.sql)
    expect(attempted.calls[0]?.sql).not.toContain(term)
    expect(attempted.calls[0]?.values).toEqual([`%${term}%`, term, `%${term}%`])
  })

  test("escapes LIKE wildcards without changing exact-code matching", async () => {
    const input = executor([[]])
    const inventory = createInventoryReaderForTest({
      query: input.query,
      preflight,
      maxResults: 20,
    })

    await inventory.query("60%_\\01")

    expect(input.calls[0]?.values).toEqual(["%60\\%\\_\\\\01%", "60%_\\01", "%60\\%\\_\\\\01%"])
  })

  test("does not query shelves or sources after an empty product result", async () => {
    const input = executor([[]])
    const inventory = createInventoryReaderForTest({
      query: input.query,
      preflight,
      maxResults: 20,
    })

    expect(await inventory.query("missing")).toEqual([])
    expect(input.calls).toHaveLength(1)
  })

  test("uses a fixed SQL cap and applies the requested limit before related reads", async () => {
    const input = executor([
      [
        ...productRows,
        {
          ...productRows[0],
          product_id: "2695",
          product_name: "6001ZZ C3",
          total_inventory: "8.00000000",
        },
      ],
      [],
      [],
    ])
    const inventory = createInventoryReaderForTest({
      query: input.query,
      preflight,
      maxResults: 20,
    })

    expect(await inventory.query("6001ZZ", 1)).toHaveLength(1)
    expect(input.calls[0]?.sql).toContain("LIMIT 100")
    expect(input.calls[0]?.values).toEqual(["%6001ZZ%", "6001ZZ", "%6001ZZ%"])
    expect(input.calls[1]?.values).toEqual(["[2694]"])
    expect(input.calls[2]?.values).toEqual(["[2694]"])
  })

  test("rejects missing terms and invalid limits before an executor call", async () => {
    const input = executor([])
    const inventory = createInventoryReaderForTest({
      query: input.query,
      preflight,
      maxResults: 20,
    })

    expect(inventory.query("   ")).rejects.toThrow("商品查询条件不能为空。")
    expect(inventory.query("6001ZZ", 0)).rejects.toThrow("商品查询数量无效。")
    expect(inventory.query("6001ZZ", 101)).rejects.toThrow("商品查询数量无效。")
    expect(input.calls).toHaveLength(0)
  })

  test("fails the complete query with a sanitized sentence for driver or malformed row errors", async () => {
    const driver = executor([new Error("password=secret-value")])
    const malformed = executor([[{ ...productRows[0], total_inventory: "200件" }], [], []])
    const driverInventory = createInventoryReaderForTest({
      query: driver.query,
      preflight,
      maxResults: 20,
    })
    const malformedInventory = createInventoryReaderForTest({
      query: malformed.query,
      preflight,
      maxResults: 20,
    })

    expect(driverInventory.query("6001ZZ")).rejects.toThrow("库存查询失败，请稍后再试。")
    expect(malformedInventory.query("6001ZZ")).rejects.toThrow("库存查询失败，请稍后再试。")
  })

  test("records a sanitized failure event without exposing a partial result", async () => {
    const input = executor([new Error("mysql://user:secret@host/schema")])
    const events: InventoryQueryEvent[] = []
    const inventory = createInventoryReaderForTest({
      query: input.query,
      preflight,
      maxResults: 20,
      observe: (event) => {
        events.push(event)
      },
    })

    await inventory.query("6001ZZ").catch(() => undefined)

    expect(events.map((event) => event.type)).toEqual(["query_started", "query_failed"])
    expect(JSON.stringify(events)).not.toContain("secret")
  })

  test("exposes no generic SQL or write method", () => {
    const input = executor([[]])
    const inventory = createInventoryReaderForTest({
      query: input.query,
      preflight,
      maxResults: 20,
    })

    expect(Object.keys(inventory).sort()).toEqual(["close", "preflight", "query"])
    expect("execute" in inventory).toBeFalse()
    expect("write" in inventory).toBeFalse()
    expect("sql" in inventory).toBeFalse()
  })
})
