import { createPool, type RowDataPacket } from "mysql2/promise"
import type { InventoryAnswerItem } from "./inventory-answer"
import {
  mapInventoryRows,
  type InventorySourceRow,
  type ProductRow,
  type ShelfRow,
} from "./inventory-mapper"
import { loadMysqlPassword, type MysqlConfig } from "./mysql-config"
import {
  runMysqlPreflight,
  type MysqlPreflight,
  type QueryExecutor,
} from "./mysql-preflight"

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
  | {
      type: "query_failed"
      templateVersion: "mysql-inventory-v1"
      durationMs: number
    }

export type MysqlInventory = {
  preflight: MysqlPreflight
  query(term: string, limit?: number): Promise<InventoryAnswerItem[]>
  close(): Promise<void>
}

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
  LIMIT 100
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
    const [rows] = await pool.execute<RowDataPacket[]>({ sql, timeout: config.queryTimeoutMs }, [...values])
    return rows
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
  return createInventoryReader({
    ...input,
    close: async () => {},
  })
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
    async query(term, limit = input.maxResults) {
      const normalized = term.trim()
      if (!normalized) throw new Error("商品查询条件不能为空。")
      if (!Number.isInteger(limit) || limit < 1 || limit > input.maxResults) {
        throw new Error("商品查询数量无效。")
      }

      const startedAt = Date.now()
      await input.observe?.({
        type: "query_started",
        templateVersion: "mysql-inventory-v1",
        term: normalized,
        limit,
      })

      return readInventory(input.query, normalized, limit)
        .then(async (result) => {
          await input.observe?.({
            type: "query_completed",
            templateVersion: "mysql-inventory-v1",
            rowCount: result.rowCount,
            durationMs: Date.now() - startedAt,
          })
          return result.items
        })
        .catch(async () => {
          await input.observe?.({
            type: "query_failed",
            templateVersion: "mysql-inventory-v1",
            durationMs: Date.now() - startedAt,
          })
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

  const productIDs = JSON.stringify(products.map((product) => Number(product.productID)))
  const [shelves, sources] = await Promise.all([
    query(shelfSQL, [productIDs]).then(shelfRows),
    query(sourceSQL, [productIDs]).then(sourceRows),
  ])

  return {
    items: mapInventoryRows({ products, shelves, sources }),
    rowCount: products.length + shelves.length + sources.length,
  }
}

function productRows(rows: readonly Record<string, unknown>[]): ProductRow[] {
  return rows.map((row) => {
    const productID = requiredString(row, "product_id")
    if (!/^\d+$/.test(productID)) throw new Error("inventory row contract mismatch")

    return {
      productID,
      name: nullableString(row, "product_name"),
      spec: nullableString(row, "product_spec"),
      attribute: nullableString(row, "product_attribute"),
      remark: nullableString(row, "product_remark"),
      totalInventory: requiredString(row, "total_inventory"),
    }
  })
}

function shelfRows(rows: readonly Record<string, unknown>[]): ShelfRow[] {
  return rows.map((row) => ({
    productID: requiredString(row, "product_id"),
    shelfCode: requiredString(row, "shelf_code"),
  }))
}

function sourceRows(rows: readonly Record<string, unknown>[]): InventorySourceRow[] {
  return rows.map((row) => ({
    productID: requiredString(row, "product_id"),
    sourceRefKind: requiredString(row, "source_ref_kind"),
    sourceRefID: requiredString(row, "source_ref_id"),
    onHandQty: requiredString(row, "on_hand_qty"),
    supplierID: nullableString(row, "supplier_id"),
    supplierLegacyID: nullableString(row, "supplier_legacy_id"),
    supplierName: nullableString(row, "supplier_name"),
    supplierRole: nullableString(row, "supplier_role"),
    supplierEnabled: nullableFlag(row, "supplier_enabled"),
    supplierDeleted: nullableFlag(row, "supplier_deleted"),
  }))
}

function requiredString(row: Record<string, unknown>, key: string) {
  const value = nullableString(row, key)
  if (value === null || !value.trim()) throw new Error("inventory row contract mismatch")
  return value
}

function nullableString(row: Record<string, unknown>, key: string) {
  const value = row[key]
  if (value === null) return null
  if (typeof value !== "string") throw new Error("inventory row contract mismatch")
  return value
}

function nullableFlag(row: Record<string, unknown>, key: string) {
  const value = row[key]
  if (value === null) return null
  if (value === 0 || value === 1) return value
  if (value === "0") return 0
  if (value === "1") return 1
  throw new Error("inventory row contract mismatch")
}

function like(term: string) {
  return `%${term.replace(/[\\%_]/g, "\\$&")}%`
}
