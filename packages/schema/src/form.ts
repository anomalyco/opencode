export * as Form from "./form.js"

import { Schema } from "effect"
import { ephemeral, inventory } from "./event.js"
import { ascending } from "./identifier.js"
import { NonNegativeInt, optional, statics } from "./schema.js"

const IDSchema = Schema.String.check(Schema.isStartsWith("frm_")).pipe(Schema.brand("Form.ID"))

export const ID = IDSchema.pipe(
  statics((schema: typeof IDSchema) => ({ create: (id?: string) => schema.make(id ?? "frm_" + ascending()) })),
)
export type ID = typeof ID.Type

export const Metadata = Schema.Record(Schema.String, Schema.Unknown).annotate({ identifier: "Form.Metadata" })
export type Metadata = typeof Metadata.Type

export const Option = Schema.Struct({
  value: Schema.String,
  label: Schema.String,
  description: Schema.String.pipe(optional),
}).annotate({ identifier: "Form.Option" })
export interface Option extends Schema.Schema.Type<typeof Option> {}

// One visibility condition on a field. A field's `when` is a list of conditions that must all
// hold (AND) against the current answers for the field to be active. Semantics:
// - `value` must match the referenced field's type; against a multiselect answer, `eq` means
//   "selection includes value" and `neq` means "selection does not include value".
// - An unanswered referenced field makes the condition false for both ops.
// - `key` must reference a field defined earlier in the form's field list.
// Inactive fields are neither required nor answerable.
export const When = Schema.Struct({
  key: Schema.String,
  op: Schema.Literals(["eq", "neq"]),
  value: Schema.Union([Schema.String, Schema.Number, Schema.Boolean]),
}).annotate({ identifier: "Form.When" })
export interface When extends Schema.Schema.Type<typeof When> {}

const FieldBase = {
  key: Schema.String,
  title: Schema.String.pipe(optional),
  description: Schema.String.pipe(optional),
  required: Schema.Boolean.pipe(optional),
  when: Schema.Array(When).pipe(optional),
}

export const StringField = Schema.Struct({
  ...FieldBase,
  type: Schema.Literal("string"),
  format: Schema.Literals(["email", "uri", "date", "date-time"]).pipe(optional),
  minLength: NonNegativeInt.pipe(optional),
  maxLength: NonNegativeInt.pipe(optional),
  pattern: Schema.String.pipe(optional),
  placeholder: Schema.String.pipe(optional),
  default: Schema.String.pipe(optional),
  options: Schema.Array(Option).pipe(optional),
  custom: Schema.Boolean.pipe(optional),
}).annotate({ identifier: "Form.StringField" })
export interface StringField extends Schema.Schema.Type<typeof StringField> {}

export const NumberField = Schema.Struct({
  ...FieldBase,
  type: Schema.Literal("number"),
  minimum: Schema.Number.pipe(optional),
  maximum: Schema.Number.pipe(optional),
  default: Schema.Number.pipe(optional),
}).annotate({ identifier: "Form.NumberField" })
export interface NumberField extends Schema.Schema.Type<typeof NumberField> {}

export const IntegerField = Schema.Struct({
  ...FieldBase,
  type: Schema.Literal("integer"),
  minimum: Schema.Number.pipe(optional),
  maximum: Schema.Number.pipe(optional),
  default: Schema.Number.pipe(optional),
}).annotate({ identifier: "Form.IntegerField" })
export interface IntegerField extends Schema.Schema.Type<typeof IntegerField> {}

export const BooleanField = Schema.Struct({
  ...FieldBase,
  type: Schema.Literal("boolean"),
  default: Schema.Boolean.pipe(optional),
}).annotate({ identifier: "Form.BooleanField" })
export interface BooleanField extends Schema.Schema.Type<typeof BooleanField> {}

export const MultiselectField = Schema.Struct({
  ...FieldBase,
  type: Schema.Literal("multiselect"),
  options: Schema.Array(Option),
  minItems: NonNegativeInt.pipe(optional),
  maxItems: NonNegativeInt.pipe(optional),
  custom: Schema.Boolean.pipe(optional),
  default: Schema.Array(Schema.String).pipe(optional),
}).annotate({ identifier: "Form.MultiselectField" })
export interface MultiselectField extends Schema.Schema.Type<typeof MultiselectField> {}

export const Field = Schema.Union([StringField, NumberField, IntegerField, BooleanField, MultiselectField]).pipe(
  Schema.toTaggedUnion("type"),
)
export type Field = StringField | NumberField | IntegerField | BooleanField | MultiselectField

const InfoBase = {
  id: ID,
  // This should be typed as SessionID. It is a plain string only because MCP elicitation
  // temporarily needs the `"global"` sentinel owner, which is not a real session. Once
  // elicitations can be attributed to real sessions, revert this to SessionID. Do not rely
  // on non-session owners anywhere else.
  sessionID: Schema.String,
  title: Schema.String,
  metadata: Metadata.pipe(optional),
}

export const FormInfo = Schema.Struct({
  ...InfoBase,
  mode: Schema.Literal("form"),
  fields: Schema.Array(Field),
}).annotate({ identifier: "Form.FormInfo" })
export interface FormInfo extends Schema.Schema.Type<typeof FormInfo> {}

export const UrlInfo = Schema.Struct({
  ...InfoBase,
  mode: Schema.Literal("url"),
  url: Schema.String,
}).annotate({ identifier: "Form.UrlInfo" })
export interface UrlInfo extends Schema.Schema.Type<typeof UrlInfo> {}

export const Info = Schema.Union([FormInfo, UrlInfo]).pipe(Schema.toTaggedUnion("mode"))
export type Info = FormInfo | UrlInfo

export const Value = Schema.Union([Schema.String, Schema.Number, Schema.Boolean, Schema.Array(Schema.String)]).annotate(
  {
    identifier: "Form.Value",
  },
)
export type Value = typeof Value.Type

export const Answer = Schema.Record(Schema.String, Value).annotate({ identifier: "Form.Answer" })
export type Answer = typeof Answer.Type

export const State = Schema.Union([
  Schema.Struct({ status: Schema.Literal("pending") }),
  Schema.Struct({ status: Schema.Literal("answered"), answer: Answer }),
  Schema.Struct({ status: Schema.Literal("cancelled") }),
])
  .pipe(Schema.toTaggedUnion("status"))
  .annotate({ identifier: "Form.State" })
export type State = typeof State.Type

export const Reply = Schema.Struct({
  answer: Answer,
}).annotate({ identifier: "Form.Reply" })
export interface Reply extends Schema.Schema.Type<typeof Reply> {}

const Created = ephemeral({ type: "form.created", schema: { form: Info } })
const Replied = ephemeral({ type: "form.replied", schema: { id: ID, sessionID: Schema.String, answer: Answer } })
const Cancelled = ephemeral({ type: "form.cancelled", schema: { id: ID, sessionID: Schema.String } })

export const Event = { Created, Replied, Cancelled, Definitions: inventory(Created, Replied, Cancelled) }
