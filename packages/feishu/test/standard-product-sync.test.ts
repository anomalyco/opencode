import { describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  assertStandardProductApplyGuards,
  assertStandardProductValidation,
  buildStandardProductPreview,
  executeStandardProductTransaction,
  fingerprintStorageTotals,
  legacyProductCandidates,
  normalizeStandardProductRows,
  reconcileStandardProducts,
  sanitizeStandardProductError,
  standardProductApplyStatements,
  standardProductRollbackStatements,
  standardProductRollbackValidationChecks,
  standardProductSetupStatements,
  standardProductStageStatements,
  standardProductValidationChecks,
  type LegacyProductCandidate,
  type StandardProductConnection,
  type StandardProductRow,
} from "../src/standard-product-sync"

const headers = [
  "原始行号",
  "商品编码",
  "商品名称",
  "产地",
  "数量",
  "货架号",
  "规格",
  "型号",
  "备注",
]

describe("standard product workbook", () => {
  test("XLSX bridge emits UTF-8 JSON on Windows", async () => {
    const directory = await mkdtemp(join(tmpdir(), "standard-product-sync-"))
    const path = join(directory, "standard.xlsx")
    const creator = Bun.spawn(
      [
        "python",
        "-c",
        "from openpyxl import Workbook; from sys import argv; w=Workbook(); s=w.active; s.title='清洗结果'; s.append(['原始行号','商品编码','商品名称','产地','数量','货架号','规格','型号','备注']); s.append([1,'001011','6001ZZ','虎旺',1,'A-1-1',None,'12*28*8',None]); w.save(argv[1])",
        path,
      ],
      { stdout: "ignore", stderr: "pipe" },
    )
    expect(await creator.exited).toBe(0)
    const reader = Bun.spawn(["python", "scripts/read-standard-product-workbook.py", path], {
      stdout: "pipe",
      stderr: "pipe",
    })
    const output = await new Response(reader.stdout).text()
    expect(await reader.exited).toBe(0)
    expect(JSON.parse(output).rows[0]).toEqual(headers)
    await rm(directory, { recursive: true })
  })

  test("maps approved columns and normalizes shelf codes", () => {
    expect(
      normalizeStandardProductRows([
        headers,
        [13, " 001011 ", "6001ZZ", "虎旺", 363, "A-1-4+A-1-1", null, "12*28*8", null],
      ]),
    ).toEqual([
      {
        sourceRow: 2,
        originalRow: "13",
        code: "001011",
        name: "6001ZZ",
        origin: "虎旺",
        workbookQuantity: "363",
        shelves: ["A-1-1", "A-1-4"],
        specification: null,
        model: "12*28*8",
        remark: null,
        shelfText: "A-1-4+A-1-1",
      },
    ])
  })

  test("keeps authoritative blanks and accepts a blank shelf", () => {
    expect(normalizeStandardProductRows([headers, [3, "001001", "604zz", "虎旺", 161]])[0])
      .toEqual({
        sourceRow: 2,
        originalRow: "3",
        code: "001001",
        name: "604zz",
        origin: "虎旺",
        workbookQuantity: "161",
        shelves: [],
        specification: null,
        model: null,
        remark: null,
        shelfText: "",
      })
  })

  test("rejects a changed header contract", () => {
    expect(() => normalizeStandardProductRows([[...headers.slice(0, 8), "说明"]])).toThrow(
      "workbook headers do not match",
    )
  })

  test("rejects duplicate normalized product codes", () => {
    expect(() =>
      normalizeStandardProductRows([
        headers,
        [1, "X", "A", "厂", 1],
        [2, " X ", "B", "厂", 1],
      ]),
    ).toThrow("duplicate product code: X")
  })

  test("rejects a nonempty shelf cell with unrecognized content", () => {
    expect(() =>
      normalizeStandardProductRows([headers, [1, "X", "A", "厂", 1, "A-1-1+not-a-shelf"]]),
    ).toThrow("invalid shelf cell at row 2")
  })
})

