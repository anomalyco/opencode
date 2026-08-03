export const STANDARD_PRODUCT_HEADERS = [
  "原始行号",
  "商品编码",
  "商品名称",
  "产地",
  "数量",
  "盘点日期",
  "货架号",
  "规格",
  "型号",
  "备注",
] as const

export type StandardProductRow = {
  sourceRow: number
  originalRow: string
  code: string
  name: string
  origin: string
  workbookQuantity: string
  inventoryDate: string | null
  shelves: string[]
  specification: string | null
  model: string | null
  sourceRemark: string | null
  remark: string | null
  shelfText: string
}

export type LegacyProductCandidate = {
  productID: number
  code: string
  name: string
  origin: string
  specification: string | null
  model: string | null
  remark: string | null
  shelves: string[]
  shelfEvidenceCount?: number
}

export type StandardProductMapping = {
  row: StandardProductRow
  status: "MATCHED" | "MISSING" | "AMBIGUOUS"
  productID?: number
  candidateProductIDs: number[]
}

export type StandardProductStatement = {
  name: string
  sql: string
  values?: readonly unknown[]
  expectedAffectedRows?: number
}

export type StandardProductCheck = {
  name: string
  sql: string
  values: readonly unknown[]
}

export type StandardProductValidation = {
  standardRows: number
  duplicateCodes: number
  mappingRows: number
  derivedRemarkMismatches: number
  matchedProductMismatches: number
  shelfMismatches: number
  shelfOrphans: number
  shelfDuplicates: number
  activeRuns: number
  storageFingerprint: string
}

export type StandardProductConnection = {
  beginTransaction(): Promise<void>
  execute(statement: StandardProductStatement): Promise<{ affectedRows: number }>
  commit(): Promise<void>
  rollback(): Promise<void>
}

export type StandardProductWorkbook = {
  fileName: string
  sha256: string
  rows: readonly (readonly unknown[])[]
}

export type StandardProductDatabaseSnapshot = {
  database: string
  version: string
  currentUser: string
  readOnly: boolean
  storageFingerprint: string
  storageRowCount: number
  candidates: readonly LegacyProductCandidate[]
  activeRunID?: string | null
}

const shelfPattern = /([A-Da-d])\s*[-－—–]\s*(\d{1,2})\s*[-－—–]\s*(\d{1,2})(?!\d)/g
const shelfSeparatorPattern = /^(?:(?:非标)|[+＋,，、;；/\\|\s])*$/

export function normalizeStandardProductRows(input: readonly (readonly unknown[])[]) {
  if (!sameHeaders(input[0])) throw new Error("workbook headers do not match")
  const codes = new Set<string>()
  return input.slice(1).flatMap((raw, index) => {
    if (raw.every((value) => !text(value))) return []
    const sourceRow = index + 2
    const code = text(raw[1])
    if (!code) throw new Error(`blank product code at row ${sourceRow}`)
    if (codes.has(code)) throw new Error(`duplicate product code: ${code}`)
    codes.add(code)
    const inventoryDate = optionalText(raw[5])
    const sourceRemark = optionalText(raw[9])
    const shelfText = text(raw[6])
    const shelves = normalizeShelves(shelfText, sourceRow)
    return [
      {
        sourceRow,
        originalRow: text(raw[0]),
        code,
        name: text(raw[2]),
        origin: text(raw[3]),
        workbookQuantity: decimal(raw[4], sourceRow),
        inventoryDate,
        shelves,
        specification: optionalText(raw[7]),
        model: optionalText(raw[8]),
        sourceRemark,
        remark: [inventoryDate, sourceRemark].filter((value) => value !== null).join("；") || null,
        shelfText,
      } satisfies StandardProductRow,
    ]
  })
}

export function reconcileStandardProducts(
  rows: readonly StandardProductRow[],
  candidates: readonly LegacyProductCandidate[],
) {
  const byCode = Map.groupBy(candidates, (candidate) => candidate.code.trim())
  return rows.map((row): StandardProductMapping => {
    const matches = (byCode.get(row.code) ?? []).toSorted(
      (left, right) => left.productID - right.productID,
    )
    const candidateProductIDs = matches.map((candidate) => candidate.productID)
    if (!matches.length) return { row, status: "MISSING", candidateProductIDs }
    if (matches.length === 1) {
      return { row, status: "MATCHED", productID: matches[0].productID, candidateProductIDs }
    }
    const exact = matches.filter((candidate) => sameApprovedFields(row, candidate))
    if (exact.length !== 1) return { row, status: "AMBIGUOUS", candidateProductIDs }
    return { row, status: "MATCHED", productID: exact[0].productID, candidateProductIDs }
  })
}

