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
    columns.TABLE_NAME AS table_name,
    columns.COLUMN_NAME AS column_name,
    columns.DATA_TYPE AS data_type,
    columns.IS_NULLABLE AS nullable,
    columns.COLUMN_KEY AS column_key,
    tables.TABLE_TYPE AS table_type
  FROM information_schema.COLUMNS AS columns
  JOIN information_schema.TABLES AS tables
    ON tables.TABLE_SCHEMA = columns.TABLE_SCHEMA
   AND tables.TABLE_NAME = columns.TABLE_NAME
  WHERE columns.TABLE_SCHEMA = ?
    AND columns.TABLE_NAME IN (
      'Product',
      'Storage',
      'vw_productshelflocation',
      'erp_inventory_source_projection',
      'erp_partner_overlay'
    )
`

const requiredColumns = [
  ["Product.s_ID", "int", "NO", "BASE TABLE", "PRI"],
  ["Product.u_Name", "varchar", "YES", "BASE TABLE", ""],
  ["Product.ProdSpec", "longtext", "YES", "BASE TABLE", ""],
  ["Product.ProdType", "longtext", "YES", "BASE TABLE", ""],
  ["Product.u_Remark", "longtext", "YES", "BASE TABLE", ""],
  ["Storage.Prod_ID", "int", "NO", "BASE TABLE", ""],
  ["Storage.Prod_Number1", "decimal", "NO", "BASE TABLE", ""],
  ["vw_productshelflocation.ShelfCode", "varchar", "NO", "VIEW", ""],
  ["vw_productshelflocation.ProductID", "int", "NO", "VIEW", ""],
  ["erp_inventory_source_projection.product_ref_kind", "varchar", "NO", "BASE TABLE", ""],
  ["erp_inventory_source_projection.product_ref_id", "varchar", "NO", "BASE TABLE", ""],
  ["erp_inventory_source_projection.source_ref_kind", "varchar", "NO", "BASE TABLE", ""],
  ["erp_inventory_source_projection.source_ref_id", "varchar", "NO", "BASE TABLE", ""],
  ["erp_inventory_source_projection.on_hand_qty", "decimal", "NO", "BASE TABLE", ""],
  ["erp_partner_overlay.id", "char", "NO", "BASE TABLE", "PRI"],
  ["erp_partner_overlay.legacy_id", "bigint", "YES", "BASE TABLE", ""],
  ["erp_partner_overlay.role", "varchar", "NO", "BASE TABLE", ""],
  ["erp_partner_overlay.name", "varchar", "YES", "BASE TABLE", ""],
  ["erp_partner_overlay.enabled", "tinyint", "NO", "BASE TABLE", ""],
  ["erp_partner_overlay.deleted", "tinyint", "NO", "BASE TABLE", ""],
] as const

export function runMysqlPreflight(query: QueryExecutor, expectedDatabase: string) {
  return inspectMysql(query, expectedDatabase).catch(() => {
    throw new Error("MySQL preflight failed")
  })
}

async function inspectMysql(query: QueryExecutor, expectedDatabase: string): Promise<MysqlPreflight> {
  const identityRows = await query(identitySQL)
  if (identityRows.length !== 1) throw new Error("identity mismatch")
  const identity = identityRows[0]
  if (!identity) throw new Error("identity mismatch")

  const mysqlVersion = text(identity.mysql_version)
  const database = text(identity.database_name)
  const currentUser = text(identity.current_user)
  const readOnly = booleanFlag(identity.read_only)
  if (!mysqlVersion.startsWith("8.4.") || database !== expectedDatabase || !currentUser) {
    throw new Error("identity mismatch")
  }

  const columns = new Map(
    (await query(columnsSQL, [expectedDatabase])).map((row) => [
      `${text(row.table_name)}.${text(row.column_name)}`,
      {
        dataType: text(row.data_type),
        nullable: text(row.nullable),
        columnKey: string(row.column_key),
        tableType: text(row.table_type),
      },
    ]),
  )
  const compatible = requiredColumns.every(([key, dataType, nullable, tableType, columnKey]) => {
    const actual = columns.get(key)
    if (!actual) return false
    return (
      actual.dataType === dataType &&
      actual.nullable === nullable &&
      actual.tableType === tableType &&
      (!columnKey || actual.columnKey === columnKey)
    )
  })
  if (!compatible) throw new Error("schema mismatch")

  return {
    mysqlVersion,
    database,
    currentUser,
    readOnly,
    contractVersion: "mysql-inventory-v1",
  }
}

function text(value: unknown) {
  const result = string(value).trim()
  if (!result) throw new Error("field mismatch")
  return result
}

function string(value: unknown) {
  if (typeof value !== "string") throw new Error("field mismatch")
  return value
}

function booleanFlag(value: unknown) {
  if (value === 0 || value === "0") return false
  if (value === 1 || value === "1") return true
  throw new Error("field mismatch")
}
