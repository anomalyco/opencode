/** The recording slot of the profile's leader key, which records one stroke instead of a command's chord. */
export const LEADER_SLOT = "keymap.leader"

/** A command chord ends at this many strokes without waiting. */
export const MAX_CHORD_STROKES = 4

/**
 * A key pressed while recording, classified by the driver. Each stroke carries the commands it would clash with,
 * as the chord recorded so far plus this stroke; `enter` carries both readings, since a plain Enter finishes a chord
 * already started and is itself a stroke when none is.
 */
export type RecordedKeyInput =
  | { readonly kind: "escape" }
  | { readonly kind: "backspace" }
  | { readonly kind: "modifier-only" }
  | { readonly kind: "stroke"; readonly stroke: string; readonly conflictTitles: readonly string[] }
  | {
      readonly kind: "enter"
      readonly stroke: string
      readonly strokeConflicts: readonly string[]
      readonly finishConflicts: readonly string[]
    }

/**
 * Recording a shortcut. Global shortcuts stay suspended exactly while `capturing`; `strokes` is the chord recorded
 * so far, which ends on Enter, on the chord timeout or at `MAX_CHORD_STROKES`.
 */
export type KeybindCaptureState =
  | { readonly status: "idle" }
  | { readonly status: "capturing"; readonly id: string; readonly strokes: readonly string[] }
  | { readonly status: "disposed" }

export type KeybindCaptureEvent =
  /** `pageActive`: whether the Shortcuts page shows; a hidden page never starts recording. */
  | { readonly type: "capture.toggled"; readonly id: string; readonly pageActive: boolean }
  /** Focus moved into a text field, such as a search box: typing there is not a shortcut. */
  | { readonly type: "capture.cancelled" }
  | { readonly type: "unbind.clicked"; readonly id: string }
  | { readonly type: "reset.clicked" }
  | { readonly type: "key.pressed"; readonly input: RecordedKeyInput }
  /** Starts the chord with the leader key; only a command's recording with nothing recorded yet takes it. */
  | { readonly type: "leader.inserted" }
  /** The pause after the last stroke ran out; `conflictTitles` are those of the chord recorded so far. */
  | { readonly type: "chord.timeout"; readonly conflictTitles: readonly string[] }
  | { readonly type: "page.synced"; readonly active: boolean }
  | { readonly type: "catalog.synced"; readonly ids: ReadonlySet<string> }
  | { readonly type: "disposed" }

export type KeybindCaptureEffect =
  | { readonly type: "keybinds.suspend" }
  | { readonly type: "keybinds.resume" }
  | { readonly type: "binding.set"; readonly id: string; readonly value: string }
  | { readonly type: "leader.set"; readonly value: string | undefined }
  | { readonly type: "bindings.reset" }
  /** (Re)starts the pause that ends the chord; resuming shortcuts cancels it. */
  | { readonly type: "chord.wait" }
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

const RESUME: KeybindCaptureEffect = Object.freeze({ type: "keybinds.resume" })

const WAIT: KeybindCaptureEffect = Object.freeze({ type: "chord.wait" })

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

  if (event.type === "capture.toggled") {
    if (!capturing) {
      if (!event.pageActive) return { state, effects: NONE }

      return {
        state: { status: "capturing", id: event.id, strokes: NO_STROKES },
        effects: [{ type: "keybinds.suspend" }],
      }
    }

    // Moving to another row keeps shortcuts suspended instead of resuming them for a moment.
    if (state.id !== event.id && event.pageActive)
      return { state: { status: "capturing", id: event.id, strokes: NO_STROKES }, effects: NONE }

    return { state: INITIAL_KEYBIND_CAPTURE_STATE, effects: stop }
  }

  if (!capturing) return { state, effects: NONE }

  if (event.type === "capture.cancelled") return { state: INITIAL_KEYBIND_CAPTURE_STATE, effects: stop }

  if (event.type === "page.synced")
    return event.active ? { state, effects: NONE } : { state: INITIAL_KEYBIND_CAPTURE_STATE, effects: stop }

  // A plugin removed while its command was recording.
  if (event.type === "catalog.synced")
    return event.ids.has(state.id) || state.id === LEADER_SLOT
      ? { state, effects: NONE }
      : { state: INITIAL_KEYBIND_CAPTURE_STATE, effects: stop }

  if (event.type === "leader.inserted") {
    if (state.id === LEADER_SLOT || state.strokes.length > 0) return { state, effects: NONE }

    return { state: { ...state, strokes: ["<leader>"] }, effects: [WAIT] }
  }

  // A timeout of a chord already finished, or never started, is stale.
  if (event.type === "chord.timeout")
    return state.strokes.length > 0 ? finish(state, event.conflictTitles) : { state, effects: NONE }

  const input = event.input

  if (input.kind === "modifier-only") return { state, effects: NONE }

  if (input.kind === "escape") return { state: INITIAL_KEYBIND_CAPTURE_STATE, effects: stop }

  // Backspace takes back the last stroke; with nothing recorded it removes the shortcut.
  if (input.kind === "backspace") {
    if (state.strokes.length === 0)
      return { state: INITIAL_KEYBIND_CAPTURE_STATE, effects: [...unbind(state.id), RESUME] }

    const strokes = state.strokes.slice(0, -1)

    return { state: { ...state, strokes }, effects: strokes.length > 0 ? [WAIT] : NONE }
  }

  if (input.kind === "enter" && state.strokes.length > 0) return finish(state, input.finishConflicts)

  const stroke = input.stroke
  const conflictTitles = input.kind === "enter" ? input.strokeConflicts : input.conflictTitles

  // The leader is one stroke, so it ends as soon as it is pressed.
  if (state.id === LEADER_SLOT) return finish({ ...state, strokes: [stroke] }, conflictTitles)

  const next = { ...state, strokes: [...state.strokes, stroke] }

  if (next.strokes.length >= MAX_CHORD_STROKES) return finish(next, conflictTitles)

  return { state: next, effects: [WAIT] }
}

export function selectCapturingKeybind(state: KeybindCaptureState) {
  return state.status === "capturing" ? state.id : null
}

/** The chord recorded so far, as a keybind such as `mod+k mod+c`. */
export function selectCapturedChord(state: KeybindCaptureState) {
  return state.status === "capturing" ? state.strokes.join(" ") : ""
}

// A clashing chord starts again, still recording; a free one is saved and shortcuts resume.
function finish(
  state: Extract<KeybindCaptureState, { status: "capturing" }>,
  conflictTitles: readonly string[],
): KeybindCaptureTransition {
  const keybind = state.strokes.join(" ")

  if (conflictTitles.length > 0)
    return { state: { ...state, strokes: NO_STROKES }, effects: [{ type: "notify.conflict", keybind, conflictTitles }] }

  return {
    state: INITIAL_KEYBIND_CAPTURE_STATE,
    effects: [
      state.id === LEADER_SLOT
        ? { type: "leader.set", value: keybind }
        : { type: "binding.set", id: state.id, value: keybind },
      RESUME,
    ],
  }
}

function unbind(id: string): readonly KeybindCaptureEffect[] {
  return [id === LEADER_SLOT ? { type: "leader.set", value: undefined } : { type: "binding.set", id, value: "none" }]
}
