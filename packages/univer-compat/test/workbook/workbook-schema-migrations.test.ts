import { describe, expect, test } from "bun:test"
import { parseWorkbookWire } from "../../src/workbook"
import { WORKBOOK_SCHEMA_VERSION } from "../../src/workbook/schema-version/latest"
import { migrateWorkbookInSnapshotRoot, migrateWorkbookToLatest } from "../../src/workbook/schema-version/run"

describe("workbook schema migrations", () => {
  test("legacy workbook (no schemaVersion) migrates to latest", () => {
    const wb = { id: "u1", sheetOrder: [], resources: [] } as Record<string, unknown>
    migrateWorkbookToLatest(wb)
    expect(wb.schemaVersion).toBe(WORKBOOK_SCHEMA_VERSION)
  })

  test("parseWorkbookWire runs migrations before validation", () => {
    const wb = { id: "u2", sheetOrder: [], resources: [] }
    const out = parseWorkbookWire(wb)
    expect(out.schemaVersion).toBe(WORKBOOK_SCHEMA_VERSION)
  })

  test("migrateWorkbookInSnapshotRoot targets nested workbook", () => {
    const root = { rev: 0, workbook: { id: "u3", sheetOrder: [], resources: [] } } as Record<string, unknown>
    migrateWorkbookInSnapshotRoot(root)
    const inner = root.workbook as Record<string, unknown>
    expect(inner.schemaVersion).toBe(WORKBOOK_SCHEMA_VERSION)
  })
})