export function buildStandardProductPreview(
  workbook: StandardProductWorkbook,
  database: StandardProductDatabaseSnapshot,
) {
  if (!/^[a-f\d]{64}$/i.test(workbook.sha256)) throw new Error("workbook SHA-256 is invalid")
  const rows = normalizeStandardProductRows(workbook.rows)
  const mappingDetails = reconcileStandardProducts(rows, database.candidates)
  const candidateByID = new Map(
    database.candidates.map((candidate) => [candidate.productID, candidate]),
  )
  const differences = {
    products: 0,
    names: 0,
    origins: 0,
    specifications: 0,
    models: 0,
    remarks: 0,
    shelves: 0,
  }
  for (const mapping of mappingDetails) {
    if (mapping.status !== "MATCHED") continue
    const candidate = candidateByID.get(mapping.productID!)
    if (!candidate) throw new Error("matched Product candidate is missing")
    const changed =
      mapping.row.name !== candidate.name.trim() ||
      mapping.row.origin !== candidate.origin.trim() ||
      mapping.row.specification !== optionalText(candidate.specification) ||
      mapping.row.model !== optionalText(candidate.model) ||
      mapping.row.remark !== optionalText(candidate.remark)
    if (changed) differences.products++
    if (mapping.row.name !== candidate.name.trim()) differences.names++
    if (mapping.row.origin !== candidate.origin.trim()) differences.origins++
    if (mapping.row.specification !== optionalText(candidate.specification)) differences.specifications++
    if (mapping.row.model !== optionalText(candidate.model)) differences.models++
    if (mapping.row.remark !== optionalText(candidate.remark)) differences.remarks++
    if (mapping.row.shelves.join("\0") !== candidate.shelves.toSorted(compareShelves).join("\0")) {
      differences.shelves++
    }
  }
  const standardCodes = new Set(rows.map((row) => row.code))
  const databaseOnlyCodes = [
    ...new Set(database.candidates.map((candidate) => candidate.code.trim()).filter(Boolean)),
  ].filter((code) => !standardCodes.has(code)).toSorted()
  return {
    workbook: {
      fileName: workbook.fileName,
      sha256: workbook.sha256.toLowerCase(),
      rowCount: rows.length,
      headers: [...STANDARD_PRODUCT_HEADERS],
    },
    database: {
      database: database.database,
      version: database.version,
      currentUser: database.currentUser,
      readOnly: database.readOnly,
      databaseOnlyCodeCount: databaseOnlyCodes.length,
      activeRunID: database.activeRunID ?? null,
    },
    storage: {
      fingerprint: database.storageFingerprint,
      rowCount: database.storageRowCount,
    },
    mappings: {
      MATCHED: mappingDetails.filter((mapping) => mapping.status === "MATCHED").length,
      MISSING: mappingDetails.filter((mapping) => mapping.status === "MISSING").length,
      AMBIGUOUS: mappingDetails.filter((mapping) => mapping.status === "AMBIGUOUS").length,
    },
    differences,
    databaseWrites: 0,
    rows,
    mappingDetails,
    databaseOnlyCodes,
  }
}

export function assertStandardProductApplyGuards(
  workbook: {
    sha256: string
    rowCount: number
    mappings?: { MATCHED: number; MISSING: number; AMBIGUOUS: number }
    activeRunID?: string | null
  },
  expected: {
    expectedSha256: string
    expectedRowCount: number
    expectedMappings?: { MATCHED: number; MISSING: number; AMBIGUOUS: number }
    expectedActiveRunID?: string | null
  },
) {
  if (workbook.sha256.toLowerCase() !== expected.expectedSha256.toLowerCase()) {
    throw new Error("workbook SHA-256 changed")
  }
  if (workbook.rowCount !== expected.expectedRowCount) {
    throw new Error("workbook row count changed")
  }
  if (
    expected.expectedMappings &&
    (!workbook.mappings ||
      workbook.mappings.MATCHED !== expected.expectedMappings.MATCHED ||
      workbook.mappings.MISSING !== expected.expectedMappings.MISSING ||
      workbook.mappings.AMBIGUOUS !== expected.expectedMappings.AMBIGUOUS)
  ) {
    throw new Error("mapping counts changed")
  }
  if (
    expected.expectedActiveRunID !== undefined &&
    (workbook.activeRunID ?? null) !== expected.expectedActiveRunID
  ) {
    throw new Error("active standard run changed")
  }
}

export function legacyProductCandidates(
  productRows: readonly Record<string, unknown>[],
  shelfRows: readonly Record<string, unknown>[],
) {
  const shelves = Map.groupBy(shelfRows, (row) => requiredString(row, "product_id"))
  return productRows
    .map((row): LegacyProductCandidate => {
      const productID = Number(requiredString(row, "product_id"))
      if (!Number.isSafeInteger(productID) || productID < 0) {
        throw new Error("legacy Product ID is invalid")
      }
      return {
        productID,
        code: requiredString(row, "product_code").trim(),
        name: nullableDatabaseString(row, "product_name") ?? "",
        origin: nullableDatabaseString(row, "product_origin") ?? "",
        specification: cleanLegacyProductText(nullableDatabaseString(row, "product_type")),
        model: cleanLegacyProductText(nullableDatabaseString(row, "product_spec")),
        remark: optionalText(nullableDatabaseString(row, "product_remark")),
        shelves: [
          ...new Set(
            (shelves.get(String(productID)) ?? []).flatMap((shelf) =>
              normalizeShelves(requiredString(shelf, "shelf_code"), 0),
            ),
          ),
        ].toSorted(compareShelves),
      }
    })
    .toSorted((left, right) => left.productID - right.productID)
}

export function fingerprintStorageTotals(
  storageRowCount: number,
  rows: readonly Record<string, unknown>[],
) {
  const hasher = new Bun.CryptoHasher("sha256")
  hasher.update(`${storageRowCount}\0`)
  for (const row of rows.toSorted((left, right) =>
    requiredString(left, "product_id").localeCompare(requiredString(right, "product_id")),
  )) {
    hasher.update(requiredString(row, "product_id"))
    hasher.update("\0")
    hasher.update(decimal(requiredString(row, "total_inventory"), 0))
    hasher.update("\0")
  }
  return hasher.digest("hex")
}

