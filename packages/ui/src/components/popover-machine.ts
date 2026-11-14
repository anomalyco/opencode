export type PopoverCloseReason = "escape" | "outside" | "control"

/**
 * One popover's open state. `controlled` follows the `open` prop; `uncontrolled` owns it. A controlled popover that
 * asked its owner to close stays open with `pendingDismiss` until the owner answers, so a refused close leaves no
 * reason behind for a later close to read.
 */
export type PopoverState =
  | {
      readonly status: "closed"
      readonly mode: "controlled" | "uncontrolled"
      /** Why it closed, until Kobalte decides where focus returns. Focus stays put after an outside press. */
      readonly closeReason: PopoverCloseReason | null
    }
  | { readonly status: "open"; readonly mode: "uncontrolled" }
  | { readonly status: "open"; readonly mode: "controlled"; readonly pendingDismiss: PopoverCloseReason | null }
  | { readonly status: "disposed" }

export type PopoverEvent =
  /** The `open` prop, read again right after every `onOpenChange` call: a controlled `true` refuses a close. */
  | { readonly type: "props.synced"; readonly open: boolean | undefined }
  /** The shared listener dismissed this popover. */
  | { readonly type: "dismiss"; readonly reason: "escape" | "outside" }
  /** Kobalte asked to open or close, from the trigger or the close button. */
  | { readonly type: "kobalte.changed"; readonly open: boolean }
  | { readonly type: "close-auto-focus.handled" }
  | { readonly type: "disposed" }

export type PopoverEffect = { readonly type: "notify.open"; readonly open: boolean }

export type PopoverTransition = {
  readonly state: PopoverState
  readonly effects: readonly PopoverEffect[]
}

const NO_EFFECTS: readonly PopoverEffect[] = Object.freeze([])

const NOTIFY_OPEN: readonly PopoverEffect[] = Object.freeze([Object.freeze({ type: "notify.open", open: true })])

const NOTIFY_CLOSED: readonly PopoverEffect[] = Object.freeze([Object.freeze({ type: "notify.open", open: false })])

export function createPopoverState(open: boolean | undefined, defaultOpen: boolean | undefined): PopoverState {
  if (open === true) return { status: "open", mode: "controlled", pendingDismiss: null }

  if (open === false) return { status: "closed", mode: "controlled", closeReason: null }

  if (defaultOpen) return { status: "open", mode: "uncontrolled" }

  return { status: "closed", mode: "uncontrolled", closeReason: null }
}

export function transitionPopover(state: PopoverState, event: PopoverEvent): PopoverTransition {
  if (state.status === "disposed") return { state, effects: NO_EFFECTS }

  if (event.type === "disposed") return { state: { status: "disposed" }, effects: NO_EFFECTS }

  if (event.type === "props.synced") return { state: syncProps(state, event.open), effects: NO_EFFECTS }

  if (event.type === "close-auto-focus.handled") {
    if (state.status !== "closed" || state.closeReason === null) return { state, effects: NO_EFFECTS }

    return { state: { status: "closed", mode: state.mode, closeReason: null }, effects: NO_EFFECTS }
  }

  if (event.type === "kobalte.changed" && event.open) {
    if (state.status === "open") return { state, effects: NO_EFFECTS }

    if (state.mode === "controlled") return { state, effects: NOTIFY_OPEN }

    return { state: { status: "open", mode: "uncontrolled" }, effects: NOTIFY_OPEN }
  }

  // A dismiss or Kobalte close from here on.
  if (state.status === "closed") return { state, effects: NO_EFFECTS }

  const reason = event.type === "dismiss" ? event.reason : "control"

  if (state.mode === "uncontrolled") {
    return { state: { status: "closed", mode: "uncontrolled", closeReason: reason }, effects: NOTIFY_CLOSED }
  }

  // Kobalte echoes a close it caused; the owner hears about it once.
  if (state.pendingDismiss !== null) return { state, effects: NO_EFFECTS }

  return { state: { status: "open", mode: "controlled", pendingDismiss: reason }, effects: NOTIFY_CLOSED }
}

