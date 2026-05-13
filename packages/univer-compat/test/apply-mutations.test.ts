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

  test("applies sheet.mutation.set-drawing-apply into SHEET_DRAWING_PLUGIN resource", () => {
    const id = crypto.randomUUID()
    const raw = JSON.stringify(defaultWorkbook(id, "n"))
    const wb = JSON.parse(raw) as { sheetOrder: string[] }
    const sheet = wb.sheetOrder[0]
    const chartId = "sdk-chart-test"
    const drawing = {
      unitId: id,
      subUnitId: sheet,
      drawingId: chartId,
      drawingType: 2,
      componentKey: "VERITLY_LIVE_CHART",
      data: { range: "Sheet1!A1:B2" },
    }
    const op = [id, sheet, ["data", chartId, { i: drawing }], ["order", 0, { i: chartId }]]
    const next = applyMutationsToSnapshotJson(
      raw,
      [
        {
          id: "sheet.mutation.set-drawing-apply",
          params: {
            unitId: id,
            subUnitId: sheet,
            op,
            objects: [],
            type: 0,
          },
        },
      ],
      3,
    )
    const out = JSON.parse(next) as {
      rev: number
      resources?: { name: string; data: string }[]
    }
    expect(out.rev).toBe(3)
    const slot = out.resources?.find((r) => r.name === "SHEET_DRAWING_PLUGIN")
    expect(slot).toBeDefined()
    const blob = JSON.parse(slot!.data) as Record<string, Record<string, { data?: Record<string, unknown> }>>
    const cell = blob[id]?.[sheet]?.data?.[chartId] as { drawingId?: string } | undefined
    expect(cell?.drawingId).toBe(chartId)
  })

  test("flat set-drawing-apply (drawing move) applies new transform without json1 tuple shape", () => {
    const id = crypto.randomUUID()
    const raw = JSON.stringify(defaultWorkbook(id, "n"))
    const sheet = JSON.parse(raw).sheetOrder[0] as string
    const draw = "sdk-flat-move"
    const op = [
      id,
      sheet,
      "data",
      draw,
      [
        "transform",
        {
          r: { left: 0, top: 0, width: 1, height: 1, angle: 0, flipY: false, flipX: false, skewX: 0, skewY: 0 },
          i: { left: 140, top: 300, width: 400, height: 300, angle: 0, flipY: false, flipX: false, skewX: 0, skewY: 0 },
        },
      ],
    ]
    const next = applyMutationsToSnapshotJson(
      raw,
      [
        {
          id: "sheet.mutation.set-drawing-apply",
          params: {
            unitId: id,
            subUnitId: sheet,
            op,
            objects: [{ unitId: id, subUnitId: sheet, drawingId: draw }],
            type: 2,
          },
        },
      ],
      5,
    )
    const out = JSON.parse(next) as { rev: number; resources?: { name: string; data: string }[] }
    expect(out.rev).toBe(5)
    const slot = out.resources?.find((r) => r.name === "SHEET_DRAWING_PLUGIN")
    expect(slot).toBeDefined()
    const blob = JSON.parse(slot!.data) as Record<
      string,
      Record<string, { data?: Record<string, { transform?: { left: number; width: number } }> }>
    >
    const t = blob[id]?.[sheet]?.data?.[draw]?.transform
    expect(t?.left).toBe(140)
    expect(t?.width).toBe(400)
  })

  test("nested workbook root: rev and mutations target inner workbook", () => {
    const id = crypto.randomUUID()
    const inner = defaultWorkbook(id, "nested")
    const raw = JSON.stringify({ rev: 0, workbook: inner })
    const sheet = inner.sheetOrder[0]
    const next = applyMutationsToSnapshotJson(
      raw,
      [
        {
          id: "sheet.mutation.set-range-values",
          params: {
            unitId: id,
            subUnitId: sheet,
            cellValue: { "0": { "0": { v: 9, t: 2 } } },
          },
        },
      ],
      2,
    )
    const out = JSON.parse(next) as {
      rev: number
      workbook: { rev: number; sheets: Record<string, { cellData?: Record<string, Record<string, { v?: unknown }>> }> }
    }
    expect(out.rev).toBe(2)
    expect(out.workbook.rev).toBe(2)
    expect(out.workbook.sheets[sheet].cellData?.["0"]?.["0"]?.v).toBe(9)
  })
})
