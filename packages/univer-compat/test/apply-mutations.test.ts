import { describe, expect, test } from "bun:test"
import { applyMutationsToSnapshotJson } from "../src/apply-mutations"
import { defaultWorkbook } from "../src/workbook"

describe("applyMutationsToSnapshotJson", () => {
  test("applies sheet.mutation.set-range-values into cellData", () => {
    const id = crypto.randomUUID()
    const raw = JSON.stringify(defaultWorkbook(id, "n"))
    const wb = JSON.parse(raw) as { sheetOrder: string[] }
    const sheet = wb.sheetOrder[0]
    const next = applyMutationsToSnapshotJson(
      raw,
      [
        {
          id: "sheet.mutation.set-range-values",
          params: {
            unitId: id,
            subUnitId: sheet,
            range: { startRow: 1, endRow: 1, startColumn: 2, endColumn: 2 },
            cellValue: { "1": { "2": { v: 7, t: 2 } } },
          },
        },
      ],
      1,
    )
    const out = JSON.parse(next) as {
      rev: number
      sheets: Record<string, { cellData?: Record<string, Record<string, { v?: unknown }>> }>
    }
    expect(out.rev).toBe(1)
    expect(out.sheets[sheet].cellData?.["1"]?.["2"]?.v).toBe(7)
  })

  test("non-empty unsupported mutations throws", () => {
    const id = crypto.randomUUID()
    const raw = JSON.stringify(defaultWorkbook(id, "n"))
    expect(() =>
      applyMutationsToSnapshotJson(raw, [{ id: "other.op", params: {} }], 1),
    ).toThrow("no supported mutations applied")
  })
})
