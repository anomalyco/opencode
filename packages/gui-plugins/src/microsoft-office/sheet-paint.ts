import { rangeRect, type CellRange, type GridMeta } from "@betteroffice/xlsx/headless"
import { columnName } from "./sheet-cells"
import type { SheetFrame, SheetFrameRequest } from "./sheet-protocol"

/** Excel's light headers and green selection. The sheet keeps them on its white paper in every theme. */
const colours = {
  header: "#f5f5f5",
  label: "#5c5c5c",
  line: "#d4d4d4",
  edge: "#bdbdbd",
  corner: "#c8c8c8",
  selectedHeader: "#d3ecdd",
  selectedLabel: "#185c37",
  accent: "#217346",
  selection: "rgba(33, 115, 70, 0.12)",
}

const font = "11px ui-sans-serif, system-ui, sans-serif"

/** The height of the column headers, in CSS pixels. */
export const headerHeight = 20

/** The sizes of the header strips, in CSS pixels: the row headers' width and the column headers' height. */
export type Headers = { readonly width: number; readonly height: number }

/**
 * The frozen panes' size in a frame: the offset of the first track past them. Without panes, the first track can start
 * before the frame, part of it scrolled away.
 */
export function frozenSize(grid: GridMeta | undefined, frozen: { readonly rows: number; readonly cols: number }) {
  if (!grid) return { width: 0, height: 0 }

  const pane = (offsets: readonly number[], start: number, indices: readonly number[] | undefined, count: number) => {
    if (count === 0) return 0

    const first = offsets.findIndex(
      (_, position) => position === offsets.length - 1 || trackIndex(start, indices, position) >= count,
    )

    return Math.max(0, offsets[first] ?? 0)
  }

  return {
    width: pane(grid.colOffsets, grid.startCol, grid.colIndices, frozen.cols),
    height: pane(grid.rowOffsets, grid.startRow, grid.rowIndices, frozen.rows),
  }
}

/** A frame from the workbook worker and the request it answers, which says where its cells sit. */
export type Painted = { readonly request: SheetFrameRequest; readonly frame: SheetFrame }

/**
 * Draws a frame's cells beside the headers at the current scroll position. A frame painted at another position, as one
 * is while the next renders, moves with the scroll: the frozen panes stay put and the cells past them shift, leaving
 * the paper where the frame has no cells yet.
 */
export function paintCells(
  context: CanvasRenderingContext2D,
  painted: Painted,
  input: {
    readonly ratio: number
    readonly headers: Headers
    readonly x: number
    readonly y: number
    readonly width: number
    readonly height: number
  },
) {
  const request = painted.request
  const bitmap = painted.frame.bitmap
  const panes = painted.frame.frozen
  const ratio = input.ratio
  const scale = ratio / request.ratio
  const origin = { x: input.headers.width * ratio, y: input.headers.height * ratio }

  // Each side splits at the frozen panes: the panes stay put, the cells past them follow the scroll.
  const columns = [
    { start: 0, end: Math.min(panes.width, input.width), shift: 0 },
    { start: panes.width, end: input.width, shift: painted.frame.viewport.x - input.x },
  ]

  const rows = [
    { start: 0, end: Math.min(panes.height, input.height), shift: 0 },
    { start: panes.height, end: input.height, shift: painted.frame.viewport.y - input.y },
  ]

  // The whole canvas clears, headers included: their edges cover part of a device pixel, which would darken with every
  // paint drawn over the last.
  context.save()
  context.setTransform(1, 0, 0, 1, 0, 0)
  context.clearRect(0, 0, context.canvas.width, context.canvas.height)

  rows.forEach((row) =>
    columns.forEach((column) => {
      if (row.end <= row.start || column.end <= column.start) return

      const left = Math.round(origin.x + column.start * ratio)
      const top = Math.round(origin.y + row.start * ratio)

      context.save()
      context.beginPath()
      context.rect(
        left,
        top,
        Math.round(origin.x + column.end * ratio) - left,
        Math.round(origin.y + row.end * ratio) - top,
      )
      context.clip()
      // Whole device pixels, so a frame at its own position lands exactly where the worker painted its cells.
      context.drawImage(
        bitmap,
        Math.round(origin.x + column.shift * ratio - request.offset.x * scale),
        Math.round(origin.y + row.shift * ratio - request.offset.y * scale),
        bitmap.width * scale,
        bitmap.height * scale,
      )
      context.restore()
    }),
  )

  context.restore()
}