export function standardProductSetupStatements(): StandardProductStatement[] {
  return [
    {
      name: "create_sync_run",
      sql: `CREATE TABLE IF NOT EXISTS erp_standard_product_sync_run (
        run_id CHAR(36) NOT NULL,
        source_file VARCHAR(255) NOT NULL,
        source_sha256 CHAR(64) NOT NULL,
        headers_json JSON NOT NULL,
        row_count INT UNSIGNED NOT NULL,
        status VARCHAR(16) NOT NULL,
        previous_run_id CHAR(36) NULL,
        storage_fingerprint CHAR(64) NOT NULL,
        validation_json JSON NULL,
        created_at DATETIME(6) NOT NULL,
        applied_at DATETIME(6) NULL,
        rolled_back_at DATETIME(6) NULL,
        PRIMARY KEY (run_id),
        KEY ix_standard_sync_run_status (status)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin`,
    },
    {
      name: "create_standard_product",
      sql: `CREATE TABLE IF NOT EXISTS erp_standard_product (
        run_id CHAR(36) NOT NULL,
        source_row INT UNSIGNED NOT NULL,
        original_row VARCHAR(64) NOT NULL,
        product_code VARCHAR(60) NOT NULL,
        product_name VARCHAR(255) NOT NULL,
        origin LONGTEXT NULL,
        workbook_quantity DECIMAL(38,8) NOT NULL,
        inventory_date LONGTEXT NULL,
        specification LONGTEXT NULL,
        model LONGTEXT NULL,
        source_remark LONGTEXT NULL,
        remark LONGTEXT NULL,
        shelf_text LONGTEXT NULL,
        PRIMARY KEY (run_id, source_row),
        UNIQUE KEY uq_standard_product_code (run_id, product_code),
        CONSTRAINT fk_standard_product_run FOREIGN KEY (run_id)
          REFERENCES erp_standard_product_sync_run (run_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin`,
    },
    {
      name: "add_inventory_date",
      sql: "ALTER TABLE erp_standard_product ADD COLUMN IF NOT EXISTS inventory_date LONGTEXT NULL AFTER workbook_quantity",
    },
    {
      name: "add_source_remark",
      sql: "ALTER TABLE erp_standard_product ADD COLUMN IF NOT EXISTS source_remark LONGTEXT NULL AFTER model",
    },
    {
      name: "create_standard_shelf",
      sql: `CREATE TABLE IF NOT EXISTS erp_standard_product_shelf (
        run_id CHAR(36) NOT NULL,
        source_row INT UNSIGNED NOT NULL,
        shelf_code VARCHAR(32) NOT NULL,
        source_text LONGTEXT NOT NULL,
        PRIMARY KEY (run_id, source_row, shelf_code),
        CONSTRAINT fk_standard_shelf_product FOREIGN KEY (run_id, source_row)
          REFERENCES erp_standard_product (run_id, source_row)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin`,
    },
    {
      name: "create_standard_map",
      sql: `CREATE TABLE IF NOT EXISTS erp_standard_product_map (
        run_id CHAR(36) NOT NULL,
        source_row INT UNSIGNED NOT NULL,
        product_id INT NULL,
        mapping_status VARCHAR(16) NOT NULL,
        candidate_product_ids JSON NOT NULL,
        PRIMARY KEY (run_id, source_row),
        UNIQUE KEY uq_standard_map_product (run_id, product_id),
        CONSTRAINT fk_standard_map_product_row FOREIGN KEY (run_id, source_row)
          REFERENCES erp_standard_product (run_id, source_row),
        CONSTRAINT fk_standard_map_legacy_product FOREIGN KEY (product_id)
          REFERENCES Product (s_ID)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin`,
    },
    {
      name: "create_product_backup",
      sql: `CREATE TABLE IF NOT EXISTS erp_standard_product_backup (
        run_id CHAR(36) NOT NULL,
        product_id INT NOT NULL,
        old_name VARCHAR(60) NULL,
        old_origin LONGTEXT NULL,
        old_type LONGTEXT NULL,
        old_spec LONGTEXT NULL,
        old_remark LONGTEXT NULL,
        PRIMARY KEY (run_id, product_id),
        CONSTRAINT fk_standard_product_backup_run FOREIGN KEY (run_id)
          REFERENCES erp_standard_product_sync_run (run_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin`,
    },
    {
      name: "create_shelf_relation_backup",
      sql: `CREATE TABLE IF NOT EXISTS erp_standard_shelf_relation_backup (
        run_id CHAR(36) NOT NULL,
        product_shelf_location_id BIGINT UNSIGNED NOT NULL,
        product_id INT NOT NULL,
        shelf_location_id BIGINT UNSIGNED NOT NULL,
        first_seen_run_id CHAR(36) NOT NULL,
        last_seen_run_id CHAR(36) NOT NULL,
        created_at DATETIME(6) NOT NULL,
        updated_at DATETIME(6) NOT NULL,
        PRIMARY KEY (run_id, product_shelf_location_id),
        CONSTRAINT fk_standard_relation_backup_run FOREIGN KEY (run_id)
          REFERENCES erp_standard_product_sync_run (run_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin`,
    },
    {
      name: "create_shelf_evidence_backup",
      sql: `CREATE TABLE IF NOT EXISTS erp_standard_shelf_evidence_backup (
        run_id CHAR(36) NOT NULL,
        evidence_id BIGINT UNSIGNED NOT NULL,
        evidence_run_id CHAR(36) NOT NULL,
        product_id INT NOT NULL,
        shelf_location_id BIGINT UNSIGNED NOT NULL,
        product_code VARCHAR(60) NULL,
        product_name VARCHAR(60) NULL,
        shelf_code VARCHAR(32) NOT NULL,
        source_field VARCHAR(32) NOT NULL,
        source_start INT UNSIGNED NOT NULL,
        source_text LONGTEXT NOT NULL,
        raw_token VARCHAR(64) NOT NULL,
        parser_rule VARCHAR(64) NOT NULL,
        created_at DATETIME(6) NOT NULL,
        PRIMARY KEY (run_id, evidence_id),
        CONSTRAINT fk_standard_evidence_backup_run FOREIGN KEY (run_id)
          REFERENCES erp_standard_product_sync_run (run_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin`,
    },
    {
      name: "create_inventory_view",
      sql: `CREATE OR REPLACE VIEW vw_standard_inventory_product AS
        SELECT
          CONCAT(product.run_id, ':', product.source_row) AS standard_product_id,
          product.run_id,
          product.source_row,
          product.product_code,
          product.product_name,
          product.origin,
          product.specification,
          product.model,
          product.remark,
          mapping.product_id,
          mapping.mapping_status,
          CAST(CASE
            WHEN mapping.product_id IS NULL THEN product.workbook_quantity
            ELSE COALESCE(inventory.total_inventory, 0)
          END AS CHAR) AS total_inventory
        FROM erp_standard_product_sync_run AS sync_run
        JOIN erp_standard_product AS product ON product.run_id = sync_run.run_id
        LEFT JOIN erp_standard_product_map AS mapping
          ON mapping.run_id = product.run_id AND mapping.source_row = product.source_row
        LEFT JOIN (
          SELECT Prod_ID, SUM(Prod_Number1) AS total_inventory
          FROM Storage
          GROUP BY Prod_ID
        ) AS inventory ON inventory.Prod_ID = mapping.product_id
        WHERE sync_run.status = 'APPLIED'`,
    },
    {
      name: "create_shelf_view",
      sql: `CREATE OR REPLACE VIEW vw_standard_product_shelf AS
        SELECT
          CONCAT(shelf.run_id, ':', shelf.source_row) AS standard_product_id,
          shelf.run_id,
          shelf.source_row,
          shelf.shelf_code
        FROM erp_standard_product_sync_run AS sync_run
        JOIN erp_standard_product_shelf AS shelf ON shelf.run_id = sync_run.run_id
        WHERE sync_run.status = 'APPLIED'`,
    },
  ]
}

