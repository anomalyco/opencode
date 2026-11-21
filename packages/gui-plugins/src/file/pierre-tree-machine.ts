import type { ChangeKind } from "@opencode/plugin/gui/review"
import type { FileNode } from "@opencode/plugin/gui"
import {
  buildGitStatusMap,
  buildKindsStatus,
  diffStatusLayers,
  normalizeFileTreeV2Path,
  sameStringMap,
  sameStringSet,
  type AllowedTreeInput,
  type LiveTreeInput,
  type TreeGitStatus,
} from "./tree-model"

/** Which programmatic `FileTree` changes are on the call stack; the tree's echoes of them are not user intent. */
export type PierreTreeSync = "none" | "expansion" | "selection" | "both"

/**
 * Scrolling the active file into view. `pending` waits for its microtask, which must still hold `attempt` to scroll;
 * `idle` remembers the file it last scrolled to, so the same file is not scrolled to again. `issued` is the last
 * attempt handed out.
 */
export type PierreTreeScroll =
  | { readonly status: "idle"; readonly scrolledPath: string; readonly issued: number }
  | { readonly status: "pending"; readonly path: string; readonly attempt: number }

export type PierreTreeBatchOp =
  | { readonly type: "add"; readonly path: string }
  | { readonly type: "remove"; readonly path: string; readonly recursive: boolean }

export type PierreTreeStatusPatch = {
  readonly remove: readonly string[]
  readonly set: ReadonlyArray<{ readonly path: string; readonly status: TreeGitStatus }>
}

type Mounted = {
  readonly sync: PierreTreeSync
  /** Normalized active file (`""` when none). */
  readonly active: string
  /** The active file while the tree holds it, else `""`; what the tree shows selected. */
  readonly selectedPath: string
  readonly scroll: PierreTreeScroll
  readonly kinds: ReadonlyMap<string, ChangeKind> | undefined
  readonly kindsStatus: ReadonlyMap<string, TreeGitStatus>
  /** Ignored entries applied to the tree; always empty in an allowed tree. */
  readonly ignored: ReadonlySet<string>
  /** Widest list width (px) measured in this row set; `0` until a row overflows the pane. */
  readonly widest: number
}

/**
 * One `FileTree` instance. `live` lists the workspace as it loads and is ordered as listed; `allowed` shows a fixed
 * set of files with tracked folders open. A tree is built for one of the two, so a change of mode builds another.
 */
export type PierreTreeState =
  | { readonly status: "unmounted" }
  | (Mounted & {
      readonly status: "live"
      readonly root: string
      readonly model: LiveTreeInput
      /** Canonical paths (`dir/` or `file`) the tree holds, including those under collapsed folders. */
      readonly knownPaths: ReadonlySet<string>
      /** Canonical folders (`dir/`) the tree has open. */
      readonly treeExpanded: ReadonlySet<string>
    })
  | (Mounted & {
      readonly status: "allowed"
      readonly model: AllowedTreeInput
      /** Normalized folders (no trailing slash) the tree has collapsed. */
      readonly collapsedDirs: ReadonlySet<string>
      readonly labels: ReadonlyMap<string, string> | undefined
    })
  | { readonly status: "disposed" }

export type PierreTreeInput =
  | { readonly mode: "live"; readonly root: string; readonly model: LiveTreeInput }
  | {
      readonly mode: "allowed"
      readonly model: AllowedTreeInput
      readonly collapsedDirs: ReadonlySet<string>
      readonly labels: ReadonlyMap<string, string> | undefined
    }

export type PierreTreeEvent =
  /** The props and workspace tree as they are now; the first one after the host element exists mounts the tree. */
  | {
      readonly type: "synced"
      readonly input: PierreTreeInput
      readonly kinds: ReadonlyMap<string, ChangeKind> | undefined
      readonly active: string
    }
  | { readonly type: "sync.started"; readonly kind: "expansion" | "selection" }
  | { readonly type: "sync.ended"; readonly kind: "expansion" | "selection" }
  | { readonly type: "tree.expansion-changed"; readonly path: string; readonly expanded: boolean }
  | { readonly type: "tree.selection-changed"; readonly selected: readonly string[] }
  | { readonly type: "list.measured"; readonly width: number }
  | { readonly type: "scroll.flushed"; readonly attempt: number }
  | { readonly type: "disposed" }

