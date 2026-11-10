import type { ComposerSuggestion } from "../types"

export const MENTION_FILE_DEBOUNCE_MS = 150

// A search that never answers settles as empty, so the menu cannot wait on it forever.
export const MENTION_SEARCH_TIMEOUT_MS = 10_000

/**
 * The file search behind an open `@` menu. While the next query is `debouncing` or `loading`, the previous query's
 * rows stay listed (`settledQuery`, `items`) so the menu keeps its height, but they cannot be picked.
 */
export type MentionFileSearchState =
  | { readonly status: "idle" }
  | {
      readonly status: "debouncing" | "loading"
      readonly attempt: number
      readonly settledQuery: string | undefined
      readonly items: readonly ComposerSuggestion[]
    }
  /** A failed or timed-out search settles with no rows. */
  | { readonly status: "settled"; readonly settledQuery: string; readonly items: readonly ComposerSuggestion[] }

/** The server-side session search for the query's first word; titles then match the whole query locally. */
export type MentionSessionSearchState =
  | { readonly status: "disabled" }
  | { readonly status: "loading"; readonly attempt: number; readonly word: string }
  | { readonly status: "settled"; readonly word: string }

/**
 * The searches an `@` menu runs while it is open.
 * - `closed`: no menu; closing aborts every search, so reopening on the same word searches again.
 * - `active`: the menu shows `query`.
 * - `disposed`: the composer unmounted; late results and timers are ignored.
 */
export type MentionSearchState =
  | { readonly status: "closed"; readonly issued: number }
  | {
      readonly status: "active"
      readonly issued: number
      readonly query: string
      readonly files: MentionFileSearchState
      readonly sessions: MentionSessionSearchState
    }
  | { readonly status: "disposed" }

export type MentionSearchEvent =
  | { readonly type: "context.changed"; readonly query: string; readonly hasSessions: boolean }
  | { readonly type: "context.closed" }
  | { readonly type: "file.debounce.fired"; readonly attempt: number }
  | { readonly type: "file.resolved"; readonly attempt: number; readonly items: readonly ComposerSuggestion[] }
  | { readonly type: "file.failed"; readonly attempt: number }
  | { readonly type: "file.timed-out"; readonly attempt: number }
  | { readonly type: "session.settled"; readonly attempt: number }
  | { readonly type: "session.timed-out"; readonly attempt: number }
  | { readonly type: "disposed" }

/** `file.abort` and `session.abort` also release a settled attempt's timer; aborting a settled request does nothing. */
export type MentionSearchEffect =
  | { readonly type: "file.debounce"; readonly attempt: number; readonly delayMs: number }
  | { readonly type: "file.search"; readonly attempt: number; readonly query: string; readonly timeoutMs: number }
  | { readonly type: "file.abort"; readonly attempt: number }
  | { readonly type: "session.search"; readonly attempt: number; readonly word: string; readonly timeoutMs: number }
  | { readonly type: "session.abort"; readonly attempt: number }

export type MentionSearchTransition = {
  readonly state: MentionSearchState
  readonly effects: readonly MentionSearchEffect[]
}

export const INITIAL_MENTION_SEARCH_STATE: MentionSearchState = Object.freeze({ status: "closed", issued: 0 })

const DISPOSED: MentionSearchState = Object.freeze({ status: "disposed" })

const IDLE_FILES: MentionFileSearchState = Object.freeze({ status: "idle" })

const DISABLED_SESSIONS: MentionSessionSearchState = Object.freeze({ status: "disabled" })

const NO_EFFECTS: readonly MentionSearchEffect[] = Object.freeze([])

const NO_SUGGESTIONS: readonly ComposerSuggestion[] = Object.freeze([])

export function transitionMentionSearch(state: MentionSearchState, event: MentionSearchEvent): MentionSearchTransition {
  if (state.status === "disposed") return stay(state)

  if (event.type === "disposed")
    return { state: DISPOSED, effects: state.status === "active" ? abortSearches(state) : NO_EFFECTS }

  if (event.type === "context.changed") return change(state, event.query, event.hasSessions)

  if (state.status === "closed") return stay(state)

  if (event.type === "context.closed")
    return { state: { status: "closed", issued: state.issued }, effects: abortSearches(state) }

  if (event.type === "session.settled" || event.type === "session.timed-out") {
    if (state.sessions.status !== "loading" || state.sessions.attempt !== event.attempt) return stay(state)

    return {
      state: { ...state, sessions: { status: "settled", word: state.sessions.word } },
      effects: [{ type: "session.abort", attempt: event.attempt }],
    }
  }

  const files = state.files

  if (event.type === "file.debounce.fired") {
    if (files.status !== "debouncing" || files.attempt !== event.attempt) return stay(state)

    return {
      state: { ...state, files: { ...files, status: "loading" } },
      effects: [
        { type: "file.search", attempt: event.attempt, query: state.query, timeoutMs: MENTION_SEARCH_TIMEOUT_MS },
      ],
    }
  }

  if (files.status !== "loading" || files.attempt !== event.attempt) return stay(state)

  return {
    state: {
      ...state,
      files: {
        status: "settled",
        settledQuery: state.query,
        items: event.type === "file.resolved" ? event.items : NO_SUGGESTIONS,
      },
    },
    effects: [{ type: "file.abort", attempt: event.attempt }],
  }
}