describe("legacy product reconciliation", () => {
  const row: StandardProductRow = {
    sourceRow: 2,
    originalRow: "13",
    code: "001011",
    name: "6001ZZ",
    origin: "虎旺",
    workbookQuantity: "363",
    shelves: ["A-1-1", "A-1-4"],
    specification: null,
    model: "12*28*8",
    remark: null,
    shelfText: "A-1-4+A-1-1",
  }

  test("maps one code candidate without using inventory", () => {
    expect(reconcileStandardProducts([row], [candidate(1542, row)])).toEqual([
      {
        row,
        status: "MATCHED",
        productID: 1542,
        candidateProductIDs: [1542],
      },
    ])
  })

  test("keeps a product missing when Product has no code candidate", () => {
    expect(reconcileStandardProducts([row], [])).toEqual([
      {
        row,
        status: "MISSING",
        candidateProductIDs: [],
      },
    ])
  })

  test("maps only the exact candidate in a duplicate code group", () => {
    const wrong = candidate(100, { ...row, origin: "无厂商" })
    expect(reconcileStandardProducts([row], [wrong, candidate(1542, row)])[0]).toEqual({
      row,
      status: "MATCHED",
      productID: 1542,
      candidateProductIDs: [100, 1542],
    })
  })

  test("keeps duplicate candidates ambiguous when none is exact", () => {
    const candidates = [
      candidate(100, { ...row, shelves: ["A-2-1"] }),
      candidate(1542, { ...row, shelves: ["A-3-1"] }),
    ]
    expect(reconcileStandardProducts([row], candidates)[0]).toEqual({
      row,
      status: "AMBIGUOUS",
      candidateProductIDs: [100, 1542],
    })
  })
})

