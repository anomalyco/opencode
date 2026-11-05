import type { FileDiffInfo } from "@opencode/client/promise"
import { expandReviewFolders, isReviewFolder, normalizePath } from "./kinds"

/** How many times a failed folder load retries before the folder shows it failed, as TanStack Query retried it. */
export const REVIEW_FOLDER_RETRIES = 3

/** What one untracked folder's diff request reads against. */
export type ReviewFolderSource = {
  readonly serverID: string
  /** The review root the folder paths are relative to. */
  readonly root: string
  readonly directory: string
  readonly mode: "git" | "branch"
  readonly branch: string
  readonly defaultBranch: string
}

export type ReviewFolderContext = {
  /** Defined while Git or Branch changes show; undefined while the review waits, has no repository, or shows a turn. */
  readonly source: ReviewFolderSource | undefined
  readonly connected: boolean
  /** The top-level changes, where Git lists each untracked folder as one `dir/` row. */
  readonly rows: readonly FileDiffInfo[]
  /** The reachable untracked folders the change tree has expanded. */
  readonly expanded: ReadonlySet<string>
}

export type ReviewFolderItem =
  /** The first load runs. `stale`: files changed meanwhile, so one more request follows its answer. */
  | { readonly status: "loading"; readonly attempt: number; readonly stale: boolean; readonly failures: number }
  /** The folder's entries, kept while it is collapsed again until the source changes or the folder goes away. */
  | { readonly status: "ready"; readonly attempt: number; readonly entries: readonly FileDiffInfo[] }
  /** Loads again while the entries already loaded stay shown. */
  | { readonly status: "refreshing"; readonly attempt: number; readonly entries: readonly FileDiffInfo[] }
  /** The first load failed or timed out; collapsing the folder drops it, so expanding it again retries. */
  | { readonly status: "error"; readonly attempt: number }

export type ReviewFolderState =
  | { readonly status: "inactive"; readonly issued: number }
  | {
      readonly status: "active"
      /** The last request's number; every request gets a new one, so a result for an older one is stale. */
      readonly issued: number
      readonly source: ReviewFolderSource
      readonly connected: boolean
      readonly rows: readonly FileDiffInfo[]
      readonly expanded: ReadonlySet<string>
      readonly folders: ReadonlyMap<string, ReviewFolderItem>
    }
  | { readonly status: "disposed"; readonly issued: number }

export type ReviewFolderEvent =
  | { readonly type: "context.changed"; readonly context: ReviewFolderContext }
  /** Files changed in the directory. */
  | { readonly type: "refresh" }
  /** The user asked to load the changes again. */
  | { readonly type: "retry" }
  | {
      readonly type: "fetch.succeeded"
      readonly folder: string
      readonly attempt: number
      readonly entries: readonly FileDiffInfo[]
    }
  | { readonly type: "fetch.failed"; readonly folder: string; readonly attempt: number }
  | { readonly type: "fetch.timed-out"; readonly folder: string; readonly attempt: number }
  | { readonly type: "disposed" }

export type ReviewFolderEffect =
  /** Starts a folder's request after `delay` milliseconds. */
  | {
      readonly type: "fetch"
      readonly folder: string
      readonly source: ReviewFolderSource
      readonly attempt: number
      readonly delay: number
    }
  | { readonly type: "abort"; readonly attempt: number }

export type ReviewFolderTransition = {
  readonly state: ReviewFolderState
  readonly effects: readonly ReviewFolderEffect[]
}

type Active = Extract<ReviewFolderState, { status: "active" }>

export const INITIAL_REVIEW_FOLDER_STATE: ReviewFolderState = { status: "inactive", issued: 0 }

const NONE: readonly ReviewFolderEffect[] = []

