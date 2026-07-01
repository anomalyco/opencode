import {
  Match,
  Switch,
  Show,
  createMemo,
  createSignal,
  createEffect,
  on,
  onCleanup,
  onMount,
  ErrorBoundary,
} from "solid-js"
import { useKeyboard, useTerminalDimensions } from "@opentui/solid"
import { useRoute, useRouteData } from "../../context/route"
import { useKeybind } from "../../context/keybind"
import { useTheme } from "../../context/theme"
import { useToast } from "../../ui/toast"
import { useDialog } from "../../ui/dialog"
import { GridProvider, useGrid } from "../../context/grid"
import { load, type GridCell } from "../../context/grid-persistence"
import { useSDK } from "../../context/sdk"
import { useProject } from "../../context/project"
import { useSync } from "../../context/sync"
import { useWorkspaceClients } from "../../context/workspace-clients"
import { SessionCell } from "./session-cell"
import { PlanCell } from "./plan-cell"
import { GridToolbar } from "./toolbar"
import { Sidebar } from "./sidebar"
import { CellErrorOverlay } from "../../component/cell-error-overlay"
import { Splitter, splitCellWidth, splitCellHeight } from "./splitter"
import { GridKeyboardHelp } from "./keyboard-help"
import { createGridSession } from "./grid-create"

/**
 * GridView — root grid layout component for Phase 6.
 *
 * Wraps the session/plan cells in a GridProvider, renders a toolbar (cell
 * tabs), the active cell body, and a management sidebar. Layout modes —
 * single, split-h, split-v — control how cells are arranged. Each cell
 * is wrapped in its own ErrorBoundary. Split layouts insert a draggable
 * splitter bar between cells so users can resize the dragged cell's share
 * (persisted to `~/.opencode/grid-layout.json`).
 *
 * Phase 6 additions:
 * - `--grid` / `OPENCODE_GRID` boot path. The flag launches the TUI straight
 *   into the grid route and restores the persisted layout on mount.
 * - Splitter drag handle + persisted split ratio.
 * - Per-cell shortcut keybinds (`<leader>1`..`<leader>9`, `<leader>0`).
 * - Render virtualization for split-h/split-v when more than two cells
 *   exist: only the active cell + the first sibling stay mounted.
 * - Resize recalculation throttle so dragging the splitter does not
 *   thrash Yoga relayouts on every frame.
 */
export function GridView() {
  return (
    <GridProvider>
      <GridInner />
    </GridProvider>
  )
}

/**
 * Phase 6: render-only flag — when `true`, the layout hides every cell
 * except the active one (plus, in split mode, one sibling). Cells beyond
 * the visible window are detached from the DOM so their scrollbox +
 * workspace-synced state cannot trigger work while the user is focused on
 * another cell. The threshold is intentionally generous: most users keep
 * <= 2 cells in a split, so we only start virtualizing past that.
 */
const VIRTUALIZE_THRESHOLD = 2

