// Marks the element that has focus with `data-focus-visible` while the user is moving through the app with the
// keyboard. Focus styles read that attribute instead of `:focus-visible`, which Chromium also matches after any typed
// key, for every text field, and for focus a script moves once a key was pressed.

import {
  initialKeyboardModeState,
  selectFocusRings,
  transitionKeyboardMode,
  type KeyboardModeEvent,
  type KeyboardModeState,
} from "./keyboard-mode-machine"

const ATTRIBUTE = "data-focus-visible"

// What Enter, Space and the arrow keys operate: native controls and the ARIA widget roles. Text fields take those keys
// as input, and regions, panels and dialogs only scroll or hold other controls.
const NATIVE_CONTROLS = "button, a[href], area[href], summary, select, input"

const WIDGET_ROLES = new Set([
  "button",
  "checkbox",
  "grid",
  "gridcell",
  "link",
  "listbox",
  "menu",
  "menubar",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "option",
  "radio",
  "radiogroup",
  "slider",
  "switch",
  "tab",
  "tablist",
  "tree",
  "treegrid",
  "treeitem",
])

const INPUT_CONTROLS = new Set(["button", "checkbox", "color", "file", "image", "radio", "range", "reset", "submit"])

const LISTENER_OPTIONS = { capture: true, passive: true }

let installs = 0

let state: KeyboardModeState<Element> = initialKeyboardModeState

let always = false

let settle: ReturnType<typeof setTimeout> | undefined

// The focused element, and the shadow hosts around it.
let marked: Element[] = []

export function installKeyboardMode() {
  installs += 1

  if (installs === 1) {
    document.addEventListener("keydown", onKeyDown, LISTENER_OPTIONS)
    document.addEventListener("pointerdown", onPointerDown, LISTENER_OPTIONS)
    document.addEventListener("focusin", onFocusIn, LISTENER_OPTIONS)
    document.addEventListener("focusout", mark, LISTENER_OPTIONS)
    window.addEventListener("blur", mark)
    window.addEventListener("focus", mark)
    mark()
  }

  return () => {
    installs -= 1

    if (installs > 0) return
    document.removeEventListener("keydown", onKeyDown, LISTENER_OPTIONS)
    document.removeEventListener("pointerdown", onPointerDown, LISTENER_OPTIONS)
    document.removeEventListener("focusin", onFocusIn, LISTENER_OPTIONS)
    document.removeEventListener("focusout", mark, LISTENER_OPTIONS)
    window.removeEventListener("blur", mark)
    window.removeEventListener("focus", mark)
    clearTimeout(settle)
    settle = undefined
    state = initialKeyboardModeState
    mark()
  }
}

/** The "Always show focus rings" setting: every focus shows its ring, a click included. */
export function setFocusRingsAlways(value: boolean) {
  always = value
  mark()
}

function dispatch(event: KeyboardModeEvent<Element>) {
  state = transitionKeyboardMode(state, event)
  clearTimeout(settle)
  // Tab and roving focus move focus while the key event dispatches, so the press is over a task later.
  settle = state.type === "moving" ? setTimeout(() => dispatch({ type: "key.settled" })) : undefined
  mark()
}

function onKeyDown(event: KeyboardEvent) {
  if (!event.isTrusted || event.isComposing) return
  dispatch({
    type: "key",
    key: event.key,
    modified: event.ctrlKey || event.altKey || event.metaKey,
    target: operable(event.composedPath()[0]) ? "control" : "other",
    focused: focusedChain().at(-1) ?? null,
  })
}

function onPointerDown(event: PointerEvent) {
  // A screen reader's click arrives without a pressed button.
  if (!event.isTrusted || event.buttons === 0) return
  dispatch({ type: "pointer" })
}

function onFocusIn() {
  const focused = focusedChain().at(-1)

  if (focused) return dispatch({ type: "focus", focused })
  mark()
}

function mark() {
  const next = installs > 0 && (always || selectFocusRings(state)) && document.hasFocus() ? focusedChain() : []

  if (next.length === marked.length && next.every((element, index) => element === marked[index])) return
  marked.filter((element) => !next.includes(element)).forEach((element) => element.removeAttribute(ATTRIBUTE))
  next.filter((element) => !marked.includes(element)).forEach((element) => element.setAttribute(ATTRIBUTE, ""))
  marked = next
}

function focusedChain() {
  const chain: Element[] = []

  for (
    let element = document.activeElement;
    element && element !== document.body && element !== document.documentElement;
    element = element.shadowRoot?.activeElement ?? null
  )
    chain.push(element)

  return chain
}

function operable(target: EventTarget | undefined) {
  if (!(target instanceof HTMLElement)) return false

  if (target.isContentEditable || target instanceof HTMLTextAreaElement) return false

  if (target instanceof HTMLInputElement) return INPUT_CONTROLS.has(target.type)

  return target.matches(NATIVE_CONTROLS) || WIDGET_ROLES.has(target.getAttribute("role") ?? "")
}
