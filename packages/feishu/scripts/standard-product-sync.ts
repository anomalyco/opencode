import { join, resolve } from "node:path"
import { parseArgs } from "node:util"
import {
  createConnection,
  type Connection,
  type ResultSetHeader,
  type RowDataPacket,
} from "mysql2/promise"
import { loadMysqlPassword, parseMysqlConfig } from "../src/mysql-config"
import {
  assertStandardProductApplyGuards,
  assertStandardProductValidation,
  buildStandardProductPreview,
  executeStandardProductTransaction,
  fingerprintStorageTotals,
  legacyProductCandidates,
  sanitizeStandardProductError,
  standardProductApplyStatements,
  standardProductRollbackStatements,
  standardProductRollbackValidationChecks,
  standardProductSetupStatements,
  standardProductStageStatements,
  standardProductValidationChecks,
  type StandardProductCheck,
  type StandardProductConnection,
  type StandardProductDatabaseSnapshot,
  type StandardProductStatement,
  type StandardProductValidation,
  type StandardProductWorkbook,
} from "../src/standard-product-sync"

type Mode = "Preview" | "Apply" | "Validate" | "Rollback"

const parsed = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    mode: { type: "string" },
    workbook: { type: "string" },
    "expected-sha256": { type: "string" },
    "expected-row-count": { type: "string" },
    "expected-matched": { type: "string" },
    "expected-missing": { type: "string" },
    "expected-ambiguous": { type: "string" },
    "expected-active-run": { type: "string" },
    "run-id": { type: "string" },
  },
  strict: true,
})

run().catch((error) => {
  console.error(sanitizeStandardProductError(error))
  process.exitCode = 1
})

async function run() {
  const mode = requireMode(parsed.values.mode)
  const config = parseMysqlConfig(process.env)
  const workbookPath = parsed.values.workbook ? resolve(parsed.values.workbook) : null
  if ((mode === "Preview" || mode === "Apply") && !workbookPath) {
    throw new Error("--workbook is required")
  }
  const password = await loadMysqlPassword(config)
  const connection = await createConnection({
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.user,
    password,
    connectTimeout: config.connectTimeoutMs,
    decimalNumbers: false,
    multipleStatements: false,
    supportBigNumbers: true,
    bigNumberStrings: true,
  })
  await dispatch(mode, connection, config.queryTimeoutMs, workbookPath).finally(() =>
    connection.end(),
  )
}

