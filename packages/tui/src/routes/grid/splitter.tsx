import { createMemo, createSignal, onCleanup, Show, type JSX } from "solid-js"
import { useTheme } from "../../context/theme"
import { useGrid } from "../../context/grid"
import { MIN_CELL_COLS } from "../../context/grid-persistence"
import type { GridLayout } from "../../context/grid-persistence"

export interface SplitterProps {
  /**
   * Layout the splitter is drawn for. The orientation of the bar and the
   * dimension it controls depend on whether the split is horizontal or
   * vertical:
   * - `split-h` → vertical bar, drag along x-axis
   * - `split-v` → horizontal bar, drag along y-axis
   * The component no-ops for `single`.
   */
  layout: GridLayout
  /**
   * Total width (split-h) or height (split-v) available to the cell area, in
   * terminal columns / rows. The component subtracts the bar's own width or
   * height from this when computing the dragged cell's share.
   */
  total: number
  /**
   * Bar thickness in columns (split-h) or rows (split-v). Defaults to 1.
   */
  thickness?: number
}

/**
 * Phase 6: draggable splitter between two grid cells in a split layout.
 *
 * Behaviour:
 * - Mouse-down captures the initial pointer position and current ratio.
 * - Mouse-move updates the local ratio signal. We don't write to the grid
 *   store on every pixel — only on mouse-up — so a long drag doesn't flood
 *   the debounced persistence layer with intermediate states.
 * - The ratio is clamped so both sides stay at >= MIN_CELL_COLS columns or
 *   rows, matching the requirement in the Phase 6 brief.
 * - Visual feedback swaps the bar's background colour while dragging and
 *   shows a transient ratio label near the bar's centre.
 */
export function Splitter(props: SplitterProps): JSX.Element {
  const grid = useGrid()
  const { theme } = useTheme()

  const thickness = () => props.thickness ?? 1
  const horizontal = () => props.layout === "split-h"

  // Local mirror of the persisted ratio so dragging stays smooth. We sync
  // from the grid store on mount but write back only on mouse-up so the
  // debounced saver isn't woken up by every drag tick.
  const [localRatio, setLocalRatio] = createSignal(grid.splitRatio)
  const [dragging, setDragging] = createSignal(false)

  const inner = () => Math.max(1, props.total - thickness())
  const minRatio = createMemo(() => {
    if (inner() <= 0) return 0
    const limit = horizontal() ? MIN_CELL_COLS : 6
    return Math.min(1, limit / inner())
  })
  const maxRatio = createMemo(() => {
    if (inner() <= 0) return 1
    const limit = horizontal() ? MIN_CELL_COLS : 6
    return Math.max(0, 1 - limit / inner())
  })

  let origin: number | undefined
  let startRatio: number | undefined

  const onMouseDown = (evt: { button: number; x?: number; y?: number }) => {
    if (evt.button !== 0) return
    origin = horizontal() ? (evt.x ?? 0) : (evt.y ?? 0)
    startRatio = grid.splitRatio
    setLocalRatio(grid.splitRatio)
    setDragging(true)
  }

  const onMouseMove = (evt: { x?: number; y?: number }) => {
    if (!dragging()) return
    if (origin === undefined || startRatio === undefined) return
    if (inner() <= 0) return
    const current = horizontal() ? (evt.x ?? 0) : (evt.y ?? 0)
    const delta = (current - origin) / inner()
    const next = startRatio + delta
    const lo = minRatio()
    const hi = maxRatio()
    setLocalRatio(Math.max(lo, Math.min(hi, next)))
  }

  const onMouseUp = () => {
    if (!dragging()) return
    const final = localRatio()
    grid.setSplitRatio(final)
    setDragging(false)
    origin = undefined
    startRatio = undefined
  }

  // Cancel the drag if the cell unmounts mid-gesture.
  onCleanup(() => {
    origin = undefined
    startRatio = undefined
  })

  // Defensive: if the store ratio changes from outside (e.g. another keybind
  // or layout switch), follow it so the bar's position stays in sync.
  const ratio = createMemo(() => (dragging() ? localRatio() : grid.splitRatio))

  // Position of the bar as a fraction of the cell area (0-1). The bar is
  // drawn at this offset; the dragged cell takes the slice up to the bar and
  // the sibling cell takes the slice after.
  const position = createMemo(() => ratio())

  return (
    <Show when={props.layout !== "single"}>
      {horizontal() ? (
        <box
          width={thickness()}
          height="100%"
          backgroundColor={dragging() ? theme.primary : theme.border}
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          onMouseDrag={onMouseMove}
          onMouseDragEnd={onMouseUp}
          alignItems="center"
          justifyContent="center"
        >
          <Show when={dragging()}>
            <text fg={theme.selectedListItemText}>{`${Math.round(position() * 100)}%`}</text>
          </Show>
        </box>
      ) : (
        <box
          width="100%"
          height={thickness()}
          backgroundColor={dragging() ? theme.primary : theme.border}
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          onMouseDrag={onMouseMove}
          onMouseDragEnd={onMouseUp}
          alignItems="center"
          justifyContent="center"
        >
          <Show when={dragging()}>
            <text fg={theme.selectedListItemText}>{`${Math.round(position() * 100)}%`}</text>
          </Show>
        </box>
      )}
    </Show>
  )
}

/**
 * Phase 6: pure helpers used by `routes/grid/index.tsx` to compute the width
 * (split-h) or height (split-v) of the dragged and sibling cells. Pulled out
 * so both the splitter and the layout code path can share the same clamp
 * math without duplicating the formula.
 */
export function splitCellWidth(total: number, ratio: number, thickness = 1): number {
  const inner = Math.max(1, total - thickness)
  const clamped = clampRatio(ratio, inner, true)
  return Math.max(MIN_CELL_COLS, Math.round(inner * clamped))
}

export function splitCellHeight(total: number, ratio: number, thickness = 1): number {
  const inner = Math.max(1, total - thickness)
  const clamped = clampRatio(ratio, inner, false)
  return Math.max(6, Math.round(inner * clamped))
}

function clampRatio(ratio: number, inner: number, horizontal: boolean): number {
  if (inner <= 0) return ratio
  const limit = horizontal ? MIN_CELL_COLS : 6
  const lo = Math.min(1, limit / inner)
  const hi = Math.max(0, 1 - limit / inner)
  return Math.max(lo, Math.min(hi, ratio))
}
