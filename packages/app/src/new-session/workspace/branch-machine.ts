/** A preload or revalidation that has not answered by then fails, so the picker can offer Retry. */
export const BRANCH_PRELOAD_TIMEOUT_MS = 10_000

export type BranchList = {
  readonly items: string[]
  readonly failed: boolean
}

/**
 * The base-branch picker of a "New worktree" draft. Branches preload before the popover opens, so it never shows a
 * smaller loading panel: opening during `loading` holds the popover open (`open: true`) until they arrive. In `ready`,
 * every open revalidates while the loaded list stays on screen (`refreshing`). `popover: "outside"` is an open picker
 * the user clicked or focused away from; it closes without moving focus back to the composer.
 */
export type BranchPickerState =
  | { readonly status: "inactive"; readonly attempt: number }
  | { readonly status: "loading"; readonly directory: string; readonly attempt: number; readonly open: boolean }
  | {
      readonly status: "ready"
      readonly directory: string
      readonly attempt: number
      readonly initial: BranchList
      readonly refreshing: boolean
      readonly popover: "closed" | "open" | "outside"
    }
  | { readonly status: "disposed" }

export type BranchPickerEvent =
  /** The project root while the draft creates a worktree, otherwise `undefined`. */
  | { readonly type: "target.changed"; readonly directory: string | undefined }
  | { readonly type: "open.change"; readonly open: boolean }
  | { readonly type: "command.select"; readonly source: string | undefined }
  /** A pointer, focus, blur or Escape outside the trigger while the popover waits for branches. */
  | { readonly type: "pending.dismiss" }
  | { readonly type: "interact.outside" }
  | { readonly type: "branch.selected"; readonly branch: string }
  | { readonly type: "branches.loaded"; readonly attempt: number; readonly items: string[] }
  | { readonly type: "branches.failed"; readonly attempt: number }
  | { readonly type: "branches.timed-out"; readonly attempt: number }
  /** The open picker's own empty-query search answered; it supersedes a revalidation still in flight. */
  | { readonly type: "branches.synced"; readonly directory: string; readonly items: string[] }
  | { readonly type: "disposed" }

export type BranchPickerEffect =
  | { readonly type: "branches.fetch"; readonly attempt: number; readonly directory: string }
  | { readonly type: "branches.abort"; readonly attempt: number }
  | { readonly type: "branch.choose"; readonly branch: string }
  | { readonly type: "focus.composer" }

export type BranchPickerTransition = {
  readonly state: BranchPickerState
  readonly effects: readonly BranchPickerEffect[]
}

type LiveState = Exclude<BranchPickerState, { status: "disposed" }>

type ReadyState = Extract<BranchPickerState, { status: "ready" }>

export const INITIAL_BRANCH_PICKER_STATE: BranchPickerState = Object.freeze({ status: "inactive", attempt: 0 })

const DISPOSED: BranchPickerState = Object.freeze({ status: "disposed" })

const NONE: readonly BranchPickerEffect[] = Object.freeze([])

const FOCUS: BranchPickerEffect = Object.freeze({ type: "focus.composer" })

export function transitionBranchPicker(state: BranchPickerState, event: BranchPickerEvent): BranchPickerTransition {
  if (state.status === "disposed") return unchanged(state)

  if (event.type === "disposed") return { state: DISPOSED, effects: abort(state) }

  if (event.type === "target.changed") return retarget(state, event.directory)

  if (state.status === "inactive") return unchanged(state)

  if (event.type === "open.change") return event.open ? open(state) : close(state)

  if (event.type === "command.select") {
    if (!selectBranchPopoverOpen(state)) return open(state)

    // The palette reopens the picker it was opened over; the shortcut toggles it.
    if (event.source === "palette") return unchanged(state)

    return closed(state, [FOCUS])
  }

  if (event.type === "pending.dismiss") return state.status === "loading" ? close(state) : unchanged(state)

  if (event.type === "branches.loaded") return settle(state, event.attempt, { items: event.items, failed: false })

  if (event.type === "branches.failed") return settle(state, event.attempt, undefined)

  if (event.type === "branches.timed-out") {
    const next = settle(state, event.attempt, undefined)

    return next.state === state
      ? next
      : { state: next.state, effects: [{ type: "branches.abort", attempt: event.attempt }] }
  }

  if (state.status !== "ready") return unchanged(state)

  if (event.type === "interact.outside")
    return state.popover === "open" ? { state: { ...state, popover: "outside" }, effects: NONE } : unchanged(state)

  if (event.type === "branch.selected") {
    if (state.popover === "closed") return unchanged(state)

    return closed(state, [{ type: "branch.choose", branch: event.branch }, FOCUS])
  }

  if (event.directory !== state.directory) return unchanged(state)

  return {
    state: { ...state, initial: { items: event.items, failed: false }, refreshing: false },
    effects: abort(state),
  }
}

