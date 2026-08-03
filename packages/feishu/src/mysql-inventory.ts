import { createPool, type RowDataPacket } from "mysql2/promise"
import type { InventoryAnswerItem } from "./inventory-answer"
import { mapInventoryRows, type ProductRow, type ShelfRow } from "./inventory-mapper"
import { loadMysqlPassword, type MysqlConfig } from "./mysql-config"
import { runMysqlPreflight, type MysqlPreflight, type QueryExecutor } from "./mysql-preflight"

export type InventoryQueryEvent =
  | {
      type: "query_started"
      templateVersion: "mysql-inventory-v2"
      term: string
      limit: number
    }
  | {
      type: "query_completed"
      templateVersion: "mysql-inventory-v2"
      rowCount: number
      durationMs: number
    }
  | {
      type: "query_failed"
      templateVersion: "mysql-inventory-v2"
      durationMs: number
    }

export type MysqlInventory = {
  preflight: MysqlPreflight
  query(
    term: string,
    limit?: number,
    observe?: (event: InventoryQueryEvent) => void | Promise<void>,
  ): Promise<InventoryAnswerItem[]>
  close(): Promise<void>
}

const productSQL = `
  SELECT
    product.standard_product_id AS product_id,
    product.product_name,
    product.model AS product_spec,
    product.specification AS product_attribute,
    product.remark AS product_remark,
    product.origin AS supplier_name,
    product.total_inventory
  FROM vw_standard_inventory_product AS product
  WHERE product.product_name LIKE ? ESCAPE '\\\\'
     OR product.product_code = ?
     OR product.model LIKE ? ESCAPE '\\\\'
  ORDER BY product.source_row
  LIMIT 100
`

const shelfSQL = `
  SELECT
    shelf.standard_product_id AS product_id,
    shelf.shelf_code
  FROM vw_standard_product_shelf AS shelf
  JOIN JSON_TABLE(
    ?,
    '$[*]' COLUMNS(product_id VARCHAR(96) PATH '$')
  ) AS selected ON selected.product_id = shelf.standard_product_id
  ORDER BY shelf.source_row, shelf.shelf_code
`

export async function createMysqlInventory(
  config: MysqlConfig,
  observe?: (event: InventoryQueryEvent) => void | Promise<void>,
): Promise<MysqlInventory> {
  const password = await loadMysqlPassword(config)
  const pool = createPool({
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.user,
    password,
    connectTimeout: config.connectTimeoutMs,
    connectionLimit: 4,
    decimalNumbers: false,
    multipleStatements: false,
    supportBigNumbers: true,
    bigNumberStrings: true,
  })
  const query: QueryExecutor = async (sql, values = []) => {
    const result = await pool.execute<RowDataPacket[]>({ sql, timeout: config.queryTimeoutMs }, [
      ...values,
    ])
    return result[0]
  }
  const preflight = await runMysqlPreflight(query, config.database).catch(async (error) => {
    await pool.end().catch(() => undefined)
    throw error
  })

  return createInventoryReader({
    query,
    preflight,
    maxResults: config.maxResults,
    observe,
    close: () => pool.end(),
  })
}

export function createInventoryReaderForTest(input: {
  query: QueryExecutor
  preflight: MysqlPreflight
  maxResults: number
  observe?: (event: InventoryQueryEvent) => void | Promise<void>
}): MysqlInventory {
  return createInventoryReader({ ...input, close: async () => {} })
}

function createInventoryReader(input: {
  query: QueryExecutor
  preflight: MysqlPreflight
  maxResults: number
  observe?: (event: InventoryQueryEvent) => void | Promise<void>
  close(): Promise<void>
}): MysqlInventory {
  return {
    preflight: input.preflight,
    async query(term, limit = input.maxResults, observe) {
      const normalized = term.trim()
      if (!normalized) throw new Error("商品查询条件不能为空。")
      if (!Number.isInteger(limit) || limit < 1 || limit > input.maxResults) {
        throw new Error("商品查询数量无效。")
      }

      const startedAt = Date.now()
      const started = {
        type: "query_started",
        templateVersion: "mysql-inventory-v2",
        term: normalized,
        limit,
      } satisfies InventoryQueryEvent
      await input.observe?.(started)
      await observe?.(started)

      return readInventory(input.query, normalized, limit)
        .then(async (result) => {
          const completed = {
            type: "query_completed",
            templateVersion: "mysql-inventory-v2",
            rowCount: result.rowCount,
            durationMs: Date.now() - startedAt,
          } satisfies InventoryQueryEvent
          await input.observe?.(completed)
          await observe?.(completed)
          return result.items
        })
        .catch(async () => {
          const failed = {
            type: "query_failed",
            templateVersion: "mysql-inventory-v2",
            durationMs: Date.now() - startedAt,
          } satisfies InventoryQueryEvent
          await input.observe?.(failed)
          await observe?.(failed)
          throw new Error("库存查询失败，请稍后再试。")
        })
    },
    close: () => input.close(),
  }
}

async function readInventory(query: QueryExecutor, term: string, limit: number) {
  const escaped = like(term)
  const products = productRows(await query(productSQL, [escaped, term, escaped])).slice(0, limit)
  if (products.length === 0) return { items: [], rowCount: 0 }

  const shelves = shelfRows(
    await query(shelfSQL, [JSON.stringify(products.map((product) => product.productID))]),
  )
  return {
    items: mapInventoryRows({ products, shelves }),
    rowCount: products.length + shelves.length,
  }
}

function productRows(rows: readonly Record<string, unknown>[]): ProductRow[] {
  return rows.map((row) => ({
    productID: requiredString(row, "product_id"),
    name: nullableString(row, "product_name"),
    spec: nullableString(row, "product_spec"),
    attribute: nullableString(row, "product_attribute"),
    remark: nullableString(row, "product_remark"),
    supplier: nullableString(row, "supplier_name"),
    totalInventory: requiredString(row, "total_inventory"),
  }))
}

function shelfRows(rows: readonly Record<string, unknown>[]): ShelfRow[] {
  return rows.map((row) => ({
    productID: requiredString(row, "product_id"),
    shelfCode: requiredString(row, "shelf_code"),
  }))
}

function requiredString(row: Record<string, unknown>, key: string) {
  const value = nullableString(row, key)
  if (!value?.trim()) throw new Error("inventory row contract mismatch")
  return value
}

function nullableString(row: Record<string, unknown>, key: string) {
  const value = row[key]
  if (value === null || value === undefined) return null
  if (typeof value !== "string") throw new Error("inventory row contract mismatch")
  return value
}

function like(value: string) {
  return `%${value.replace(/([%_\\])/g, "\\$1")}%`
}