function GridInner() {
  const grid = useGrid()
  const route = useRoute()
  const routeData = useRouteData("grid")
  const keybind = useKeybind()
  const dialog = useDialog()
  const { theme } = useTheme()
  const dimensions = useTerminalDimensions()
  const toast = useToast()
  const sdk = useSDK()
  const project = useProject()
  const sync = useSync()
  const workspaceClients = useWorkspaceClients()

  /**
   * Phase 8: create a fresh session via the workspace-aware SDK and add it
   * to the grid as the new active cell. Shared with the toolbar "+" button
   * through `./grid-create.ts`. Replaces the old "navigate to home" behaviour
   * so the keybind actually opens a new grid cell instead of teleporting
   * the user out of the grid.
   */
  const createSessionInCell = () => createGridSession({ grid, sdk, project, sync, workspaceClients, toast, route })

  // Track processed cell sessionIDs to avoid re-adding cells that were
  // already handled by the initial mount or a previous effect run.
  const processedCells = new Set<string>()

  // Load persisted grid state on mount so the layout survives restarts.
  // Phase 6: this also drives the `--grid` boot path — when the user
  // launches with `--grid` and a stale layout exists, we restore it before
  // seeding any single-cell defaults below.
  onMount(async () => {
    // Phase 8: hydrate from route.data.cells when the grid was opened via a
    // navigation that pre-seeded cells (e.g. from home with a session list).
    // Skip entries that already exist in the grid store — this keeps the
    // restored layout intact when both persistence and route data are present.
    const seeded = routeData.cells
    if (!seeded?.length) return
    for (const entry of seeded) {
      if (!entry.sessionID) continue
      if (grid.cells.some((c) => c.sessionID === entry.sessionID)) continue
      processedCells.add(entry.sessionID)
      await createGridSession({ grid, sdk, project, sync, workspaceClients, toast, route, sessionID: entry.sessionID })
    }
  })

  // Watch for new cells added via route navigation (e.g. /session dialog
  // in grid mode). Since the Match condition stays "grid" the component
  // is NOT re-mounted — only `routeData.cells` changes reactively, so we
  // use createEffect instead of onMount to pick up late-arriving cells.
  createEffect(() => {
    const seeded = routeData.cells
    if (!seeded?.length) return
    for (const entry of seeded) {
      if (!entry.sessionID) continue
      if (processedCells.has(entry.sessionID)) continue
      if (grid.cells.some((c) => c.sessionID === entry.sessionID)) continue
      processedCells.add(entry.sessionID)
      void createGridSession({ grid, sdk, project, sync, workspaceClients, toast, route, sessionID: entry.sessionID })
    }
  })

  // Watch for active cell changes from the route (e.g. chosen from DialogSessionList)
  // and activate the matching cell in the grid. Uses on() for explicit dependency
  // tracking so that changes to grid.activeCellId (e.g. from mouse clicks) do NOT
  // re-trigger this effect and snap back to the old activeSessionID.
  createEffect(on(
    () => routeData.activeSessionID,
    (activeSessionID) => {
      if (!activeSessionID) return
      const cell = grid.cells.find((c) => c.sessionID === activeSessionID)
      if (cell) grid.setActive(cell.id)
    },
  ))

  // Phase 6: throttle the splitter-driven resize recalculation and terminal SIGWINCH.
  // Yoga relayout is expensive enough that a 60-fps drag tick would tank the
  // render loop. We capture the dragged ratio locally in <Splitter/> and
  // apply it to the store on mouse-up; this throttle covers any other
  // resize-trigger (terminal SIGWINCH, sidebar toggle, etc.).
  const [throttledDimensions, setThrottledDimensions] = createSignal({
    width: dimensions().width,
    height: dimensions().height,
  })
  let resizeTimer: ReturnType<typeof setTimeout> | undefined
  createEffect(() => {
    const w = dimensions().width
    const h = dimensions().height
    if (resizeTimer) clearTimeout(resizeTimer)
    resizeTimer = setTimeout(() => {
      resizeTimer = undefined
      setThrottledDimensions({ width: w, height: h })
    }, 32)
  })
  onCleanup(() => {
    if (resizeTimer) clearTimeout(resizeTimer)
  })

  // Grid-level keyboard navigation
  useKeyboard((evt) => {
    const cells = grid.cells
    if (cells.length === 0) return

    if (keybind.match("grid_next", evt)) {
      evt.preventDefault()
      const activeIdx = cells.findIndex((c) => c.id === grid.activeCellId)
      grid.setActive(cells[(activeIdx + 1) % cells.length].id)
      return
    }

    if (keybind.match("grid_prev", evt)) {
      evt.preventDefault()
      const activeIdx = cells.findIndex((c) => c.id === grid.activeCellId)
      grid.setActive(cells[(activeIdx - 1 + cells.length) % cells.length].id)
      return
    }

    if (keybind.match("grid_close", evt)) {
      evt.preventDefault()
      if (grid.activeCellId) grid.removeCell(grid.activeCellId)
      return
    }

    if (keybind.match("grid_create", evt)) {
      evt.preventDefault()
      void createSessionInCell()
      return
    }

    if (keybind.match("grid_single", evt)) {
      evt.preventDefault()
      grid.setLayout("single")
      return
    }

    if (keybind.match("grid_layout_toggle", evt)) {
      evt.preventDefault()
      const next =
        grid.layout === "single"
          ? "split-h"
          : grid.layout === "split-h"
            ? "split-v"
            : grid.layout === "split-v"
              ? "2x2"
              : "single"
      grid.setLayout(next)
      return
    }

    // Phase 6: direct cell switching via leader + number. Indices are
    // 1-based to match the on-screen tab labels; we wrap if the user
    // presses a key higher than the cell count rather than swallowing it.
    for (let n = 1; n <= 9; n++) {
      if (!keybind.match(`grid_cell_${n}` as const, evt)) continue
      evt.preventDefault()
      const idx = (n - 1) % cells.length
      const target = cells[idx]
      if (target) grid.setActive(target.id)
      return
    }

    if (keybind.match("grid_help", evt)) {
      evt.preventDefault()
      dialog.setSize("large")
      dialog.replace(() => <GridKeyboardHelp />)
      return
    }
  })

  const width = () => Math.max(80, throttledDimensions().width)
  const sidebarWidth = 28
  const contentWidth = () => Math.max(40, width() - sidebarWidth - 2)
  // Reserve 4 lines for toolbar + border
  const cellAreaHeight = () => Math.max(6, throttledDimensions().height - 4)
  const layout = () => grid.layout
  const empty = () => grid.cells.length === 0
  const activeCell = () => grid.activeCell()

  // Phase 6: virtualize the visible cell window. In single mode only the
  // active cell renders; in split modes we show the active cell plus the
  // next sibling. Everything else is detached so its scrollbox, sync
  // listeners, and SSE fan-out won't fire.
  const visibleCells = createMemo(() => {
    const all = grid.cells
    if (all.length === 0) return []
    if (layout() === "single") {
      return activeCell() ? [activeCell()!] : []
    }
    if (layout() === "2x2") {
      const activeIdx = all.findIndex((c) => c.id === grid.activeCellId)
      if (activeIdx < 0) return all.slice(0, 4)
      const chunkIdx = Math.floor(activeIdx / 4) * 4
      return all.slice(chunkIdx, chunkIdx + 4)
    }
    // Stable order chunked by 2, similar to 2x2 chunk slice.
    // Active cell is highlighted via the `active` prop, not position.
    const activeIdx = all.findIndex((c) => c.id === grid.activeCellId)
    if (activeIdx < 0) return all.slice(0, 2)
    const chunkIdx = Math.floor(activeIdx / 2) * 2
    return all.slice(chunkIdx, chunkIdx + 2)
  })

  // Split layouts always render at most two cells; non-virtualized renders
  // are still useful while cell count <= VIRTUALIZE_THRESHOLD.
  const useVirtualization = createMemo(() => {
    const limit = layout() === "2x2" ? 4 : VIRTUALIZE_THRESHOLD
    return grid.cells.length > limit
  })

  const splitCellArea = createMemo(() => {
    // The dragged cell's width is governed by the persisted split ratio.
    // splitCellWidth clamps to MIN_CELL_COLS at both ends of the bar.
    return splitCellWidth(contentWidth(), grid.splitRatio, 1)
  })

  const splitCellAreaHeight = createMemo(() => {
    return splitCellHeight(cellAreaHeight(), grid.splitRatio, 1)
  })

  return (
    <box
      flexDirection="row"
      width={width()}
      height={Math.max(10, throttledDimensions().height)}
      backgroundColor={theme.background}
    >
      {/* Main area: toolbar + cells */}
      <box flexDirection="column" flexGrow={1} height="100%">
        <GridToolbar />
        <Show when={!empty()} fallback={<GridEmptyState />}>
          <box flexDirection="column" flexGrow={1} height={cellAreaHeight()}>
            <Switch>
              {/* Single: only the active cell, full width */}
              <Match when={layout() === "single"}>
                <Show when={activeCell()} keyed>
                  {(cell) => (
                    <ErrorBoundary fallback={(err) => <CellError error={err} cell={cell} />}>
                      <CellRenderer cell={cell} active={true} width={contentWidth()} />
                    </ErrorBoundary>
                  )}
                </Show>
              </Match>

              {/* Split-h: dragged cell + sibling, separated by a draggable bar */}
              <Match when={layout() === "split-h"}>
                <box flexDirection="row" flexGrow={1}>
                  <Show when={visibleCells()[0]} keyed>
                    {(cell) => (
                      <ErrorBoundary fallback={(err) => <CellError error={err} cell={cell} />}>
                        <CellRenderer cell={cell} active={cell.id === grid.activeCellId} width={splitCellArea()} />
                      </ErrorBoundary>
                    )}
                  </Show>
                  <Splitter layout="split-h" total={contentWidth()} />
                  <Show when={visibleCells()[1]} keyed>
                    {(cell) => (
                      <ErrorBoundary fallback={(err) => <CellError error={err} cell={cell} />}>
                        <CellRenderer
                          cell={cell}
                          active={cell.id === grid.activeCellId}
                          width={Math.max(40, contentWidth() - splitCellArea() - 1)}
                        />
                      </ErrorBoundary>
                    )}
                  </Show>
                </box>
              </Match>

              {/* Split-v: same as split-h but stacked. The splitter drives the
                  row split the same way it drives the column split. */}
              <Match when={layout() === "split-v"}>
                <box flexDirection="column" flexGrow={1}>
                  <Show when={visibleCells()[0]} keyed>
                    {(cell) => (
                      <ErrorBoundary fallback={(err) => <CellError error={err} cell={cell} />}>
                        <CellRenderer
                          cell={cell}
                          active={cell.id === grid.activeCellId}
                          width={contentWidth()}
                          height={splitCellAreaHeight()}
                        />
                      </ErrorBoundary>
                    )}
                  </Show>
                  <Splitter layout="split-v" total={cellAreaHeight()} />
                  <Show when={visibleCells()[1]} keyed>
                    {(cell) => (
                      <ErrorBoundary fallback={(err) => <CellError error={err} cell={cell} />}>
                        <CellRenderer
                          cell={cell}
                          active={cell.id === grid.activeCellId}
                          width={contentWidth()}
                          height={Math.max(6, cellAreaHeight() - splitCellAreaHeight() - 1)}
                        />
                      </ErrorBoundary>
                    )}
                  </Show>
                </box>
              </Match>

              {/* 2x2: 4 cells in a 2x2 grid */}
              <Match when={layout() === "2x2"}>
                <box flexDirection="column" flexGrow={1}>
                  {/* Top half */}
                  <box flexDirection="row" height={splitCellAreaHeight()}>
                    <Show when={visibleCells()[0]} keyed>
                      {(cell) => (
                        <ErrorBoundary fallback={(err) => <CellError error={err} cell={cell} />}>
                          <CellRenderer cell={cell} active={cell.id === grid.activeCellId} width={splitCellArea()} />
                        </ErrorBoundary>
                      )}
                    </Show>
                    <Splitter layout="split-h" total={contentWidth()} />
                    <Show when={visibleCells()[1]} keyed>
                      {(cell) => (
                        <ErrorBoundary fallback={(err) => <CellError error={err} cell={cell} />}>
                          <CellRenderer
                            cell={cell}
                            active={cell.id === grid.activeCellId}
                            width={Math.max(40, contentWidth() - splitCellArea() - 1)}
                          />
                        </ErrorBoundary>
                      )}
                    </Show>
                  </box>
                  <Splitter layout="split-v" total={cellAreaHeight()} />
                  {/* Bottom half */}
                  <box flexDirection="row" height={Math.max(6, cellAreaHeight() - splitCellAreaHeight() - 1)}>
                    <Show when={visibleCells()[2]} keyed>
                      {(cell) => (
                        <ErrorBoundary fallback={(err) => <CellError error={err} cell={cell} />}>
                          <CellRenderer cell={cell} active={cell.id === grid.activeCellId} width={splitCellArea()} />
                        </ErrorBoundary>
                      )}
                    </Show>
                    <Splitter layout="split-h" total={contentWidth()} />
                    <Show when={visibleCells()[3]} keyed>
                      {(cell) => (
                        <ErrorBoundary fallback={(err) => <CellError error={err} cell={cell} />}>
                          <CellRenderer
                            cell={cell}
                            active={cell.id === grid.activeCellId}
                            width={Math.max(40, contentWidth() - splitCellArea() - 1)}
                          />
                        </ErrorBoundary>
                      )}
                    </Show>
                  </box>
                </box>
              </Match>
            </Switch>

            {/* Hidden detail block: shows the active cell index for diagnostics
                when virtualization is engaged. Pure UI surface — no side
                effects. */}
            <Show when={useVirtualization()}>
              <text fg={theme.textMuted} selectable={false}>
                {`virtualized: ${visibleCells().length}/${grid.cells.length}`}
              </text>
            </Show>
          </box>
        </Show>
      </box>

      {/* Right sidebar */}
      <Sidebar />
    </box>
  )
}

