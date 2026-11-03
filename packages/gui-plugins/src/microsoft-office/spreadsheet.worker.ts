import {
  initWasm,
  openWorkbook,
  toTsv,
  type SheetInfo,
  type WorkbookHandle,
  type XlsxCellRead,
  type XlsxRangeTarget,
} from "@betteroffice/xlsx"
import type { CellRange } from "@betteroffice/xlsx/headless"
import { anchorRange, attempt, lastCell, parseRange, parseSpans } from "./sheet-cells"
import { drawFrame, paintFrame } from "./sheet-frame"
import { frozenSize } from "./sheet-paint"
import type { SheetLayout, SheetMethods, SheetTab } from "./sheet-protocol"
import { serveWorker, Transfer } from "./worker-rpc"

// One worker holds one open workbook: its engine, recalculation, display lists and the painting of its cells. The
// window terminates the worker when the workbook closes, which is the only way the engine's memory is given back.

type Opened = {
  readonly workbook: WorkbookHandle
  /** The active sheet's metadata; the engine draws only the active sheet. */
  info: SheetInfo
  /** Where each sheet's last cell ends, by sheet and frozen panes' size; measured once, as it costs a frame. */
  readonly ends: Map<string, { readonly x: number; readonly y: number } | undefined>
  /** The one canvas every frame paints on and hands over as a bitmap. */
  readonly surface: OffscreenCanvas
}

/** The workbook this worker opened, once it has. */
type State = { opened: Opened | undefined }

const state: State = { opened: undefined }

serveWorker<SheetMethods>({
  open: async (input) => {
    if (state.opened) throw new Error("The worker already holds a workbook")

    await initWasm()

    const workbook = openWorkbook(new Uint8Array(input.bytes))
    const info = workbook.sheetInfo()

    state.opened = { workbook, info, ends: new Map(), surface: new OffscreenCanvas(1, 1) }

    const tabs = visibleTabs(workbook, info)
    // A workbook saved on a hidden sheet opens on the first visible one, as Excel does.
    const first = tabs.find((tab) => tab.index === info.activeSheet) ?? tabs[0]

    if (!first) return undefined

    return { tabs, layout: show(state.opened, first.index) }
  },
  show: (input) => {
    const opened = required()
    const current = opened.info.activeSheet
    const layout = attempt(() => show(opened, input.sheet))

    if (layout) return layout

    // One sheet that fails to open leaves the others readable: go back to the sheet on show.
    attempt(() => show(opened, current))

    throw new Error(`Sheet ${input.sheet} could not open`)
  },
  frame: (input) => {
    const opened = active(input.sheet)
    const frozen = { rows: opened.info.frozenRows, cols: opened.info.frozenCols }
    const viewport = { x: input.x, y: input.y, width: input.width, height: input.height }
    const drawn = drawFrame(opened.workbook, viewport, frozen, input.wider)

    if (!drawn) return undefined

    const surface = opened.surface
    const width = Math.ceil(input.offset.x + drawn.viewport.width * input.ratio)
    const height = Math.ceil(input.offset.y + drawn.viewport.height * input.ratio)

    if (surface.width !== width) surface.width = width

    if (surface.height !== height) surface.height = height

    const context = surface.getContext("2d")

    if (!context) return undefined

    paintFrame(context, drawn, { ratio: input.ratio, origin: input.offset })

    const bitmap = surface.transferToImageBitmap()
    const grid = drawn.list.grid
    const panes = frozenSize(grid, frozen)

    return new Transfer(
      {
        bitmap,
        viewport: drawn.viewport,
        grid,
        hyperlinks: drawn.list.hyperlinks ?? [],
        frozen: panes,
        end: end(opened, input.sheet, panes),
      },
      [bitmap],
    )
  },
  position: (input) => {
    const workbook = required().workbook
    const cell = input.cell
    const start = attempt(() => workbook.cellPosition(input.sheet, cell.row, cell.col))

    const next = attempt(() =>
      workbook.cellPosition(input.sheet, Math.min(cell.row + 1, lastCell.row), Math.min(cell.col + 1, lastCell.col)),
    )

    return start && next ? { start, next } : undefined
  },
  cells: (input) => {
    const cells = read(required(), input.sheet, input.range)
    const range = input.range

    return Array.from({ length: range.bottom - range.top + 1 }, (_, row) =>
      Array.from({ length: range.right - range.left + 1 }, (_, col) => cells?.[row]?.[col]?.displayText ?? ""),
    )
  },
  // Copies the cells as they show, which is what a reader expects to paste, not the formulas behind them.
  copy: (input) => {
    const cells = read(required(), input.sheet, input.range)

    if (!cells) return undefined

    return toTsv(cells.map((row) => row.map((cell) => ({ input: cell.displayText, isFormula: literal(cell) }))))
  },
})

function required() {
  if (!state.opened) throw new Error("The worker holds no workbook")

  return state.opened
}

/** The workbook with `sheet` active, as a frame from a grid that has since given way to another sheet may ask. */
function active(sheet: number) {
  const opened = required()

  if (opened.info.activeSheet !== sheet) show(opened, sheet)

  return opened
}

