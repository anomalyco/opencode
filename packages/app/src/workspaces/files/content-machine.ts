import type { FileContent } from "@opencode/plugin/gui"
import { getFilename } from "@opencode/util/path"
import type { FileState } from "./types"

// One normalized path's content lifecycle in the provider's directory. An unloaded or evicted file has no entry.
// `rerun` records a change reported while a read was in flight: that read's result is outdated, so one more read runs
// when it settles. `stale` records a failed refresh, so the next plain load reads again. A read has no deadline of its
// own: the transport gives up on a server that sends no response, which arrives here as `load.failed`, and a large file
// may download for as long as it needs.
export type FileEntryState =
  | { readonly status: "loading"; readonly attempt: number; readonly silent: boolean; readonly rerun: boolean }
  | { readonly status: "ready"; readonly content: FileContent; readonly stale: boolean }
  | {
      readonly status: "refreshing"
      readonly content: FileContent
      readonly attempt: number
      readonly silent: boolean
      readonly rerun: boolean
    }
  | { readonly status: "missing"; readonly error: string }
  | { readonly status: "error"; readonly error: string }

// One file provider's content. `issued` only grows, also across directories, so a reply to a read from an earlier
// directory never matches a read in the current one. The driver's store write replaces changed entries in place, so
// `issued` and `files` are mutable; the transition never mutates them.
export type FileContentState =
  | {
      readonly status: "active"
      readonly directory: string
      issued: number
      files: Record<string, FileEntryState>
    }
  | { readonly status: "disposed" }

export type FileContentEvent =
  | { readonly type: "load.requested"; readonly path: string; readonly force: boolean; readonly silent: boolean }
  | { readonly type: "load.succeeded"; readonly path: string; readonly attempt: number; readonly content: FileContent }
  | {
      readonly type: "load.missing"
      readonly path: string
      readonly attempt: number
      readonly error: string
      // A file tab open for the path shows the missing state itself, so no toast repeats it.
      readonly opened: boolean
    }
  | { readonly type: "load.failed"; readonly path: string; readonly attempt: number; readonly error: string }
  | { readonly type: "cache.evicted"; readonly paths: readonly string[] }
  | { readonly type: "scope.changed"; readonly directory: string }
  | { readonly type: "disposed" }

export type FileContentEffect =
  | { readonly type: "read"; readonly directory: string; readonly path: string; readonly attempt: number }
  | { readonly type: "abort.all" }
  | { readonly type: "settle"; readonly path: string }
  | { readonly type: "cache.store"; readonly path: string; readonly content: FileContent }
  | { readonly type: "cache.remove"; readonly path: string }
  | { readonly type: "cache.reset" }
  | { readonly type: "toast"; readonly message: string }

export type FileContentTransition = {
  readonly state: FileContentState
  readonly effects: readonly FileContentEffect[]
}

type ActiveState = Extract<FileContentState, { status: "active" }>

type ResultEvent = Extract<FileContentEvent, { type: "load.succeeded" | "load.missing" | "load.failed" }>

export function createFileContentState(directory: string): FileContentState {
  return { status: "active", directory, issued: 0, files: {} }
}

export function transitionFileContent(state: FileContentState, event: FileContentEvent): FileContentTransition {
  if (state.status === "disposed") return unchanged(state)

  if (event.type === "disposed")
    return changed({ status: "disposed" }, [{ type: "abort.all" }, { type: "cache.reset" }])

  if (event.type === "scope.changed") {
    if (event.directory === state.directory) return unchanged(state)

    return changed({ status: "active", directory: event.directory, issued: state.issued, files: {} }, [
      { type: "abort.all" },
      { type: "cache.reset" },
    ])
  }

  if (event.type === "cache.evicted") return evict(state, event.paths)

  if (event.type === "load.requested") return request(state, event)

  return complete(state, event)
}

// A request joins a read in flight. A forced one also asks for one more read after it, because the file may have
// changed after that read started; aborting instead would starve a file that changes faster than it reads.
function request(state: ActiveState, event: Extract<FileContentEvent, { type: "load.requested" }>) {
  if (!event.path) return unchanged(state)
  const entry = state.files[event.path]

  if (entry?.status === "loading" || entry?.status === "refreshing") {
    const silent = entry.silent && event.silent
    const rerun = entry.rerun || event.force

    if (silent === entry.silent && rerun === entry.rerun) return unchanged(state)

    return changed(put(state, event.path, { ...entry, silent, rerun }))
  }

  if (entry?.status === "ready" && !entry.stale && !event.force) return unchanged(state)

  return start(state, event.path, entry?.status === "ready" ? entry.content : undefined, event.silent)
}

