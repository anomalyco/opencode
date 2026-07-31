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
  ["Product", "s_ID", "int", "NO", "PRI", "BASE TABLE"],
  ["Product", "u_Name", "varchar", "YES", "", "BASE TABLE"],
  ["Product", "ProdSpec", "longtext", "YES", "", "BASE TABLE"],
  ["Product", "ProdType", "longtext", "YES", "", "BASE TABLE"],
  ["Product", "u_Remark", "longtext", "YES", "", "BASE TABLE"],
  ["Storage", "Prod_ID", "int", "NO", "", "BASE TABLE"],
  ["Storage", "Prod_Number1", "decimal", "NO", "", "BASE TABLE"],
  ["vw_productshelflocation", "ShelfCode", "varchar", "NO", "", "VIEW"],
  ["vw_productshelflocation", "ProductID", "int", "NO", "", "VIEW"],
  ["erp_inventory_source_projection", "product_ref_kind", "varchar", "NO", "", "BASE TABLE"],
  ["erp_inventory_source_projection", "product_ref_id", "varchar", "NO", "", "BASE TABLE"],
  ["erp_inventory_source_projection", "source_ref_kind", "varchar", "NO", "", "BASE TABLE"],
  ["erp_inventory_source_projection", "source_ref_id", "varchar", "NO", "", "BASE TABLE"],
  ["erp_inventory_source_projection", "on_hand_qty", "decimal", "NO", "", "BASE TABLE"],
  ["erp_partner_overlay", "id", "char", "NO", "PRI", "BASE TABLE"],
  ["erp_partner_overlay", "legacy_id", "bigint", "YES", "", "BASE TABLE"],
  ["erp_partner_overlay", "role", "varchar", "NO", "", "BASE TABLE"],
  ["erp_partner_overlay", "name", "varchar", "YES", "", "BASE TABLE"],
  ["erp_partner_overlay", "enabled", "tinyint", "NO", "", "BASE TABLE"],
  ["erp_partner_overlay", "deleted", "tinyint", "NO", "", "BASE TABLE"],
].map(([table_name, column_name, data_type, nullable, column_key, table_type]) => ({
  table_name,
  column_name,
  data_type,
  nullable,
  column_key,
  table_type,
}))

function executor(input?: {
  identity?: readonly Record<string, unknown>[]
  columns?: readonly Record<string, unknown>[]
  error?: Error
}) {
  const calls: { sql: string; values: readonly unknown[] }[] = []
  const query: QueryExecutor = async (sql, values = []) => {
    calls.push({ sql, values })
    if (input?.error) throw input.error
    return calls.length === 1 ? (input?.identity ?? identityRows) : (input?.columns ?? columns)
  }
  return { calls, query }
}

describe("runMysqlPreflight", () => {
  test("accepts the confirmed MySQL 8.4 schema and records writable server state", async () => {
    const input = executor()

    expect(await runMysqlPreflight(input.query, "t1_full_20260717_133707")).toEqual({
      mysqlVersion: "8.4.10",
      database: "t1_full_20260717_133707",
      currentUser: "inventory_reader@%",
      readOnly: false,
      contractVersion: "mysql-inventory-v1",
    })
    expect(input.calls).toHaveLength(2)
    expect(input.calls[0]?.sql).toContain("CURRENT_USER() AS authenticated_account")
    expect(input.calls[1]?.values).toEqual(["t1_full_20260717_133707"])
  })

  test("fails closed for a wrong database identity", async () => {
    const input = executor({
      identity: [{ ...identityRows[0], database_name: "other_schema" }],
    })

    expect(runMysqlPreflight(input.query, "t1_full_20260717_133707")).rejects.toThrow("MySQL preflight failed")
    expect(input.calls).toHaveLength(1)
  })

  test("fails closed for an unsupported MySQL version", async () => {
    const input = executor({
      identity: [{ ...identityRows[0], mysql_version: "5.7.44" }],
    })

    expect(runMysqlPreflight(input.query, "t1_full_20260717_133707")).rejects.toThrow("MySQL preflight failed")
  })

  test("fails closed for a missing or incompatible required column", async () => {
    const missing = executor({
      columns: columns.filter(
        (column) => !(column.table_name === "vw_productshelflocation" && column.column_name === "ShelfCode"),
      ),
    })
    const incompatible = executor({
      columns: columns.map((column) =>
        column.table_name === "Storage" && column.column_name === "Prod_Number1"
          ? { ...column, data_type: "varchar" }
          : column,
      ),
    })

    expect(runMysqlPreflight(missing.query, "t1_full_20260717_133707")).rejects.toThrow("MySQL preflight failed")
    expect(runMysqlPreflight(incompatible.query, "t1_full_20260717_133707")).rejects.toThrow("MySQL preflight failed")
  })

  test("requires the shelf relation to remain a view and the product key to remain primary", async () => {
    const changedView = executor({
      columns: columns.map((column) =>
        column.table_name === "vw_productshelflocation" ? { ...column, table_type: "BASE TABLE" } : column,
      ),
    })
    const changedKey = executor({
      columns: columns.map((column) =>
        column.table_name === "Product" && column.column_name === "s_ID" ? { ...column, column_key: "" } : column,
      ),
    })

    expect(runMysqlPreflight(changedView.query, "t1_full_20260717_133707")).rejects.toThrow(
      "MySQL preflight failed",
    )
    expect(runMysqlPreflight(changedKey.query, "t1_full_20260717_133707")).rejects.toThrow(
      "MySQL preflight failed",
    )
  })

  test("removes credential-bearing driver errors", async () => {
    const input = executor({ error: new Error("password=secret-value") })
    const error = errorValue(
      await runMysqlPreflight(input.query, "t1_full_20260717_133707").catch((value: unknown) => value),
    )

    expect(error.message).toBe("MySQL preflight failed")
    expect(error.message).not.toContain("secret-value")
    expect(error.cause).toBeUndefined()
  })
})

function errorValue(value: unknown) {
  if (!(value instanceof Error)) throw new Error("expected an Error")
  return value
}
