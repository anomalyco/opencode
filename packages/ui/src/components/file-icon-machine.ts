import type { IconName } from "./file-icons/types"

export const FILE_ICON_LOAD_TIMEOUT_MS = 10_000

/** Bundled with the component, so they are always in the sprite and stand in for an icon that failed to load. */
export type FallbackIconName = "Document" | "Folder" | "FolderOpen"

/**
 * Lifecycle of one lazy `<symbol>` in the in-document sprite, shared by every mounted icon with that name. It only
 * moves forward: Chromium keeps a failed dynamic import failed for the page's lifetime, so a retry cannot succeed.
 */
export type FileIconSymbolState = { readonly status: "unrequested" | "loading" | "failed" | "ready" }

export type FileIconSymbolEvent =
  | { readonly type: "requested" }
  | { readonly type: "load.succeeded"; readonly svg: string }
  | { readonly type: "load.failed" }
  | { readonly type: "load.timed-out" }

export type FileIconSymbolEffect =
  | { readonly type: "load" }
  | { readonly type: "insert-symbol"; readonly svg: string }
  | { readonly type: "cancel-timeout" }

export type FileIconSymbolTransition = {
  readonly state: FileIconSymbolState
  readonly effects: readonly FileIconSymbolEffect[]
}

const UNREQUESTED: FileIconSymbolState = Object.freeze({ status: "unrequested" })

const LOADING: FileIconSymbolState = Object.freeze({ status: "loading" })

const FAILED: FileIconSymbolState = Object.freeze({ status: "failed" })

const READY: FileIconSymbolState = Object.freeze({ status: "ready" })

export const INITIAL_FILE_ICON_SYMBOL_STATE = UNREQUESTED

export const READY_FILE_ICON_SYMBOL_STATE = READY

export const FILE_ICON_REQUESTED: FileIconSymbolEvent = Object.freeze({ type: "requested" })

const NONE: readonly FileIconSymbolEffect[] = Object.freeze([])

const LOAD: readonly FileIconSymbolEffect[] = Object.freeze([{ type: "load" }])

const CANCEL: readonly FileIconSymbolEffect[] = Object.freeze([{ type: "cancel-timeout" }])

export function transitionFileIconSymbol(
  state: FileIconSymbolState,
  event: FileIconSymbolEvent,
): FileIconSymbolTransition {
  if (state.status === "unrequested" && event.type === "requested") return { state: LOADING, effects: LOAD }

  // A symbol that arrives after its timeout still upgrades the icons showing the fallback.
  if ((state.status === "loading" || state.status === "failed") && event.type === "load.succeeded")
    return {
      state: READY,
      effects: [...(state.status === "loading" ? CANCEL : NONE), { type: "insert-symbol", svg: event.svg }],
    }

  if (state.status === "loading" && (event.type === "load.failed" || event.type === "load.timed-out"))
    return { state: FAILED, effects: CANCEL }

  return { state, effects: NONE }
}

export function chooseFallbackIconName(type: "directory" | "file", expanded: boolean): FallbackIconName {
  if (type === "file") return "Document"

  return expanded ? "FolderOpen" : "Folder"
}

/** The symbol a mounted icon shows: its own unless it failed to load. */
export function selectFileIconSymbol(state: FileIconSymbolState, name: IconName, fallback: FallbackIconName): IconName {
  return state.status === "failed" ? fallback : name
}