export type PierreTreeEffect =
  /** Replaces any previous tree with a new one built for `mode`. */
  | {
      readonly type: "mount-tree"
      readonly mode: "live" | "allowed"
      readonly paths: readonly string[]
      readonly expanded: readonly string[] | undefined
      readonly selected: string
      readonly gitStatus: ReadonlyArray<{ readonly path: string; readonly status: TreeGitStatus }>
      readonly collapse: readonly string[]
    }
  | {
      readonly type: "reset-paths"
      readonly paths: readonly string[]
      readonly expanded: readonly string[] | undefined
    }
  | { readonly type: "batch-paths"; readonly ops: readonly PierreTreeBatchOp[] }
  | { readonly type: "sync-expansion"; readonly expand: readonly string[]; readonly collapse: readonly string[] }
  /** Selects exactly `path` in the tree, or nothing when it is `""`. */
  | { readonly type: "select"; readonly path: string }
  | { readonly type: "patch-git-status"; readonly patch: PierreTreeStatusPatch }
  | { readonly type: "rerender" }
  /** Records a folder the user opened or closed in the workspace tree; `list` loads its entries. */
  | { readonly type: "persist-expansion"; readonly path: string; readonly expanded: boolean; readonly list: boolean }
  | { readonly type: "reset-width" }
  | { readonly type: "set-min-width"; readonly width: number }
  | { readonly type: "schedule-scroll"; readonly path: string; readonly attempt: number }
  | { readonly type: "cleanup" }

export type PierreTreeTransition = { readonly state: PierreTreeState; readonly effects: readonly PierreTreeEffect[] }

type Live = Extract<PierreTreeState, { status: "live" }>

type Allowed = Extract<PierreTreeState, { status: "allowed" }>

type Synced = Extract<PierreTreeEvent, { type: "synced" }>

const NONE: readonly PierreTreeEffect[] = []

export function createPierreTreeState(): PierreTreeState {
  return { status: "unmounted" }
}

export function transitionPierreTree(state: PierreTreeState, event: PierreTreeEvent): PierreTreeTransition {
  if (state.status === "disposed") return unchanged(state)

  if (event.type === "disposed") {
    return { state: { status: "disposed" }, effects: state.status === "unmounted" ? NONE : [{ type: "cleanup" }] }
  }

  if (state.status === "unmounted") return event.type === "synced" ? mount(event, 0) : unchanged(state)

  if (event.type === "synced") {
    if (event.input.mode === "live") {
      return state.status === "live"
        ? syncLive(state, event.input, event.kinds, event.active)
        : mount(event, issuedAttempt(state.scroll))
    }

    return state.status === "allowed"
      ? syncAllowed(state, event.input, event.kinds, event.active)
      : mount(event, issuedAttempt(state.scroll))
  }

  if (event.type === "sync.started" || event.type === "sync.ended") {
    const sync = nextSync(state.sync, event.kind, event.type === "sync.started")

    return sync === state.sync ? unchanged(state) : { state: { ...state, sync }, effects: NONE }
  }

  if (event.type === "tree.expansion-changed") {
    if (isSyncing(state.sync, "expansion")) return unchanged(state)

    return userExpansion(state, event.path, event.expanded)
  }

  if (event.type === "tree.selection-changed") {
    if (isSyncing(state.sync, "selection") || matchesSelection(event.selected, state.selectedPath))
      return unchanged(state)

    // The tree selected a row itself (a click); it shows the active file until the caller makes the row active.
    return { state, effects: [{ type: "select", path: state.selectedPath }] }
  }

  if (event.type === "list.measured") {
    if (event.width <= state.widest) return unchanged(state)

    return { state: { ...state, widest: event.width }, effects: [{ type: "set-min-width", width: event.width }] }
  }

  if (state.scroll.status !== "pending" || state.scroll.attempt !== event.attempt) return unchanged(state)

  return {
    state: { ...state, scroll: { status: "idle", scrolledPath: state.scroll.path, issued: state.scroll.attempt } },
    effects: NONE,
  }
}

/**
 * Runs a programmatic change to the tree. The tree's echoes of it are ignored until it ends, also when it throws, so
 * a failed change can never stop user folder toggles from persisting.
 */