describe("standard product database plan", () => {
  test("legacy snapshot removes old shelf tokens from display fields", () => {
    expect(
      legacyProductCandidates(
        [
          {
            product_id: "1542",
            product_code: "001011",
            product_name: "6001ZZ",
            product_origin: "虎旺",
            product_spec: "12*28*8 A-1-1",
            product_type: "清油+A-1-4",
            product_remark: null,
          },
        ],
        [
          { product_id: "1542", shelf_code: "A-1-4" },
          { product_id: "1542", shelf_code: "A-1-1" },
        ],
      ),
    ).toEqual([
      {
        productID: 1542,
        code: "001011",
        name: "6001ZZ",
        origin: "虎旺",
        specification: "清油",
        model: "12*28*8",
        remark: null,
        shelves: ["A-1-1", "A-1-4"],
      },
    ])
  })

  test("legacy snapshot preserves approved plus-separated specifications without shelves", () => {
    expect(
      legacyProductCandidates(
        [
          {
            product_id: "1542",
            product_code: "001011",
            product_name: "6001ZZ",
            product_origin: "虎旺",
            product_spec: "12*28*8",
            product_type: "清油+蓝盖",
            product_remark: null,
          },
        ],
        [],
      )[0]?.specification,
    ).toBe("清油+蓝盖")
  })

  test("storage fingerprint changes when a product total changes", () => {
    const first = fingerprintStorageTotals(20, [
      { product_id: "1", total_inventory: "10.00000000" },
      { product_id: "2", total_inventory: "20.00000000" },
    ])
    const second = fingerprintStorageTotals(20, [
      { product_id: "1", total_inventory: "10.00000000" },
      { product_id: "2", total_inventory: "21.00000000" },
    ])
    expect(first).toHaveLength(64)
    expect(second).not.toBe(first)
  })

  test("preview reports differences and performs zero writes", () => {
    const preview = buildStandardProductPreview(
      {
        fileName: "standard.xlsx",
        sha256: "a".repeat(64),
        rows: [headers, [13, "001011", "6001ZZ", "虎旺", 363, "A-1-4+A-1-1", null, "12*28*8"]],
      },
      {
        database: "t1_full_20260717_133707",
        version: "8.4.10",
        currentUser: "sync@%",
        readOnly: false,
        storageFingerprint: "b".repeat(64),
        storageRowCount: 10,
        candidates: [
          candidate(1542, {
            sourceRow: 2,
            originalRow: "13",
            code: "001011",
            name: "6001ZZ",
            origin: "虎旺",
            workbookQuantity: "363",
            shelves: ["A-2-1"],
            specification: null,
            model: "12*28*8",
            remark: null,
            shelfText: "A-2-1",
          }),
        ],
      },
    )
    expect(preview.workbook.rowCount).toBe(1)
    expect(preview.mappings).toEqual({ MATCHED: 1, MISSING: 0, AMBIGUOUS: 0 })
    expect(preview.differences.shelves).toBe(1)
    expect(preview.databaseWrites).toBe(0)
  })

  test("apply guards reject a changed workbook hash or row count", () => {
    const workbook = {
      sha256: "a".repeat(64),
      rowCount: 10_560,
      mappings: { MATCHED: 10_391, MISSING: 106, AMBIGUOUS: 63 },
      activeRunID: "run-1",
    }
    expect(() =>
      assertStandardProductApplyGuards(workbook, {
        expectedSha256: "b".repeat(64),
        expectedRowCount: 10_560,
        expectedMappings: workbook.mappings,
        expectedActiveRunID: "run-1",
      }),
    ).toThrow("workbook SHA-256 changed")
    expect(() =>
      assertStandardProductApplyGuards(workbook, {
        expectedSha256: "a".repeat(64),
        expectedRowCount: 10_559,
        expectedMappings: workbook.mappings,
        expectedActiveRunID: "run-1",
      }),
    ).toThrow("workbook row count changed")
    expect(() =>
      assertStandardProductApplyGuards(workbook, {
        expectedSha256: "a".repeat(64),
        expectedRowCount: 10_560,
        expectedMappings: { ...workbook.mappings, AMBIGUOUS: 64 },
        expectedActiveRunID: "run-1",
      }),
    ).toThrow("mapping counts changed")
    expect(() =>
      assertStandardProductApplyGuards(workbook, {
        expectedSha256: "a".repeat(64),
        expectedRowCount: 10_560,
        expectedMappings: workbook.mappings,
        expectedActiveRunID: "run-2",
      }),
    ).toThrow("active standard run changed")
  })

  test("staging uses parameterized batches for every workbook value", () => {
    const preview = buildStandardProductPreview(
      {
        fileName: "standard.xlsx",
        sha256: "a".repeat(64),
        rows: [headers, [13, "001011", "6001ZZ", "虎旺", 363, "A-1-4", null, "12*28*8"]],
      },
      {
        database: "t1_full_20260717_133707",
        version: "8.4.10",
        currentUser: "sync@%",
        readOnly: false,
        storageFingerprint: "b".repeat(64),
        storageRowCount: 10,
        candidates: [candidate(1542, rowForCode("001011"))],
      },
    )
    const statements = standardProductStageStatements({
      runID: "run-1",
      previousRunID: null,
      preview,
    })
    expect(statements.some((statement) => statement.sql.includes("001011"))).toBeFalse()
    expect(statements.flatMap((statement) => statement.values ?? [])).toContain("001011")
    expect(statements.filter((statement) => statement.name.startsWith("stage_"))).toHaveLength(4)
  })

  test("setup creates only idempotent authoritative and audit objects", () => {
    const statements = standardProductSetupStatements()
    expect(statements).toHaveLength(9)
    expect(
      statements.every(
        (statement) =>
          /^CREATE TABLE IF NOT EXISTS/i.test(statement.sql.trim()) ||
          /^CREATE OR REPLACE VIEW/i.test(statement.sql.trim()),
      ),
    ).toBeTrue()
    const inventoryView = statements.find((statement) => statement.name === "create_inventory_view")!
    expect(inventoryView.sql).toMatch(
      /CASE\s+WHEN\s+mapping\.product_id\s+IS\s+NULL[\s\S]*workbook_quantity[\s\S]*COALESCE\(inventory\.total_inventory,\s*0\)/i,
    )
  })

  test("apply never writes Storage and updates only approved Product fields", () => {
    const statements = standardProductApplyStatements("run-1", {
      matchedProducts: 10,
      changedProducts: 8,
      existingShelfRelations: 12,
      existingShelfEvidence: 13,
      replacementShelves: 11,
      previousRun: true,
    })
    expect(
      statements.some((statement) =>
        /(?:UPDATE|INSERT\s+INTO|DELETE\s+FROM)\s+`?Storage`?/i.test(statement.sql),
      ),
    ).toBeFalse()
    const productUpdates = statements.filter((statement) => /UPDATE\s+`?Product`?/i.test(statement.sql))
    expect(productUpdates).toHaveLength(1)
    expect(productUpdates[0].sql).toMatch(
      /u_Name[\s\S]*ProdArea[\s\S]*ProdType[\s\S]*ProdSpec[\s\S]*u_Remark/,
    )
    expect(productUpdates[0].sql).not.toMatch(/s_ID\s*=|u_Code\s*=|s_ParentID\s*=/)
    expect(statements.find((statement) => statement.name === "backup_products")?.expectedAffectedRows).toBe(10)
    expect(statements.find((statement) => statement.name === "update_products")?.expectedAffectedRows).toBe(8)
    expect(statements.find((statement) => statement.name === "delete_shelf_relations")?.expectedAffectedRows).toBe(12)
    expect(statements.find((statement) => statement.name === "delete_shelf_evidence")?.expectedAffectedRows).toBe(13)
    expect(statements.find((statement) => statement.name === "replace_shelf_relations")?.expectedAffectedRows).toBe(11)
    expect(statements.find((statement) => statement.name === "replace_shelf_evidence")?.expectedAffectedRows).toBe(11)
    expect(statements.find((statement) => statement.name === "supersede_previous_run")?.expectedAffectedRows).toBe(1)
  })

  test("rollback restores Product and shelf backups without writing Storage", () => {
    const statements = standardProductRollbackStatements()
    expect(statements.some((statement) => statement.name === "restore_products")).toBeTrue()
    expect(statements.some((statement) => statement.name === "restore_shelf_relations")).toBeTrue()
    expect(statements.some((statement) => statement.name === "restore_shelf_evidence")).toBeTrue()
    expect(statements.some((statement) => /\bStorage\b/i.test(statement.sql))).toBeFalse()
    const checks = standardProductRollbackValidationChecks("run-1")
    expect(checks.map((check) => check.name)).toEqual([
      "restored_shelf_relation_mismatches",
      "restored_shelf_evidence_mismatches",
    ])
    expect(checks.every((check) => /^SELECT/i.test(check.sql.trim()))).toBeTrue()
    expect(checks.every((check) => check.values.includes("run-1"))).toBeTrue()
    expect(checks.some((check) => /\bStorage\b/i.test(check.sql))).toBeFalse()
  })

  test("transaction failure rolls back and never reaches activation", async () => {
    const connection = recordingConnection("replace_shelf_relations")
    await expect(
      executeStandardProductTransaction(connection, standardProductApplyStatements()),
    ).rejects.toThrow("replace_shelf_relations")
    expect(connection.events).toContain("rollback")
    expect(connection.events).not.toContain("activate_run")
  })

  test("validation failure rolls back after activation and before commit", async () => {
    const connection = recordingConnection("")
    await expect(
      executeStandardProductTransaction(
        connection,
        standardProductApplyStatements(),
        async () => {
          throw new Error("validation mismatch")
        },
      ),
    ).rejects.toThrow("validation mismatch")
    expect(connection.events).toContain("activate_run")
    expect(connection.events).toContain("rollback")
    expect(connection.events).not.toContain("commit")
  })

  test("validation requires exact rows, mappings, shelves, active run, and Storage fingerprint", () => {
    const checks = standardProductValidationChecks("run-1")
    expect(checks.map((check) => check.name)).toEqual([
      "standard_rows",
      "duplicate_codes",
      "mapping_rows",
      "matched_product_mismatches",
      "shelf_mismatches",
      "shelf_orphans",
      "shelf_duplicates",
      "active_runs",
    ])
    expect(checks.every((check) => /^SELECT/i.test(check.sql.trim()))).toBeTrue()
    expect(checks.flatMap((check) => check.values)).toContain("run-1")

    expect(
      assertStandardProductValidation(
        {
          standardRows: 10_560,
          duplicateCodes: 0,
          mappingRows: 10_560,
          matchedProductMismatches: 0,
          shelfMismatches: 0,
          shelfOrphans: 0,
          shelfDuplicates: 0,
          activeRuns: 1,
          storageFingerprint: "a".repeat(64),
        },
        { expectedRows: 10_560, expectedStorageFingerprint: "a".repeat(64) },
      ).valid,
    ).toBeTrue()

    expect(() =>
      assertStandardProductValidation(
        {
          standardRows: 10_560,
          duplicateCodes: 0,
          mappingRows: 10_560,
          matchedProductMismatches: 0,
          shelfMismatches: 1,
          shelfOrphans: 0,
          shelfDuplicates: 0,
          activeRuns: 1,
          storageFingerprint: "a".repeat(64),
        },
        { expectedRows: 10_560, expectedStorageFingerprint: "a".repeat(64) },
      ),
    ).toThrow("shelfMismatches expected 0, received 1")
  })

  test("sanitized errors exclude passwords and controlled file paths", () => {
    expect(
      sanitizeStandardProductError(
        "password=secret FEISHU_MYSQL_PASSWORD_FILE=D:\\secret\\experiment_user_password mysql://user:secret@host/schema",
      ),
    ).toBe("password=<redacted> FEISHU_MYSQL_PASSWORD_FILE=<redacted> <redacted-connection>")
  })
})

function candidate(productID: number, row: StandardProductRow): LegacyProductCandidate {
  return {
    productID,
    code: row.code,
    name: row.name,
    origin: row.origin,
    specification: row.specification,
    model: row.model,
    remark: row.remark,
    shelves: row.shelves,
  }
}

function rowForCode(code: string): StandardProductRow {
  return {
    sourceRow: 2,
    originalRow: "13",
    code,
    name: "6001ZZ",
    origin: "虎旺",
    workbookQuantity: "363",
    shelves: ["A-1-4"],
    specification: null,
    model: "12*28*8",
    remark: null,
    shelfText: "A-1-4",
  }
}

function recordingConnection(failOn: string) {
  const events: string[] = []
  return {
    events,
    async beginTransaction() {
      events.push("begin")
    },
    async execute(statement) {
      events.push(statement.name)
      if (statement.name === failOn) throw new Error(failOn)
      return { affectedRows: statement.expectedAffectedRows ?? 0 }
    },
    async commit() {
      events.push("commit")
    },
    async rollback() {
      events.push("rollback")
    },
  } satisfies StandardProductConnection & { events: string[] }
}