/**
 * Dispatches to the correct cell component based on cell.mode.
 */
function CellRenderer(props: { cell: GridCell; active: boolean; width: number; height?: number }) {
  const grid = useGrid()
  return (
    <box
      flexDirection="column"
      width={props.width}
      height={props.height ?? "100%"}
      onMouseUp={() => {
        if (grid.activeCellId !== props.cell.id) {
          grid.setActive(props.cell.id)
        }
      }}
    >
      <Switch>
        <Match when={props.cell.mode === "plan-only"}>
          <PlanCell cell={props.cell} />
        </Match>
        <Match when={true}>
          <SessionCell
            cell={props.cell}
            active={props.active}
            width={props.width}
            wide={props.width > 120}
            height={props.height}
          />
        </Match>
      </Switch>
    </box>
  )
}

/**
 * Fallback UI when a cell's component throws. Delegates to the shared
 * `CellErrorOverlay` so the look and behaviour match the inline
 * error treatment used elsewhere; the only grid-specific twist is that
 * the cell label is included in the headline.
 */
function CellError(props: { error: unknown; cell: GridCell }) {
  return <CellErrorOverlay error={props.error} cellLabel={props.cell.label} />
}

/**
 * Minimal empty-state placeholder shown when the grid has no cells.
 */
function GridEmptyState() {
  const { theme } = useTheme()
  const keybind = useKeybind()
  return (
    <box flexDirection="column" alignItems="center" justifyContent="center" flexGrow={1} gap={1}>
      <text fg={theme.text}>Grid View</text>
      <text fg={theme.textMuted}>{keybind.print("grid_create")} to add a session</text>
      <text fg={theme.textMuted}>{keybind.print("grid_help")} for keyboard help</text>
    </box>
  )
}
