import { createMemo, ErrorBoundary, For, Show } from "solid-js"
import { useLayout, type GridCell } from "@/context/layout"
import Page from "@/pages/session"
import { SessionProviders } from "@/components/session/session-providers"
import { CellSessionPicker } from "@/components/session/cell-session-picker"

const GRID_COLS: Record<number, string> = {
  1: "1fr",
  2: "1fr 1fr",
  3: "1fr 1fr 1fr",
  4: "1fr 1fr",
  6: "1fr 1fr 1fr",
  8: "1fr 1fr 1fr 1fr",
}

const GRID_ROWS: Record<number, string> = {
  1: "1fr",
  2: "1fr",
  3: "1fr",
  4: "1fr 1fr",
  6: "1fr 1fr",
  8: "1fr 1fr",
}

/**
 * Each cell gets its own session context stack (Terminal/File/Prompt/Comments)
 * so parallel sessions have independent state and useFile() etc. resolve.
 * Only the ACTIVE cell renders "full" (header chrome); the rest render
 * "cell" so the top controls aren't duplicated per cell.
 */
function Cell(props: {
  dir: string
  cell: GridCell
  active: boolean
  onActivate?: () => void
  onRemove?: () => void
}) {
  return (
    <div
      class="relative overflow-hidden rounded-md border bg-background-stronger"
      classList={{
        "border-border-base ring-1 ring-border-base": props.active,
        "border-border-weak-base": !props.active,
      }}
      onPointerDown={() => props.onActivate?.()}
    >
      <SessionProviders>
        <ErrorBoundary
          fallback={(err: unknown) => (
            <div class="flex size-full flex-col items-center justify-center gap-2 rounded-md border border-dashed border-border-weak-base bg-background-stronger p-3">
              <div class="text-12-regular text-text-weak">Session unreachable</div>
              <Show when={typeof (err as Error)?.message === "string"}>
                <div class="max-w-[90%] truncate text-12-regular text-text-weaker">
                  {(err as Error).message}
                </div>
              </Show>
              <button
                type="button"
                class="rounded-md px-1 py-0.5 text-10-regular text-text-weak transition-colors hover:bg-background-base hover:text-text-base"
                onClick={() => props.onRemove?.()}
              >
                Remove
              </button>
            </div>
          )}
        >
          <Page sessionID={props.cell.sessionID} mode={props.active ? "full" : "cell"} />
        </ErrorBoundary>
      </SessionProviders>
    </div>
  )
}

/**
 * SessionGrid composes a CSS grid of session cells for the active directory.
 * Cell 0 is always the primary (current route) session. Page handles the
 * new-session state when primaryId is undefined, and its header carries the
 * Grid toggle. Extra cells fill the remaining grid slots and are added via
 * the empty-cell picker.
 *
 * Layout preferences (mode + cell assignments + active cell) are persisted
 * per-directory via the layout store.
 */
export function SessionGrid(props: { dir: string; primaryId?: string }) {
  const layout = useLayout()
  const mode = createMemo(() => layout.grid.mode(props.dir)())
  const cells = createMemo(() => layout.grid.cells(props.dir)())

  // Cell 0 is always the primary (current route) session. Extra cells
  // exclude the primary and stay under the slot budget.
  const extraCells = createMemo(() => {
    const seen = new Set<string>()
    return cells()
      .filter((c) => c.sessionID !== props.primaryId)
      .filter((c) => {
        if (seen.has(c.sessionID)) return false
        seen.add(c.sessionID)
        return true
      })
      .slice(0, Math.max(0, mode() - 1))
  })
  const emptyCount = createMemo(() => Math.max(0, mode() - 1 - extraCells().length))

  // Synthesize an ephemeral primary cell so the chrome still works when the
  // route doesn't carry a session id (new-session state).
  const primaryCell = createMemo<GridCell>(() => ({
    id: props.primaryId ?? "primary",
    sessionID: props.primaryId ?? "",
    directory: props.dir,
    mode: "full",
    label: "",
  }))

  const activeId = createMemo(() => layout.grid.active(props.dir)() ?? primaryCell().id)

  return (
    <Show
      when={mode() > 1}
      fallback={
        // mode 1: plain single session (full page + header + Grid toggle).
        <SessionProviders>
          <Page sessionID={props.primaryId} mode="full" />
        </SessionProviders>
      }
    >
      <div
        class="size-full grid gap-1 p-1 bg-background-base"
        style={{
          "grid-template-columns": GRID_COLS[mode()],
          "grid-template-rows": GRID_ROWS[mode()],
        }}
      >
        <Cell
          dir={props.dir}
          cell={primaryCell()}
          active={activeId() === primaryCell().id}
          onActivate={() => layout.grid.setActive(props.dir, primaryCell().id)}
          onRemove={() => layout.grid.setMode(props.dir, 1)}
        />
        <For each={extraCells()}>
          {(cell) => (
            <Cell
              dir={props.dir}
              cell={cell}
              active={activeId() === cell.id}
              onActivate={() => layout.grid.setActive(props.dir, cell.id)}
              onRemove={() => layout.grid.removeCell(props.dir, cell.sessionID)}
            />
          )}
        </For>
        <For each={Array.from({ length: emptyCount() })}>
          {() => <CellSessionPicker dir={props.dir} primaryId={props.primaryId} />}
        </For>
      </div>
    </Show>
  )
}
