import { Schema } from "effect"

export type Tone = "default" | "muted" | "accent" | "success" | "warning" | "error"
export type Gap = 0 | 1 | 2 | 3

export interface Column {
  readonly type: "column"
  readonly children: ReadonlyArray<Node>
  readonly gap?: Gap
  readonly align?: "start" | "center" | "end" | "stretch"
}
export interface Row {
  readonly type: "row"
  readonly children: ReadonlyArray<Node>
  readonly gap?: Gap
  readonly align?: "start" | "center" | "end"
  readonly wrap?: boolean
}
export interface Text {
  readonly type: "text"
  readonly text: string
  readonly style?: "title" | "body" | "caption" | "code"
  readonly tone?: Tone
}
export interface Markdown {
  readonly type: "markdown"
  readonly text: string
}
export interface Image {
  readonly type: "image"
  readonly src: string
  readonly alt?: string
  /** width / height */
  readonly aspect?: number
}
export interface Carousel {
  readonly type: "carousel"
  readonly id?: string
  readonly index?: number
  readonly children: ReadonlyArray<Node>
}
export interface Card {
  readonly type: "card"
  readonly id?: string
  readonly selected?: boolean
  readonly children: ReadonlyArray<Node>
}
export interface Button {
  readonly type: "button"
  readonly id: string
  readonly label: string
  readonly variant?: "primary" | "secondary" | "danger"
  readonly disabled?: boolean
}
export interface Checkbox {
  readonly type: "checkbox"
  readonly id: string
  readonly label: string
  readonly checked: boolean
  readonly disabled?: boolean
}
export interface Slider {
  readonly type: "slider"
  readonly id: string
  readonly label?: string
  readonly value: number
  readonly min: number
  readonly max: number
  readonly step?: number
}
export interface SelectOption {
  readonly value: string
  readonly label: string
  readonly description?: string
}
export interface Select {
  readonly type: "select"
  readonly id: string
  readonly label?: string
  readonly options: ReadonlyArray<SelectOption>
  readonly value?: string | ReadonlyArray<string>
  readonly multiple?: boolean
}
export interface Input {
  readonly type: "input"
  readonly id: string
  readonly label?: string
  readonly value: string
  readonly placeholder?: string
  readonly multiline?: boolean
}
export interface Divider {
  readonly type: "divider"
}
/**
 * A drawing surface, drawn one of two ways, never both: with 2D commands from the widget template's
 * `draw(state, data, frame)`, or, when it has `wgsl`, by that WGSL fragment shader on the GPU (see the spec's Canvas
 * section). Sends `pointer` events when it has an `id` (prelude-assigned).
 */
export interface Canvas {
  readonly type: "canvas"
  readonly id?: string
  /** Logical pixels; the canvas takes the full available width unless `width` is set. */
  readonly height: number
  readonly width?: number
  /** Frames per second while animating, max 60: default 0 (draw on appearing and state changes), 60 with `wgsl`. */
  readonly fps?: number
  /** Seconds after the canvas appears to animate at `fps`, ending with a frame at `t >= duration`; default forever. */
  readonly duration?: number
  readonly alt?: string
  /** A GPU canvas: WGSL defining `fn shade(frag: vec2f) -> vec4f`, at most 16 KB of UTF-8. `draw` isn't called. */
  readonly wgsl?: string
  /** With `wgsl`: up to 16 floats, available as `widget.values` (4 vec4f, row-major, zero padded). */
  readonly values?: ReadonlyArray<number>
  /** A live program draws it with `widget.gpu` (widgets-gpu.md); it needs a `key`. */
  readonly gpu?: true
  /** An image src shown where the canvas can't be drawn (a terminal, a shader that fails to compile). */
  readonly poster?: string
  /** Set by the prelude when the canvas has an `onPointer` handler: only then does it take pointer input. */
  readonly pointer?: true
}

/** Where a child of a `stack` sits in it (widgets.md, Stack); ignored outside a stack. */
export type Place =
  | "top-left"
  | "top"
  | "top-right"
  | "left"
  | "center"
  | "right"
  | "bottom-left"
  | "bottom"
  | "bottom-right"
  | "fill"
