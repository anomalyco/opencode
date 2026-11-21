import type { PaneElement } from "./ipc"

// The page's element picker and its highlights, folded from the window's requests and CDP's answers. Electron-free so
// it stays unit-testable under Bun. Every arm, description and flash takes the next attempt number, so an answer whose
// attempt the state no longer holds is stale.

/** How long each phase may last before its timeout ends it. */
export const PICKER_TIMEOUT_MS = {
  /** Chromium answers Overlay.setInspectMode at once; past this the picker counts as failed to start. */
  arming: 2_000,
  /** Describing a picked element reads the DOM, layout and accessibility tree; past this the pick is dropped. */
  describing: 5_000,
  /** How long a revealed element stays highlighted. */
  flashing: 1_500,
}

/** A picked element: its backend node, the frame it is in, and the CDP session of that frame's target. */
export type PickerTarget = { readonly backendID: number; readonly frameID: string; readonly sessionID?: string }

export type PickerState =
  | { readonly status: "off"; readonly attempt: number }
  /** Overlay.setInspectMode is on its way; the window hears the picker is on only once it is. */
  | { readonly status: "arming"; readonly attempt: number }
  | { readonly status: "armed"; readonly attempt: number }
  /** The user clicked an element, which is being described for the comment editor. */
  | { readonly status: "describing"; readonly attempt: number }
  /** A picked element highlighted for PICKER_FLASH_MS, as a comment reveals it. */
  | { readonly status: "flashing"; readonly attempt: number }
  | { readonly status: "closed" }

export type PickerEvent =
  /** The window turns the picker on or off. */
  | { readonly type: "inspect.set"; readonly enabled: boolean }
  /** The DevTools chord pressed in the page. */
  | { readonly type: "inspect.toggled" }
  | { readonly type: "escape.pressed" }
  /** An agent command sends input that the picker would take as a pick. */
  | { readonly type: "pointer.command" }
  /** The page started showing another document. */
  | { readonly type: "document.changed" }
  /** The embed hid: a hidden page cannot be picked from, and a comment's still already shows the element. */
  | { readonly type: "embed.hidden" }
  | { readonly type: "frame.attached"; readonly sessionID: string }
  | { readonly type: "arm.succeeded"; readonly attempt: number }
  | { readonly type: "arm.failed"; readonly attempt: number }
  | { readonly type: "node.picked"; readonly backendID: number; readonly sessionID?: string }
  | {
      readonly type: "describe.succeeded"
      readonly attempt: number
      readonly target: PickerTarget
      readonly element: PickedElement
    }
  | { readonly type: "describe.failed"; readonly attempt: number }
  /** The window highlights a picked element, or clears the highlight with none. */
  | { readonly type: "highlight.requested"; readonly target: PickerTarget | undefined }
  | { readonly type: "flash.shown"; readonly attempt: number }
  | { readonly type: "flash.failed"; readonly attempt: number }
  | { readonly type: "timeout"; readonly phase: "arming" | "describing" | "flashing"; readonly attempt: number }
  | { readonly type: "disposed" }

/** What the comment editor shows of a picked element, without its ref, which is handed out once the pick holds. */
export type PickedElement = Omit<PaneElement, "ref">

export type PickerEffect =
  | { readonly type: "arm"; readonly attempt: number }
  | { readonly type: "arm-frame"; readonly attempt: number; readonly sessionID: string }
  | { readonly type: "disarm" }
  | { readonly type: "describe"; readonly attempt: number; readonly backendID: number; readonly sessionID?: string }
  /** Hands out the pick's ref and reports the element to the window. */
  | { readonly type: "pick"; readonly target: PickerTarget; readonly element: PickedElement }
  | { readonly type: "flash"; readonly attempt: number; readonly target: PickerTarget }
  | { readonly type: "hide-highlight" }
  | { readonly type: "report"; readonly active: boolean }
  | { readonly type: "timer"; readonly phase: "arming" | "describing" | "flashing"; readonly attempt: number }

export type PickerTransition = { readonly state: PickerState; readonly effects: readonly PickerEffect[] }

type Open = Exclude<PickerState, { status: "closed" }>

export const initialPickerState: PickerState = { status: "off", attempt: 0 }

const CLOSED: PickerState = { status: "closed" }

const DISARM: PickerEffect = { type: "disarm" }

const HIDE: PickerEffect = { type: "hide-highlight" }

const ON: PickerEffect = { type: "report", active: true }

const OFF: PickerEffect = { type: "report", active: false }

