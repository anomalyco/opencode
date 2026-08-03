import { describe, expect, test } from "bun:test"
import { runMysqlPreflight, type QueryExecutor } from "../src/mysql-preflight"

const identityRows = [
  {
    mysql_version: "8.4.10",
    database_name: "t1_full_20260717_133707",
    authenticated_account: "inventory_reader@%",
    read_only: 0,
  },
]

const columns = [
  ["Storage", "Prod_ID", "int", "NO", "", "BASE TABLE"],
  ["Storage", "Prod_Number1", "decimal", "NO", "", "BASE TABLE"],
  ["erp_standard_product_sync_run", "run_id", "char", "NO", "PRI", "BASE TABLE"],
  ["erp_standard_product_sync_run", "status", "varchar", "NO", "MUL", "BASE TABLE"],
  ["erp_standard_product_sync_run", "validation_json", "json", "YES", "", "BASE TABLE"],
  ["vw_standard_inventory_product", "standard_product_id", "varchar", "YES", "", "VIEW"],
  ["vw_standard_inventory_product", "run_id", "char", "NO", "", "VIEW"],
  ["vw_standard_inventory_product", "source_row", "int", "NO", "", "VIEW"],
  ["vw_standard_inventory_product", "product_code", "varchar", "NO", "", "VIEW"],
  ["vw_standard_inventory_product", "product_name", "varchar", "NO", "", "VIEW"],
  ["vw_standard_inventory_product", "origin", "longtext", "YES", "", "VIEW"],
  ["vw_standard_inventory_product", "specification", "longtext", "YES", "", "VIEW"],
  ["vw_standard_inventory_product", "model", "longtext", "YES", "", "VIEW"],
  ["vw_standard_inventory_product", "remark", "longtext", "YES", "", "VIEW"],
  ["vw_standard_inventory_product", "product_id", "int", "YES", "", "VIEW"],
  ["vw_standard_inventory_product", "mapping_status", "varchar", "YES", "", "VIEW"],
  ["vw_standard_inventory_product", "total_inventory", "varchar", "YES", "", "VIEW"],
  ["vw_standard_product_shelf", "standard_product_id", "varchar", "YES", "", "VIEW"],
  ["vw_standard_product_shelf", "run_id", "char", "NO", "", "VIEW"],
  ["vw_standard_product_shelf", "source_row", "int", "NO", "", "VIEW"],
  ["vw_standard_product_shelf", "shelf_code", "varchar", "NO", "", "VIEW"],
].map(([table_name, column_name, data_type, nullable, column_key, table_type]) => ({
  table_name,
  column_name,
  data_type,
  nullable,
  column_key,
  table_type,
}))

const activeRun = [{ run_id: "run-1", validation_valid: "true" }]

function executor(input?: {
  identity?: readonly Record<string, unknown>[]
  columns?: readonly Record<string, unknown>[]
  activeRun?: readonly Record<string, unknown>[]
  error?: Error
}) {
  const calls: { sql: string; values: readonly unknown[] }[] = []
  const query: QueryExecutor = async (sql, values = []) => {
    calls.push({ sql, values })
    if (input?.error) throw input.error
    if (calls.length === 1) return input?.identity ?? identityRows
    if (calls.length === 2) return input?.columns ?? columns
    return input?.activeRun ?? activeRun
  }
  return { calls, query }
}

describe("runMysqlPreflight", () => {
  test("accepts the authoritative views and records the validated active run", async () => {
    const input = executor()
    expect(await runMysqlPreflight(input.query, "t1_full_20260717_133707")).toEqual({
      mysqlVersion: "8.4.10",
      database: "t1_full_20260717_133707",
      currentUser: "inventory_reader@%",
      readOnly: false,
      standardRunID: "run-1",
      contractVersion: "mysql-inventory-v2",
    })
    expect(input.calls).toHaveLength(3)
    expect(input.calls[1]?.sql).toContain("vw_standard_inventory_product")
    expect(input.calls[1]?.sql).toContain("vw_standard_product_shelf")
    expect(input.calls[1]?.sql).not.toMatch(/ListBuy|MasterBill|Units|erp_partner_overlay/)
    expect(input.calls[2]?.sql).toContain("validation_json")
  })

  test("fails closed for a missing authoritative field or a legacy replacement", async () => {
    const missing = executor({
      columns: columns.filter(
        (column) =>
          !(column.table_name === "vw_standard_inventory_product" && column.column_name === "origin"),
      ),
    })
    const changedView = executor({
      columns: columns.map((column) =>
        column.table_name === "vw_standard_product_shelf"
          ? { ...column, table_type: "BASE TABLE" }
          : column,
      ),
    })
    expect(runMysqlPreflight(missing.query, "t1_full_20260717_133707")).rejects.toThrow(
      "MySQL preflight failed",
    )
    expect(runMysqlPreflight(changedView.query, "t1_full_20260717_133707")).rejects.toThrow(
      "MySQL preflight failed",
    )
  })

  test("fails closed without exactly one validated active run", async () => {
    expect(
      runMysqlPreflight(executor({ activeRun: [] }).query, "t1_full_20260717_133707"),
    ).rejects.toThrow("MySQL preflight failed")
    expect(
      runMysqlPreflight(
        executor({ activeRun: [{ run_id: "run-1", validation_valid: "false" }] }).query,
        "t1_full_20260717_133707",
      ),
    ).rejects.toThrow("MySQL preflight failed")
  })

  test("fails closed for wrong database/version and sanitizes driver errors", async () => {
    expect(
      runMysqlPreflight(
        executor({ identity: [{ ...identityRows[0], database_name: "other" }] }).query,
        "t1_full_20260717_133707",
      ),
    ).rejects.toThrow("MySQL preflight failed")
    expect(
      runMysqlPreflight(
        executor({ identity: [{ ...identityRows[0], mysql_version: "5.7.44" }] }).query,
        "t1_full_20260717_133707",
      ),
    ).rejects.toThrow("MySQL preflight failed")
    const error = await runMysqlPreflight(
      executor({ error: new Error("password=secret-value") }).query,
      "t1_full_20260717_133707",
    ).catch((value: unknown) => value)
    expect(error).toBeInstanceOf(Error)
    expect(String(error)).not.toContain("secret-value")
  })
})
