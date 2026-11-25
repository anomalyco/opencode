import { describe, expect, test } from "bun:test"
import type { SheetInfo } from "@betteroffice/xlsx"
import { activateSheet, showSheet, type ActiveSheet } from "./sheet-activate"

const info = (sheet: number): SheetInfo => ({
  sheetIds: ["a", "b", "c"],
  sheetNames: ["One", "Two", "Three"],
  activeSheet: sheet,
  contentWidth: 1000,
  contentHeight: 1000,
  frozenRows: 0,
  frozenCols: 0,
  initialScrollX: 0,
  initialScrollY: 0,
})

// A workbook engine reduced to its active sheet, which counts the switches it makes.
const engine = () => {
  const workbook = {
    active: 0,
    switches: 0,
    setActiveSheet: (sheet: number) => {
      workbook.active = sheet
      workbook.switches += 1
    },
    sheetInfo: () => info(workbook.active),
  }

  const target: ActiveSheet = { workbook, info: info(0) }

  return { workbook, target }
}

// The layout read throws for these sheets, as one the engine cannot export does.
const read = (broken: readonly number[]) => (sheet: SheetInfo) => {
  if (broken.includes(sheet.activeSheet)) throw new Error("no layout")

  return sheet.activeSheet
}

describe("showSheet", () => {
  test("opens a sheet and records its metadata", () => {
    const fixture = engine()

    expect(showSheet(fixture.target, 2, read([]))).toBe(2)
    expect(fixture.workbook.active).toBe(2)
    expect(fixture.target.info.activeSheet).toBe(2)
  })

  // Bug: the failed sheet's metadata stayed on record, so a second failing show "recovered" to the failed sheet.
  test("a sheet that fails twice in a row leaves the sheet on show active", () => {
    const fixture = engine()

    expect(showSheet(fixture.target, 1, read([1, 2]))).toBeUndefined()
    expect(fixture.workbook.active).toBe(0)
    expect(fixture.target.info.activeSheet).toBe(0)

    expect(showSheet(fixture.target, 2, read([1, 2]))).toBeUndefined()
    expect(fixture.workbook.active).toBe(0)
    expect(fixture.target.info.activeSheet).toBe(0)

    expect(showSheet(fixture.target, 1, read([2]))).toBe(1)
    expect(fixture.target.info.activeSheet).toBe(1)
  })
})

describe("activateSheet", () => {
  test("switches the engine only when another sheet is asked for", () => {
    const fixture = engine()

    expect(activateSheet(fixture.target, 0).activeSheet).toBe(0)
    expect(fixture.workbook.switches).toBe(0)
    expect(activateSheet(fixture.target, 1).activeSheet).toBe(1)
    expect(fixture.workbook.switches).toBe(1)
  })
})