/** The file rows to list: the current query's, or the previous query's while the next search runs. */
export function selectMentionFiles(state: MentionSearchState) {
  return state.status === "active" && state.files.status !== "idle" ? state.files.items : NO_SUGGESTIONS
}

/** Whether listed file rows belong to an earlier query, so the keyboard cannot highlight or pick them. */
export function isMentionFileStale(state: MentionSearchState, query: string) {
  return state.status !== "active" || state.files.status === "idle" || state.files.settledQuery !== query
}

/** Whether the session search for this query has yet to settle, so the menu must not close as empty yet. */
export function selectMentionSessionsPending(state: MentionSearchState, query: string, hasSessions: boolean) {
  if (!hasSessions || state.status === "disposed") return false

  if (state.status === "closed") return true

  if (state.sessions.status === "disabled") return false

  if (state.sessions.word !== mentionSearchWord(query)) return true

  return state.sessions.status === "loading"
}

/** The server narrows sessions by the first word. */
export function mentionSearchWord(query: string) {
  return query.toLowerCase().split(" ")[0] ?? ""
}

function change(
  state: Exclude<MentionSearchState, { status: "disposed" }>,
  query: string,
  hasSessions: boolean,
): MentionSearchTransition {
  const active = state.status === "active" ? state : undefined

  if (active?.query === query && (active.sessions.status !== "disabled") === hasSessions) return stay(state)
  const effects: MentionSearchEffect[] = []
  const issued = { value: state.issued }
  const files = active?.query === query ? active.files : nextFiles(active?.files ?? IDLE_FILES, query, issued, effects)
  const previous = active?.sessions ?? DISABLED_SESSIONS
  const word = mentionSearchWord(query)

  const keep = hasSessions && previous.status !== "disabled" && previous.word === word

  if (!keep && previous.status === "loading") effects.push({ type: "session.abort", attempt: previous.attempt })

  const sessions = keep ? previous : hasSessions ? startSessions(word, issued, effects) : DISABLED_SESSIONS

  return { state: { status: "active", issued: issued.value, query, files, sessions }, effects }
}

function nextFiles(
  previous: MentionFileSearchState,
  query: string,
  issued: { value: number },
  effects: MentionSearchEffect[],
): MentionFileSearchState {
  if (previous.status === "debouncing" || previous.status === "loading")
    effects.push({ type: "file.abort", attempt: previous.attempt })

  // Only paths are searched: an empty query lists recent files, and a space means prose or a session title.
  if (!query.trim() || /\s/.test(query)) return IDLE_FILES
  const attempt = ++issued.value
  effects.push({ type: "file.debounce", attempt, delayMs: MENTION_FILE_DEBOUNCE_MS })

  return previous.status === "idle"
    ? { status: "debouncing", attempt, settledQuery: undefined, items: NO_SUGGESTIONS }
    : { status: "debouncing", attempt, settledQuery: previous.settledQuery, items: previous.items }
}

function startSessions(
  word: string,
  issued: { value: number },
  effects: MentionSearchEffect[],
): MentionSessionSearchState {
  const attempt = ++issued.value
  effects.push({ type: "session.search", attempt, word, timeoutMs: MENTION_SEARCH_TIMEOUT_MS })

  return { status: "loading", attempt, word }
}

function abortSearches(state: Extract<MentionSearchState, { status: "active" }>) {
  const files: readonly MentionSearchEffect[] =
    state.files.status === "debouncing" || state.files.status === "loading"
      ? [{ type: "file.abort", attempt: state.files.attempt }]
      : NO_EFFECTS

  return state.sessions.status === "loading"
    ? [...files, { type: "session.abort" as const, attempt: state.sessions.attempt }]
    : files
}

function stay(state: MentionSearchState): MentionSearchTransition {
  return { state, effects: NO_EFFECTS }
}
