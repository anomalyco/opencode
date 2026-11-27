import { diagrams } from "./diagram.js"
import type { JSONSchema } from "./json-schema.js"
import { version } from "./program.js"
import { backdrop, chart, confirm, form, suggestions } from "./source.js"

/** `step` (default): short init/view/draw steps, events through handlers on nodes. `live`: one long-running `main(data)` (widgets-live.md). */
export type Mode = "step" | "live"

/**
 * What a live widget template may use beyond rendering (widgets-live.md, Capabilities). `https.hosts` entries are exact host
 * names, `*.` suffix wildcards, or `"*"` for any host. `storage: {}`: `widget.storage` (widgets-live.md, Storage).
 */
export interface Capabilities {
  readonly https?: { readonly hosts: ReadonlyArray<string> }
  readonly storage?: {}
}

export interface WidgetTemplate {
  /** /^[a-z][a-z0-9-]{0,47}$/, unique per server */
  readonly name: string
  /** `version(source, data, mode, capabilities)`: a content address; a version is immutable. */
  readonly version: string
  /** One line, shown to the model when listing widget templates. */
  readonly description: string
  /** JSON Schema for the data the widget template takes. */
  readonly data: JSONSchema
  /** The widget template source, without the prelude; clients run `program(source)`. */
  readonly source: string
  readonly builtin: boolean
  readonly mode: Mode
  /** Live widget templates only. */
  readonly capabilities?: Capabilities
}

export const NAME = /^[a-z][a-z0-9-]{0,47}$/

const string = (description: string): JSONSchema => ({ type: "string", description })
const label = string("Shown next to the field")
const hex = (description: string): JSONSchema => ({
  type: "string",
  pattern: "^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$",
  description: `${description}, "#rgb" or "#rrggbb"`,
})

const field = (type: string, properties: Record<string, JSONSchema>, required: ReadonlyArray<string>): JSONSchema => ({
  type: "object",
  properties: { key: string("Key of this field in the submitted value"), type: { const: type }, label, ...properties },
  required: ["key", "type", "label", ...required],
  additionalProperties: false,
})

const option: JSONSchema = {
  type: "object",
  properties: { value: string("Submitted value"), label: string("Shown to the user") },
  required: ["value", "label"],
  additionalProperties: false,
}

const make = (
  name: string,
  description: string,
  source: string,
  data: JSONSchema,
  mode: Mode = "step",
): WidgetTemplate => ({
  name,
  version: version(source, data, mode),
  description,
  data,
  source,
  builtin: true,
  mode,
})

export const builtins: ReadonlyArray<WidgetTemplate> = [
  make(
    "suggestions",
    "2 or 3 options as cards with image carousels; the user picks one, optionally with a note. Submits { choice, index, note? }.",
    suggestions,
    {
      type: "object",
      properties: {
        title: string("Question or heading shown above the options"),
        options: {
          type: "array",
          minItems: 2,
          maxItems: 3,
          items: {
            type: "object",
            properties: {
              label: string("Short name of the option; submitted as `choice`"),
              note: string("One line about the option"),
              images: {
                type: "array",
                minItems: 1,
                maxItems: 3,
                description: "Image URLs, data: URIs or paths relative to the session directory",
                items: { type: "string" },
              },
              recommended: { type: "boolean", description: "Marks the option as recommended" },
            },
            required: ["label", "images"],
            additionalProperties: false,
          },
        },
        allowNote: { type: "boolean", description: "Offer a free-text note sent with the pick (default true)" },
      },
      required: ["title", "options"],
      additionalProperties: false,
    },
  ),
  make(
    "form",
    "A form of text, number (slider), boolean (checkbox) and select fields with a submit button. Submits { [key]: value }.",
    form,
    {
      type: "object",
      properties: {
        title: string("Heading of the form"),
        description: string("Markdown shown under the title"),
        submitLabel: string("Label of the submit button (default Submit)"),
        fields: {
          type: "array",
          minItems: 1,
          items: {
            oneOf: [
              field(
                "text",
                {
                  placeholder: { type: "string" },
                  multiline: { type: "boolean" },
                  default: { type: "string" },
                },
                [],
              ),
              field(
                "number",
                {
                  min: { type: "number" },
                  max: { type: "number" },
                  step: { type: "number" },
                  default: { type: "number" },
                },
                ["min", "max"],
              ),
              field("boolean", { default: { type: "boolean" } }, []),
              field(
                "select",
                {
                  options: { type: "array", minItems: 1, items: option },
                  multiple: { type: "boolean" },
                  default: { anyOf: [{ type: "string" }, { type: "array", items: { type: "string" } }] },
                },
                ["options"],
              ),
            ],
          },
        },
      },
      required: ["title", "fields"],
      additionalProperties: false,
    },
  ),
  make("confirm", "A yes/no confirmation. Submits { confirmed: boolean }.", confirm, {
    type: "object",
    properties: {
      title: string("Question to confirm"),
      message: string("Markdown with the details"),
      confirmLabel: string("Label of the confirm button (default Confirm)"),
      cancelLabel: string("Label of the cancel button (default Cancel)"),
      danger: { type: "boolean", description: "Show the confirm button as destructive" },
    },
    required: ["title", "message"],
    additionalProperties: false,
  }),
  make(
    "chart",
    "An animated bar or line chart of one or more series; pressing shows values. Submits nothing, or { series, index, value } on a tap when choose is true.",
    chart,
    {
      type: "object",
      properties: {
        title: string("Heading of the chart"),
        kind: { enum: ["bar", "line"], description: "bar: grouped bars per label; line: one line per series" },
        series: {
          type: "array",
          minItems: 1,
          maxItems: 6,
          items: {
            type: "object",
            properties: {
              label: string("Name of the series; submitted as `series`"),
              values: { type: "array", minItems: 1, maxItems: 60, items: { type: "number" } },
              color: hex("Color of the series (default: a palette starting with the theme accent)"),
            },
            required: ["label", "values"],
            additionalProperties: false,
          },
        },
        labels: {
          type: "array",
          items: { type: "string" },
          description: "Label of each value index (x axis), e.g. months; default 1, 2, 3...",
        },
        unit: string('Unit appended to values, such as "%", "ms" or "k users"'),
        choose: { type: "boolean", description: "Tapping a bar or point submits it (default false)" },
      },
      required: ["title", "kind", "series"],
      additionalProperties: false,
    },
  ),
  make(
    "backdrop",
    "A title and text on an animated GPU shader banner (plasma, aurora or waves) with a speed slider. Submits nothing.",
    backdrop,
    {
      type: "object",
      properties: {
        title: string("Heading shown under the banner"),
        preset: { enum: ["plasma", "aurora", "waves"], description: "The shader" },
        text: string("Markdown shown under the title"),
        accent: hex("Accent color of the shader (default per preset)"),
      },
      required: ["title", "preset"],
      additionalProperties: false,
    },
  ),
  ...diagrams,
]
