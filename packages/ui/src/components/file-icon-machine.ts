import type { IconName } from "./file-icons/types"

export const FILE_ICON_LOAD_TIMEOUT_MS = 10_000

export const FILE_ICON_RETRY_DELAY_MS = 2_000

/** Bundled with the component, so they are always in the sprite and stand in for an icon that failed to load. */
export type FallbackIconName = "Document" | "Folder" | "FolderOpen"

/**
 * Lifecycle of one lazy `<symbol>` in the in-document sprite, shared by every mounted icon with that name.
 * `consumers` counts mounted icons. `retried` keeps the fallback on screen while a retry loads, so the icon does not
 * blank between the fallback and the real symbol. `retry: "pending"` means the one automatic retry is scheduled.
 */
export type FileIconSymbolState =
  | { readonly status: "unrequested" }
  | { readonly status: "loading"; readonly attempt: number; readonly consumers: number; readonly retried: boolean }
  | {
      readonly status: "failed"
      readonly attempt: number
      readonly consumers: number
      readonly retry: "pending" | "idle"
    }
  | { readonly status: "ready" }

export type FileIconSymbolEvent =
  | { readonly type: "retained" }
  | { readonly type: "released" }
  | { readonly type: "load.succeeded"; readonly attempt: number; readonly svg: string }
  | { readonly type: "load.failed"; readonly attempt: number }
  | { readonly type: "load.timed-out"; readonly attempt: number }
  | { readonly type: "retry.due"; readonly attempt: number }

export type FileIconSymbolEffect =
  | { readonly type: "load"; readonly attempt: number }
  | { readonly type: "insert-symbol"; readonly svg: string }
  | { readonly type: "schedule-retry"; readonly attempt: number }
  | { readonly type: "cancel-timers" }

export type FileIconSymbolTransition = {
  readonly state: FileIconSymbolState
  readonly effects: readonly FileIconSymbolEffect[]
}

export const INITIAL_FILE_ICON_SYMBOL_STATE: FileIconSymbolState = Object.freeze({ status: "unrequested" })

export const READY_FILE_ICON_SYMBOL_STATE: FileIconSymbolState = Object.freeze({ status: "ready" })

export const FILE_ICON_RETAINED: FileIconSymbolEvent = Object.freeze({ type: "retained" })

export const FILE_ICON_RELEASED: FileIconSymbolEvent = Object.freeze({ type: "released" })

const NONE: readonly FileIconSymbolEffect[] = Object.freeze([])

const CANCEL: readonly FileIconSymbolEffect[] = Object.freeze([{ type: "cancel-timers" }])

const KEEP_UNREQUESTED: FileIconSymbolTransition = Object.freeze({
  state: INITIAL_FILE_ICON_SYMBOL_STATE,
  effects: NONE,
})

const KEEP_READY: FileIconSymbolTransition = Object.freeze({ state: READY_FILE_ICON_SYMBOL_STATE, effects: NONE })

export function transitionFileIconSymbol(
  state: FileIconSymbolState,
  event: FileIconSymbolEvent,
): FileIconSymbolTransition {
  if (state.status === "ready") return KEEP_READY

  if (state.status === "unrequested") {
    if (event.type !== "retained") return KEEP_UNREQUESTED

    return { state: { status: "loading", attempt: 1, consumers: 1, retried: false }, effects: [load(1)] }
  }

  if (state.status === "loading") return transitionLoading(state, event)

  return transitionFailed(state, event)
}

export function chooseFallbackIconName(type: "directory" | "file", expanded: boolean): FallbackIconName {
  if (type === "file") return "Document"

  return expanded ? "FolderOpen" : "Folder"
}

/** The symbol a mounted icon shows: its own once loaded, the fallback after a failure and during the retry. */
export function selectFileIconSymbol(state: FileIconSymbolState, name: IconName, fallback: FallbackIconName): IconName {
  if (state.status === "failed" || (state.status === "loading" && state.retried)) return fallback

  return name
}

function transitionLoading(
  state: Extract<FileIconSymbolState, { status: "loading" }>,
  event: FileIconSymbolEvent,
): FileIconSymbolTransition {
  switch (event.type) {
    case "retained":
      return keep({ ...state, consumers: state.consumers + 1 })
    case "released":
      if (state.consumers === 0) return keep(state)

      return keep({ ...state, consumers: state.consumers - 1 })
    case "load.succeeded":
      if (event.attempt !== state.attempt) return keep(state)

      return { state: READY_FILE_ICON_SYMBOL_STATE, effects: [...CANCEL, { type: "insert-symbol", svg: event.svg }] }
    case "load.failed":
    case "load.timed-out":
      if (event.attempt !== state.attempt) return keep(state)

      // One automatic retry, and only while someone still shows the icon; a later mount retries after that.
      if (!state.retried && state.consumers > 0)
        return {
          state: { status: "failed", attempt: state.attempt, consumers: state.consumers, retry: "pending" },
          effects: [{ type: "schedule-retry", attempt: state.attempt }],
        }

      return {
        state: { status: "failed", attempt: state.attempt, consumers: state.consumers, retry: "idle" },
        effects: CANCEL,
      }
    case "retry.due":
      return keep(state)
  }
}

function transitionFailed(
  state: Extract<FileIconSymbolState, { status: "failed" }>,
  event: FileIconSymbolEvent,
): FileIconSymbolTransition {
  switch (event.type) {
    case "retained":
      if (state.retry === "idle" && state.consumers === 0)
        return {
          state: { status: "loading", attempt: state.attempt + 1, consumers: 1, retried: true },
          effects: [load(state.attempt + 1)],
        }

      return keep({ ...state, consumers: state.consumers + 1 })
    case "released":
      if (state.consumers === 0) return keep(state)

      if (state.consumers === 1 && state.retry === "pending")
        return { state: { ...state, consumers: 0, retry: "idle" }, effects: CANCEL }

      return keep({ ...state, consumers: state.consumers - 1 })
    case "retry.due":
      if (state.retry !== "pending" || event.attempt !== state.attempt) return keep(state)

      return {
        state: { status: "loading", attempt: state.attempt + 1, consumers: state.consumers, retried: true },
        effects: [load(state.attempt + 1)],
      }
    case "load.succeeded":
    case "load.failed":
    case "load.timed-out":
      return keep(state)
  }
}

function load(attempt: number): FileIconSymbolEffect {
  return { type: "load", attempt }
}

function keep(state: FileIconSymbolState): FileIconSymbolTransition {
  return { state, effects: NONE }
}
