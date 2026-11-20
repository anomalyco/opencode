import type { JSONSchema } from "./json-schema.js"
import { version } from "./program.js"
import { confirm, form, suggestions } from "./source.js"

export interface Template {
  /** /^[a-z][a-z0-9-]{0,47}$/, unique per server */
  readonly name: string
  /** `version(source, data)`: a content address; a version is immutable. */
  readonly version: string
  /** One line, shown to the model when listing templates. */
  readonly description: string
  /** JSON Schema for the data the template takes. */
  readonly data: JSONSchema
  /** The template source, without the prelude; clients run `program(source)`. */
  readonly source: string
  readonly builtin: boolean
}

export const NAME = /^[a-z][a-z0-9-]{0,47}$/

const string = (description: string): JSONSchema => ({ type: "string", description })
const label = string("Shown next to the field")

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

const make = (name: string, description: string, source: string, data: JSONSchema): Template => ({
  name,
  version: version(source, data),
  description,
  data,
  source,
  builtin: true,
})

export const builtins: ReadonlyArray<Template> = [
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
]
