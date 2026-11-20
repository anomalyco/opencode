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

export type Node =
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

export type WidgetEvent = { readonly id: string; readonly type: "press" | "change"; readonly value?: unknown }

export type StepInput =
  | { readonly phase: "init"; readonly data: unknown }
  | { readonly phase: "event"; readonly data: unknown; readonly state: unknown; readonly event: WidgetEvent }

export interface StepOutput {
  readonly state: unknown
  readonly view: Node
  /** Present: the user submitted this value. */
  readonly submit?: unknown
  /** Present: the user dismissed the widget. */
  readonly dismiss?: true
  /** Added by the runtime, not the program: nodes of unknown types that were dropped from the view. */
  readonly warnings?: ReadonlyArray<string>
}

const optional = Schema.optionalKey
const children = Schema.Array(Schema.suspend((): Schema.Codec<Node> => Node))
const gap = Schema.Literals([0, 1, 2, 3])

export const Node: Schema.Codec<Node> = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("column"),
    children,
    gap: optional(gap),
    align: optional(Schema.Literals(["start", "center", "end", "stretch"])),
  }),
  Schema.Struct({
    type: Schema.Literal("row"),
    children,
    gap: optional(gap),
    align: optional(Schema.Literals(["start", "center", "end"])),
    wrap: optional(Schema.Boolean),
  }),
  Schema.Struct({
    type: Schema.Literal("text"),
    text: Schema.String,
    style: optional(Schema.Literals(["title", "body", "caption", "code"])),
    tone: optional(Schema.Literals(["default", "muted", "accent", "success", "warning", "error"])),
  }),
  Schema.Struct({ type: Schema.Literal("markdown"), text: Schema.String }),
  Schema.Struct({
    type: Schema.Literal("image"),
    src: Schema.String,
    alt: optional(Schema.String),
    aspect: optional(Schema.Finite.check(Schema.isGreaterThan(0))),
  }),
  Schema.Struct({
    type: Schema.Literal("carousel"),
    id: optional(Schema.String),
    index: optional(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
    children,
  }),
  Schema.Struct({
    type: Schema.Literal("card"),
    id: optional(Schema.String),
    selected: optional(Schema.Boolean),
    children,
  }),
  Schema.Struct({
    type: Schema.Literal("button"),
    id: Schema.String,
    label: Schema.String,
    variant: optional(Schema.Literals(["primary", "secondary", "danger"])),
    disabled: optional(Schema.Boolean),
  }),
  Schema.Struct({
    type: Schema.Literal("checkbox"),
    id: Schema.String,
    label: Schema.String,
    checked: Schema.Boolean,
    disabled: optional(Schema.Boolean),
  }),
  Schema.Struct({
    type: Schema.Literal("slider"),
    id: Schema.String,
    label: optional(Schema.String),
    value: Schema.Finite,
    min: Schema.Finite,
    max: Schema.Finite,
    step: optional(Schema.Finite.check(Schema.isGreaterThan(0))),
  }),
  Schema.Struct({
    type: Schema.Literal("select"),
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
    id: Schema.String,
    label: optional(Schema.String),
    value: Schema.String,
    placeholder: optional(Schema.String),
    multiline: optional(Schema.Boolean),
  }),
  Schema.Struct({ type: Schema.Literal("divider") }),
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
]

export const StepOutput = Schema.Struct({
  state: Schema.Unknown,
  view: Node,
  submit: optional(Schema.Unknown),
  dismiss: optional(Schema.Literal(true)),
})