/** Space between a stack's edges and a child: one number for every side, or per side (default 0). */
export type Inset =
  | number
  | { readonly top?: number; readonly right?: number; readonly bottom?: number; readonly left?: number }
/** How any node is placed as a child of a `stack`. */
export interface Layer {
  readonly place?: Place
  readonly inset?: Inset
}
/** Children layered in order, the last on top, each placed by its `place` and `inset`. */
export interface Stack {
  readonly type: "stack"
  readonly children: ReadonlyArray<Node>
}

export type Node = (
  | Column
  | Row
  | Text
  | Markdown
  | Image
  | Carousel
  | Card
  | Button
  | Checkbox
  | Slider
  | Select
  | Input
  | Divider
  | Canvas
  | Stack
) &
  Layer

/** A rectangle in a node's logical pixels. */
export interface Rect {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/** Pointer input on a canvas with `pointer: true`: `move` only while down, at most once per frame. */
export interface Pointer {
  readonly kind: "down" | "move" | "up"
  readonly x: number
  readonly y: number
  /** The canvas's logical size, so a handler can hit-test a layout that follows the width. */
  readonly width: number
  readonly height: number
  /** In full screen, the close button's area in this node's coordinates when it overlaps it (as in `Frame`). */
  readonly close?: Rect
}

/** Pointer input while the widget holds pointer capture (widgets-input.md): relative movement, buttons on down/up. */
export type CapturedPointer =
  | { readonly kind: "move"; readonly dx: number; readonly dy: number }
  | { readonly kind: "down" | "up"; readonly button: number }

/**
 * The mouse wheel or trackpad scroll while the widget holds pointer capture (widgets-input.md, Wheel), summed over a
 * frame, in logical pixels.
 */
export interface Wheel {
  readonly kind: "wheel"
  readonly dx: number
  readonly dy: number
}

/** A key while the widget has keyboard focus; `key` and `code` as in DOM `KeyboardEvent`. Esc is never delivered. */
export interface Key {
  readonly kind: "down" | "up"
  readonly key: string
  readonly code: string
  readonly repeat: boolean
  readonly shift: boolean
  readonly alt: boolean
  readonly ctrl: boolean
  readonly meta: boolean
}

export type WidgetEvent =
  | { readonly id: string; readonly type: "press" | "change"; readonly value?: unknown }
  | { readonly id: string; readonly type: "pointer"; readonly value: Pointer | CapturedPointer | Wheel }
  | { readonly id: string; readonly type: "key"; readonly value: Key }
  /** Keyboard focus gained or lost. */
  | { readonly id: string; readonly type: "focus"; readonly value: boolean }
  /** Pointer capture granted or released. */
  | { readonly id: string; readonly type: "capture"; readonly value: boolean }
  /** Full screen entered or left (widgets-fullscreen.md); `close` is the close button's area in the root's coordinates. */
  | { readonly id: string; readonly type: "fullscreen"; readonly value: boolean; readonly close?: Rect | null }

/** What `draw` gets: the canvas being drawn, the time, its size and the pointer over it. */
export interface Frame {
  /** The canvas node's id. The prelude hands the widget template `frame.key` (the canvas's `key`, or null) instead. */
  readonly id: string | null
  /** Seconds since the canvas appeared. */
  readonly t: number
  /** Seconds since the previous frame. */
  readonly dt: number
  /** Logical size. */
  readonly width: number
  readonly height: number
  /** Device pixel ratio. */
  readonly scale: number
  readonly pointer: { readonly x: number; readonly y: number; readonly down: boolean } | null
  readonly dark: boolean
  /** In full screen, the close button's area in this canvas's coordinates when it overlaps the canvas, else null. */
  readonly close?: Rect | null
}

export type StepInput =
  | { readonly phase: "init"; readonly data: unknown }
  | { readonly phase: "event"; readonly data: unknown; readonly state: unknown; readonly event: WidgetEvent }
  | DrawInput

export type DrawInput = {
  readonly phase: "draw"
  readonly data: unknown
  readonly state: unknown
  readonly frame: Frame
}

/** "#rgb", "#rrggbb", "#rrggbbaa" or a theme token. */
export type Color = string
export type Gradient =
  | { readonly linear: readonly [number, number, number, number]; readonly stops: ReadonlyArray<Stop> }
  | { readonly radial: readonly [number, number, number]; readonly stops: ReadonlyArray<Stop> }
export type Stop = readonly [offset: number, color: Color]
export interface Paint {
  readonly fill?: Color | Gradient
  readonly stroke?: Color
  readonly width?: number
  readonly cap?: "butt" | "round"
}
export interface TextStyle {
  readonly size?: number
  readonly weight?: 400 | 500 | 600 | 700
  readonly align?: "left" | "center" | "right"
  readonly color?: Color
  readonly mono?: boolean
}
export type Segment =
  | readonly ["M", number, number]
  | readonly ["L", number, number]
  | readonly ["Q", number, number, number, number]
  | readonly ["C", number, number, number, number, number, number]
  | readonly ["Z"]
export type Command =
  | readonly ["save"]
  | readonly ["restore"]
  | readonly ["translate", number, number]
  | readonly ["rotate", number]
  | readonly ["scale", number, number]
  | readonly ["alpha", number]
  | readonly ["rect", number, number, number, number, Paint]
  | readonly ["rrect", number, number, number, number, number, Paint]
  | readonly ["circle", number, number, number, Paint]
  | readonly ["line", number, number, number, number, Paint]
  | readonly ["path", ReadonlyArray<Segment>, Paint]
  | readonly ["text", number, number, string, TextStyle]
  | readonly ["image", string, number, number, number, number]

export interface DrawOutput {
  readonly commands: ReadonlyArray<Command>
}

export interface StepOutput {
  readonly state: unknown
  readonly view: Node
  /** Present: the user submitted this value. */
  readonly submit?: unknown
  /** Present: the user dismissed the widget. */
  readonly dismiss?: true
  /**
   * Present: a message to the agent from `send(value, state, { wake })`; the widget stays open. `wake: false` delivers
   * it without waking the agent, so it sees it on its next turn.
   */
  readonly send?: { readonly value: unknown; readonly wake: boolean }
  /** Added by the runtime, not the program: nodes of unknown types that were dropped from the view. */
  readonly warnings?: ReadonlyArray<string>
}

/** The most a canvas's `wgsl` may hold, in UTF-8 bytes. */
export const WGSL_BYTES = 16 * 1024
/** The most commands one draw step may return. */
export const MAX_COMMANDS = 2000

const optional = Schema.optionalKey
const children = Schema.Array(Schema.suspend((): Schema.Codec<Node> => Node))
const gap = Schema.Literals([0, 1, 2, 3])
const spacing = Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0))
// A stack child's placement (widgets.md, Stack); any node may carry it.
const layer = {
  place: optional(
    Schema.Literals([
      "top-left",
      "top",
      "top-right",
      "left",
      "center",
      "right",
      "bottom-left",
      "bottom",
      "bottom-right",
      "fill",
    ]),
  ),
  inset: optional(
    Schema.Union([
      spacing,
      Schema.Struct({
        top: optional(spacing),
        right: optional(spacing),
        bottom: optional(spacing),
        left: optional(spacing),
      }),
    ]),
  ),
}

