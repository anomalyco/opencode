export * as Widget from "./widget.js"

import { Schema } from "effect"

/** A template name, unique per server. */
export const Name = Schema.String.check(Schema.isPattern(/^[a-z][a-z0-9-]{0,47}$/)).annotate({
  identifier: "Widget.Name",
})
export type Name = typeof Name.Type

/** The first 16 hex characters of `sha256(source + "\n" + JSON.stringify(data))`: a content address. */
export const Version = Schema.String.check(Schema.isPattern(/^[0-9a-f]{16}$/)).annotate({
  identifier: "Widget.Version",
})
export type Version = typeof Version.Type

export interface Ref extends Schema.Schema.Type<typeof Ref> {}
export const Ref = Schema.Struct({
  name: Name,
  version: Version,
}).annotate({ identifier: "Widget.Ref" })

/** A JSON Schema (draft 2020-12 subset) describing the data a template takes. */
export const DataSchema = Schema.Record(Schema.String, Schema.Json).annotate({ identifier: "Widget.DataSchema" })
export type DataSchema = typeof DataSchema.Type

/** A template version without its source, as listed. */
export interface Summary extends Schema.Schema.Type<typeof Summary> {}
export const Summary = Schema.Struct({
  name: Name,
  version: Version,
  /** One line, shown to the model when listing templates. */
  description: Schema.String,
  data: DataSchema,
  builtin: Schema.Boolean,
}).annotate({ identifier: "Widget.Summary" })

export interface Template extends Schema.Schema.Type<typeof Template> {}
export const Template = Schema.Struct({
  ...Summary.fields,
  /** The template's PsychoScript source. */
  source: Schema.String,
}).annotate({ identifier: "Widget.Template" })

/** A template with its runnable program: the widget prelude followed by the source. */
export interface Program extends Schema.Schema.Type<typeof Program> {}
export const Program = Schema.Struct({
  ...Template.fields,
  program: Schema.String,
}).annotate({ identifier: "Widget.Program" })

export const Status = Schema.Literals(["open", "submitted", "dismissed"]).annotate({ identifier: "Widget.Status" })
export type Status = typeof Status.Type

export interface Submit extends Schema.Schema.Type<typeof Submit> {}
export const Submit = Schema.Struct({ value: Schema.Json }).annotate({ identifier: "Widget.Submit" })

export interface Dismiss extends Schema.Schema.Type<typeof Dismiss> {}
export const Dismiss = Schema.Struct({ dismiss: Schema.Literal(true) }).annotate({ identifier: "Widget.Dismiss" })

/** A response to an open widget: the submitted value, or a dismissal. */
export const Response = Schema.Union([Submit, Dismiss]).annotate({ identifier: "Widget.Response" })
export type Response = Submit | Dismiss