export function standardProductStageStatements(input: {
  runID: string
  previousRunID: string | null
  preview: ReturnType<typeof buildStandardProductPreview>
}): StandardProductStatement[] {
  const statements: StandardProductStatement[] = [
    {
      name: "stage_run",
      sql: `INSERT INTO erp_standard_product_sync_run
        (run_id, source_file, source_sha256, headers_json, row_count, status,
          previous_run_id, storage_fingerprint, created_at)
        VALUES (?, ?, ?, ?, ?, 'STAGED', ?, ?, NOW(6))`,
      values: [
        input.runID,
        input.preview.workbook.fileName,
        input.preview.workbook.sha256,
        JSON.stringify(input.preview.workbook.headers),
        input.preview.workbook.rowCount,
        input.previousRunID,
        input.preview.storage.fingerprint,
      ],
      expectedAffectedRows: 1,
    },
  ]
  for (const [index, rows] of chunks(input.preview.rows, 250).entries()) {
    statements.push({
      name: `stage_products_${index + 1}`,
      sql: `INSERT INTO erp_standard_product
        (run_id, source_row, original_row, product_code, product_name, origin,
          workbook_quantity, inventory_date, specification, model, source_remark, remark, shelf_text)
        VALUES ${rows.map(() => "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").join(", ")}`,
      values: rows.flatMap((row) => [
        input.runID,
        row.sourceRow,
        row.originalRow,
        row.code,
        row.name,
        row.origin || null,
        row.workbookQuantity,
        row.inventoryDate,
        row.specification,
        row.model,
        row.sourceRemark,
        row.remark,
        row.shelfText || null,
      ]),
      expectedAffectedRows: rows.length,
    })
  }
  const shelves = input.preview.rows.flatMap((row) =>
    row.shelves.map((shelf) => ({ row, shelf })),
  )
  for (const [index, rows] of chunks(shelves, 500).entries()) {
    statements.push({
      name: `stage_shelves_${index + 1}`,
      sql: `INSERT INTO erp_standard_product_shelf
        (run_id, source_row, shelf_code, source_text)
        VALUES ${rows.map(() => "(?, ?, ?, ?)").join(", ")}`,
      values: rows.flatMap((item) => [
        input.runID,
        item.row.sourceRow,
        item.shelf,
        item.row.shelfText,
      ]),
      expectedAffectedRows: rows.length,
    })
  }
  for (const [index, rows] of chunks(input.preview.mappingDetails, 500).entries()) {
    statements.push({
      name: `stage_mappings_${index + 1}`,
      sql: `INSERT INTO erp_standard_product_map
        (run_id, source_row, product_id, mapping_status, candidate_product_ids)
        VALUES ${rows.map(() => "(?, ?, ?, ?, ?)").join(", ")}`,
      values: rows.flatMap((mapping) => [
        input.runID,
        mapping.row.sourceRow,
        mapping.productID ?? null,
        mapping.status,
        JSON.stringify(mapping.candidateProductIDs),
      ]),
      expectedAffectedRows: rows.length,
    })
  }
  return statements
}