export const Node: Schema.Codec<Node> = Schema.Union([
  Schema.Struct({ type: Schema.Literal("stack"), ...layer, children }),
  Schema.Struct({
    type: Schema.Literal("column"),
    ...layer,
    children,
    gap: optional(gap),
    align: optional(Schema.Literals(["start", "center", "end", "stretch"])),
  }),
  Schema.Struct({
    type: Schema.Literal("row"),
    ...layer,
    children,
    gap: optional(gap),
    align: optional(Schema.Literals(["start", "center", "end"])),
    wrap: optional(Schema.Boolean),
  }),
  Schema.Struct({
    type: Schema.Literal("text"),
    ...layer,
    text: Schema.String,
    style: optional(Schema.Literals(["title", "body", "caption", "code"])),
    tone: optional(Schema.Literals(["default", "muted", "accent", "success", "warning", "error"])),
  }),
  Schema.Struct({ type: Schema.Literal("markdown"), ...layer, text: Schema.String }),
  Schema.Struct({
    type: Schema.Literal("image"),
    ...layer,
    src: Schema.String,
    alt: optional(Schema.String),
    aspect: optional(Schema.Finite.check(Schema.isGreaterThan(0))),
  }),
  Schema.Struct({
    type: Schema.Literal("carousel"),
    ...layer,
    id: optional(Schema.String),
    index: optional(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
    children,
  }),
  Schema.Struct({
    type: Schema.Literal("card"),
    ...layer,
    id: optional(Schema.String),
    selected: optional(Schema.Boolean),
    children,
  }),
  Schema.Struct({
    type: Schema.Literal("button"),
    ...layer,
    id: Schema.String,
    label: Schema.String,
    variant: optional(Schema.Literals(["primary", "secondary", "danger"])),
    disabled: optional(Schema.Boolean),
  }),
  Schema.Struct({
    type: Schema.Literal("checkbox"),
    ...layer,
    id: Schema.String,
    label: Schema.String,
    checked: Schema.Boolean,
    disabled: optional(Schema.Boolean),
  }),
  Schema.Struct({
    type: Schema.Literal("slider"),
    ...layer,
    id: Schema.String,
    label: optional(Schema.String),
    value: Schema.Finite,
    min: Schema.Finite,
    max: Schema.Finite,
    step: optional(Schema.Finite.check(Schema.isGreaterThan(0))),
  }),
  Schema.Struct({
    type: Schema.Literal("select"),
    ...layer,
    id: Schema.String,
    label: optional(Schema.String),
    options: Schema.Array(
      Schema.Struct({ value: Schema.String, label: Schema.String, description: optional(Schema.String) }),
    ),
    value: optional(Schema.Union([Schema.String, Schema.Array(Schema.String)])),
    multiple: optional(Schema.Boolean),
  }),
  Schema.Struct({
    type: Schema.Literal("input"),
    ...layer,
    id: Schema.String,
    label: optional(Schema.String),
    value: Schema.String,
    placeholder: optional(Schema.String),
    multiline: optional(Schema.Boolean),
  }),
  Schema.Struct({ type: Schema.Literal("divider"), ...layer }),
  Schema.Struct({
    type: Schema.Literal("canvas"),
    ...layer,
    id: optional(Schema.String),
    height: Schema.Finite.check(Schema.isGreaterThan(0)),
    width: optional(Schema.Finite.check(Schema.isGreaterThan(0))),
    fps: optional(Schema.Finite.check(Schema.isBetween({ minimum: 0, maximum: 60 }))),
    duration: optional(Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0))),
    alt: optional(Schema.String),
    wgsl: optional(
      Schema.String.check(
        Schema.makeFilter((wgsl: string) => Buffer.byteLength(wgsl) <= WGSL_BYTES || `must be at most 16 KB of WGSL`),
      ),
    ),
    values: optional(Schema.Array(Schema.Finite).check(Schema.isMaxLength(16))),
    poster: optional(Schema.String),
    pointer: optional(Schema.Literal(true)),
    gpu: optional(Schema.Literal(true)),
  }).check(
    Schema.makeFilter(
      (canvas: { readonly wgsl?: string; readonly values?: ReadonlyArray<number>; readonly gpu?: true }) =>
        canvas.values === undefined || canvas.wgsl !== undefined || "`values` need `wgsl`",
    ),
    Schema.makeFilter(
      (canvas: { readonly wgsl?: string; readonly gpu?: true }) =>
        canvas.gpu === undefined || canvas.wgsl === undefined || "`gpu` and `wgsl` exclude each other",
    ),
  ),
])

export const types: ReadonlyArray<Node["type"]> = [
  "column",
  "row",
  "text",
  "markdown",
  "image",
  "carousel",
  "card",
  "button",
  "checkbox",
  "slider",
  "select",
  "input",
  "divider",
  "canvas",
  "stack",
]

export const StepOutput = Schema.Struct({
  state: Schema.Unknown,
  view: Node,
  submit: optional(Schema.Unknown),
  dismiss: optional(Schema.Literal(true)),
  send: optional(Schema.Struct({ value: Schema.Unknown, wake: Schema.Boolean })),
})