async function dispatch(
  mode: Mode,
  connection: Connection,
  timeout: number,
  workbookPath: string | null,
) {
  if (mode === "Validate") {
    await validate(connection, timeout, parsed.values["run-id"])
    return
  }
  if (mode === "Rollback") {
    await rollback(connection, timeout, requireOption(parsed.values["run-id"], "--run-id"))
    return
  }

  const workbook = await readWorkbook(workbookPath!)
  const snapshot = await loadDatabaseSnapshot(connection, timeout)
  const preview = buildStandardProductPreview(workbook, snapshot)
  const report = previewReport(mode, preview)
  if (mode === "Preview") {
    console.log(JSON.stringify(report, null, 2))
    return
  }

  assertStandardProductApplyGuards(
    {
      ...preview.workbook,
      mappings: preview.mappings,
      activeRunID: preview.database.activeRunID,
    },
    {
    expectedSha256: requireOption(parsed.values["expected-sha256"], "--expected-sha256"),
    expectedRowCount: requirePositiveInteger(
      parsed.values["expected-row-count"],
      "--expected-row-count",
    ),
      expectedMappings: {
        MATCHED: requireNonnegativeInteger(parsed.values["expected-matched"], "--expected-matched"),
        MISSING: requireNonnegativeInteger(parsed.values["expected-missing"], "--expected-missing"),
        AMBIGUOUS: requireNonnegativeInteger(
          parsed.values["expected-ambiguous"],
          "--expected-ambiguous",
        ),
      },
      expectedActiveRunID: expectedActiveRun(parsed.values["expected-active-run"]),
    },
  )
  if (snapshot.readOnly) throw new Error("database is read-only")
  const oversized = preview.mappingDetails.find(
    (mapping) => mapping.status === "MATCHED" && mapping.row.name.length > 60,
  )
  if (oversized) throw new Error(`Product.u_Name exceeds 60 characters at row ${oversized.row.sourceRow}`)

  for (const statement of standardProductSetupStatements()) {
    await execute(connection, timeout, statement)
  }
  const activeRuns = await queryRows(
    connection,
    timeout,
    "SELECT run_id FROM erp_standard_product_sync_run WHERE status='APPLIED' ORDER BY applied_at DESC",
  )
  if (activeRuns.length > 1) throw new Error("more than one active standard product run")
  const runID = crypto.randomUUID()
  const previousRunID = activeRuns[0] ? requiredText(activeRuns[0], "run_id") : null
  const candidates = new Map(snapshot.candidates.map((candidate) => [candidate.productID, candidate]))
  const matched = preview.mappingDetails.filter((mapping) => mapping.status === "MATCHED")
  const adapter = transactionAdapter(connection, timeout)
  let validation: ReturnType<typeof assertStandardProductValidation> | undefined
  await executeStandardProductTransaction(
    adapter,
    [
      ...standardProductStageStatements({ runID, previousRunID, preview }),
      ...standardProductApplyStatements(runID, {
        matchedProducts: matched.length,
        changedProducts: preview.differences.products,
        existingShelfRelations: matched.reduce(
          (total, mapping) => total + candidates.get(mapping.productID!)!.shelves.length,
          0,
        ),
        existingShelfEvidence: matched.reduce(
          (total, mapping) => total + (candidates.get(mapping.productID!)!.shelfEvidenceCount ?? 0),
          0,
        ),
        replacementShelves: matched.reduce(
          (total, mapping) => total + mapping.row.shelves.length,
          0,
        ),
        previousRun: previousRunID !== null,
      }),
    ],
    async () => {
      validation = assertStandardProductValidation(
        await loadValidation(connection, timeout, runID),
        {
          expectedRows: preview.workbook.rowCount,
          expectedStorageFingerprint: preview.storage.fingerprint,
        },
      )
      const result = await execute(connection, timeout, {
        name: "record_validation",
        sql: "UPDATE erp_standard_product_sync_run SET validation_json=? WHERE run_id=? AND status='APPLIED'",
        values: [JSON.stringify(validation), runID],
        expectedAffectedRows: 1,
      })
      if (result.affectedRows !== 1) throw new Error("record_validation affected unexpected rows")
    },
  )
  console.log(JSON.stringify({ ...report, databaseWrites: "committed", runID, validation }, null, 2))
}

async function validate(connection: Connection, timeout: number, selectedRunID: string | undefined) {
  const rows = await queryRows(
    connection,
    timeout,
    selectedRunID
      ? "SELECT run_id, row_count, storage_fingerprint, status FROM erp_standard_product_sync_run WHERE run_id=?"
      : "SELECT run_id, row_count, storage_fingerprint, status FROM erp_standard_product_sync_run WHERE status='APPLIED' ORDER BY applied_at DESC LIMIT 1",
    selectedRunID ? [selectedRunID] : [],
  )
  if (rows.length !== 1) throw new Error("standard product run was not found")
  const runID = requiredText(rows[0]!, "run_id")
  if (requiredText(rows[0]!, "status") !== "APPLIED") throw new Error("run is not active")
  const result = assertStandardProductValidation(await loadValidation(connection, timeout, runID), {
    expectedRows: requiredCount(rows[0]!, "row_count"),
    expectedStorageFingerprint: requiredText(rows[0]!, "storage_fingerprint"),
  })
  console.log(JSON.stringify({ mode: "Validate", runID, validation: result }, null, 2))
}