/** Makes a sheet the active one and reads what its grid needs. */
function show(opened: Opened, sheet: number): SheetLayout {
  opened.workbook.setActiveSheet(sheet)
  opened.info = opened.workbook.sheetInfo()

  return { info: opened.info, ...layout(opened.workbook, sheet) }
}

/**
 * The used range, the merged cells, the hidden rows and columns, and how far the charts reach, from one export of the
 * sheet's metadata. One cell is enough: the lists before the cells are complete however soon the export stops.
 */
function layout(workbook: WorkbookHandle, sheet: number) {
  const result = attempt(() =>
    workbook.exportStructured({
      scope: [{ sheet, range: "A1:XFD1048576" }],
      maxCells: 1,
      includeDefinedNames: false,
    }),
  )

  const exported = result?.ok ? result.content.sheets[0] : undefined

  const charts = (exported?.objects ?? [])
    .filter((object) => object.kind === "chart" && !object.hidden)
    .flatMap((object) => (object.anchor ? anchorRange(object.anchor) : []))
    // The corner cell holds the chart's edge somewhere inside it, so the cell past it bounds the chart.
    .flatMap((range) => {
      const corner = attempt(() =>
        workbook.cellPosition(sheet, Math.min(range.bottom + 1, lastCell.row), Math.min(range.right + 1, lastCell.col)),
      )

      return corner ? [corner] : []
    })

  return {
    used: exported?.usedRange ? parseRange(exported.usedRange) : undefined,
    merges: (exported?.merges ?? []).flatMap((merge) => anchorRange(merge.anchor)),
    hidden: {
      rows: parseSpans(exported?.hiddenRows ?? [], "rows"),
      columns: parseSpans(exported?.hiddenColumns ?? [], "columns"),
    },
    chartWidth: Math.max(0, ...charts.map((corner) => corner.x)),
    chartHeight: Math.max(0, ...charts.map((corner) => corner.y)),
  }
}

/** Where the sheet's last cell ends, past the frozen panes. A viewport past it makes the engine throw. */
function end(opened: Opened, sheet: number, frozen: { readonly width: number; readonly height: number }) {
  const key = `${sheet}:${frozen.width}:${frozen.height}`

  if (opened.ends.has(key)) return opened.ends.get(key)

  const measured = measureEnd(opened.workbook, sheet, frozen)

  opened.ends.set(key, measured)

  return measured
}

function measureEnd(
  workbook: WorkbookHandle,
  sheet: number,
  frozen: { readonly width: number; readonly height: number },
) {
  const last = attempt(() => workbook.cellPosition(sheet, lastCell.row, lastCell.col))

  if (!last) return undefined

  // A viewport one pixel past the frozen panes, on the last cell, reports where that cell ends.
  const grid = attempt(
    () => workbook.displayList({ x: last.x, y: last.y, width: frozen.width + 1, height: frozen.height + 1 }).grid,
  )

  // The engine works in single precision there, so stay a little short of the edge.
  const margin = 2

  return {
    x: last.x + Math.max(0, (grid ? grid.colOffsets[grid.colOffsets.length - 1] : 0) - frozen.width) - margin,
    y: last.y + Math.max(0, (grid ? grid.rowOffsets[grid.rowOffsets.length - 1] : 0) - frozen.height) - margin,
  }
}

/** The cells of a range on a sheet as the engine reads them, row by row; undefined when it cannot. */
function read(opened: Opened, sheet: number, range: CellRange) {
  const target: XlsxRangeTarget = {
    sheetId: opened.info.sheetIds[sheet],
    range: { kind: "rowCol", start: { row: range.top, col: range.left }, end: { row: range.bottom, col: range.right } },
  }

  const result = attempt(() => opened.workbook.readCells({ ranges: [target] }))

  return result?.ok ? result.ranges[0]?.cells : undefined
}

/** The workbook's sheets but its hidden and very hidden ones, which Excel lists only to unhide. */
function visibleTabs(workbook: WorkbookHandle, info: SheetInfo): SheetTab[] {
  const names = info.sheetNames

  const result = attempt(() =>
    workbook.exportStructured({
      includeHiddenSheets: true,
      includeDefinedNames: false,
      scope: names.map((_, sheet) => ({ sheet, range: "A1" })),
    }),
  )

  const hidden = new Set(
    (result?.ok ? result.content.sheets : [])
      .filter((sheet) => sheet.visibility === "hidden" || sheet.visibility === "veryHidden")
      .flatMap((sheet) => (sheet.anchor.kind === "sheet" ? [sheet.anchor.sheet.index] : [])),
  )

  return names.flatMap((name, index) => (hidden.has(index) ? [] : [{ index, name }]))
}

/**
 * Whether a cell's text pastes as it is. `toTsv` quotes text that a spreadsheet would read as a formula; a number shown
 * with a sign, such as "-12.50", is safe, and quoting it would paste text instead of the number.
 */
function literal(cell: XlsxCellRead) {
  return cell.value.kind === "number" && /^[-+][\d\s.,%\p{Sc}]+(?:e[-+]\d+)?$/iu.test(cell.displayText)
}