function complete(state: ActiveState, event: ResultEvent) {
  const entry = state.files[event.path]

  if (entry?.status !== "loading" && entry?.status !== "refreshing") return unchanged(state)

  if (entry.attempt !== event.attempt) return unchanged(state)

  const shown = entry.status === "refreshing" ? entry.content : undefined

  if (event.type === "load.succeeded") {
    const store: FileContentEffect = { type: "cache.store", path: event.path, content: event.content }

    // Show what this read found, then read again for the change reported during it.
    if (entry.rerun) return start(state, event.path, event.content, entry.silent, [store])

    return changed(put(state, event.path, { status: "ready", content: event.content, stale: false }), [
      store,
      { type: "settle", path: event.path },
    ])
  }

  // A failure that a later change already outdated is not reported: read again and keep what the tab shows.
  if (entry.rerun) return start(state, event.path, shown, entry.silent)

  const toast: FileContentEffect[] = entry.silent ? [] : [{ type: "toast", message: event.error }]

  if (event.type === "load.missing") {
    return changed(put(state, event.path, { status: "missing", error: event.error }), [
      { type: "cache.remove", path: event.path },
      { type: "settle", path: event.path },
      ...(event.opened ? [] : toast),
    ])
  }

  // A failed refresh keeps the content it had; the next plain load reads again.
  return changed(
    put(
      state,
      event.path,
      shown ? { status: "ready", content: shown, stale: true } : { status: "error", error: event.error },
    ),
    [{ type: "settle", path: event.path }, ...toast],
  )
}

// An evicted file is forgotten. A refresh in flight keeps its read and shows a first load until that read settles.
function evict(state: ActiveState, paths: readonly string[]) {
  const evicted = new Set(
    paths.filter((path) => {
      const status = state.files[path]?.status

      return status === "ready" || status === "refreshing"
    }),
  )

  if (evicted.size === 0) return unchanged(state)

  const files = Object.entries(state.files).flatMap(([path, entry]): [string, FileEntryState][] => {
    if (!evicted.has(path)) return [[path, entry]]

    if (entry.status !== "refreshing") return []

    return [[path, { status: "loading", attempt: entry.attempt, silent: entry.silent, rerun: entry.rerun }]]
  })

  return changed({ ...state, files: Object.fromEntries(files) })
}

function start(
  state: ActiveState,
  path: string,
  content: FileContent | undefined,
  silent: boolean,
  effects: readonly FileContentEffect[] = [],
) {
  const attempt = state.issued + 1

  const entry: FileEntryState = content
    ? { status: "refreshing", content, attempt, silent, rerun: false }
    : { status: "loading", attempt, silent, rerun: false }

  return changed({ ...put(state, path, entry), issued: attempt }, [
    ...effects,
    { type: "read", directory: state.directory, path, attempt },
  ])
}

function put(state: ActiveState, path: string, entry: FileEntryState): ActiveState {
  return { ...state, files: { ...state.files, [path]: entry } }
}

function changed(state: FileContentState, effects: readonly FileContentEffect[] = []): FileContentTransition {
  return { state, effects }
}

function unchanged(state: FileContentState): FileContentTransition {
  return { state, effects: [] }
}

// The file's state as readers see it; undefined while unloaded or evicted.
export function selectFileState(path: string, entry: FileEntryState | undefined): FileState | undefined {
  if (!entry) return undefined
  const name = getFilename(path)

  if (entry.status === "loading")
    return { status: "loading", path, name, loaded: false, loading: true, notFound: false }

  if (entry.status === "ready") {
    return { status: "ready", path, name, loaded: true, loading: false, notFound: false, content: entry.content }
  }

  if (entry.status === "refreshing") {
    return { status: "refreshing", path, name, loaded: true, loading: true, notFound: false, content: entry.content }
  }

  if (entry.status === "missing") {
    return { status: "missing", path, name, loaded: false, loading: false, notFound: true, error: entry.error }
  }

  return { status: "error", path, name, loaded: false, loading: false, notFound: false, error: entry.error }
}

export function selectFileMissing(entry: FileEntryState | undefined) {
  return entry?.status === "missing"
}

export function selectFileLoading(entry: FileEntryState | undefined) {
  return entry?.status === "loading" || entry?.status === "refreshing"
}
