/** A key pressed while recording, classified by the driver. */
export type RecordedKeyInput =
  | { readonly kind: "escape" }
  | { readonly kind: "clear" }
  | { readonly kind: "modifier-only" }
  | { readonly kind: "combo"; readonly keybind: string; readonly conflictTitles: readonly string[] }

/** Recording a shortcut. Global shortcuts stay suspended exactly while a command is `capturing`. */
export type KeybindCaptureState =
  | { readonly status: "idle" }
  | { readonly status: "capturing"; readonly id: string }
  | { readonly status: "disposed" }

export type KeybindCaptureEvent =
  /** `pageActive`: whether the Shortcuts page shows; a hidden page never starts recording. */
  | { readonly type: "capture.toggled"; readonly id: string; readonly pageActive: boolean }
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
    return { state: INITIAL_KEYBIND_CAPTURE_STATE, effects: [{ type: "binding.set", id: event.id, value: "none" }, ...stop] }

  if (event.type === "reset.clicked")
    return { state: INITIAL_KEYBIND_CAPTURE_STATE, effects: [...stop, { type: "bindings.reset" }, { type: "notify.reset" }] }

  if (event.type === "capture.toggled") {
    if (!capturing) {
      if (!event.pageActive) return { state, effects: NONE }

      return { state: { status: "capturing", id: event.id }, effects: [{ type: "keybinds.suspend" }] }
    }

    // Moving to another row keeps shortcuts suspended instead of resuming them for a moment.
    if (state.id !== event.id && event.pageActive)
      return { state: { status: "capturing", id: event.id }, effects: NONE }

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

  if (input.kind === "clear")
    return { state: INITIAL_KEYBIND_CAPTURE_STATE, effects: [{ type: "binding.set", id: state.id, value: "none" }, RESUME] }

  if (input.conflictTitles.length > 0)
    return { state, effects: [{ type: "notify.conflict", keybind: input.keybind, conflictTitles: input.conflictTitles }] }

  return {
    state: INITIAL_KEYBIND_CAPTURE_STATE,
    effects: [{ type: "binding.set", id: state.id, value: input.keybind }, RESUME],
  }
}

export function selectCapturingKeybind(state: KeybindCaptureState) {
  return state.status === "capturing" ? state.id : null
}