export function standardProductApplyStatements(
  runID = "",
  expected?: {
    matchedProducts: number
    changedProducts: number
    existingShelfRelations: number
    existingShelfEvidence: number
    replacementShelves: number
    previousRun: boolean
  },
): StandardProductStatement[] {
  return [
    {
      name: "lock_active_run",
      sql: "SELECT run_id FROM erp_standard_product_sync_run WHERE status='APPLIED' FOR UPDATE",
    },
    {
      name: "backup_products",
      sql: `INSERT INTO erp_standard_product_backup
        (run_id, product_id, old_name, old_origin, old_type, old_spec, old_remark)
        SELECT ?, product.s_ID, product.u_Name, product.ProdArea, product.ProdType,
          product.ProdSpec, product.u_Remark
        FROM Product AS product
        JOIN erp_standard_product_map AS mapping ON mapping.product_id = product.s_ID
        WHERE mapping.run_id = ? AND mapping.mapping_status = 'MATCHED'`,
      values: [runID, runID],
      expectedAffectedRows: expected?.matchedProducts,
    },
    {
      name: "backup_shelf_relations",
      sql: `INSERT INTO erp_standard_shelf_relation_backup
        SELECT ?, relation.product_shelf_location_id, relation.s_ID,
          relation.shelf_location_id, relation.first_seen_run_id, relation.last_seen_run_id,
          relation.created_at, relation.updated_at
        FROM ProductShelfLocation AS relation
        JOIN erp_standard_product_map AS mapping ON mapping.product_id = relation.s_ID
        WHERE mapping.run_id = ? AND mapping.mapping_status = 'MATCHED'`,
      values: [runID, runID],
      expectedAffectedRows: expected?.existingShelfRelations,
    },
    {
      name: "backup_shelf_evidence",
      sql: `INSERT INTO erp_standard_shelf_evidence_backup
        SELECT ?, evidence.evidence_id, evidence.run_id, evidence.s_ID,
          evidence.shelf_location_id, evidence.u_Code, evidence.u_Name,
          evidence.shelf_no, evidence.source_field, evidence.source_start,
          evidence.source_text, evidence.raw_token, evidence.parser_rule, evidence.created_at
        FROM ProductShelfLocationEvidence AS evidence
        JOIN erp_standard_product_map AS mapping ON mapping.product_id = evidence.s_ID
        WHERE mapping.run_id = ? AND mapping.mapping_status = 'MATCHED'`,
      values: [runID, runID],
      expectedAffectedRows: expected?.existingShelfEvidence,
    },
    {
      name: "update_products",
      sql: `UPDATE Product AS product
        JOIN erp_standard_product_map AS mapping ON mapping.product_id = product.s_ID
        JOIN erp_standard_product AS standard
          ON standard.run_id = mapping.run_id AND standard.source_row = mapping.source_row
        SET product.u_Name = standard.product_name,
          product.ProdArea = standard.origin,
          product.ProdType = standard.specification,
          product.ProdSpec = standard.model,
          product.u_Remark = standard.remark
        WHERE mapping.run_id = ? AND mapping.mapping_status = 'MATCHED'`,
      values: [runID],
      expectedAffectedRows: expected?.changedProducts,
    },
    {
      name: "delete_shelf_evidence",
      sql: `DELETE evidence FROM ProductShelfLocationEvidence AS evidence
        JOIN erp_standard_product_map AS mapping ON mapping.product_id = evidence.s_ID
        WHERE mapping.run_id = ? AND mapping.mapping_status = 'MATCHED'`,
      values: [runID],
      expectedAffectedRows: expected?.existingShelfEvidence,
    },
    {
      name: "delete_shelf_relations",
      sql: `DELETE relation FROM ProductShelfLocation AS relation
        JOIN erp_standard_product_map AS mapping ON mapping.product_id = relation.s_ID
        WHERE mapping.run_id = ? AND mapping.mapping_status = 'MATCHED'`,
      values: [runID],
      expectedAffectedRows: expected?.existingShelfRelations,
    },
    {
      name: "insert_shelf_dictionary",
      sql: `INSERT IGNORE INTO ShelfLocation
        (shelf_no, area_code, row_no, column_no, first_seen_run_id, created_at, updated_at)
        SELECT DISTINCT shelf.shelf_code, SUBSTRING_INDEX(shelf.shelf_code, '-', 1),
          CAST(SUBSTRING_INDEX(SUBSTRING_INDEX(shelf.shelf_code, '-', 2), '-', -1) AS UNSIGNED),
          CAST(SUBSTRING_INDEX(shelf.shelf_code, '-', -1) AS UNSIGNED),
          ?, NOW(6), NOW(6)
        FROM erp_standard_product_shelf AS shelf WHERE shelf.run_id = ?`,
      values: [runID, runID],
    },
    {
      name: "replace_shelf_relations",
      sql: `INSERT INTO ProductShelfLocation
        (s_ID, shelf_location_id, first_seen_run_id, last_seen_run_id, created_at, updated_at)
        SELECT mapping.product_id, location.shelf_location_id, ?, ?, NOW(6), NOW(6)
        FROM erp_standard_product_shelf AS shelf
        JOIN erp_standard_product_map AS mapping
          ON mapping.run_id = shelf.run_id AND mapping.source_row = shelf.source_row
        JOIN ShelfLocation AS location ON location.shelf_no = shelf.shelf_code
        WHERE shelf.run_id = ? AND mapping.mapping_status = 'MATCHED'`,
      values: [runID, runID, runID],
      expectedAffectedRows: expected?.replacementShelves,
    },
    {
      name: "replace_shelf_evidence",
      sql: `INSERT INTO ProductShelfLocationEvidence
        (run_id, s_ID, shelf_location_id, u_Code, u_Name, shelf_no, source_field,
          source_start, source_text, raw_token, parser_rule, created_at)
        SELECT ?, mapping.product_id, location.shelf_location_id, standard.product_code,
          standard.product_name, shelf.shelf_code, 'StandardWorkbook', 0,
          shelf.source_text, shelf.shelf_code, 'standard-workbook-v1', NOW(6)
        FROM erp_standard_product_shelf AS shelf
        JOIN erp_standard_product AS standard
          ON standard.run_id = shelf.run_id AND standard.source_row = shelf.source_row
        JOIN erp_standard_product_map AS mapping
          ON mapping.run_id = shelf.run_id AND mapping.source_row = shelf.source_row
        JOIN ShelfLocation AS location ON location.shelf_no = shelf.shelf_code
        WHERE shelf.run_id = ? AND mapping.mapping_status = 'MATCHED'`,
      values: [runID, runID],
      expectedAffectedRows: expected?.replacementShelves,
    },
    {
      name: "supersede_previous_run",
      sql: `UPDATE erp_standard_product_sync_run AS previous
        JOIN erp_standard_product_sync_run AS current ON current.run_id = ?
        SET previous.status = 'SUPERSEDED'
        WHERE previous.run_id = current.previous_run_id AND previous.status = 'APPLIED'`,
      values: [runID],
      expectedAffectedRows: expected ? Number(expected.previousRun) : undefined,
    },
    {
      name: "activate_run",
      sql: `UPDATE erp_standard_product_sync_run
        SET status='APPLIED', applied_at=NOW(6) WHERE run_id=? AND status='STAGED'`,
      values: [runID],
      expectedAffectedRows: 1,
    },
  ]
}

