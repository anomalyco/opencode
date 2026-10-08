// What the presenter page reports about the user's input, mapped to the input events an offscreen page takes.
// Electron-free apart from types, so it stays unit-testable under Bun.
import { Option, Schema } from "effect"

const Modifiers = Schema.Struct({
  shift: Schema.Boolean,
  control: Schema.Boolean,
  alt: Schema.Boolean,
  meta: Schema.Boolean,
})

const point = { x: Schema.Finite, y: Schema.Finite, modifiers: Modifiers }

/** One user input or presenter state change, as the presenter page posts it. Coordinates are page CSS pixels. */
export const PresenterEvent = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("mouse"),
    type: Schema.Literals(["down", "up", "move", "leave"]),
    ...point,
    button: Schema.Literals([0, 1, 2]),
    /** DOM `MouseEvent.buttons`: the buttons held while the pointer moves. */
    buttons: Schema.Int,
    clicks: Schema.Int,
  }),
  Schema.Struct({
    kind: Schema.Literal("wheel"),
    ...point,
    deltaX: Schema.Finite,
    deltaY: Schema.Finite,
    deltaMode: Schema.Literals([0, 1, 2]),
  }),
  Schema.Struct({
    kind: Schema.Literal("key"),
    type: Schema.Literals(["down", "up"]),
    key: Schema.String.check(Schema.isMaxLength(64)),
    code: Schema.String.check(Schema.isMaxLength(64)),
    repeat: Schema.Boolean,
    modifiers: Modifiers,
  }),
  // Text an input method composed.
  Schema.Struct({ kind: Schema.Literal("text"), text: Schema.String.check(Schema.isMaxLength(10_000)) }),
  Schema.Struct({ kind: Schema.Literal("focus") }),
  // The presenter's own size in CSS pixels, which an unpinned page follows.
  Schema.Struct({ kind: Schema.Literal("resize"), width: Schema.Finite, height: Schema.Finite }),
])

export type PresenterEvent = typeof PresenterEvent.Type

export type Modifiers = typeof Modifiers.Type

/** An input event `WebContents.sendInputEvent` takes. */
export type ReplayedInput = Electron.KeyboardInputEvent | Electron.MouseInputEvent | Electron.MouseWheelInputEvent

const Events = Schema.fromJsonString(Schema.Array(Schema.Json))

/** The events of one posted batch; entries that are not valid events are dropped. */
export function decodePresenterEvents(body: string): PresenterEvent[] {
  return Schema.decodeUnknownOption(Events)(body).pipe(
    Option.map((items) => items.flatMap((item) => Option.toArray(Schema.decodeUnknownOption(PresenterEvent)(item)))),
    Option.getOrElse(() => []),
  )
}

// Pixels per DOM wheel delta unit: pixels, lines, pages.
const wheelScales = [1, 40, 800] as const

const mouseTypes = { down: "mouseDown", up: "mouseUp", move: "mouseMove", leave: "mouseLeave" } as const

// DOM MouseEvent.button order.
const mouseButtons = ["left", "middle", "right"] as const

// DOM key names whose Electron accelerator name differs.
const renamed = new Map(
  Object.entries({
    ArrowUp: "Up",
    ArrowDown: "Down",
    ArrowLeft: "Left",
    ArrowRight: "Right",
    " ": "Space",
  }),
)

// Named keys Electron's keyboard events accept as they are.
const named = new Set([
  "Enter",
  "Tab",
  "Escape",
  "Backspace",
  "Delete",
  "Insert",
  "Home",
  "End",
  "PageUp",
  "PageDown",
  "CapsLock",
  "NumLock",
  "ScrollLock",
  "PrintScreen",
  "ContextMenu",
])

/** The input events that replay one user event in the offscreen page; empty for presenter state events. */
export function toInputEvents(event: PresenterEvent): ReplayedInput[] {
  if (event.kind === "mouse") return [mouse(event)]

  if (event.kind === "wheel") {
    // Chromium's wheel delta is the scroll direction's opposite: positive DOM deltaY scrolls down.
    const scale = wheelScales[event.deltaMode]

    const wheel: Electron.MouseWheelInputEvent = {
      type: "mouseWheel",
      x: Math.round(event.x),
      y: Math.round(event.y),
      deltaX: -event.deltaX * scale,
      deltaY: -event.deltaY * scale,
      canScroll: true,
      modifiers: modifiers(event.modifiers),
    }

    return [wheel]
  }

  if (event.kind !== "key") return []
  const keyCode = keyName(event.key, event.code)

  if (!keyCode) return []

  const flags = [...modifiers(event.modifiers), ...(event.repeat ? ["isautorepeat" as const] : [])]

  if (event.type === "up") return [{ type: "keyUp", keyCode, modifiers: flags }]
  const down: Electron.KeyboardInputEvent = { type: "keyDown", keyCode, modifiers: flags }
  // Only characters type: a char event for a named key would insert its name. AltGr chords (Control+Alt) type too.
  const typing = (!event.modifiers.control && !event.modifiers.meta) || (event.modifiers.control && event.modifiers.alt)

  if (event.key === "Enter" && typing) return [down, { type: "char", keyCode: "\r", modifiers: flags }]

  if ([...event.key].length !== 1 || !typing) return [down]

  return [down, { type: "char", keyCode: event.key, modifiers: flags }]
}

function mouse(event: Extract<PresenterEvent, { kind: "mouse" }>): Electron.MouseInputEvent {
  const held = [
    ...(event.buttons & 1 ? ["leftbuttondown" as const] : []),
    ...(event.buttons & 2 ? ["rightbuttondown" as const] : []),
    ...(event.buttons & 4 ? ["middlebuttondown" as const] : []),
  ]

  return {
    type: mouseTypes[event.type],
    x: Math.round(event.x),
    y: Math.round(event.y),
    button: mouseButtons[event.button],
    clickCount: Math.max(1, event.clicks),
    modifiers: [...modifiers(event.modifiers), ...held],
  }
}

function modifiers(input: Modifiers) {
  return [
    ...(input.shift ? ["shift" as const] : []),
    ...(input.control ? ["control" as const] : []),
    ...(input.alt ? ["alt" as const] : []),
    ...(input.meta ? ["meta" as const] : []),
  ]
}

/** The Electron key code of a DOM key, or undefined for keys the page cannot take (dead keys, IME processing). */
export function keyName(key: string, code: string) {
  const known = renamed.get(key)

  if (known) return known

  if (named.has(key) || /^F([1-9]|1\d|2[0-4])$/.test(key)) return key

  if ([...key].length === 1) return key

  // A dead or unidentified key still has a physical position.
  const letter = /^Key([A-Z])$/.exec(code)?.[1]

  if (letter) return letter.toLowerCase()

  return /^Digit([0-9])$/.exec(code)?.[1]
}