/**
 * A frame's grid at another scroll position, moved as `paintCells` moves its cells: the tracks past the frozen panes
 * shift by `shift`, and never under the panes, so headers, selection and hit tests follow the cells on screen.
 */
export function shiftGrid(
  grid: GridMeta,
  frozen: { readonly rows: number; readonly cols: number },
  panes: { readonly width: number; readonly height: number },
  shift: { readonly x: number; readonly y: number },
): GridMeta {
  if (shift.x === 0 && shift.y === 0) return grid

  const axis = (
    offsets: readonly number[],
    start: number,
    indices: readonly number[] | undefined,
    count: number,
    edge: number,
    by: number,
  ) => {
    // The offsets up to the panes' far edge belong to the panes; without panes, every track moves.
    const fixed = count === 0 ? -1 : offsets.findIndex((_, position) => trackIndex(start, indices, position) >= count)

    return offsets.map((offset, position) => {
      if (fixed === -1 && count > 0) return offset

      if (position <= fixed) return offset

      return count === 0 ? offset + by : Math.max(edge, offset + by)
    })
  }

  return {
    ...grid,
    colOffsets: axis(grid.colOffsets, grid.startCol, grid.colIndices, frozen.cols, panes.width, shift.x),
    rowOffsets: axis(grid.rowOffsets, grid.startRow, grid.rowIndices, frozen.rows, panes.height, shift.y),
  }
}

/** The sheet row or column at a position in a frame's grid: its indices when tracks are skipped, else consecutive. */
export function trackIndex(start: number, indices: readonly number[] | undefined, position: number) {
  return indices?.[position] ?? start + position
}

/** The width of the row headers that fits row numbers up to `rows`, as Excel widens them for longer numbers. */
export function rowHeaderWidth(context: CanvasRenderingContext2D, rows: number) {
  context.font = font

  return Math.max(28, Math.ceil(context.measureText(String(rows)).width) + 12)
}

/**
 * Draws the column letters and row numbers of a frame's tracks, frozen panes first, along the top and left edges.
 * Hidden tracks have no width in the grid, so they get no header.
 */
export function paintHeaders(
  context: CanvasRenderingContext2D,
  input: {
    readonly grid: GridMeta
    readonly ratio: number
    readonly headers: Headers
    readonly width: number
    readonly height: number
    readonly selected: CellRange | undefined
  },
) {
  const grid = input.grid
  const headers = input.headers
  const selected = input.selected

  context.save()
  context.setTransform(input.ratio, 0, 0, input.ratio, 0, 0)
  context.fillStyle = colours.header
  context.fillRect(0, 0, input.width, headers.height)
  context.fillRect(0, 0, headers.width, input.height)
  context.font = font
  context.textAlign = "center"
  context.textBaseline = "middle"

  grid.colOffsets.slice(0, -1).forEach((offset, position) => {
    const index = trackIndex(grid.startCol, grid.colIndices, position)

    paintHeader(context, {
      x: headers.width + offset,
      y: 0,
      width: grid.colOffsets[position + 1] - offset,
      height: headers.height,
      label: columnName(index),
      selected: !!selected && index >= selected.left && index <= selected.right,
      clip: { x: headers.width, width: input.width - headers.width },
    })
  })
  grid.rowOffsets.slice(0, -1).forEach((offset, position) => {
    const index = trackIndex(grid.startRow, grid.rowIndices, position)

    paintHeader(context, {
      x: 0,
      y: headers.height + offset,
      width: headers.width,
      height: grid.rowOffsets[position + 1] - offset,
      label: String(index + 1),
      selected: !!selected && index >= selected.top && index <= selected.bottom,
      clip: { y: headers.height, height: input.height - headers.height },
    })
  })

  line(context, colours.edge, 0, headers.height, input.width, headers.height)
  line(context, colours.edge, headers.width, 0, headers.width, input.height)
  // Excel's select-all corner: a small triangle pointing at the cells.
  context.fillStyle = colours.corner
  context.beginPath()
  context.moveTo(headers.width - 4, headers.height - 12)
  context.lineTo(headers.width - 4, headers.height - 4)
  context.lineTo(headers.width - 12, headers.height - 4)
  context.closePath()
  context.fill()
  context.restore()
}