export function transitionReviewFolders(state: ReviewFolderState, event: ReviewFolderEvent): ReviewFolderTransition {
  if (state.status === "disposed") return unchanged(state)

  if (event.type === "disposed") return { state: { status: "disposed", issued: state.issued }, effects: aborts(state) }

  if (event.type === "context.changed") return contextChanged(state, event.context)

  if (state.status !== "active") return unchanged(state)

  if (event.type === "refresh") {
    // A first load keeps its request; the changes that arrive meanwhile load once it answers.
    if (!state.connected || ![...state.folders.values()].some((item) => item.status === "loading" && !item.stale))
      return unchanged(state)

    return {
      state: {
        ...state,
        folders: new Map(
          [...state.folders].map(([folder, item]) => [
            folder,
            item.status === "loading" ? { ...item, stale: true } : item,
          ]),
        ),
      },
      effects: NONE,
    }
  }

  if (event.type === "retry") {
    const failed = [...state.folders].filter(([folder, item]) => item.status === "error" && state.expanded.has(folder))

    if (!state.connected || failed.length === 0) return unchanged(state)
    const retried = failed.map(([folder], index) => [folder, loading(state.issued + index + 1)] as const)

    return {
      state: { ...state, issued: state.issued + retried.length, folders: new Map([...state.folders, ...retried]) },
      effects: retried.map(([folder, item]) => fetch(state.source, folder, item.attempt)),
    }
  }

  const item = state.folders.get(event.folder)

  if (!item || item.attempt !== event.attempt || (item.status !== "loading" && item.status !== "refreshing"))
    return unchanged(state)

  if (event.type === "fetch.succeeded") {
    if (item.status === "loading" && item.stale) {
      const attempt = state.issued + 1

      // The changes that arrived meanwhile load once more, with the first answer shown.
      return settle(
        { ...state, issued: attempt },
        event.folder,
        { status: "refreshing", attempt, entries: event.entries },
        [fetch(state.source, event.folder, attempt)],
      )
    }

    return settle(state, event.folder, { status: "ready", attempt: item.attempt, entries: event.entries }, NONE)
  }

  // A failed refresh keeps the entries already shown.
  if (item.status === "refreshing")
    return settle(state, event.folder, { status: "ready", attempt: item.attempt, entries: item.entries }, NONE)

  const folders = new Map(state.folders)

  // A folder collapsed meanwhile forgets the failure, so expanding it again loads it at once.
  if (!state.expanded.has(event.folder)) {
    folders.delete(event.folder)

    return { state: { ...state, folders }, effects: NONE }
  }

  // A rejected request retries with backoff, as TanStack Query did; a request that hung does not wait that long again.
  if (event.type === "fetch.failed" && item.failures < REVIEW_FOLDER_RETRIES) {
    const attempt = state.issued + 1

    folders.set(event.folder, { status: "loading", attempt, stale: item.stale, failures: item.failures + 1 })

    return {
      state: { ...state, issued: attempt, folders },
      effects: [fetch(state.source, event.folder, attempt, Math.min(1000 * 2 ** item.failures, 30_000))],
    }
  }

  folders.set(event.folder, { status: "error", attempt: item.attempt })

  return { state: { ...state, folders }, effects: NONE }
}

/** The reachable untracked folders: folder rows, and folder entries of the loaded folders among them. */
export function reviewFolderCandidates(rows: readonly FileDiffInfo[], state: ReviewFolderState): string[] {
  return [...reachable(rows, loadedEntries(state))]
}

/** The rows with each loaded folder's entries after its row, depth first. */
export function reviewExpandedDiffs(rows: readonly FileDiffInfo[], state: ReviewFolderState) {
  return expandReviewFolders(rows, loadedEntries(state))
}

/**
 * Each folder's tree label by normalized path: its entry count, `format.more` when its listing stopped early, or
 * `format.failed` when it could not load.
 */
export function reviewFolderLabels(
  state: ReviewFolderState,
  format: { readonly more: (count: number) => string; readonly failed: string },
): Map<string, string> {
  if (state.status !== "active") return new Map()

  return new Map(
    [...state.folders].flatMap(([folder, item]) => {
      if (item.status === "error") return [[normalizePath(folder), format.failed] as const]

      if (item.status === "loading") return []
      const shown = item.entries.filter((entry) => !entry.more).length
      const label = item.entries.some((entry) => entry.more) ? format.more(shown) : `${shown}`

      return [[normalizePath(folder), label] as const]
    }),
  )
}

export function sameReviewFolderSource(a: ReviewFolderSource, b: ReviewFolderSource) {
  return (
    a.serverID === b.serverID &&
    a.root === b.root &&
    a.directory === b.directory &&
    a.mode === b.mode &&
    a.branch === b.branch &&
    a.defaultBranch === b.defaultBranch
  )
}

