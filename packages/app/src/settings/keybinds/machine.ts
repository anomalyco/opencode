/** A command chord takes at most this many strokes; its row offers no + past that. */
export const MAX_CHORD_STROKES = 4

/** A key pressed while recording, classified by the driver; a stroke carries the commands its chord would clash with. */
export type RecordedKeyInput =
  | { readonly kind: "escape" }
  | { readonly kind: "backspace" }
  | { readonly kind: "modifier-only" }
  | { readonly kind: "stroke"; readonly stroke: string; readonly conflictTitles: readonly string[] }

/**
 * Recording a shortcut. Global shortcuts stay suspended exactly while `capturing`. Each pressed key saves the chord
 * at once: `prefix` holds the strokes it extends, from +. `idle.recent` is the row just saved,
 * which offers + to add a key.
 */
export type KeybindCaptureState =
  | { readonly status: "idle"; readonly recent?: string }
  | { readonly status: "capturing"; readonly id: string; readonly prefix: readonly string[] }
  | { readonly status: "disposed" }

export type KeybindCaptureEvent =
  /** `pageActive`: whether the Shortcuts page shows; a hidden page never starts recording. */
  | { readonly type: "capture.toggled"; readonly id: string; readonly pageActive: boolean }
  /** + on a row: the next key is added to `chord`, the row's current shortcut. */
  | { readonly type: "capture.extended"; readonly id: string; readonly chord: string; readonly pageActive: boolean }
  /** Focus moved into a text field, such as a search box: typing there is not a shortcut. */
  | { readonly type: "capture.cancelled" }
  | { readonly type: "unbind.clicked"; readonly id: string }
  | { readonly type: "reset.clicked" }
  | { readonly type: "key.pressed"; readonly input: RecordedKeyInput }
  | { readonly type: "page.synced"; readonly active: boolean }
  | { readonly type: "catalog.synced"; readonly ids: ReadonlySet<string> }
  | { readonly type: "disposed" }

export type KeybindCaptureEffect =
  | { readonly type: "keybinds.suspend" }
  | { readonly type: "keybinds.resume" }
  | { readonly type: "binding.set"; readonly id: string; readonly value: string }
  | { readonly type: "bindings.reset" }
  | { readonly type: "notify.conflict"; readonly keybind: string; readonly conflictTitles: readonly string[] }
  | { readonly type: "notify.reset" }

export type KeybindCaptureTransition = {
  readonly state: KeybindCaptureState
  readonly effects: readonly KeybindCaptureEffect[]
}

export const INITIAL_KEYBIND_CAPTURE_STATE: KeybindCaptureState = Object.freeze({ status: "idle" })

const DISPOSED: KeybindCaptureState = Object.freeze({ status: "disposed" })

const NONE: readonly KeybindCaptureEffect[] = Object.freeze([])

const NO_STROKES: readonly string[] = Object.freeze([])

const SUSPEND: KeybindCaptureEffect = Object.freeze({ type: "keybinds.suspend" })

const RESUME: KeybindCaptureEffect = Object.freeze({ type: "keybinds.resume" })

export function transitionKeybindCapture(
  state: KeybindCaptureState,
  event: KeybindCaptureEvent,
): KeybindCaptureTransition {
  if (state.status === "disposed") return { state, effects: NONE }

  const capturing = state.status === "capturing"
  const stop = capturing ? [RESUME] : NONE

  if (event.type === "disposed") return { state: DISPOSED, effects: stop }

  if (event.type === "unbind.clicked")
    return { state: INITIAL_KEYBIND_CAPTURE_STATE, effects: [...unbind(event.id), ...stop] }

  if (event.type === "reset.clicked")
    return {
      state: INITIAL_KEYBIND_CAPTURE_STATE,
      effects: [...stop, { type: "bindings.reset" }, { type: "notify.reset" }],
    }

  if (event.type === "capture.toggled" || event.type === "capture.extended") {
    const prefix = event.type === "capture.extended" ? event.chord.split(" ").filter(Boolean) : NO_STROKES

    if (!capturing) {
      if (!event.pageActive) return { state, effects: NONE }

      return { state: { status: "capturing", id: event.id, prefix }, effects: [SUSPEND] }
    }

    // Moving to another row, or extending one, keeps shortcuts suspended instead of resuming them for a moment.
    if ((state.id !== event.id || event.type === "capture.extended") && event.pageActive)
      return { state: { status: "capturing", id: event.id, prefix }, effects: NONE }

    return { state: INITIAL_KEYBIND_CAPTURE_STATE, effects: stop }
  }

  if (!capturing) return { state, effects: NONE }

  if (event.type === "capture.cancelled") return { state: INITIAL_KEYBIND_CAPTURE_STATE, effects: stop }

  if (event.type === "page.synced")
    return event.active ? { state, effects: NONE } : { state: INITIAL_KEYBIND_CAPTURE_STATE, effects: stop }

  // A plugin removed while its command was recording.
  if (event.type === "catalog.synced")
    return event.ids.has(state.id) ? { state, effects: NONE } : { state: INITIAL_KEYBIND_CAPTURE_STATE, effects: stop }

  const input = event.input

  if (input.kind === "modifier-only") return { state, effects: NONE }

  if (input.kind === "escape") return { state: INITIAL_KEYBIND_CAPTURE_STATE, effects: stop }

  // With nothing before it, Backspace removes the shortcut; otherwise it drops the key being added.
  if (input.kind === "backspace") {
    if (state.prefix.length === 0)
      return { state: INITIAL_KEYBIND_CAPTURE_STATE, effects: [...unbind(state.id), RESUME] }

    return { state: { ...state, prefix: state.prefix.slice(0, -1) }, effects: NONE }
  }

  const keybind = [...state.prefix, input.stroke].join(" ")

  // A clashing key keeps recording, so the next press tries again.
  if (input.conflictTitles.length > 0)
    return { state, effects: [{ type: "notify.conflict", keybind, conflictTitles: input.conflictTitles }] }

  return {
    state: { status: "idle", recent: state.id },
    effects: [{ type: "binding.set", id: state.id, value: keybind }, RESUME],
  }
}

export function selectCapturingKeybind(state: KeybindCaptureState) {
  return state.status === "capturing" ? state.id : null
}

/** The strokes the key being recorded adds to, as a keybind such as `mod+k`. */
export function selectCapturePrefix(state: KeybindCaptureState) {
  return state.status === "capturing" ? state.prefix.join(" ") : ""
}

/** The row that offers + to add a key: the one just saved. */
export function selectExtendableKeybind(state: KeybindCaptureState) {
  return state.status === "idle" ? state.recent : undefined
}

function unbind(id: string): readonly KeybindCaptureEffect[] {
  return [{ type: "binding.set", id, value: "none" }]
}
