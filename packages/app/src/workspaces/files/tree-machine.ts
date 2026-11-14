import type { FileNode } from "@/runtime/server/types"

/** Bounded fallback so a wedged server or network mount cannot leave a directory loading forever. */
export const DIRECTORY_LIST_TIMEOUT_MS = 30_000

/**
 * One directory's listing lifecycle, keyed by its normalized path. `expanded` holds in every status: collapsing keeps
 * the listed entries, and filtered trees expand directories with `list: false` without listing them. `dirty` records
 * a forced reload that arrived while `attempt` was in flight, so one follow-up listing runs after it.
 */
export type DirectoryState =
  | { readonly status: "idle"; readonly expanded: boolean }
  | { readonly status: "loading"; readonly expanded: boolean; readonly attempt: number; readonly dirty: boolean }
  | { readonly status: "ready"; readonly expanded: boolean; readonly children: readonly string[] }
  | {
      readonly status: "refreshing"
      readonly expanded: boolean
      readonly children: readonly string[]
      readonly attempt: number
      readonly dirty: boolean
    }
  | { readonly status: "failed"; readonly expanded: boolean; readonly error?: string }

/**
 * The file tree of one workspace. `epoch` counts workspace resets; `issued` keeps counting across them, so a listing
 * that started before a reset or before its directory was pruned never matches a later attempt.
 */
export type FileTreeState =
  | {
      readonly status: "active"
      readonly epoch: number
      readonly issued: number
      readonly nodes: Readonly<Record<string, FileNode>>
      readonly dirs: Readonly<Record<string, DirectoryState>>
    }
  | { readonly status: "disposed" }

export type FileTreeEvent =
  | { readonly type: "list.requested"; readonly dir: string; readonly force: boolean }
  | { readonly type: "dir.expanded"; readonly dir: string; readonly list: boolean }
  | { readonly type: "dir.collapsed"; readonly dir: string }
  | {
      readonly type: "list.loaded"
      readonly dir: string
      readonly attempt: number
      readonly nodes: readonly FileNode[]
    }
  | { readonly type: "list.failed"; readonly dir: string; readonly attempt: number; readonly error: string }
  | { readonly type: "list.timed-out"; readonly dir: string; readonly attempt: number }
  | { readonly type: "reset" }
  | { readonly type: "disposed" }

export type FileTreeEffect =
  | { readonly type: "list"; readonly dir: string; readonly attempt: number; readonly timeoutMs: number }
  | { readonly type: "notify.error"; readonly message: string }

export type FileTreeTransition = { readonly state: FileTreeState; readonly effects: readonly FileTreeEffect[] }

type ActiveTree = Extract<FileTreeState, { status: "active" }>

type BusyDirectory = Extract<DirectoryState, { status: "loading" | "refreshing" }>

// Not frozen: the driver reconciles states into a Solid store, which writes into the objects it already holds.
export function createFileTreeState(): FileTreeState {
  return { status: "active", epoch: 0, issued: 0, nodes: {}, dirs: { "": { status: "idle", expanded: true } } }
}

export function transitionFileTree(state: FileTreeState, event: FileTreeEvent): FileTreeTransition {
  if (state.status === "disposed") return unchanged(state)

  if (event.type === "disposed") return { state: { status: "disposed" }, effects: [] }

  if (event.type === "reset") {
    if (isPristine(state)) return unchanged(state)

    return {
      state: {
        status: "active",
        epoch: state.epoch + 1,
        issued: state.issued,
        nodes: {},
        dirs: { "": { status: "idle", expanded: true } },
      },
      effects: [],
    }
  }

  const entry = state.dirs[event.dir]

  if (event.type === "list.requested") {
    if (!entry || entry.status === "idle" || entry.status === "failed") {
      return startListing(state, event.dir, (attempt) => ({
        status: "loading",
        expanded: entry?.expanded ?? false,
        attempt,
        dirty: false,
      }))
    }

    if (entry.status === "ready") {
      if (!event.force) return unchanged(state)

      return startListing(state, event.dir, (attempt) => ({ ...entry, status: "refreshing", attempt, dirty: false }))
    }

    if (!event.force || entry.dirty) return unchanged(state)

    return withDirectory(state, event.dir, { ...entry, dirty: true })
  }

  if (event.type === "dir.expanded") {
    if (event.list && (!entry || entry.status === "idle" || entry.status === "failed")) {
      return startListing(state, event.dir, (attempt) => ({ status: "loading", expanded: true, attempt, dirty: false }))
    }

    if (entry?.expanded) return unchanged(state)

    return withDirectory(state, event.dir, entry ? { ...entry, expanded: true } : { status: "idle", expanded: true })
  }

  if (event.type === "dir.collapsed") {
    if (entry && !entry.expanded) return unchanged(state)

    return withDirectory(state, event.dir, entry ? { ...entry, expanded: false } : { status: "idle", expanded: false })
  }

  // A result for a superseded attempt, a pruned directory or an earlier workspace.
  if (!entry || (entry.status !== "loading" && entry.status !== "refreshing") || entry.attempt !== event.attempt) {
    return unchanged(state)
  }

  if (event.type === "list.loaded") return applyListing(state, event.dir, entry, event.nodes)

  // The queued reload runs before a failure is reported: the change that queued it may have fixed the directory.
  if (entry.dirty) {
    return startListing(state, event.dir, (attempt) => ({ ...entry, attempt, dirty: false }))
  }

  // A failed reload keeps the entries it already shows; the directory reloads with the next change.
  if (entry.status === "refreshing") {
    return withDirectory(state, event.dir, { status: "ready", expanded: entry.expanded, children: entry.children })
  }

  const error = event.type === "list.failed" ? event.error : undefined

  return {
    state: withDirectory(state, event.dir, { status: "failed", expanded: entry.expanded, error }).state,
    effects: [{ type: "notify.error", message: error ?? "" }],
  }
}

