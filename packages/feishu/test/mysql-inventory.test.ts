import { describe, expect, test } from "bun:test"
import { createInventoryReaderForTest, type InventoryQueryEvent } from "../src/mysql-inventory"
import type { QueryExecutor } from "../src/mysql-preflight"

const preflight = {
  mysqlVersion: "8.4.10",
  database: "t1_full_20260717_133707",
  currentUser: "inventory_reader@%",
  readOnly: false,
  standardRunID: "run-1",
  contractVersion: "mysql-inventory-v2" as const,
}

const productRows = [
  {
    product_id: "run-1:2",
    product_name: "6001ZZ",
    product_spec: "12*28*8",
    product_attribute: "清油",
    product_remark: "xxx",
    supplier_name: "虎旺",
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
  test("queries only the authoritative product and shelf projections", async () => {
    const input = executor([productRows, [{ product_id: "run-1:2", shelf_code: "B-11-13" }]])
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
        supplier: "虎旺",
        inventory: "200",
        remark: "xxx",
      },
    ])
    expect(input.calls).toHaveLength(2)
    expect(input.calls[0]?.sql).toContain("FROM vw_standard_inventory_product AS product")
    expect(input.calls[1]?.sql).toContain("FROM vw_standard_product_shelf AS shelf")
    expect(input.calls.map((call) => call.sql).join("\n")).not.toMatch(
      /\bProduct\s+AS|\bListBuy\b|\bMasterBill\b|\bUnits\b|erp_inventory_source_projection|erp_partner_overlay/,
    )
    expect(input.calls[0]?.values).toEqual(["%6001ZZ%", "6001ZZ", "%6001ZZ%"])
    expect(input.calls[1]?.values).toEqual(['["run-1:2"]'])
    expect(events.map((event) => event.type)).toEqual(["query_started", "query_completed"])
    expect(events[1]).toMatchObject({ rowCount: 2, templateVersion: "mysql-inventory-v2" })
  })

  test("keeps injection text in parameters and escapes LIKE wildcards", async () => {
    const normal = executor([[]])
    const attempted = executor([[]])
    const normalInventory = createInventoryReaderForTest({ query: normal.query, preflight, maxResults: 20 })
    const attemptedInventory = createInventoryReaderForTest({ query: attempted.query, preflight, maxResults: 20 })
    const term = "60%_\\01' OR 1=1 --"

    await normalInventory.query("6001ZZ")
    await attemptedInventory.query(term)

    expect(attempted.calls[0]?.sql).toBe(normal.calls[0]?.sql)
    expect(attempted.calls[0]?.sql).not.toContain(term)
    expect(attempted.calls[0]?.values).toEqual([
      "%60\\%\\_\\\\01' OR 1=1 --%",
      term,
      "%60\\%\\_\\\\01' OR 1=1 --%",
    ])
  })

  test("does not query shelves after an empty product result", async () => {
    const input = executor([[]])
    const inventory = createInventoryReaderForTest({ query: input.query, preflight, maxResults: 20 })
    expect(await inventory.query("missing")).toEqual([])
    expect(input.calls).toHaveLength(1)
  })

  test("uses a fixed SQL cap and applies the requested limit before shelf reads", async () => {
    const input = executor([
      [
        ...productRows,
        { ...productRows[0], product_id: "run-1:3", total_inventory: "8.00000000" },
      ],
      [],
    ])
    const inventory = createInventoryReaderForTest({ query: input.query, preflight, maxResults: 20 })
    expect(await inventory.query("6001ZZ", 1)).toHaveLength(1)
    expect(input.calls[0]?.sql).toContain("LIMIT 100")
    expect(input.calls[1]?.values).toEqual(['["run-1:2"]'])
  })

  test("fails closed for driver and malformed row errors", async () => {
    const driver = createInventoryReaderForTest({
      query: executor([new Error("password=secret-value")]).query,
      preflight,
      maxResults: 20,
    })
    const malformed = createInventoryReaderForTest({
      query: executor([[{ ...productRows[0], total_inventory: "200件" }], []]).query,
      preflight,
      maxResults: 20,
    })
    expect(driver.query("6001ZZ")).rejects.toThrow()
    expect(malformed.query("6001ZZ")).rejects.toThrow()
  })

  test("exposes no generic SQL or write method", () => {
    const inventory = createInventoryReaderForTest({ query: executor([[]]).query, preflight, maxResults: 20 })
    expect(Object.keys(inventory).sort()).toEqual(["close", "preflight", "query"])
    expect("execute" in inventory).toBeFalse()
    expect("write" in inventory).toBeFalse()
    expect("sql" in inventory).toBeFalse()
  })
})
