import { paintDisplayList, type DisplayList, type GridMeta, type WorkbookHandle } from "@betteroffice/xlsx"
import { attempt } from "./sheet-cells"
import { frozenSize } from "./sheet-paint"
import type { SheetViewport } from "./sheet-protocol"

// The workbook worker's frames: the display lists of one viewport, split into tiles where the engine refuses it whole,
// and their painting.

/** The most tiles a side of a frame splits into before the frame gives up. */
const maxSplit = 8

/**
 * How far a tile reaches past each of its seams, in CSS pixels. The engine draws pane dividers and cut tracks at a
 * frame's edges, which the next tile has to cover, and the seam falls inside a device pixel.
 */
const seamOverlap = 8

/** Part of a frame: its display list, where its origin sits in the frame, and where it starts to show. */
type Tile = {
  readonly list: DisplayList
  readonly x: number
  readonly y: number
  readonly clipX: number
  readonly clipY: number
}

/**
 * A frame of cells: the tiles that draw it, one display list for its grid and links, without draw commands, and the
 * viewport it shows.
 */
export type Frame = { readonly list: DisplayList; readonly tiles: readonly Tile[]; readonly viewport: SheetViewport }

/**
 * The cells of one viewport, as the engine draws them; `undefined` when even its smallest tiles fail. A `wider`
 * viewport around it is drawn instead when the engine takes it whole.
 */
export function drawFrame(
  workbook: WorkbookHandle,
  viewport: SheetViewport,
  frozen: { readonly rows: number; readonly cols: number },
  wider?: SheetViewport,
): Frame | undefined {
  const around = wider && attempt(() => workbook.displayList(wider))

  if (wider && around)
    return { list: around, tiles: [{ list: around, x: 0, y: 0, clipX: 0, clipY: 0 }], viewport: wider }

  const whole = attempt(() => workbook.displayList(viewport))

  if (whole) return { list: whole, tiles: [{ list: whole, x: 0, y: 0, clipX: 0, clipY: 0 }], viewport }

  // The engine refuses a viewport with too many cells, as a wide pane of narrow columns has. One row and one column of
  // the frame give its tracks, and so where its frozen panes end.
  const columns = attempt(() => workbook.displayList({ ...viewport, height: 1 }).grid)
  const rows = attempt(() => workbook.displayList({ ...viewport, width: 1 }).grid)

  if (!columns || !rows) return undefined

  const grid = {
    startRow: rows.startRow,
    rowIndices: rows.rowIndices,
    rowOffsets: rows.rowOffsets,
    startCol: columns.startCol,
    colIndices: columns.colIndices,
    colOffsets: columns.colOffsets,
  }

  return tiled(workbook, viewport, frozenSize(grid, frozen), grid, 2)
}

/**
 * Draws a frame's tiles with the cells' top-left corner at `origin`, in device pixels, each tile from its seam on, so a
 * tile covers the panes it repeats.
 */
export function paintFrame(
  context: OffscreenCanvasRenderingContext2D,
  frame: Frame,
  input: { readonly ratio: number; readonly origin: { readonly x: number; readonly y: number } },
) {
  const ratio = input.ratio
  const origin = input.origin
  // SAFETY: the painter draws through the members a worker's 2D context shares with the window's. Only the window's
  // context type is declared, and it has focus and attribute members the worker's lacks, hence the double cast.
  // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- see SAFETY above
  const painter = context as unknown as CanvasRenderingContext2D

  frame.tiles.forEach((tile) => {
    const at = { x: origin.x + tile.x * ratio, y: origin.y + tile.y * ratio }

    if (tile.clipX === 0 && tile.clipY === 0) return paintDisplayList(painter, tile.list, ratio, at)

    context.save()
    context.setTransform(1, 0, 0, 1, 0, 0)
    context.beginPath()
    context.rect(
      Math.round(origin.x + tile.clipX * ratio),
      Math.round(origin.y + tile.clipY * ratio),
      context.canvas.width,
      context.canvas.height,
    )
    context.clip()
    paintDisplayList(painter, tile.list, ratio, at)
    context.restore()
  })
}

/**
 * A frame split into `split` tiles a side, each under the engine's cap. A tile past the first along an axis asks for
 * the frozen panes too, as every viewport has them, so the cells past them start just before its seam.
 */
function tiled(
  workbook: WorkbookHandle,
  viewport: SheetViewport,
  panes: { readonly width: number; readonly height: number },
  grid: GridMeta,
  split: number,
): Frame | undefined {
  const columns = segments(viewport.width, panes.width, split)
  const rows = segments(viewport.height, panes.height, split)
  const tiles: Tile[] = []

  const complete = rows.every((row) =>
    columns.every((column) => {
      const x = column.start === 0 ? 0 : column.start - seamOverlap - panes.width
      const y = row.start === 0 ? 0 : row.start - seamOverlap - panes.height
      // A tile but the last along an axis reaches past its end, which the next tile paints over.
      const right = column.end === viewport.width ? column.end : column.end + seamOverlap
      const bottom = row.end === viewport.height ? row.end : row.end + seamOverlap

      const list = attempt(() =>
        workbook.displayList({ x: viewport.x + x, y: viewport.y + y, width: right - x, height: bottom - y }),
      )

      if (list) tiles.push({ list, x, y, clipX: column.start, clipY: row.start })

      return !!list
    }),
  )

  if (complete) {
    const hyperlinks = tiles.flatMap((tile) => tile.list.hyperlinks ?? [])

    return { list: { width: viewport.width, height: viewport.height, commands: [], grid, hyperlinks }, tiles, viewport }
  }

  if (split >= maxSplit) return undefined

  return tiled(workbook, viewport, panes, grid, split + 1)
}

/** Even spans of a side, the first holding the frozen panes whole; a seam inside them is dropped. */
function segments(size: number, panes: number, split: number) {
  const starts = Array.from({ length: split }, (_, part) => Math.round((part * size) / split)).filter(
    (start, part) => part === 0 || (start >= panes + seamOverlap && start < size),
  )

  return starts.map((start, part) => ({ start, end: starts[part + 1] ?? size }))
}
