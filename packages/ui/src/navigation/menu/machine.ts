/**
 * Every dropdown menu runs this machine, so each reachable state and event is a frozen module singleton, and an event
 * that changes nothing returns the state it was given.
 */
export type MenuInputGesture = "pointer" | "keyboard" | "none"

/** How the menu opened. An open without an input gesture (a shortcut handler, an async action) is `programmatic`. */
export type MenuOpenModality = "pointer" | "keyboard" | "programmatic"

export type MenuState =
  | { readonly status: "closed" }
  | { readonly status: "open"; readonly modality: MenuOpenModality; readonly outsideInteracted: boolean }
  /**
   * Kobalte reports the close first and restores focus a task later, so the modality outlives the open state until
   * that focus restore has run.
   */
  | { readonly status: "closing"; readonly modality: MenuOpenModality; readonly outsideInteracted: boolean }
  | { readonly status: "disposed" }

export type MenuEvent =
  | { readonly type: "open.changed"; readonly open: boolean; readonly gesture: MenuInputGesture }
  /** A press outside a non-modal menu, or a context menu anywhere, dismissed it and keeps focus where it landed. */
  | { readonly type: "outside.interacted" }
  | { readonly type: "close.autofocus" }
  | { readonly type: "disposed" }

const MODALITIES: readonly MenuOpenModality[] = ["pointer", "keyboard", "programmatic"]

const GESTURES: readonly MenuInputGesture[] = ["pointer", "keyboard", "none"]

const CLOSED: MenuState = Object.freeze({ status: "closed" })

const DISPOSED: MenuState = Object.freeze({ status: "disposed" })

const OPEN = MODALITIES.flatMap((modality) =>
  [false, true].map((outsideInteracted): MenuState => Object.freeze({ status: "open", modality, outsideInteracted })),
)

const CLOSING = MODALITIES.flatMap((modality) =>
  [false, true].map(
    (outsideInteracted): MenuState => Object.freeze({ status: "closing", modality, outsideInteracted }),
  ),
)

const key = (modality: MenuOpenModality, outsideInteracted: boolean) =>
  MODALITIES.indexOf(modality) * 2 + (outsideInteracted ? 1 : 0)

const open = (modality: MenuOpenModality, outsideInteracted: boolean) => OPEN[key(modality, outsideInteracted)]

const closing = (modality: MenuOpenModality, outsideInteracted: boolean) => CLOSING[key(modality, outsideInteracted)]

const OPEN_CHANGED = [false, true].flatMap((isOpen) =>
  GESTURES.map((gesture): MenuEvent => Object.freeze({ type: "open.changed", open: isOpen, gesture })),
)

export const MENU_OUTSIDE_INTERACTED: MenuEvent = Object.freeze({ type: "outside.interacted" })

export const MENU_CLOSE_AUTOFOCUS: MenuEvent = Object.freeze({ type: "close.autofocus" })

export const MENU_DISPOSED: MenuEvent = Object.freeze({ type: "disposed" })

export function openChangedEvent(isOpen: boolean, gesture: MenuInputGesture) {
  return OPEN_CHANGED[(isOpen ? GESTURES.length : 0) + GESTURES.indexOf(gesture)]
}

export function createMenuState(initialOpen: boolean) {
  return initialOpen ? open("programmatic", false) : CLOSED
}

export function transitionMenu(state: MenuState, event: MenuEvent): MenuState {
  if (state.status === "disposed") return state

  if (event.type === "disposed") return DISPOSED

  if (event.type === "open.changed") {
    if (event.open && state.status !== "open") {
      return open(
        event.gesture === "pointer" ? "pointer" : event.gesture === "keyboard" ? "keyboard" : "programmatic",
        false,
      )
    }

    if (!event.open && state.status === "open") return closing(state.modality, state.outsideInteracted)

    return state
  }

  if (event.type === "outside.interacted") {
    if (state.status === "open" && !state.outsideInteracted) return open(state.modality, true)

    if (state.status === "closing" && !state.outsideInteracted) return closing(state.modality, true)

    return state
  }

  if (state.status === "closing") return CLOSED

  return state
}

/**
 * Restore focus to the trigger without a focus ring: Escape counts as keyboard use, so Chromium would ring a trigger
 * the pointer opened. After an outside press, focus stays where that press put it.
 */
export function selectMenuRestoreTriggerWithoutRing(state: MenuState) {
  return (
    (state.status === "closing" || state.status === "open") && state.modality === "pointer" && !state.outsideInteracted
  )
}