/** Outlines the selected range and tints it, leaving its active cell clear, in the cells beside the headers. */
export function paintSelection(
  context: CanvasRenderingContext2D,
  input: {
    readonly grid: GridMeta
    readonly ratio: number
    readonly headers: Headers
    readonly width: number
    readonly height: number
    readonly range: CellRange
    readonly active: CellRange
  },
) {
  const range = rangeRect(input.grid, input.range)

  if (!range) return

  const active = rangeRect(input.grid, input.active)

  context.save()
  context.setTransform(
    input.ratio,
    0,
    0,
    input.ratio,
    input.headers.width * input.ratio,
    input.headers.height * input.ratio,
  )
  context.beginPath()
  context.rect(0, 0, input.width, input.height)
  context.clip()

  if (!sameRect(range, active)) {
    context.beginPath()
    context.rect(range.x, range.y, range.w, range.h)

    if (active) context.rect(active.x, active.y, active.w, active.h)

    context.fillStyle = colours.selection
    context.fill("evenodd")
  }

  context.strokeStyle = colours.accent
  context.lineWidth = 2
  context.strokeRect(range.x, range.y, range.w, range.h)
  context.restore()
}

function paintHeader(
  context: CanvasRenderingContext2D,
  header: {
    readonly x: number
    readonly y: number
    readonly width: number
    readonly height: number
    readonly label: string
    readonly selected: boolean
    readonly clip: { readonly x?: number; readonly y?: number; readonly width?: number; readonly height?: number }
  },
) {
  if (header.width <= 0 || header.height <= 0) return

  const columns = header.y === 0

  context.save()
  context.beginPath()
  context.rect(
    header.clip.x ?? header.x,
    header.clip.y ?? header.y,
    header.clip.width ?? header.width,
    header.clip.height ?? header.height,
  )
  context.clip()

  // A selected header is tinted, with a bar on the edge that meets the cells.
  if (header.selected) {
    context.fillStyle = colours.selectedHeader
    context.fillRect(header.x, header.y, header.width, header.height)
    context.fillStyle = colours.accent
    context.fillRect(
      columns ? header.x : header.x + header.width - 2,
      columns ? header.y + header.height - 2 : header.y,
      columns ? header.width : 2,
      columns ? 2 : header.height,
    )
  }

  // A track too small for its label shows none, rather than labels piled over each other.
  if (columns ? context.measureText(header.label).width + 2 <= header.width : header.height >= 9) {
    context.fillStyle = header.selected ? colours.selectedLabel : colours.label
    context.fillText(header.label, header.x + header.width / 2, header.y + header.height / 2 + 0.5)
  }

  context.restore()

  // The line after the header, where the gridline between its cells and the next ones meets it.
  const x = columns ? header.x + header.width : header.x
  const y = columns ? header.y : header.y + header.height

  line(context, colours.line, x, y, columns ? x : x + header.width, columns ? y + header.height : y)
}

/** A one-pixel line centred on its coordinates, as the display list draws gridlines, so the two meet. */
function line(context: CanvasRenderingContext2D, colour: string, x1: number, y1: number, x2: number, y2: number) {
  context.strokeStyle = colour
  context.lineWidth = 1
  context.beginPath()
  context.moveTo(x1, y1)
  context.lineTo(x2, y2)
  context.stroke()
}

function sameRect(a: { x: number; y: number; w: number; h: number }, b: typeof a | null) {
  return !!b && a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h
}
