import { describe, expect, test } from "bun:test"
import { applyMutationsToSnapshotJson } from "../../src/apply-mutations"
import {
  commitDrawingPluginInWorkbook,
  defaultWorkbook,
  workbookFromSnapshot,
  type WorkbookWire,
} from "../../src/workbook"

const DRAW = "SHEET_DRAWING_PLUGIN"

type AnyBlob = Record<string, unknown>

function drawingBlob(root: { resources?: { name: string; data: string }[] }): AnyBlob | undefined {
  const slot = root.resources?.find((r) => r.name === DRAW)
  if (!slot) return undefined
  return JSON.parse(slot.data) as AnyBlob
}

function isDrawingSlot(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x) && ("data" in x || "order" in x)
}

type DrawingLayer = { data: Record<string, unknown>; order: unknown[] }

function asData(o: unknown): Record<string, unknown> {
  if (o !== null && typeof o === "object" && !Array.isArray(o)) return o as Record<string, unknown>
  return {}
}

function row(m: Record<string, unknown> | undefined, k: string): Record<string, unknown> | undefined {
  if (!m) return undefined
  const v = m[k]
  if (v !== null && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>
  return undefined
}

function drawingSheet(blob: AnyBlob | undefined, uid: string, sheet: string): DrawingLayer | undefined {
  if (!blob) return undefined
  const d = blob[sheet]
  if (isDrawingSlot(d)) return { data: asData(d.data), order: Array.isArray(d.order) ? d.order : [] }
  const u = blob[uid]
  if (!u || typeof u !== "object" || Array.isArray(u)) return undefined
  const s = (u as Record<string, unknown>)[sheet]
  if (!s || typeof s !== "object" || Array.isArray(s)) return undefined
  const slot = s as Record<string, unknown>
  return { data: asData(slot.data), order: Array.isArray(slot.order) ? slot.order : [] }
}

describe("applyMutationsToSnapshotJson — set-range edge cases", () => {
  test("merges styled cell (ff, fs, cl) like Univer client", () => {
    const uid = crypto.randomUUID()
    const raw = JSON.stringify(defaultWorkbook(uid, "styled"))
    const sheet = JSON.parse(raw).sheetOrder[0] as string
    const next = applyMutationsToSnapshotJson(
      raw,
      [
        {
          id: "sheet.mutation.set-range-values",
          params: {
            unitId: uid,
            subUnitId: sheet,
            cellValue: {
              "5": {
                "5": {
                  v: 224,
                  t: 2,
                  s: { ff: "Arial", fs: 9, cl: { rgb: "#CC0000" } },
                  f: null,
                  si: null,
                  custom: null,
                },
              },
            },
          },
        },
      ],
      11,
    )
    const out = JSON.parse(next) as {
      rev: number
      sheets: Record<string, { cellData?: Record<string, Record<string, { v?: unknown; s?: { ff?: string } }>> }>
    }
    expect(out.rev).toBe(11)
    const cell = out.sheets[sheet].cellData?.["5"]?.["5"]
    expect(cell?.v).toBe(224)
    expect(cell?.s?.ff).toBe("Arial")
  })

  test("merges into existing cell without dropping prior keys", () => {
    const uid = crypto.randomUUID()
    const raw = JSON.stringify(defaultWorkbook(uid, "merge"))
    const sheet = JSON.parse(raw).sheetOrder[0] as string
    const one = applyMutationsToSnapshotJson(
      raw,
      [
        {
          id: "sheet.mutation.set-range-values",
          params: {
            unitId: uid,
            subUnitId: sheet,
            cellValue: { "1": { "1": { v: "a", t: 1 } } },
          },
        },
      ],
      1,
    )
    const two = applyMutationsToSnapshotJson(
      one,
      [
        {
          id: "sheet.mutation.set-range-values",
          params: {
            unitId: uid,
            subUnitId: sheet,
            cellValue: { "1": { "1": { t: 2, v: 99 } } },
          },
        },
      ],
      2,
    )
    const out = JSON.parse(two) as {
      sheets: Record<string, { cellData?: Record<string, Record<string, { v?: unknown; t?: number }>> }>
    }
    expect(out.sheets[sheet].cellData?.["1"]?.["1"]?.v).toBe(99)
    expect(out.sheets[sheet].cellData?.["1"]?.["1"]?.t).toBe(2)
  })

  test("nested workbook root: set-range targets inner workbook", () => {
    const uid = crypto.randomUUID()
    const inner = defaultWorkbook(uid, "in")
    const raw = JSON.stringify({ rev: 0, workbook: inner })
    const sheet = inner.sheetOrder[0]
    const next = applyMutationsToSnapshotJson(
      raw,
      [
        {
          id: "sheet.mutation.set-range-values",
          params: {
            unitId: uid,
            subUnitId: sheet,
            cellValue: { "0": { "0": { v: "x", t: 1 } } },
          },
        },
      ],
      3,
    )
    const out = JSON.parse(next) as {
      workbook: { sheets: Record<string, { cellData?: Record<string, Record<string, { v?: unknown }>> }> }
    }
    expect(out.workbook.sheets[sheet].cellData?.["0"]?.["0"]?.v).toBe("x")
  })
})

describe("applyMutationsToSnapshotJson — nested drawing insert (browser shape)", () => {
  test("insert VeritlyLiveChart op from client (data + order tuples)", () => {
    const uid = crypto.randomUUID()
    const raw = JSON.stringify(defaultWorkbook(uid, "chart"))
    const sheet = JSON.parse(raw).sheetOrder[0] as string
    const draw = "sdk-xpjhsbxbek"
    const op = [
      uid,
      sheet,
      [
        "data",
        draw,
        {
          i: {
            unitId: uid,
            subUnitId: sheet,
            drawingId: draw,
            drawingType: 2,
            componentKey: "VeritlyLiveChart",
            sheetTransform: {
              from: { column: 9, columnOffset: 60, row: 8, rowOffset: 8 },
              to: { column: 15, columnOffset: 30, row: 30, rowOffset: 2 },
            },
            transform: { left: 200, top: 200, width: 468, height: 369 },
            axisAlignSheetTransform: {
              from: { column: 9, columnOffset: 60, row: 8, rowOffset: 8 },
              to: { column: 15, columnOffset: 30, row: 30, rowOffset: 2 },
            },
            data: {
              border: "#979DAC",
              background: "#fcfcfc",
              range: "Sheet1!E4:I8",
              chartType: 4,
              isRowDirection: true,
            },
            allowTransform: true,
          },
        },
      ],
      ["order", 0, { i: draw }],
    ]
    const next = applyMutationsToSnapshotJson(
      raw,
      [
        {
          id: "sheet.mutation.set-drawing-apply",
          params: {
            unitId: uid,
            subUnitId: sheet,
            op,
            objects: [{ unitId: uid, subUnitId: sheet, drawingId: draw }],
            type: 0,
            trigger: "sheet.command.insert-sheet-image",
          },
        },
      ],
      7,
    )
    const out = JSON.parse(next) as { rev: number; resources?: { name: string; data: string }[] }
    expect(out.rev).toBe(7)
    const blob = drawingBlob(out)
    const layer = drawingSheet(blob, uid, sheet)
    expect(row(layer?.data, draw)?.["componentKey"]).toBe("VeritlyLiveChart")
    expect(layer?.order).toEqual([draw])
  })

  test("nested insert survives corrupt prior SHEET_DRAWING_PLUGIN JSON", () => {
    const uid = crypto.randomUUID()
    const wb = defaultWorkbook(uid, "badblob")
    const sheet = wb.sheetOrder[0]
    ;(wb as Record<string, unknown>).resources = [{ name: DRAW, data: "{broken json" }]
    const raw = JSON.stringify(wb)
    const draw = "sdk-after-bad"
    const op = [
      uid,
      sheet,
      ["data", draw, { i: { drawingId: draw, drawingType: 2, componentKey: "VeritlyLiveChart" } }],
      ["order", 0, { i: draw }],
    ]
    const next = applyMutationsToSnapshotJson(
      raw,
      [{ id: "sheet.mutation.set-drawing-apply", params: { unitId: uid, subUnitId: sheet, op, objects: [], type: 0 } }],
      1,
    )
    const out = JSON.parse(next) as { resources?: { name: string; data: string }[] }
    const blob = drawingBlob(out)
    const layer = drawingSheet(blob, uid, sheet)
    expect(row(layer?.data, draw)?.["drawingId"]).toBe(draw)
  })

  test("nested insert when blob was JSON array (invalid shape) resets to object map", () => {
    const uid = crypto.randomUUID()
    const wb = defaultWorkbook(uid, "arrblob")
    const sheet = wb.sheetOrder[0]
    ;(wb as Record<string, unknown>).resources = [{ name: DRAW, data: "[]" }]
    const draw = "sdk-from-array"
    const op = [
      uid,
      sheet,
      ["data", draw, { i: { drawingId: draw, componentKey: "VeritlyLiveChart" } }],
      ["order", 0, { i: draw }],
    ]
    const raw = JSON.stringify(wb)
    const next = applyMutationsToSnapshotJson(
      raw,
      [{ id: "sheet.mutation.set-drawing-apply", params: { unitId: uid, subUnitId: sheet, op, objects: [], type: 0 } }],
      2,
    )
    const out = JSON.parse(next) as { resources?: { name: string; data: string }[] }
    const blob = drawingBlob(out)
    const layer = drawingSheet(blob, uid, sheet)
    expect(row(layer?.data, draw)?.["componentKey"]).toBe("VeritlyLiveChart")
  })

  test("second nested insert appends another drawing and order", () => {
    const uid = crypto.randomUUID()
    const raw = JSON.stringify(defaultWorkbook(uid, "two"))
    const sheet = JSON.parse(raw).sheetOrder[0] as string
    const a = "sdk-a"
    const b = "sdk-b"
    const opA = [uid, sheet, ["data", a, { i: { drawingId: a, x: 1 } }], ["order", 0, { i: a }]]
    const opB = [uid, sheet, ["data", b, { i: { drawingId: b, x: 2 } }], ["order", 0, { i: b }]]
    const mid = applyMutationsToSnapshotJson(
      raw,
      [{ id: "sheet.mutation.set-drawing-apply", params: { unitId: uid, subUnitId: sheet, op: opA, objects: [], type: 0 } }],
      1,
    )
    const fin = applyMutationsToSnapshotJson(
      mid,
      [{ id: "sheet.mutation.set-drawing-apply", params: { unitId: uid, subUnitId: sheet, op: opB, objects: [], type: 0 } }],
      2,
    )
    const out = JSON.parse(fin) as { resources?: { name: string; data: string }[] }
    const blob = drawingBlob(out)
    const layer = drawingSheet(blob, uid, sheet)
    expect(row(layer?.data, a)?.["x"]).toBe(1)
    expect(row(layer?.data, b)?.["x"]).toBe(2)
    expect(layer?.order).toEqual([b, a])
  })

  test("nested insert inside nested workbook root", () => {
    const uid = crypto.randomUUID()
    const inner = defaultWorkbook(uid, "nested-chart")
    const raw = JSON.stringify({ rev: 0, workbook: inner })
    const sheet = inner.sheetOrder[0]
    const draw = "sdk-nested"
    const op = [
      uid,
      sheet,
      ["data", draw, { i: { drawingId: draw, componentKey: "VeritlyLiveChart" } }],
      ["order", 0, { i: draw }],
    ]
    const next = applyMutationsToSnapshotJson(
      raw,
      [{ id: "sheet.mutation.set-drawing-apply", params: { unitId: uid, subUnitId: sheet, op, objects: [], type: 0 } }],
      5,
    )
    const out = JSON.parse(next) as { workbook: { resources?: { name: string; data: string }[] } }
    const blob = drawingBlob(out.workbook as { resources?: { name: string; data: string }[] })
    const layer = drawingSheet(blob, uid, sheet)
    expect(row(layer?.data, draw)?.["drawingId"]).toBe(draw)
  })
})

describe("applyMutationsToSnapshotJson — flat drawing update", () => {
  test("flat transform after nested insert in two steps", () => {
    const uid = crypto.randomUUID()
    const raw = JSON.stringify(defaultWorkbook(uid, "flatmix"))
    const sheet = JSON.parse(raw).sheetOrder[0] as string
    const draw = "sdk-mix"
    const insert = [
      uid,
      sheet,
      ["data", draw, { i: { drawingId: draw, transform: { left: 0, top: 0, width: 1, height: 1, angle: 0, flipY: false, flipX: false, skewX: 0, skewY: 0 } } }],
      ["order", 0, { i: draw }],
    ]
    const mid = applyMutationsToSnapshotJson(
      raw,
      [{ id: "sheet.mutation.set-drawing-apply", params: { unitId: uid, subUnitId: sheet, op: insert, objects: [], type: 0 } }],
      1,
    )
    const move = [
      uid,
      sheet,
      "data",
      draw,
      [
        "transform",
        {
          r: { left: 0, top: 0, width: 1, height: 1, angle: 0, flipY: false, flipX: false, skewX: 0, skewY: 0 },
          i: { left: 50, top: 60, width: 400, height: 300, angle: 0, flipY: false, flipX: false, skewX: 0, skewY: 0 },
        },
      ],
    ]
    const fin = applyMutationsToSnapshotJson(
      mid,
      [{ id: "sheet.mutation.set-drawing-apply", params: { unitId: uid, subUnitId: sheet, op: move, objects: [], type: 2 } }],
      2,
    )
    const out = JSON.parse(fin) as { resources?: { name: string; data: string }[] }
    const blob = drawingBlob(out)
    const layer = drawingSheet(blob, uid, sheet)
    const t = row(row(layer?.data, draw), "transform")
    expect(t?.["left"]).toBe(50)
  })
})

describe("applyMutationsToSnapshotJson — combined mutations", () => {
  test("single batch: set-range + nested drawing insert", () => {
    const uid = crypto.randomUUID()
    const raw = JSON.stringify(defaultWorkbook(uid, "combo"))
    const sheet = JSON.parse(raw).sheetOrder[0] as string
    const draw = "sdk-combo"
    const op = [
      uid,
      sheet,
      ["data", draw, { i: { drawingId: draw, componentKey: "VeritlyLiveChart" } }],
      ["order", 0, { i: draw }],
    ]
    const next = applyMutationsToSnapshotJson(
      raw,
      [
        {
          id: "sheet.mutation.set-range-values",
          params: { unitId: uid, subUnitId: sheet, cellValue: { "2": { "2": { v: 1, t: 2 } } } },
        },
        { id: "sheet.mutation.set-drawing-apply", params: { unitId: uid, subUnitId: sheet, op, objects: [], type: 0 } },
      ],
      9,
    )
    const out = JSON.parse(next) as {
      rev: number
      sheets: Record<string, { cellData?: Record<string, Record<string, { v?: unknown }>> }>
      resources?: { name: string; data: string }[]
    }
    expect(out.rev).toBe(9)
    expect(out.sheets[sheet].cellData?.["2"]?.["2"]?.v).toBe(1)
    const blob = drawingBlob(out)
    const layer = drawingSheet(blob, uid, sheet)
    expect(row(layer?.data, draw)?.["drawingId"]).toBe(draw)
  })
})

describe("commitDrawingPluginInWorkbook (compat)", () => {
  test("fills data and order when sub-sheet leaf is empty object", () => {
    const uid = crypto.randomUUID()
    const sheet = crypto.randomUUID()
    const wb: Record<string, unknown> = {
      unitID: uid,
      resources: [
        {
          name: DRAW,
          data: JSON.stringify({ [uid]: { [sheet]: {} } }),
        },
      ],
    }
    commitDrawingPluginInWorkbook(wb as WorkbookWire, "compat")
    const list = wb.resources as { name: string; data: string }[]
    const slot = list.find((r) => r.name === DRAW)
    expect(slot).toBeDefined()
    const blob = JSON.parse(slot!.data) as AnyBlob
    const layer = drawingSheet(blob, uid, sheet)
    expect(layer?.data).toEqual({})
    expect(layer?.order).toEqual([])
  })

  test("coerces object resource.data to normalized string", () => {
    const uid = crypto.randomUUID()
    const sheet = crypto.randomUUID()
    const wb: Record<string, unknown> = {
      unitID: uid,
      resources: [
        {
          name: DRAW,
          data: { [uid]: { [sheet]: {} } } as unknown,
        },
      ],
    }
    commitDrawingPluginInWorkbook(wb as WorkbookWire, "compat")
    const list = wb.resources as { name: string; data: string }[]
    const slot = list.find((r) => r.name === DRAW)
    expect(typeof slot?.data).toBe("string")
    const blob = JSON.parse(slot!.data) as AnyBlob
    const layer = drawingSheet(blob, uid, sheet)
    expect(layer?.data).toEqual({})
    expect(layer?.order).toEqual([])
  })

  test("workbookFromSnapshot repairs drawing blob before client load", () => {
    const uid = crypto.randomUUID()
    const sheet = crypto.randomUUID()
    const snap = JSON.stringify({
      rev: 1,
      workbook: {
        unitID: uid,
        rev: 1,
        resources: [{ name: DRAW, data: JSON.stringify({ [uid]: { [sheet]: {} } }) }],
        sheets: { [sheet]: { id: sheet, name: "S1" } },
        sheetOrder: [sheet],
      },
    })
    const { workbook } = workbookFromSnapshot(uid, 1, snap)
    const list = workbook.resources as { name: string; data: string }[]
    const slot = list.find((r) => r.name === DRAW)
    expect(slot).toBeDefined()
    const blob = JSON.parse(slot!.data) as AnyBlob
    const layer = drawingSheet(blob, uid, sheet)
    expect(layer?.data).toEqual({})
    expect(layer?.order).toEqual([])
  })
})

describe("applyMutationsToSnapshotJson — failures", () => {
  test("unknown mutation id still throws when list non-empty", () => {
    const uid = crypto.randomUUID()
    const raw = JSON.stringify(defaultWorkbook(uid, "x"))
    expect(() =>
      applyMutationsToSnapshotJson(raw, [{ id: "sheet.mutation.unknown", params: { unitId: uid, subUnitId: "s", x: 1 } }], 1),
    ).toThrow("no supported mutations applied")
  })

  test("set-range wrong sheet id returns no applied", () => {
    const uid = crypto.randomUUID()
    const raw = JSON.stringify(defaultWorkbook(uid, "x"))
    const sheet = JSON.parse(raw).sheetOrder[0] as string
    expect(() =>
      applyMutationsToSnapshotJson(
        raw,
        [
          {
            id: "sheet.mutation.set-range-values",
            params: { unitId: uid, subUnitId: "not-a-sheet", cellValue: { "0": { "0": { v: 1, t: 2 } } } },
          },
        ],
        1,
      ),
    ).toThrow("no supported mutations applied")
  })
})