async function rollback(connection: Connection, timeout: number, runID: string) {
  const rows = await queryRows(
    connection,
    timeout,
    `SELECT run_id, previous_run_id, storage_fingerprint, status
      FROM erp_standard_product_sync_run WHERE run_id=?`,
    [runID],
  )
  if (rows.length !== 1 || requiredText(rows[0]!, "status") !== "APPLIED") {
    throw new Error("active standard product run was not found")
  }
  const previousRunID = optionalDatabaseText(rows[0]!, "previous_run_id")
  const expectedStorageFingerprint = requiredText(rows[0]!, "storage_fingerprint")
  await executeStandardProductTransaction(
    transactionAdapter(connection, timeout),
    standardProductRollbackStatements(runID),
    async () => {
      const storage = await loadStorageState(connection, timeout)
      if (storage.fingerprint !== expectedStorageFingerprint) throw new Error("Storage fingerprint changed")
      const statuses = await queryRows(
        connection,
        timeout,
        `SELECT
          SUM(run_id=? AND status='ROLLED_BACK') AS rolled_back,
          SUM(status='APPLIED') AS active_runs,
          SUM(run_id=? AND status='APPLIED') AS previous_active
        FROM erp_standard_product_sync_run`,
        [runID, previousRunID ?? ""],
      )
      if (
        requiredCount(statuses[0]!, "rolled_back") !== 1 ||
        requiredCount(statuses[0]!, "active_runs") !== (previousRunID ? 1 : 0) ||
        requiredCount(statuses[0]!, "previous_active") !== (previousRunID ? 1 : 0)
      ) {
        throw new Error("rollback run status validation failed")
      }
      const restore = await queryRows(
        connection,
        timeout,
        `SELECT COUNT(*) AS value
          FROM erp_standard_product_backup AS backup
          JOIN Product AS product ON product.s_ID=backup.product_id
          WHERE backup.run_id=? AND NOT (
            product.u_Name <=> backup.old_name
            AND product.ProdArea <=> backup.old_origin
            AND product.ProdType <=> backup.old_type
            AND product.ProdSpec <=> backup.old_spec
            AND product.u_Remark <=> backup.old_remark
          )`,
        [runID],
      )
      if (requiredCount(restore[0]!, "value") !== 0) throw new Error("Product rollback validation failed")
      for (const check of standardProductRollbackValidationChecks(runID)) {
        if ((await loadCheck(connection, timeout, check)) !== 0) {
          throw new Error(`${check.name} expected 0`)
        }
      }
    },
  )
  console.log(JSON.stringify({ mode: "Rollback", runID, previousRunID, valid: true }, null, 2))
}

async function readWorkbook(path: string): Promise<StandardProductWorkbook> {
  const process = Bun.spawn(["python", join(import.meta.dir, "read-standard-product-workbook.py"), path], {
    stdout: "pipe",
    stderr: "pipe",
  })
  const output = await new Response(process.stdout).text()
  const error = await new Response(process.stderr).text()
  if ((await process.exited) !== 0) throw new Error(`workbook reader failed: ${error.trim()}`)
  const value = JSON.parse(output) as unknown
  if (!isRecord(value) || typeof value.fileName !== "string" || typeof value.sha256 !== "string") {
    throw new Error("workbook reader returned an invalid document")
  }
  if (!Array.isArray(value.rows) || !value.rows.every(Array.isArray)) {
    throw new Error("workbook reader returned invalid rows")
  }
  return { fileName: value.fileName, sha256: value.sha256, rows: value.rows }
}