export function transitionPicker(state: PickerState, event: PickerEvent): PickerTransition {
  if (state.status === "closed") return unchanged(state)

  switch (event.type) {
    case "disposed":
      return { state: CLOSED, effects: [] }
    case "inspect.set":
      if (!event.enabled) return state.status === "off" ? { state, effects: [OFF] } : stop(state)

      if (state.status === "armed") return { state, effects: [ON] }

      return state.status === "arming" ? unchanged(state) : arm(state)
    case "inspect.toggled":
      return isPickerActive(state) ? stop(state) : arm(state)
    case "escape.pressed":
    case "pointer.command":
      return isPickerActive(state) ? stop(state) : unchanged(state)
    case "document.changed":
    case "embed.hidden":
      return state.status === "off" ? unchanged(state) : stop(state)
    case "frame.attached":
      if (!isPickerActive(state)) return unchanged(state)

      return { state, effects: [{ type: "arm-frame", attempt: state.attempt, sessionID: event.sessionID }] }
    case "arm.succeeded":
      if (state.status !== "arming" || event.attempt !== state.attempt) return unchanged(state)

      return { state: { status: "armed", attempt: state.attempt }, effects: [ON] }
    case "arm.failed":
      return state.status === "arming" && event.attempt === state.attempt ? stop(state) : unchanged(state)
    case "node.picked": {
      if (!isPickerActive(state)) return unchanged(state)
      const attempt = state.attempt + 1

      return {
        state: { status: "describing", attempt },
        effects: [
          { type: "timer", phase: "describing", attempt },
          { type: "describe", attempt, backendID: event.backendID, sessionID: event.sessionID },
        ],
      }
    }

    case "describe.succeeded":
      if (state.status === "describing" && event.attempt === state.attempt)
        return {
          state: { status: "off", attempt: state.attempt },
          effects: [{ type: "pick", target: event.target, element: event.element }],
        }

      return stale(state)
    case "describe.failed":
      return state.status === "describing" && event.attempt === state.attempt ? stop(state) : stale(state)
    case "highlight.requested":
      if (event.target) return flash(state, event.target)

      // Clearing a comment's highlight leaves a running picker and a pick being described alone.
      return state.status === "off" || state.status === "flashing" ? stop(state) : unchanged(state)
    case "flash.shown":
      if (state.status !== "flashing" || event.attempt !== state.attempt) return unchanged(state)

      return { state, effects: [{ type: "timer", phase: "flashing", attempt: state.attempt }] }
    case "flash.failed":
      return state.status === "flashing" && event.attempt === state.attempt ? stop(state) : unchanged(state)
    case "timeout":
      return state.status === event.phase && event.attempt === state.attempt ? stop(state) : unchanged(state)
  }
}

/** The picker waits for a click: Escape and agent input stop it. */
export function isPickerActive(state: PickerState) {
  return state.status === "arming" || state.status === "armed"
}

/** The attempt a driver checks before an answer changes the page; none once closed. */
export function pickerAttempt(state: PickerState) {
  return state.status === "closed" ? -1 : state.attempt
}

function arm(state: Open): PickerTransition {
  const attempt = state.attempt + 1

  return {
    state: { status: "arming", attempt },
    effects: [
      { type: "timer", phase: "arming", attempt },
      { type: "arm", attempt },
    ],
  }
}

/** Ends whatever runs: a running picker is disarmed, any highlight hides, and the window hears the picker is off. */
function stop(state: Open): PickerTransition {
  const next: PickerState = { status: "off", attempt: state.attempt + 1 }

  if (isPickerActive(state)) return { state: next, effects: [DISARM, HIDE, OFF] }

  if (state.status === "describing") return { state: next, effects: [HIDE, OFF] }

  return { state: next, effects: [HIDE] }
}

/** A highlight for a picked element ends the picker, as the element is already chosen. */
function flash(state: Open, target: PickerTarget): PickerTransition {
  const attempt = state.attempt + 1

  const ended: readonly PickerEffect[] = isPickerActive(state)
    ? [DISARM, OFF]
    : state.status === "describing"
      ? [OFF]
      : []

  return { state: { status: "flashing", attempt }, effects: [...ended, { type: "flash", attempt, target }] }
}

/** A description that finished after its pick was cancelled may have highlighted the element; an idle page hides it. */
function stale(state: Open): PickerTransition {
  return state.status === "off" ? { state, effects: [HIDE] } : unchanged(state)
}

function unchanged(state: PickerState): PickerTransition {
  return { state, effects: [] }
}