export function runPierreTreeSync(
  dispatch: (event: PierreTreeEvent) => void,
  kind: "expansion" | "selection",
  fn: () => void,
) {
  dispatch({ type: "sync.started", kind })

  try {
    fn()
  } finally {
    dispatch({ type: "sync.ended", kind })
  }
}

export function isPierreTreeMounted(state: PierreTreeState) {
  return state.status === "live" || state.status === "allowed"
}

/** The workspace path a tree row stands for, with its original separators. */
export function pierreTreeOriginalPath(state: PierreTreeState, rawPath: string) {
  const norm = normalizeFileTreeV2Path(rawPath)

  if (state.status === "live") return state.model.nodesByPath.get(norm)?.path ?? norm

  if (state.status === "allowed") return state.model.originalByPath.get(norm) ?? norm

  return norm
}

export function pierreTreeFileNode(state: PierreTreeState, rawPath: string): FileNode {
  const norm = normalizeFileTreeV2Path(rawPath)
  const existing = state.status === "live" ? state.model.nodesByPath.get(norm) : undefined

  if (existing) return existing
  const original = pierreTreeOriginalPath(state, rawPath)

  return { name: norm.split("/").at(-1) || norm, path: original, absolute: original, type: "file", ignored: false }
}

export function pierreTreeRowDecoration(state: PierreTreeState, row: { readonly kind: string; readonly path: string }) {
  if (state.status !== "allowed" || row.kind !== "directory") return null
  const label = state.labels?.get(normalizeFileTreeV2Path(row.path))

  return label ? { text: label } : null
}

/** Orders live rows as the workspace listed them. */
export function pierreTreeCompareOrder(state: PierreTreeState, a: string, b: string) {
  if (state.status !== "live") return 0
  const order = state.model.orderByPath

  return (order.get(normalizeFileTreeV2Path(a)) ?? 0) - (order.get(normalizeFileTreeV2Path(b)) ?? 0)
}

export function needsPierreTreeWiden(state: PierreTreeState, width: number) {
  return (state.status === "live" || state.status === "allowed") && width > state.widest
}

/** Whether the scroll microtask for `attempt` is still the current one. */
export function shouldScrollPierreTree(state: PierreTreeState, attempt: number) {
  return (
    (state.status === "live" || state.status === "allowed") &&
    state.scroll.status === "pending" &&
    state.scroll.attempt === attempt
  )
}

/**
 * Diffs the live tree's paths with a new listing. A removed folder takes everything under it out of the tree, so its
 * descendants leave `known` with it and come back as additions when they are listed again.
 */
export function reconcileLivePaths(known: ReadonlySet<string>, model: LiveTreeInput) {
  const removed = new Set<string>()
  const removedDirs = new Set<string>()

  for (const existing of known) {
    if (model.pathSet.has(existing)) continue
    const parent = parentPath(existing)

    // Rows under a collapsed folder are not listed, but the tree still holds them.
    if (parent !== "" && !model.expandedSet.has(parent)) continue
    removed.add(existing)

    if (existing.endsWith("/")) removedDirs.add(existing)
  }

  const gone = (path: string) => removedDirs.size > 0 && hasRemovedAncestor(path, removedDirs)
  const ops: PierreTreeBatchOp[] = []

  for (const path of removed) {
    if (!gone(path)) ops.push({ type: "remove", path, recursive: path.endsWith("/") })
  }

  for (const path of model.paths) {
    if (!known.has(path)) ops.push({ type: "add", path })
  }

  if (ops.length === 0) return { known, ops }

  const next = new Set<string>()

  for (const existing of known) {
    if (!removed.has(existing) && !gone(existing)) next.add(existing)
  }

  for (const path of model.paths) next.add(path)

  return { known: next, ops }
}

/**
 * Settles the scroll target for the active file. A file the tree does not show (unloaded, or under a collapsed folder)
 * cancels a pending scroll and is not remembered as scrolled to, so it scrolls once it shows.
 */
export function reconcileScroll(scroll: PierreTreeScroll, active: string, visible: boolean): PierreTreeScroll {
  const issued = issuedAttempt(scroll)

  if (scroll.status === "idle" && scroll.scrolledPath === active) return scroll

  if (!active || !visible) {
    return scroll.status === "idle" && scroll.scrolledPath === ""
      ? scroll
      : { status: "idle", scrolledPath: "", issued }
  }

  if (scroll.status === "pending" && scroll.path === active) return scroll

  return { status: "pending", path: active, attempt: issued + 1 }
}