async function loadDatabaseSnapshot(
  connection: Connection,
  timeout: number,
): Promise<StandardProductDatabaseSnapshot> {
  const identity = await queryRows(
    connection,
    timeout,
    `SELECT DATABASE() AS database_name, VERSION() AS version_name,
      CURRENT_USER() AS current_user_name, @@read_only AS read_only_value`,
  )
  if (identity.length !== 1) throw new Error("database identity query failed")
  const products = await queryRows(
    connection,
    timeout,
    `SELECT CAST(s_ID AS CHAR) AS product_id, CAST(TRIM(u_Code) AS CHAR) AS product_code,
      CAST(u_Name AS CHAR) AS product_name, CAST(ProdArea AS CHAR) AS product_origin,
      CAST(ProdType AS CHAR) AS product_type, CAST(ProdSpec AS CHAR) AS product_spec,
      CAST(u_Remark AS CHAR) AS product_remark
      FROM Product WHERE CHAR_LENGTH(TRIM(COALESCE(u_Code, ''))) > 0 ORDER BY s_ID`,
  )
  const shelves = await queryRows(
    connection,
    timeout,
    `SELECT CAST(ProductID AS CHAR) AS product_id, CAST(ShelfCode AS CHAR) AS shelf_code
      FROM vw_productshelflocation ORDER BY ProductID, ShelfCode, RelationID`,
  )
  const evidence = await queryRows(
    connection,
    timeout,
    `SELECT CAST(s_ID AS CHAR) AS product_id, CAST(COUNT(*) AS CHAR) AS evidence_count
      FROM ProductShelfLocationEvidence GROUP BY s_ID ORDER BY s_ID`,
  )
  const evidenceByProduct = new Map(
    evidence.map((row) => [requiredText(row, "product_id"), requiredCount(row, "evidence_count")]),
  )
  const standardRunTable = await queryRows(
    connection,
    timeout,
    `SELECT COUNT(*) AS table_count FROM information_schema.TABLES
      WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='erp_standard_product_sync_run'`,
  )
  const activeRuns =
    requiredCount(standardRunTable[0]!, "table_count") === 1
      ? await queryRows(
          connection,
          timeout,
          "SELECT run_id FROM erp_standard_product_sync_run WHERE status='APPLIED' ORDER BY applied_at DESC",
        )
      : []
  if (activeRuns.length > 1) throw new Error("more than one active standard product run")
  const storage = await loadStorageState(connection, timeout)
  return {
    database: requiredText(identity[0]!, "database_name"),
    version: requiredText(identity[0]!, "version_name"),
    currentUser: requiredText(identity[0]!, "current_user_name"),
    readOnly: requiredCount(identity[0]!, "read_only_value") !== 0,
    storageFingerprint: storage.fingerprint,
    storageRowCount: storage.rowCount,
    candidates: legacyProductCandidates(products, shelves).map((candidate) => ({
      ...candidate,
      shelfEvidenceCount: evidenceByProduct.get(String(candidate.productID)) ?? 0,
    })),
    activeRunID: activeRuns[0] ? requiredText(activeRuns[0], "run_id") : null,
  }
}

async function loadStorageState(connection: Connection, timeout: number) {
  const counts = await queryRows(
    connection,
    timeout,
    "SELECT CAST(COUNT(*) AS CHAR) AS row_count FROM Storage",
  )
  const totals = await queryRows(
    connection,
    timeout,
    `SELECT CAST(Prod_ID AS CHAR) AS product_id,
      CAST(COALESCE(SUM(Prod_Number1), 0) AS CHAR) AS total_inventory
      FROM Storage GROUP BY Prod_ID ORDER BY Prod_ID`,
  )
  const rowCount = requiredCount(counts[0]!, "row_count")
  return { rowCount, fingerprint: fingerprintStorageTotals(rowCount, totals) }
}

async function loadValidation(connection: Connection, timeout: number, runID: string) {
  const values = new Map<string, number>()
  for (const check of standardProductValidationChecks(runID)) {
    values.set(check.name, await loadCheck(connection, timeout, check))
  }
  const storage = await loadStorageState(connection, timeout)
  return {
    standardRows: requiredCheck(values, "standard_rows"),
    duplicateCodes: requiredCheck(values, "duplicate_codes"),
    mappingRows: requiredCheck(values, "mapping_rows"),
    derivedRemarkMismatches: requiredCheck(values, "derived_remark_mismatches"),
    matchedProductMismatches: requiredCheck(values, "matched_product_mismatches"),
    shelfMismatches: requiredCheck(values, "shelf_mismatches"),
    shelfOrphans: requiredCheck(values, "shelf_orphans"),
    shelfDuplicates: requiredCheck(values, "shelf_duplicates"),
    activeRuns: requiredCheck(values, "active_runs"),
    storageFingerprint: storage.fingerprint,
  } satisfies StandardProductValidation
}