export function standardProductRollbackStatements(runID = ""): StandardProductStatement[] {
  return [
    {
      name: "lock_rollback_run",
      sql: "SELECT run_id FROM erp_standard_product_sync_run WHERE run_id=? AND status='APPLIED' FOR UPDATE",
      values: [runID],
    },
    {
      name: "delete_current_shelf_evidence",
      sql: `DELETE evidence FROM ProductShelfLocationEvidence AS evidence
        JOIN erp_standard_product_backup AS backup ON backup.product_id=evidence.s_ID
        WHERE backup.run_id=?`,
      values: [runID],
    },
    {
      name: "delete_current_shelf_relations",
      sql: `DELETE relation FROM ProductShelfLocation AS relation
        JOIN erp_standard_product_backup AS backup ON backup.product_id=relation.s_ID
        WHERE backup.run_id=?`,
      values: [runID],
    },
    {
      name: "restore_products",
      sql: `UPDATE Product AS product
        JOIN erp_standard_product_backup AS backup ON backup.product_id=product.s_ID
        SET product.u_Name=backup.old_name, product.ProdArea=backup.old_origin,
          product.ProdType=backup.old_type, product.ProdSpec=backup.old_spec,
          product.u_Remark=backup.old_remark
        WHERE backup.run_id=?`,
      values: [runID],
    },
    {
      name: "restore_shelf_relations",
      sql: `INSERT INTO ProductShelfLocation
        (product_shelf_location_id, s_ID, shelf_location_id, first_seen_run_id,
          last_seen_run_id, created_at, updated_at)
        SELECT product_shelf_location_id, product_id, shelf_location_id, first_seen_run_id,
          last_seen_run_id, created_at, updated_at
        FROM erp_standard_shelf_relation_backup WHERE run_id=?`,
      values: [runID],
    },
    {
      name: "restore_shelf_evidence",
      sql: `INSERT INTO ProductShelfLocationEvidence
        (evidence_id, run_id, s_ID, shelf_location_id, u_Code, u_Name, shelf_no,
          source_field, source_start, source_text, raw_token, parser_rule, created_at)
        SELECT evidence_id, evidence_run_id, product_id, shelf_location_id, product_code,
          product_name, shelf_code, source_field, source_start, source_text,
          raw_token, parser_rule, created_at
        FROM erp_standard_shelf_evidence_backup WHERE run_id=?`,
      values: [runID],
    },
    {
      name: "reactivate_previous_run",
      sql: `UPDATE erp_standard_product_sync_run AS previous
        JOIN erp_standard_product_sync_run AS current ON current.run_id=?
        SET previous.status='APPLIED'
        WHERE previous.run_id=current.previous_run_id AND previous.status='SUPERSEDED'`,
      values: [runID],
    },
    {
      name: "mark_run_rolled_back",
      sql: `UPDATE erp_standard_product_sync_run SET status='ROLLED_BACK',
        rolled_back_at=NOW(6) WHERE run_id=? AND status='APPLIED'`,
      values: [runID],
      expectedAffectedRows: 1,
    },
  ]
}