function mount(event: Synced, issued: number): PierreTreeTransition {
  const kindsStatus = buildKindsStatus(event.kinds)
  const idle: PierreTreeScroll = { status: "idle", scrolledPath: "", issued }
  const active = event.active

  if (event.input.mode === "live") {
    const model = event.input.model
    const selectedPath = active && model.pathSet.has(active) ? active : ""
    const scroll = reconcileScroll(idle, active, selectedPath !== "")

    return {
      state: {
        status: "live",
        sync: "none",
        active,
        selectedPath,
        scroll,
        kinds: event.kinds,
        kindsStatus,
        ignored: model.ignoredPaths,
        widest: 0,
        root: event.input.root,
        model,
        knownPaths: model.pathSet,
        treeExpanded: model.expandedSet,
      },
      effects: [
        {
          type: "mount-tree",
          mode: "live",
          paths: model.paths,
          expanded: model.expandedDirs,
          selected: selectedPath,
          gitStatus: statusEntries(buildGitStatusMap(kindsStatus, model.ignoredPaths)),
          collapse: [],
        },
        ...scheduled(idle, scroll),
      ],
    }
  }

  const input = event.input
  const selectedPath = active && input.model.files.has(active) ? active : ""
  const visible = selectedPath !== "" && !hasCollapsedAncestor(active, input.collapsedDirs)
  const scroll = reconcileScroll(idle, active, visible)

  return {
    state: {
      status: "allowed",
      sync: "none",
      active,
      selectedPath,
      scroll,
      kinds: event.kinds,
      kindsStatus,
      ignored: new Set(),
      widest: 0,
      model: input.model,
      collapsedDirs: input.collapsedDirs,
      labels: input.labels,
    },
    effects: [
      {
        type: "mount-tree",
        mode: "allowed",
        paths: input.model.paths,
        expanded: undefined,
        selected: selectedPath,
        gitStatus: statusEntries(kindsStatus),
        collapse: [...input.collapsedDirs],
      },
      ...scheduled(idle, scroll),
    ],
  }
}

function syncLive(
  state: Live,
  input: Extract<PierreTreeInput, { mode: "live" }>,
  kinds: ReadonlyMap<string, ChangeKind> | undefined,
  active: string,
): PierreTreeTransition {
  const rootChanged = input.root !== state.root
  const modelChanged = rootChanged || input.model !== state.model

  if (!modelChanged && kinds === state.kinds && active === state.active) return unchanged(state)
  const structure = modelChanged ? reconcileLiveStructure(state, input) : undefined
  const status = reconcileStatus(state, kinds, modelChanged ? input.model.ignoredPaths : state.ignored)
  const knownPaths = structure?.knownPaths ?? state.knownPaths
  const selectedPath = active && knownPaths.has(active) ? active : ""
  // Another workspace root is another set of rows: the active file scrolls into view in it again.
  const base = rootChanged ? forgetScroll(state.scroll) : state.scroll
  const scroll = reconcileScroll(base, active, active !== "" && input.model.pathSet.has(active))
  const changed = structure !== undefined && structure.effects.length > 0

  return {
    state: {
      ...state,
      ...status.state,
      active,
      selectedPath,
      scroll,
      widest: changed ? 0 : state.widest,
      root: input.root,
      model: input.model,
      knownPaths,
      treeExpanded: structure?.treeExpanded ?? state.treeExpanded,
    },
    effects: [
      ...(changed && state.widest > 0 ? [{ type: "reset-width" } as const] : []),
      ...(structure?.effects ?? []),
      ...status.effects,
      ...(selectedPath !== state.selectedPath || changed ? [{ type: "select", path: selectedPath } as const] : []),
      ...scheduled(state.scroll, scroll),
    ],
  }
}

