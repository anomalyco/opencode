import { createStore, produce, reconcile } from "solid-js/store"
import { createEffect, createMemo, onCleanup } from "solid-js"
import { createSimpleContext } from "./helper"
import fs from "fs"
import {
  defaultGridState,
  debouncedSave,
  normalizeGridState,
  isGridState,
  gridLayoutPath,
  type GridCell,
  type GridLayout,
  type GridSplitRatio,
  type GridState,
} from "./grid-persistence"

export type AddCellInput = Omit<GridCell, "id">

export const { use: useGrid, provider: GridProvider } = createSimpleContext({
  name: "Grid",
  init: (props: { initial?: GridState }) => {
    let initialStore = props.initial
    if (!initialStore) {
      try {
        if (fs.existsSync(gridLayoutPath)) {
          const content = fs.readFileSync(gridLayoutPath, "utf-8")
          const parsed = JSON.parse(content)
          if (isGridState(parsed)) {
            initialStore = normalizeGridState(parsed)
          }
        }
      } catch {
        // ignore
      }
    }

    const [store, setStore] = createStore<GridState>(
      initialStore ? normalizeGridState(initialStore) : defaultGridState(),
    )

    const persist = debouncedSave(250)
    createEffect(() => {
      // Touch every tracked field so Solid registers them, then snapshot.
      // Phase 6: include splitRatio so the splitter drag handle is durable
      // across restarts. batched via produce-style manual snapshot to keep
      // the persistence path cheap during rapid layout changes.
      const snapshot: GridState = {
        cells: store.cells.map((c) => ({ ...c })),
        activeCellId: store.activeCellId,
        layout: store.layout,
        splitRatio: store.splitRatio,
      }
      persist(snapshot)
    })
    onCleanup(() => {
      // No-op: pending debounced save still fires for the latest snapshot.
    })

    return {
      get data() {
        return store
      },
      get cells() {
        return store.cells
      },
      get activeCellId() {
        return store.activeCellId
      },
      get layout() {
        return store.layout
      },
      get splitRatio() {
        return store.splitRatio
      },
      activeCell: createMemo(() => store.cells.find((c) => c.id === store.activeCellId)),
      addCell(input: AddCellInput) {
        const id = crypto.randomUUID()
        const cell: GridCell = { ...input, id }
        setStore(
          produce((draft) => {
            draft.cells.push(cell)
            draft.cells.sort((a, b) => a.sessionID.localeCompare(b.sessionID))
            draft.activeCellId = id
          }),
        )
        return id
      },
      removeCell(id: string) {
        setStore(
          produce((draft) => {
            const idx = draft.cells.findIndex((c) => c.id === id)
            if (idx < 0) return
            draft.cells.splice(idx, 1)
            if (draft.activeCellId === id) {
              const next = draft.cells[Math.min(idx, draft.cells.length - 1)]
              draft.activeCellId = next ? next.id : ""
            }
          }),
        )
      },
      setActive(id: string) {
        if (!store.cells.some((c) => c.id === id)) return
        setStore("activeCellId", id)
      },
      setLayout(layout: GridLayout) {
        setStore("layout", layout)
      },
      /**
       * Phase 6: persist a new split ratio. The splitter drag handle clamps
       * the value to a sane range before calling this; we still defensively
       * guard against NaN/out-of-range values here so external callers can't
       * poison the persisted state.
       */
      setSplitRatio(ratio: GridSplitRatio) {
        if (!Number.isFinite(ratio)) return
        const clamped = Math.max(0, Math.min(1, ratio))
        if (clamped === store.splitRatio) return
        setStore("splitRatio", clamped)
      },
      toggleMode(id?: string) {
        const target = id ?? store.activeCellId
        if (!target) return
        const idx = store.cells.findIndex((c) => c.id === target)
        if (idx < 0) return
        const current = store.cells[idx]
        if (!current) return
        const next = current.mode === "full" ? "plan-only" : "full"
        setStore("cells", idx, reconcile({ ...current, mode: next }))
      },
      /**
       * Replace the entire state (e.g. after a successful load from disk).
       * Use sparingly — prefer the targeted mutators above.
       */
      hydrate(state: GridState) {
        const normalized = normalizeGridState(state)
        const sortedCells = [...normalized.cells].sort((a, b) => a.sessionID.localeCompare(b.sessionID))
        setStore(reconcile({ ...normalized, cells: sortedCells }))
      },
    }
  },
})

export type GridContext = ReturnType<typeof useGrid>

/**
 * Convenience namespace export for callers that prefer
 * `import { grid } from "./grid"` over the hook form.
 */
export const grid = {
  addCell: (ctx: GridContext, input: AddCellInput) => ctx.addCell(input),
  removeCell: (ctx: GridContext, id: string) => ctx.removeCell(id),
  setActive: (ctx: GridContext, id: string) => ctx.setActive(id),
  toggleMode: (ctx: GridContext, id?: string) => ctx.toggleMode(id),
  setLayout: (ctx: GridContext, layout: GridLayout) => ctx.setLayout(layout),
  setSplitRatio: (ctx: GridContext, ratio: GridSplitRatio) => ctx.setSplitRatio(ratio),
}