async function loadCheck(connection: Connection, timeout: number, check: StandardProductCheck) {
  const rows = await queryRows(connection, timeout, check.sql, check.values)
  if (rows.length !== 1) throw new Error(`${check.name} returned unexpected rows`)
  return requiredCount(rows[0]!, "value")
}

function transactionAdapter(connection: Connection, timeout: number) {
  return {
    beginTransaction: () => connection.beginTransaction(),
    execute: (statement) => execute(connection, timeout, statement),
    commit: () => connection.commit(),
    rollback: () => connection.rollback(),
  } satisfies StandardProductConnection
}

async function execute(connection: Connection, timeout: number, statement: StandardProductStatement) {
  const result = await connection.execute<ResultSetHeader>({ sql: statement.sql, timeout }, [
    ...(statement.values ?? []),
  ])
  return { affectedRows: Array.isArray(result[0]) ? 0 : result[0].affectedRows }
}

async function queryRows(
  connection: Connection,
  timeout: number,
  sql: string,
  values: readonly unknown[] = [],
) {
  const result = await connection.execute<RowDataPacket[]>({ sql, timeout }, [...values])
  return result[0] as Record<string, unknown>[]
}

function previewReport(mode: "Preview" | "Apply", preview: ReturnType<typeof buildStandardProductPreview>) {
  return {
    mode,
    workbook: preview.workbook,
    database: preview.database,
    storage: preview.storage,
    mappings: preview.mappings,
    differences: preview.differences,
    standardShelfRows: preview.rows.reduce((total, row) => total + row.shelves.length, 0),
    databaseOnlyCodeCount: preview.databaseOnlyCodes.length,
    databaseWrites: preview.databaseWrites,
  }
}

function requireMode(value: string | undefined): Mode {
  if (value === "Preview" || value === "Apply" || value === "Validate" || value === "Rollback") {
    return value
  }
  throw new Error("--mode must be Preview, Apply, Validate, or Rollback")
}

function requireOption(value: string | undefined, name: string) {
  if (value?.trim()) return value.trim()
  throw new Error(`${name} is required`)
}

function requirePositiveInteger(value: string | undefined, name: string) {
  const parsed = Number(requireOption(value, name))
  if (Number.isSafeInteger(parsed) && parsed > 0) return parsed
  throw new Error(`${name} is invalid`)
}

function requireNonnegativeInteger(value: string | undefined, name: string) {
  const parsed = Number(requireOption(value, name))
  if (Number.isSafeInteger(parsed) && parsed >= 0) return parsed
  throw new Error(`${name} is invalid`)
}

function expectedActiveRun(value: string | undefined) {
  const expected = requireOption(value, "--expected-active-run")
  return expected.toUpperCase() === "NONE" ? null : expected
}

function requiredText(row: Record<string, unknown>, name: string) {
  const value = optionalDatabaseText(row, name)
  if (value) return value
  throw new Error(`database result is missing ${name}`)
}

function optionalDatabaseText(row: Record<string, unknown>, name: string) {
  const value = row[name]
  if (value === null || value === undefined) return null
  if (typeof value === "string" || typeof value === "number" || typeof value === "bigint") {
    return String(value)
  }
  throw new Error(`database result has invalid ${name}`)
}

function requiredCount(row: Record<string, unknown>, name: string) {
  const value = Number(requiredText(row, name))
  if (Number.isSafeInteger(value) && value >= 0) return value
  throw new Error(`database result has invalid ${name}`)
}

function requiredCheck(values: ReadonlyMap<string, number>, name: string) {
  const value = values.get(name)
  if (value !== undefined) return value
  throw new Error(`validation result is missing ${name}`)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
