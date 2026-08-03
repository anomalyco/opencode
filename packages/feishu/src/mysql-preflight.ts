export type QueryExecutor = (
  sql: string,
  values?: readonly unknown[],
) => Promise<readonly Record<string, unknown>[]>

export type MysqlPreflight = {
  mysqlVersion: string
  database: string
  currentUser: string
  readOnly: boolean
  standardRunID: string
  contractVersion: "mysql-inventory-v2"
}

const identitySQL = `
  SELECT
    VERSION() AS mysql_version,
    DATABASE() AS database_name,
    CURRENT_USER() AS authenticated_account,
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
      'Storage',
      'erp_standard_product_sync_run',
      'vw_standard_inventory_product',
      'vw_standard_product_shelf'
    )
`

const activeRunSQL = `
  SELECT
    run_id,
    JSON_UNQUOTE(JSON_EXTRACT(validation_json, '$.valid')) AS validation_valid
  FROM erp_standard_product_sync_run
  WHERE status = 'APPLIED'
`

const requiredColumns = [
  ["Storage.Prod_ID", "int", "NO", "BASE TABLE", ""],
  ["Storage.Prod_Number1", "decimal", "NO", "BASE TABLE", ""],
  ["erp_standard_product_sync_run.run_id", "char", "NO", "BASE TABLE", "PRI"],
  ["erp_standard_product_sync_run.status", "varchar", "NO", "BASE TABLE", ""],
  ["erp_standard_product_sync_run.validation_json", "json", "YES", "BASE TABLE", ""],
  ["vw_standard_inventory_product.standard_product_id", "varchar", "YES", "VIEW", ""],
  ["vw_standard_inventory_product.run_id", "char", "NO", "VIEW", ""],
  ["vw_standard_inventory_product.source_row", "int", "NO", "VIEW", ""],
  ["vw_standard_inventory_product.product_code", "varchar", "NO", "VIEW", ""],
  ["vw_standard_inventory_product.product_name", "varchar", "NO", "VIEW", ""],
  ["vw_standard_inventory_product.origin", "longtext", "YES", "VIEW", ""],
  ["vw_standard_inventory_product.specification", "longtext", "YES", "VIEW", ""],
  ["vw_standard_inventory_product.model", "longtext", "YES", "VIEW", ""],
  ["vw_standard_inventory_product.remark", "longtext", "YES", "VIEW", ""],
  ["vw_standard_inventory_product.product_id", "int", "YES", "VIEW", ""],
  ["vw_standard_inventory_product.mapping_status", "varchar", "YES", "VIEW", ""],
  ["vw_standard_inventory_product.total_inventory", "varchar", "YES", "VIEW", ""],
  ["vw_standard_product_shelf.standard_product_id", "varchar", "YES", "VIEW", ""],
  ["vw_standard_product_shelf.run_id", "char", "NO", "VIEW", ""],
  ["vw_standard_product_shelf.source_row", "int", "NO", "VIEW", ""],
  ["vw_standard_product_shelf.shelf_code", "varchar", "NO", "VIEW", ""],
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
  const mysqlVersion = text(identity.mysql_version)
  const database = text(identity.database_name)
  const currentUser = text(identity.authenticated_account)
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
  if (
    !requiredColumns.every(([key, dataType, nullable, tableType, columnKey]) => {
      const actual = columns.get(key)
      return (
        actual?.dataType === dataType &&
        actual.nullable === nullable &&
        actual.tableType === tableType &&
        (!columnKey || actual.columnKey === columnKey)
      )
    })
  ) {
    throw new Error("schema mismatch")
  }

  const activeRuns = await query(activeRunSQL)
  if (activeRuns.length !== 1 || text(activeRuns[0].validation_valid) !== "true") {
    throw new Error("active standard run mismatch")
  }
  return {
    mysqlVersion,
    database,
    currentUser,
    readOnly,
    standardRunID: text(activeRuns[0].run_id),
    contractVersion: "mysql-inventory-v2",
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
