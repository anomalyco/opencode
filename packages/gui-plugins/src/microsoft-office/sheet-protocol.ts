import type { SheetInfo } from "@betteroffice/xlsx"
import type { CellAddr, CellRange, GridMeta, HyperlinkRegion } from "@betteroffice/xlsx/headless"
import type { Span } from "./sheet-cells"
import type { Method } from "./worker-rpc"

// What the Excel preview's window and its workbook worker say to each other. The window keeps the selection, the
// headers and the scroll area; the engine, its recalculation, the display lists and the cells' painting live in the
// worker.

/** A visible sheet: its index in the workbook and its tab name. */
export type SheetTab = { readonly index: number; readonly name: string }

/** What a sheet's grid needs from the workbook before its first frame. */
export type SheetLayout = {
  readonly info: SheetInfo
  /** The used range; undefined for an empty sheet. */
  readonly used: CellRange | undefined
  readonly merges: readonly CellRange[]
  readonly hidden: { readonly rows: readonly Span[]; readonly columns: readonly Span[] }
  /** How far the charts reach, in the engine's scroll coordinates. */
  readonly chartWidth: number
  readonly chartHeight: number
}

/** A viewport, in CSS pixels and the engine's scroll coordinates: the frozen panes, then the cells past them from `x`, `y`. */
export type SheetViewport = {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/** The cells of one viewport. */
export type SheetFrameRequest = {
  readonly sheet: number
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
  /** Device pixels per CSS pixel. */
  readonly ratio: number
  /** Where the cells start inside the bitmap's first device pixel, so a frame lands where a direct paint would. */
  readonly offset: { readonly x: number; readonly y: number }
  /**
   * A larger viewport around this one to draw instead, so the frame still covers the screen after a scroll that
   * outruns the next frame. The worker draws the requested viewport alone where the engine refuses the larger one.
   */
  readonly wider: SheetViewport | undefined
}

/** A painted frame: the bitmap and the little geometry the window needs to draw headers, select and follow links. */
export type SheetFrame = {
  /** The cells, `offset` device pixels in from its top-left corner. */
  readonly bitmap: ImageBitmap
  /** The viewport the bitmap shows: the requested one, or a wider one with the margin. */
  readonly viewport: SheetViewport
  readonly grid: GridMeta | undefined
  readonly hyperlinks: readonly HyperlinkRegion[]
  /** The frozen panes' size in the frame. */
  readonly frozen: { readonly width: number; readonly height: number }
  /** Where the sheet's last cell ends, past the frozen panes; undefined when the engine cannot tell. */
  readonly end: { readonly x: number; readonly y: number } | undefined
}

/** The workbook worker's methods. Every method but `open` needs the workbook `open` opened. */
export type SheetMethods = {
  /**
   * Opens the file's bytes and the sheet to show first: the active one, or the first visible one when the workbook was
   * saved on a hidden sheet. Undefined when no sheet is visible.
   */
  readonly open: Method<
    { readonly bytes: ArrayBuffer },
    { readonly tabs: readonly SheetTab[]; readonly layout: SheetLayout } | undefined
  >
  /** Makes a sheet the active one; rejects, leaving the sheet before it active, when it cannot open. */
  readonly show: Method<{ readonly sheet: number }, SheetLayout>
  /** Paints a frame; undefined when even its smallest tiles cannot be drawn. */
  readonly frame: Method<SheetFrameRequest, SheetFrame | undefined>
  /** Where a cell starts and where the cell past it starts, to scroll it into view. */
  readonly position: Method<
    { readonly sheet: number; readonly cell: CellAddr },
    { readonly start: { x: number; y: number }; readonly next: { x: number; y: number } } | undefined
  >
  /** The cells' text as they show, row by row, for screen readers. */
  readonly cells: Method<{ readonly sheet: number; readonly range: CellRange }, readonly (readonly string[])[]>
  /** The cells as they show, as tab-separated text to paste; undefined when they cannot be read. */
  readonly copy: Method<{ readonly sheet: number; readonly range: CellRange }, string | undefined>
}
