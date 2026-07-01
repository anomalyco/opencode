import path from "path"
import { mkdir } from "fs/promises"
import { Global } from "@opencode-ai/core/global"

export type GridCell = {
  id: string
  sessionID: string
  workspaceID: string
  agentID?: string
  mode: "full" | "plan-only"
  label: string
}

export type GridLayout = "single" | "split-h" | "split-v" | "2x2"

/**
 * Phase 6: ratio (0-1) of the left/top cell's share when in a split layout.
 * Default 0.6 (60/40). The splitter drag handle clamps this value to a range
 * that keeps both cells at >= `MIN_CELL_COLS` columns wide.
 */
export type GridSplitRatio = number

/**
 * Minimum width (in terminal columns) either side of the split must keep.
 * Below this the dragged cell would be unreadable, so the splitter clamps.
 */
export const MIN_CELL_COLS = 40

/**
 * Default split ratio when entering a split layout for the first time.
 * 0.6 → 60/40 split (left/top cell is the larger one).
 */
export const DEFAULT_SPLIT_RATIO: GridSplitRatio = 0.6

export type GridState = {
  cells: GridCell[]
  activeCellId: string
  layout: GridLayout
  /** Phase 6: persisted split ratio; only meaningful for split-h/split-v. */
  splitRatio: GridSplitRatio
}

// Project-local opencode dir under the user's home — explicit per spec.
// Resolved against HOME/USERPROFILE (matching Global.Path.home) so tests can
// isolate via env vars without touching XDG state paths.
export const gridLayoutPath = path.join(Global.Path.home, ".opencode", "grid-layout.json")

export function defaultGridState(): GridState {
  return {
    cells: [],
    activeCellId: "",
    layout: "single",
    splitRatio: DEFAULT_SPLIT_RATIO,
  }
}

function isGridCell(value: unknown): value is GridCell {
  if (typeof value !== "object" || value === null) return false
  const v = value as Record<string, unknown>
  return (
    typeof v.id === "string" &&
    typeof v.sessionID === "string" &&
    typeof v.workspaceID === "string" &&
    (v.agentID === undefined || typeof v.agentID === "string") &&
    (v.mode === "full" || v.mode === "plan-only") &&
    typeof v.label === "string"
  )
}

function isGridLayout(value: unknown): value is GridLayout {
  return value === "single" || value === "split-h" || value === "split-v" || value === "2x2"
}

function isGridSplitRatio(value: unknown): value is GridSplitRatio {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1
}

export function isGridState(value: unknown): value is GridState {
  if (typeof value !== "object" || value === null) return false
  const v = value as Record<string, unknown>
  return (
    Array.isArray(v.cells) &&
    v.cells.every(isGridCell) &&
    typeof v.activeCellId === "string" &&
    isGridLayout(v.layout) &&
    // Persisted files written before Phase 6 lack splitRatio; default it.
    (v.splitRatio === undefined || isGridSplitRatio(v.splitRatio))
  )
}

/**
 * Normalize a persisted state to fill in any fields added after the file was
 * last written. Currently just injects `splitRatio` for pre-Phase-6 files.
 */
export function normalizeGridState(state: GridState): GridState {
  if (isGridSplitRatio(state.splitRatio)) return state
  return { ...state, splitRatio: DEFAULT_SPLIT_RATIO }
}

async function ensureParent(p: string): Promise<void> {
  await mkdir(path.dirname(p), { recursive: true })
}

export async function save(state: GridState): Promise<void> {
  await ensureParent(gridLayoutPath)
  await Bun.write(gridLayoutPath, JSON.stringify(state, null, 2))
}

export async function load(): Promise<GridState | null> {
  const handle = Bun.file(gridLayoutPath)
  if (!(await handle.exists())) return null
  try {
    const data = (await handle.json()) as unknown
    if (!isGridState(data)) return null
    return data
  } catch {
    return null
  }
}

/**
 * Returns a debounced saver that coalesces rapid grid-state changes into a
 * single write. The trailing call always fires so the final state is durable.
 */
export function debouncedSave(delayMs = 250): (state: GridState) => void {
  let timer: ReturnType<typeof setTimeout> | undefined
  let pending: GridState | undefined
  return (state) => {
    pending = state
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      const snapshot = pending
      timer = undefined
      pending = undefined
      if (snapshot) save(snapshot).catch(() => undefined)
    }, delayMs)
  }
}
