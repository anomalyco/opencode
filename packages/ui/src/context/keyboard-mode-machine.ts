/**
 * Whether the user is moving through the app with the keyboard. Focus rings show only while they are.
 *
 * The mode turns on when a key moves focus to another element (Tab, the arrows, Home, End), or when a key operates the
 * control that has focus (Enter, Space, the arrows, Home, End). A pointer press turns it off. Typing, shortcuts, lone
 * modifiers, Escape, keys in a text field or a scroll region, returning to the window and focus the app moves itself
 * never change it.
 */
export type KeyboardModeState<Focused> =
  | { readonly type: "pointer" }
  // A key that can move focus is down, and focus is still on `from`. Rings stay hidden until it moves.
  | { readonly type: "moving"; readonly from: Focused | null }
  | { readonly type: "keyboard" }

export type KeyboardModeEvent<Focused> =
  | {
      readonly type: "key"
      readonly key: string
      // Held with Ctrl, Alt or Meta: a shortcut, not navigation.
      readonly modified: boolean
      // What the key was pressed on: a control it can operate (a button, link, tab, menu item), or anything else.
      readonly target: "control" | "other"
      readonly focused: Focused | null
    }
  | { readonly type: "focus"; readonly focused: Focused }
  // The key press ended without moving focus.
  | { readonly type: "key.settled" }
  | { readonly type: "pointer" }

const POINTER = Object.freeze({ type: "pointer" } as const)

const KEYBOARD = Object.freeze({ type: "keyboard" } as const)

const MOVE = new Set(["Tab", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End"])

const OPERATE = new Set(["Enter", " ", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End"])

export const initialKeyboardModeState: KeyboardModeState<never> = POINTER

export function transitionKeyboardMode<Focused>(
  state: KeyboardModeState<Focused>,
  event: KeyboardModeEvent<Focused>,
): KeyboardModeState<Focused> {
  if (event.type === "pointer") return state.type === "pointer" ? state : POINTER

  if (event.type === "key") {
    if (event.modified || state.type === "keyboard") return state

    if (event.target === "control" && OPERATE.has(event.key)) return KEYBOARD

    if (MOVE.has(event.key)) return { type: "moving", from: event.focused }

    return state
  }

  if (state.type !== "moving") return state

  if (event.type === "key.settled") return POINTER

  return event.focused === state.from ? state : KEYBOARD
}

export const selectFocusRings = (state: KeyboardModeState<unknown>) => state.type === "keyboard"