function applyListing(
  state: ActiveTree,
  dir: string,
  entry: BusyDirectory,
  listed: readonly FileNode[],
): FileTreeTransition {
  const children = listed.map((node) => node.path)
  const byPath = new Map(listed.map((node) => [node.path, node]))
  const previous = entry.status === "refreshing" ? entry.children : []
  const removed = new Set(previous.filter((path) => !byPath.has(path)))

  // A directory that disappeared or became a file takes its listed descendants and their directory states with it.
  const prunedRoots = previous
    .filter((path) => state.nodes[path]?.type === "directory" && byPath.get(path)?.type !== "directory")
    .map(treeKey)

  const pruned = (path: string) => {
    const key = treeKey(path)

    return prunedRoots.some((root) => key === root || key.startsWith(`${root}/`))
  }

  const nodes = Object.fromEntries(Object.entries(state.nodes).filter(([path]) => !removed.has(path) && !pruned(path)))

  listed.forEach((node) => {
    nodes[node.path] = node
  })

  const dirs = Object.fromEntries(Object.entries(state.dirs).filter(([path]) => path === dir || !pruned(path)))

  if (!entry.dirty) {
    dirs[dir] = { status: "ready", expanded: entry.expanded, children }

    return { state: { ...state, nodes, dirs }, effects: [] }
  }

  const attempt = state.issued + 1
  dirs[dir] = { status: "refreshing", expanded: entry.expanded, children, attempt, dirty: false }

  return { state: { ...state, issued: attempt, nodes, dirs }, effects: [listEffect(dir, attempt)] }
}

/**
 * Compares listed paths with directory keys. The server ends directory paths with the platform separator, and the
 * driver keys directories by `normalizeDir`, which turns Windows separators into `/`.
 */
function treeKey(path: string) {
  return path.replaceAll("\\", "/").replace(/\/+$/, "")
}

function startListing(state: ActiveTree, dir: string, next: (attempt: number) => DirectoryState): FileTreeTransition {
  const attempt = state.issued + 1

  return {
    state: { ...state, issued: attempt, dirs: { ...state.dirs, [dir]: next(attempt) } },
    effects: [listEffect(dir, attempt)],
  }
}

function listEffect(dir: string, attempt: number): FileTreeEffect {
  return { type: "list", dir, attempt, timeoutMs: DIRECTORY_LIST_TIMEOUT_MS }
}

function withDirectory(state: ActiveTree, dir: string, entry: DirectoryState): FileTreeTransition {
  return { state: { ...state, dirs: { ...state.dirs, [dir]: entry } }, effects: [] }
}

function isPristine(state: ActiveTree) {
  const root = state.dirs[""]

  return (
    Object.keys(state.nodes).length === 0 &&
    Object.keys(state.dirs).length === 1 &&
    root?.status === "idle" &&
    root.expanded
  )
}

function unchanged(state: FileTreeState): FileTreeTransition {
  return { state, effects: [] }
}

/*
 * The view selectors below read key presence (`children`, `attempt`, `error`) rather than `status`. Each key exists
 * in exactly the variants it names, and a Solid store reader re-runs only when its answer changes: a root that goes
 * idle, loading, then failed stays "not loaded" without waking the file tree's reload-when-unloaded check.
 */

export function isDirectoryExpanded(entry: DirectoryState | undefined) {
  return entry?.expanded ?? false
}

/** True for `ready` and `refreshing`. */
export function isDirectoryLoaded(entry: DirectoryState | undefined) {
  return entry !== undefined && "children" in entry
}

/** True for `loading` and `refreshing`. */
export function isDirectoryLoading(entry: DirectoryState | undefined) {
  return entry !== undefined && "attempt" in entry
}

export function selectDirectoryError(entry: DirectoryState | undefined) {
  return entry !== undefined && "error" in entry ? entry.error : undefined
}

export function selectDirectoryChildren(state: FileTreeState, dir: string) {
  if (state.status !== "active") return []
  const entry = state.dirs[dir]

  if (!entry || !("children" in entry)) return []

  return entry.children.flatMap((path) => {
    const node = state.nodes[path]

    return node ? [node] : []
  })
}

export function selectTreeNode(state: FileTreeState, path: string) {
  return state.status === "active" ? state.nodes[path] : undefined
}

/** Whether a watcher change should reload the directory: it is listed or being listed. */
export function canRefreshDirectory(state: FileTreeState, dir: string) {
  if (state.status !== "active") return false
  const entry = state.dirs[dir]

  return isDirectoryLoaded(entry) || isDirectoryLoading(entry)
}

/** Whether a listing for the directory is in flight; `listDir` callers wait until it is not. */
export function isDirectoryBusy(state: FileTreeState, dir: string) {
  return state.status === "active" && isDirectoryLoading(state.dirs[dir])
}