export function standardProductRollbackValidationChecks(runID: string): StandardProductCheck[] {
  return [
    {
      name: "restored_shelf_relation_mismatches",
      sql: `SELECT
        ABS(
          (SELECT COUNT(*) FROM ProductShelfLocation AS relation
            JOIN erp_standard_product_backup AS product_backup
              ON product_backup.run_id=? AND product_backup.product_id=relation.s_ID)
          -
          (SELECT COUNT(*) FROM erp_standard_shelf_relation_backup WHERE run_id=?)
        ) +
        (SELECT COUNT(*)
          FROM erp_standard_shelf_relation_backup AS backup
          LEFT JOIN ProductShelfLocation AS relation
            ON relation.product_shelf_location_id=backup.product_shelf_location_id
          WHERE backup.run_id=? AND NOT (
            relation.s_ID <=> backup.product_id
            AND relation.shelf_location_id <=> backup.shelf_location_id
            AND relation.first_seen_run_id <=> backup.first_seen_run_id
            AND relation.last_seen_run_id <=> backup.last_seen_run_id
            AND relation.created_at <=> backup.created_at
            AND relation.updated_at <=> backup.updated_at
          )
        ) AS value`,
      values: [runID, runID, runID],
    },
    {
      name: "restored_shelf_evidence_mismatches",
      sql: `SELECT
        ABS(
          (SELECT COUNT(*) FROM ProductShelfLocationEvidence AS evidence
            JOIN erp_standard_product_backup AS product_backup
              ON product_backup.run_id=? AND product_backup.product_id=evidence.s_ID)
          -
          (SELECT COUNT(*) FROM erp_standard_shelf_evidence_backup WHERE run_id=?)
        ) +
        (SELECT COUNT(*)
          FROM erp_standard_shelf_evidence_backup AS backup
          LEFT JOIN ProductShelfLocationEvidence AS evidence
            ON evidence.evidence_id=backup.evidence_id
          WHERE backup.run_id=? AND NOT (
            evidence.run_id <=> backup.evidence_run_id
            AND evidence.s_ID <=> backup.product_id
            AND evidence.shelf_location_id <=> backup.shelf_location_id
            AND evidence.u_Code <=> backup.product_code
            AND evidence.u_Name <=> backup.product_name
            AND evidence.shelf_no <=> backup.shelf_code
            AND evidence.source_field <=> backup.source_field
            AND evidence.source_start <=> backup.source_start
            AND evidence.source_text <=> backup.source_text
            AND evidence.raw_token <=> backup.raw_token
            AND evidence.parser_rule <=> backup.parser_rule
            AND evidence.created_at <=> backup.created_at
          )
        ) AS value`,
      values: [runID, runID, runID],
    },
  ]
}

export function standardProductValidationChecks(runID: string): StandardProductCheck[] {
  return [
    {
      name: "standard_rows",
      sql: "SELECT COUNT(*) AS value FROM erp_standard_product WHERE run_id=?",
      values: [runID],
    },
    {
      name: "duplicate_codes",
      sql: `SELECT COUNT(*) AS value FROM (
        SELECT product_code FROM erp_standard_product WHERE run_id=?
        GROUP BY product_code HAVING COUNT(*) > 1
      ) AS duplicates`,
      values: [runID],
    },
    {
      name: "mapping_rows",
      sql: "SELECT COUNT(*) AS value FROM erp_standard_product_map WHERE run_id=?",
      values: [runID],
    },
    {
      name: "derived_remark_mismatches",
      sql: `SELECT COUNT(*) AS value FROM erp_standard_product
        WHERE run_id=? AND NOT (
          remark <=> NULLIF(CONCAT_WS('；',
            NULLIF(TRIM(inventory_date), ''),
            NULLIF(TRIM(source_remark), '')
          ), '')
        )`,
      values: [runID],
    },
    {
      name: "matched_product_mismatches",
      sql: `SELECT COUNT(*) AS value
        FROM erp_standard_product_map AS mapping
        JOIN erp_standard_product AS standard
          ON standard.run_id=mapping.run_id AND standard.source_row=mapping.source_row
        JOIN Product AS product ON product.s_ID=mapping.product_id
        WHERE mapping.run_id=? AND mapping.mapping_status='MATCHED'
          AND NOT (
            product.u_Name <=> standard.product_name
            AND product.ProdArea <=> standard.origin
            AND product.ProdType <=> standard.specification
            AND product.ProdSpec <=> standard.model
            AND product.u_Remark <=> standard.remark
          )`,
      values: [runID],
    },
    {
      name: "shelf_mismatches",
      sql: `SELECT COUNT(*) AS value FROM (
        SELECT mapping.product_id, shelf.shelf_code
        FROM erp_standard_product_shelf AS shelf
        JOIN erp_standard_product_map AS mapping
          ON mapping.run_id=shelf.run_id AND mapping.source_row=shelf.source_row
        LEFT JOIN ShelfLocation AS location ON location.shelf_no=shelf.shelf_code
        LEFT JOIN ProductShelfLocation AS relation
          ON relation.s_ID=mapping.product_id
          AND relation.shelf_location_id=location.shelf_location_id
        WHERE shelf.run_id=? AND mapping.mapping_status='MATCHED'
          AND relation.product_shelf_location_id IS NULL
        UNION ALL
        SELECT relation.s_ID, location.shelf_no
        FROM ProductShelfLocation AS relation
        JOIN ShelfLocation AS location ON location.shelf_location_id=relation.shelf_location_id
        JOIN erp_standard_product_map AS mapping
          ON mapping.run_id=? AND mapping.product_id=relation.s_ID
          AND mapping.mapping_status='MATCHED'
        LEFT JOIN erp_standard_product_shelf AS shelf
          ON shelf.run_id=mapping.run_id AND shelf.source_row=mapping.source_row
          AND shelf.shelf_code=location.shelf_no
        WHERE shelf.shelf_code IS NULL
      ) AS mismatches`,
      values: [runID, runID],
    },
    {
      name: "shelf_orphans",
      sql: `SELECT COUNT(*) AS value
        FROM ProductShelfLocation AS relation
        LEFT JOIN Product AS product ON product.s_ID=relation.s_ID
        LEFT JOIN ShelfLocation AS location
          ON location.shelf_location_id=relation.shelf_location_id
        WHERE product.s_ID IS NULL OR location.shelf_location_id IS NULL`,
      values: [],
    },
    {
      name: "shelf_duplicates",
      sql: `SELECT COUNT(*) AS value FROM (
        SELECT s_ID, shelf_location_id FROM ProductShelfLocation
        GROUP BY s_ID, shelf_location_id HAVING COUNT(*) > 1
      ) AS duplicates`,
      values: [],
    },
    {
      name: "active_runs",
      sql: "SELECT COUNT(*) AS value FROM erp_standard_product_sync_run WHERE status='APPLIED'",
      values: [],
    },
  ]
}