export function selectPopoverOpen(state: PopoverState) {
  return state.status === "open"
}

/** An outside press already moved focus where the user wanted it, so closing does not pull it back to the trigger. */
export function selectPreventCloseAutoFocus(state: PopoverState) {
  return state.status === "closed" && state.closeReason === "outside"
}

function syncProps(state: Exclude<PopoverState, { status: "disposed" }>, open: boolean | undefined): PopoverState {
  if (open === undefined) {
    if (state.mode === "uncontrolled") return state

    if (state.status === "open") return { status: "open", mode: "uncontrolled" }

    return { status: "closed", mode: "uncontrolled", closeReason: state.closeReason }
  }

  if (open) {
    if (state.status === "open" && state.mode === "controlled" && state.pendingDismiss === null) return state

    return { status: "open", mode: "controlled", pendingDismiss: null }
  }

  if (state.status === "closed") {
    if (state.mode === "controlled") return state

    return { status: "closed", mode: "controlled", closeReason: state.closeReason }
  }

  return {
    status: "closed",
    mode: "controlled",
    closeReason: state.mode === "controlled" ? (state.pendingDismiss ?? "control") : "control",
  }
}

/** One open popover, and the popover it opened inside (portaled content is outside its parent in the DOM). */
export type PopoverStackEntry = {
  readonly id: number
  readonly parentId: number | null
}

/** Every open popover, in the order they opened. One shared set of window listeners routes Escape and outside presses. */
export type PopoverStackState = { readonly entries: readonly PopoverStackEntry[] }

export type PopoverStackEvent =
  | { readonly type: "layer.opened"; readonly id: number; readonly parentId: number | null }
  | { readonly type: "layer.closed"; readonly id: number }
  | { readonly type: "escape.pressed" }
  /** A press or focus landed; `insideIds` are the open popovers whose trigger or content contains it. */
  | { readonly type: "outside.interacted"; readonly insideIds: ReadonlySet<number> }

export type PopoverStackEffect = {
  readonly type: "dismiss.layer"
  readonly id: number
  readonly reason: "escape" | "outside"
}

export type PopoverStackTransition = {
  readonly state: PopoverStackState
  readonly effects: readonly PopoverStackEffect[]
}

const NO_STACK_EFFECTS: readonly PopoverStackEffect[] = Object.freeze([])

export const EMPTY_POPOVER_STACK: PopoverStackState = Object.freeze({ entries: Object.freeze([]) })

export function transitionPopoverStack(state: PopoverStackState, event: PopoverStackEvent): PopoverStackTransition {
  if (event.type === "layer.opened") {
    if (state.entries.some((entry) => entry.id === event.id)) return { state, effects: NO_STACK_EFFECTS }

    return {
      state: { entries: [...state.entries, { id: event.id, parentId: event.parentId }] },
      effects: NO_STACK_EFFECTS,
    }
  }

  if (event.type === "layer.closed") {
    if (!state.entries.some((entry) => entry.id === event.id)) return { state, effects: NO_STACK_EFFECTS }
    const entries = state.entries.filter((entry) => entry.id !== event.id)

    return { state: entries.length === 0 ? EMPTY_POPOVER_STACK : { entries }, effects: NO_STACK_EFFECTS }
  }

  const top = state.entries.at(-1)

  if (!top) return { state, effects: NO_STACK_EFFECTS }

  if (event.type === "escape.pressed")
    return { state, effects: [{ type: "dismiss.layer", id: top.id, reason: "escape" }] }

  // A press inside a child keeps its ancestors open, even when the child's content is portaled outside them.
  const kept = new Set<number>()

  const keep = (id: number | null): void => {
    if (id === null || kept.has(id)) return
    kept.add(id)
    keep(state.entries.find((entry) => entry.id === id)?.parentId ?? null)
  }

  event.insideIds.forEach(keep)

  return {
    state,
    effects: state.entries
      .filter((entry) => !kept.has(entry.id))
      .reverse()
      .map((entry) => ({ type: "dismiss.layer", id: entry.id, reason: "outside" }) as const),
  }
}