function reconcileLiveStructure(state: Live, input: Extract<PierreTreeInput, { mode: "live" }>) {
  if (input.root !== state.root) {
    return {
      knownPaths: input.model.pathSet,
      treeExpanded: input.model.expandedSet,
      effects: [{ type: "reset-paths", paths: input.model.paths, expanded: input.model.expandedDirs }] as const,
    }
  }

  const paths = reconcileLivePaths(state.knownPaths, input.model)
  const held = paths.known === state.knownPaths ? state.treeExpanded : retain(state.treeExpanded, paths.known)
  const expand = input.model.expandedDirs.filter((dir) => !held.has(dir))
  const collapse: string[] = []

  // A folder another view collapsed is listed without its entries; one hidden under a collapsed folder keeps its state.
  for (const dir of held) {
    if (input.model.pathSet.has(dir) && !input.model.expandedSet.has(dir)) collapse.push(dir)
  }

  const effects: PierreTreeEffect[] = []

  if (paths.ops.length > 0) effects.push({ type: "batch-paths", ops: paths.ops })

  if (expand.length === 0 && collapse.length === 0) return { knownPaths: paths.known, treeExpanded: held, effects }
  const treeExpanded = new Set(held)
  collapse.forEach((dir) => treeExpanded.delete(dir))
  expand.forEach((dir) => treeExpanded.add(dir))
  effects.push({ type: "sync-expansion", expand, collapse })

  return { knownPaths: paths.known, treeExpanded, effects }
}

function syncAllowed(
  state: Allowed,
  input: Extract<PierreTreeInput, { mode: "allowed" }>,
  kinds: ReadonlyMap<string, ChangeKind> | undefined,
  active: string,
): PierreTreeTransition {
  const modelChanged = input.model !== state.model

  if (
    !modelChanged &&
    input.collapsedDirs === state.collapsedDirs &&
    input.labels === state.labels &&
    kinds === state.kinds &&
    active === state.active
  )
    return unchanged(state)

  // Same rows: only folders another view opened or closed change.
  const expansion = modelChanged ? undefined : diffCollapsed(state.collapsedDirs, input.collapsedDirs)
  const changed = modelChanged || expansion !== undefined
  const status = reconcileStatus(state, kinds, state.ignored)
  const selectedPath = active && input.model.files.has(active) ? active : ""
  const visible = selectedPath !== "" && !hasCollapsedAncestor(active, input.collapsedDirs)
  const scroll = reconcileScroll(state.scroll, active, visible)
  const effects: PierreTreeEffect[] = []

  if (modelChanged && state.selectedPath !== "") effects.push({ type: "select", path: "" })

  if (changed && state.widest > 0) effects.push({ type: "reset-width" })

  if (modelChanged) {
    effects.push({ type: "reset-paths", paths: input.model.paths, expanded: undefined })

    if (input.collapsedDirs.size > 0)
      effects.push({ type: "sync-expansion", expand: [], collapse: [...input.collapsedDirs] })
  }

  if (expansion) effects.push({ type: "sync-expansion", expand: expansion.expand, collapse: expansion.collapse })

  if (!sameStringMap(state.labels, input.labels)) effects.push({ type: "rerender" })
  effects.push(...status.effects)

  if (selectedPath !== state.selectedPath || modelChanged) effects.push({ type: "select", path: selectedPath })
  effects.push(...scheduled(state.scroll, scroll))

  return {
    state: {
      ...state,
      ...status.state,
      active,
      selectedPath,
      scroll,
      widest: changed ? 0 : state.widest,
      model: input.model,
      collapsedDirs: input.collapsedDirs,
      labels: input.labels,
    },
    effects,
  }
}

function userExpansion(state: Live | Allowed, rawPath: string, expanded: boolean): PierreTreeTransition {
  const norm = normalizeFileTreeV2Path(rawPath)
  const width: readonly PierreTreeEffect[] = state.widest > 0 ? [{ type: "reset-width" }] : NONE

  const persist: PierreTreeEffect = {
    type: "persist-expansion",
    path: pierreTreeOriginalPath(state, rawPath),
    expanded,
    list: state.status === "live",
  }

  if (state.status === "live") {
    return {
      state: { ...state, widest: 0, treeExpanded: toggled(state.treeExpanded, `${norm}/`, expanded) },
      effects: [...width, persist],
    }
  }

  const collapsedDirs = toggled(state.collapsedDirs, norm, !expanded)
  const visible = state.selectedPath !== "" && !hasCollapsedAncestor(state.active, collapsedDirs)
  const scroll = reconcileScroll(state.scroll, state.active, visible)

  return {
    state: { ...state, widest: 0, collapsedDirs, scroll },
    effects: [...width, ...scheduled(state.scroll, scroll), persist],
  }
}