export function assertStandardProductValidation(
  validation: StandardProductValidation,
  expected: { expectedRows: number; expectedStorageFingerprint: string },
) {
  const checks = [
    ["standardRows", expected.expectedRows],
    ["duplicateCodes", 0],
    ["mappingRows", expected.expectedRows],
    ["derivedRemarkMismatches", 0],
    ["matchedProductMismatches", 0],
    ["shelfMismatches", 0],
    ["shelfOrphans", 0],
    ["shelfDuplicates", 0],
    ["activeRuns", 1],
  ] as const
  for (const [name, value] of checks) {
    if (validation[name] !== value) {
      throw new Error(`${name} expected ${value}, received ${validation[name]}`)
    }
  }
  if (validation.storageFingerprint !== expected.expectedStorageFingerprint) {
    throw new Error("Storage fingerprint changed")
  }
  return { ...validation, valid: true as const }
}

export async function executeStandardProductTransaction(
  connection: StandardProductConnection,
  statements: readonly StandardProductStatement[],
  validate?: () => Promise<void>,
) {
  await connection.beginTransaction()
  try {
    for (const statement of statements) {
      const result = await connection.execute(statement)
      if (
        statement.expectedAffectedRows !== undefined &&
        result.affectedRows !== statement.expectedAffectedRows
      ) {
        throw new Error(`${statement.name} affected ${result.affectedRows} rows`)
      }
    }
    await validate?.()
    await connection.commit()
  } catch (error) {
    await connection.rollback()
    throw error
  }
}

export function sanitizeStandardProductError(value: unknown) {
  return String(value)
    .replace(/\bmysql:\/\/[^\s]+/gi, "<redacted-connection>")
    .replace(/(FEISHU_MYSQL_PASSWORD_FILE\s*=\s*)\S+/gi, "$1<redacted>")
    .replace(/(password\s*=\s*)\S+/gi, "$1<redacted>")
    .slice(0, 4_000)
}

function sameHeaders(raw: readonly unknown[] | undefined) {
  return (
    raw?.length === STANDARD_PRODUCT_HEADERS.length &&
    STANDARD_PRODUCT_HEADERS.every((header, index) => text(raw[index]) === header)
  )
}

function normalizeShelves(value: string, sourceRow: number) {
  if (!value) return []
  const matches = [...value.matchAll(shelfPattern)]
  const remainder = matches.reduceRight(
    (result, match) => result.slice(0, match.index) + result.slice(match.index + match[0].length),
    value,
  )
  if (!matches.length || !shelfSeparatorPattern.test(remainder)) {
    throw new Error(`invalid shelf cell at row ${sourceRow}`)
  }
  return [
    ...new Set(
      matches.map(
        (match) => `${match[1].toUpperCase()}-${Number(match[2])}-${Number(match[3])}`,
      ),
    ),
  ].toSorted(compareShelves)
}

function compareShelves(left: string, right: string) {
  const leftParts = left.split("-")
  const rightParts = right.split("-")
  return (
    leftParts[0].localeCompare(rightParts[0]) ||
    Number(leftParts[1]) - Number(rightParts[1]) ||
    Number(leftParts[2]) - Number(rightParts[2])
  )
}

function cleanLegacyProductText(value: string | null) {
  if (!value) return null
  if (![...value.matchAll(shelfPattern)].length) return optionalText(value)
  return optionalText(
    value
      .replace(shelfPattern, " ")
      .replace(/[+＋,，、;；|]+/g, " ")
      .replace(/\s+/g, " "),
  )
}

function sameApprovedFields(row: StandardProductRow, candidate: LegacyProductCandidate) {
  return (
    row.name === candidate.name.trim() &&
    row.origin === candidate.origin.trim() &&
    row.specification === optionalText(candidate.specification) &&
    row.model === optionalText(candidate.model) &&
    row.remark === optionalText(candidate.remark) &&
    row.shelves.join("\0") === candidate.shelves.toSorted(compareShelves).join("\0")
  )
}

function decimal(value: unknown, sourceRow: number) {
  const normalized = text(value)
  if (!normalized || !/^-?\d+(?:\.\d+)?$/.test(normalized)) {
    throw new Error(`invalid quantity at row ${sourceRow}`)
  }
  const [integer, fraction] = normalized.split(".")
  const trimmed = fraction?.replace(/0+$/, "")
  return trimmed ? `${BigInt(integer)}.${trimmed}` : BigInt(integer).toString()
}

function optionalText(value: unknown) {
  return text(value) || null
}

function requiredString(row: Record<string, unknown>, key: string) {
  const value = nullableDatabaseString(row, key)
  if (value === null || !value.trim()) throw new Error(`database row is missing ${key}`)
  return value
}

function nullableDatabaseString(row: Record<string, unknown>, key: string) {
  const value = row[key]
  if (value === null || value === undefined) return null
  if (typeof value !== "string") throw new Error(`database row has invalid ${key}`)
  return value
}

function text(value: unknown) {
  if (value === null || value === undefined) return ""
  if (
    typeof value !== "string" &&
    typeof value !== "number" &&
    typeof value !== "bigint" &&
    typeof value !== "boolean"
  ) {
    throw new Error("workbook cell has an invalid value")
  }
  return String(value).trim().replace(/\s+/g, " ")
}

function chunks<T>(values: readonly T[], size: number) {
  return Array.from({ length: Math.ceil(values.length / size) }, (_, index) =>
    values.slice(index * size, (index + 1) * size),
  )
}
