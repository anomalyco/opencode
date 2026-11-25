/** How long one file search may take before the browser shows it failed, so a wedged server never loads forever. */
export const FILE_SEARCH_TIMEOUT_MS = 10_000

/** The workspace a search reads. Results never carry over to another. */
export type FileSearchScope = { readonly serverID: string; readonly root: string }

export type FileSearchContext = {
  readonly scope: FileSearchScope
  readonly connected: boolean
  /** The trimmed filter text; empty shows the tree. */
  readonly query: string
}

export type FileSearchFailure = { readonly type: "rejected"; readonly message: string } | { readonly type: "timeout" }

/** The last results of the same workspace, shown dimmed and inert while the next query loads. */
export type FileSearchPrevious = { readonly query: string; readonly files: readonly string[] }

export type FileSearchState =
  | { readonly status: "idle"; readonly attempt: number }
  /** The server is unreachable; the search runs once it reconnects. */
  | { readonly status: "offline"; readonly scope: FileSearchScope; readonly query: string; readonly attempt: number }
  | {
      readonly status: "searching"
      readonly scope: FileSearchScope
      readonly query: string
      readonly attempt: number
      readonly previous: FileSearchPrevious | undefined
    }
  | {
      readonly status: "ready"
      readonly scope: FileSearchScope
      readonly query: string
      readonly connected: boolean
      readonly attempt: number
      readonly files: readonly string[]
    }
  | {
      readonly status: "error"
      readonly scope: FileSearchScope
      readonly query: string
      readonly attempt: number
      readonly failure: FileSearchFailure
    }
  | { readonly status: "disposed"; readonly attempt: number }

export type FileSearchEvent =
  | { readonly type: "context.changed"; readonly context: FileSearchContext }
  | { readonly type: "retry" }
  | { readonly type: "search.succeeded"; readonly attempt: number; readonly files: readonly string[] }
  | { readonly type: "search.failed"; readonly attempt: number; readonly message: string }
  | { readonly type: "search.timed-out"; readonly attempt: number }
  | { readonly type: "disposed" }

export type FileSearchEffect =
  | {
      readonly type: "search"
      readonly scope: FileSearchScope
      readonly query: string
      readonly attempt: number
      readonly timeoutMs: number
    }
  | { readonly type: "abort"; readonly attempt: number }

export type FileSearchTransition = { readonly state: FileSearchState; readonly effects: readonly FileSearchEffect[] }

/** What the browser's sidebar shows. Only `results` that are not `stale` take a pick. */
export type FileSearchView =
  | { readonly status: "tree" }
  | { readonly status: "loading" }
  | { readonly status: "offline" }
  | { readonly status: "error"; readonly failure: FileSearchFailure }
  | { readonly status: "results"; readonly files: readonly string[]; readonly stale: boolean }

export const INITIAL_FILE_SEARCH_STATE: FileSearchState = { status: "idle", attempt: 0 }

const TREE: FileSearchView = { status: "tree" }

const LOADING: FileSearchView = { status: "loading" }

const OFFLINE: FileSearchView = { status: "offline" }

const NONE: readonly FileSearchEffect[] = []

export function transitionFileSearch(state: FileSearchState, event: FileSearchEvent): FileSearchTransition {
  if (state.status === "disposed") return unchanged(state)

  if (event.type === "disposed") return leave(state, { status: "disposed", attempt: state.attempt })

  if (event.type === "context.changed") return contextChanged(state, event.context)

  if (event.type === "retry")
    return state.status === "error" ? search(state, state.scope, state.query, undefined) : unchanged(state)

  if (state.status !== "searching" || event.attempt !== state.attempt) return unchanged(state)

  if (event.type === "search.succeeded")
    return changed({
      status: "ready",
      scope: state.scope,
      query: state.query,
      connected: true,
      attempt: state.attempt,
      files: [...new Set(event.files)],
    })

  const failed: FileSearchState = {
    status: "error",
    scope: state.scope,
    query: state.query,
    attempt: state.attempt,
    failure: event.type === "search.timed-out" ? { type: "timeout" } : { type: "rejected", message: event.message },
  }

  return event.type === "search.timed-out"
    ? { state: failed, effects: [{ type: "abort", attempt: state.attempt }] }
    : changed(failed)
}

export function fileSearchView(state: FileSearchState): FileSearchView {
  if (state.status === "idle" || state.status === "disposed") return TREE

  if (state.status === "offline") return OFFLINE

  if (state.status === "error") return { status: "error", failure: state.failure }

  if (state.status === "ready") return { status: "results", files: state.files, stale: false }

  return state.previous ? { status: "results", files: state.previous.files, stale: true } : LOADING
}

export function sameFileSearchContext(a: FileSearchContext, b: FileSearchContext) {
  return a.query === b.query && a.connected === b.connected && sameScope(a.scope, b.scope)
}

function contextChanged(state: Exclude<FileSearchState, { status: "disposed" }>, context: FileSearchContext) {
  if (!context.query)
    return state.status === "idle" ? unchanged(state) : leave(state, { status: "idle", attempt: state.attempt })

  const scope = context.scope
  const query = context.query
  const same = "scope" in state && sameScope(state.scope, scope) && state.query === query

  if (!context.connected) {
    // Results already shown stay shown; they reload once the server is back.
    if (same && state.status === "ready")
      return state.connected ? changed({ ...state, connected: false }) : unchanged(state)

    if (same && state.status === "offline") return unchanged(state)

    return leave(state, { status: "offline", scope, query, attempt: state.attempt })
  }

  if (same) {
    if (state.status === "searching" || state.status === "error") return unchanged(state)

    if (state.status === "ready" && state.connected) return unchanged(state)
  }

  // A new query keeps the same workspace's last results on screen, inert, until its own arrive.
  return search(state, scope, query, previousFor(state, scope))
}

function previousFor(state: FileSearchState, scope: FileSearchScope): FileSearchPrevious | undefined {
  if (state.status === "ready" && sameScope(state.scope, scope)) return { query: state.query, files: state.files }

  if (state.status === "searching" && sameScope(state.scope, scope)) return state.previous

  return undefined
}

function search(
  state: FileSearchState,
  scope: FileSearchScope,
  query: string,
  previous: FileSearchPrevious | undefined,
): FileSearchTransition {
  const attempt = state.attempt + 1
  const begin: FileSearchEffect = { type: "search", scope, query, attempt, timeoutMs: FILE_SEARCH_TIMEOUT_MS }

  return {
    state: { status: "searching", scope, query, attempt, previous },
    effects: state.status === "searching" ? [{ type: "abort", attempt: state.attempt }, begin] : [begin],
  }
}

/** Moves to a state that runs no search, ending the running one. */
function leave(state: FileSearchState, next: FileSearchState): FileSearchTransition {
  return { state: next, effects: state.status === "searching" ? [{ type: "abort", attempt: state.attempt }] : NONE }
}

function sameScope(a: FileSearchScope, b: FileSearchScope) {
  return a.serverID === b.serverID && a.root === b.root
}

function changed(state: FileSearchState): FileSearchTransition {
  return { state, effects: NONE }
}

function unchanged(state: FileSearchState): FileSearchTransition {
  return { state, effects: NONE }
}