function contextChanged(state: Exclude<ReviewFolderState, { status: "disposed" }>, context: ReviewFolderContext) {
  if (!context.source) {
    if (state.status === "inactive") return unchanged(state)

    return { state: { status: "inactive", issued: state.issued }, effects: aborts(state) }
  }

  const source = context.source

  // Another source starts over: nothing an earlier source loaded or requested applies to it.
  if (state.status === "inactive" || !sameReviewFolderSource(state.source, source)) {
    const loads = (context.connected ? [...context.expanded] : []).map(
      (folder, index) => [folder, loading(state.issued + index + 1)] as const,
    )

    return {
      state: {
        status: "active",
        issued: state.issued + loads.length,
        source,
        connected: context.connected,
        rows: context.rows,
        expanded: context.expanded,
        folders: new Map(loads),
      },
      effects: [...aborts(state), ...loads.map(([folder, item]) => fetch(source, folder, item.attempt))],
    }
  }

  if (
    state.connected === context.connected &&
    state.rows === context.rows &&
    sameFolderSet(state.expanded, context.expanded)
  )
    return unchanged(state)

  const reach = reachable(context.rows, loadedEntries(state))
  const reload = state.rows !== context.rows || (context.connected && !state.connected)
  const run = { issued: state.issued, effects: [] as ReviewFolderEffect[], folders: new Map<string, ReviewFolderItem>() }

  const keep = (folder: string, item: ReviewFolderItem) => {
    run.folders.set(folder, item)
  }

  const abort = (item: ReviewFolderItem) => {
    if (item.status === "loading" || item.status === "refreshing")
      run.effects.push({ type: "abort", attempt: item.attempt })
  }

  const start = (folder: string, entries?: readonly FileDiffInfo[]) => {
    run.issued += 1
    keep(folder, entries ? { status: "refreshing", attempt: run.issued, entries } : loading(run.issued))
    run.effects.push(fetch(state.source, folder, run.issued))
  }

  state.folders.forEach((item, folder) => {
    // A folder that left the changes is gone with its entries; its request would read a deleted directory.
    if (!reach.has(folder)) return abort(item)

    // A disconnect ends the requests; loaded entries stay shown.
    if (!context.connected) {
      abort(item)

      if (item.status === "ready" || item.status === "refreshing")
        keep(folder, { status: "ready", attempt: item.attempt, entries: item.entries })

      return
    }

    if (item.status === "error") {
      // Collapsing a folder that failed forgets the failure, so expanding it again retries.
      if (!context.expanded.has(folder)) return

      return reload ? start(folder) : keep(folder, item)
    }

    if (item.status === "loading")
      return keep(folder, state.rows !== context.rows && !item.stale ? { ...item, stale: true } : item)

    if (!reload) return keep(folder, item)
    abort(item)
    start(folder, item.entries)
  })

  if (context.connected)
    context.expanded.forEach((folder) => {
      if (!run.folders.has(folder) && reach.has(folder)) start(folder)
    })

  return {
    state: {
      ...state,
      issued: run.issued,
      connected: context.connected,
      rows: context.rows,
      expanded: context.expanded,
      folders: run.folders,
    },
    effects: run.effects,
  }
}

/** Replaces a folder's item and forgets the nested folders its new entries no longer list. */
function settle(
  state: Active,
  folder: string,
  item: ReviewFolderItem,
  effects: readonly ReviewFolderEffect[],
): ReviewFolderTransition {
  const replaced = new Map(state.folders).set(folder, item)
  const reach = reachable(state.rows, loadedEntries({ ...state, folders: replaced }))
  const pruned = [...replaced].filter(([path]) => !reach.has(path))

  if (pruned.length === 0) return { state: { ...state, folders: replaced }, effects }

  return {
    state: {
      ...state,
      folders: new Map([...replaced].filter(([path]) => reach.has(path))),
      expanded: new Set([...state.expanded].filter((path) => reach.has(path))),
    },
    effects: [
      ...pruned.flatMap(([, pending]) =>
        pending.status === "loading" || pending.status === "refreshing"
          ? [{ type: "abort", attempt: pending.attempt } as const]
          : [],
      ),
      ...effects,
    ],
  }
}

function loadedEntries(state: ReviewFolderState): ReadonlyMap<string, readonly FileDiffInfo[]> {
  if (state.status !== "active") return new Map()

  return new Map(
    [...state.folders].flatMap(([folder, item]) =>
      item.status === "ready" || item.status === "refreshing" ? [[folder, item.entries] as const] : [],
    ),
  )
}

function reachable(rows: readonly FileDiffInfo[], loaded: ReadonlyMap<string, readonly FileDiffInfo[]>) {
  return new Set(
    expandReviewFolders(rows, loaded)
      .map((diff) => diff.file)
      .filter(isReviewFolder),
  )
}

function aborts(state: ReviewFolderState): ReviewFolderEffect[] {
  if (state.status !== "active") return []

  return [...state.folders.values()].flatMap((item) =>
    item.status === "loading" || item.status === "refreshing" ? [{ type: "abort", attempt: item.attempt } as const] : [],
  )
}

function fetch(source: ReviewFolderSource, folder: string, attempt: number, delay = 0): ReviewFolderEffect {
  return { type: "fetch", folder, source, attempt, delay }
}

function loading(attempt: number): ReviewFolderItem {
  return { status: "loading", attempt, stale: false, failures: 0 }
}

function sameFolderSet(a: ReadonlySet<string>, b: ReadonlySet<string>) {
  return a.size === b.size && [...a].every((folder) => b.has(folder))
}

function unchanged(state: ReviewFolderState): ReviewFolderTransition {
  return { state, effects: NONE }
}