/** Kobalte's `open`: the popover is open, or held open until branches arrive. */
export function selectBranchPopoverOpen(state: BranchPickerState) {
  if (state.status === "loading") return state.open

  return state.status === "ready" && state.popover !== "closed"
}

/** The popover is held open without content, so Kobalte has no dismissable layer yet. */
export function selectBranchPending(state: BranchPickerState) {
  return state.status === "loading" && state.open
}

export function selectBranchBusy(state: BranchPickerState) {
  return state.status === "loading" || (state.status === "ready" && state.refreshing)
}

/** The list the popover opens on; kept through a close so the content can animate out. */
export function selectBranchInitial(state: BranchPickerState) {
  return state.status === "ready" ? state.initial : undefined
}

// A new target drops the previous root's request and list, and closes the picker.
function retarget(state: LiveState, directory: string | undefined): BranchPickerTransition {
  if (directory === undefined) {
    if (state.status === "inactive") return unchanged(state)

    return { state: { status: "inactive", attempt: state.attempt }, effects: abort(state) }
  }

  if (state.status !== "inactive" && state.directory === directory) return unchanged(state)

  const attempt = state.attempt + 1

  return {
    state: { status: "loading", directory, attempt, open: false },
    effects: [...abort(state), { type: "branches.fetch", attempt, directory }],
  }
}

// Every open revalidates the loaded list.
function open(state: Exclude<LiveState, { status: "inactive" }>): BranchPickerTransition {
  if (state.status === "loading")
    return state.open ? unchanged(state) : { state: { ...state, open: true }, effects: NONE }

  if (state.popover !== "closed") return unchanged(state)

  const attempt = state.attempt + 1

  return {
    state: { ...state, attempt, refreshing: true, popover: "open" },
    effects: [...abort(state), { type: "branches.fetch", attempt, directory: state.directory }],
  }
}

function close(state: Exclude<LiveState, { status: "inactive" }>): BranchPickerTransition {
  if (state.status === "loading")
    return state.open ? { state: { ...state, open: false }, effects: NONE } : unchanged(state)

  if (state.popover === "closed") return unchanged(state)

  // An outside click or focus keeps focus where the user put it.
  return closed(state, state.popover === "outside" ? NONE : [FOCUS])
}

function closed(
  state: Exclude<LiveState, { status: "inactive" }>,
  effects: readonly BranchPickerEffect[],
): BranchPickerTransition {
  if (state.status === "loading") return { state: { ...state, open: false }, effects }

  return { state: { ...state, popover: "closed" }, effects }
}

// A failed revalidation keeps the list on screen; only a failed preload offers Retry.
function settle(
  state: Exclude<LiveState, { status: "inactive" }>,
  attempt: number,
  list: BranchList | undefined,
): BranchPickerTransition {
  if (state.attempt !== attempt) return unchanged(state)

  if (state.status === "loading") {
    const next: ReadyState = {
      status: "ready",
      directory: state.directory,
      attempt,
      initial: list ?? { items: [], failed: true },
      refreshing: false,
      popover: state.open ? "open" : "closed",
    }

    return { state: next, effects: NONE }
  }

  if (!state.refreshing) return unchanged(state)

  return { state: { ...state, initial: list ?? state.initial, refreshing: false }, effects: NONE }
}

function abort(state: LiveState): BranchPickerEffect[] {
  if (state.status === "loading" || (state.status === "ready" && state.refreshing))
    return [{ type: "branches.abort", attempt: state.attempt }]

  return []
}

function unchanged(state: BranchPickerState): BranchPickerTransition {
  return { state, effects: NONE }
}