function reconcileStatus(
  state: Live | Allowed,
  kinds: ReadonlyMap<string, ChangeKind> | undefined,
  ignored: ReadonlySet<string>,
) {
  const kindsSame = sameStringMap(state.kinds, kinds)
  const ignoredSame = sameStringSet(state.ignored, ignored)
  const kindsStatus = kindsSame ? state.kindsStatus : buildKindsStatus(kinds)
  const layers = { kinds: kindsStatus, ignored: ignoredSame ? state.ignored : ignored }
  const next = { kinds, kindsStatus, ignored: layers.ignored }

  if (kindsSame && ignoredSame) return { state: next, effects: NONE }
  const patch = diffStatusLayers({ kinds: state.kindsStatus, ignored: state.ignored }, layers)

  if (patch.remove.length === 0 && patch.set.length === 0) return { state: next, effects: NONE }

  return { state: next, effects: [{ type: "patch-git-status", patch } as const] }
}

function diffCollapsed(previous: ReadonlySet<string>, next: ReadonlySet<string>) {
  if (sameStringSet(previous, next)) return undefined

  return {
    expand: [...previous].filter((dir) => !next.has(dir)),
    collapse: [...next].filter((dir) => !previous.has(dir)),
  }
}

function scheduled(previous: PierreTreeScroll, next: PierreTreeScroll): readonly PierreTreeEffect[] {
  if (next.status !== "pending" || next === previous) return NONE

  return [{ type: "schedule-scroll", path: next.path, attempt: next.attempt }]
}

function forgetScroll(scroll: PierreTreeScroll): PierreTreeScroll {
  return { status: "idle", scrolledPath: "", issued: issuedAttempt(scroll) }
}

function issuedAttempt(scroll: PierreTreeScroll) {
  return scroll.status === "pending" ? scroll.attempt : scroll.issued
}

function nextSync(sync: PierreTreeSync, kind: "expansion" | "selection", started: boolean): PierreTreeSync {
  const other = kind === "expansion" ? "selection" : "expansion"
  const hasOther = isSyncing(sync, other)

  if (started) return hasOther ? "both" : kind

  return hasOther ? other : "none"
}

function isSyncing(sync: PierreTreeSync, kind: "expansion" | "selection") {
  return sync === kind || sync === "both"
}

function matchesSelection(selected: readonly string[], path: string) {
  return path ? selected.length === 1 && selected[0] === path : selected.length === 0
}

function statusEntries(status: ReadonlyMap<string, TreeGitStatus>) {
  return Array.from(status, ([path, value]) => ({ path, status: value }))
}

function toggled(set: ReadonlySet<string>, item: string, present: boolean) {
  if (set.has(item) === present) return set
  const next = new Set(set)

  if (present) next.add(item)
  else next.delete(item)

  return next
}

function retain(set: ReadonlySet<string>, known: ReadonlySet<string>) {
  for (const item of set) {
    if (!known.has(item)) return new Set([...set].filter((entry) => known.has(entry)))
  }

  return set
}

/** The canonical parent folder (`dir/`) of a canonical path, or `""` at the root. */
function parentPath(path: string) {
  const slash = path.lastIndexOf("/", path.length - 2)

  return slash === -1 ? "" : path.slice(0, slash + 1)
}

function hasRemovedAncestor(path: string, removedDirs: ReadonlySet<string>) {
  for (let slash = path.indexOf("/"); slash !== -1 && slash < path.length - 1; slash = path.indexOf("/", slash + 1)) {
    if (removedDirs.has(path.slice(0, slash + 1))) return true
  }

  return false
}

function hasCollapsedAncestor(path: string, collapsed: ReadonlySet<string>) {
  if (collapsed.size === 0) return false

  for (let slash = path.indexOf("/"); slash !== -1; slash = path.indexOf("/", slash + 1)) {
    if (collapsed.has(path.slice(0, slash))) return true
  }

  return false
}

function unchanged(state: PierreTreeState): PierreTreeTransition {
  return { state, effects: NONE }
}
