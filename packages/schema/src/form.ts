export * as Form from "./form.js"

import { Schema } from "effect"
import { define, inventory } from "./event.js"
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

export const When = Schema.Struct({
  key: Schema.String,
  op: Schema.Literals(["eq", "neq"]),
  value: Schema.String,
}).annotate({ identifier: "Form.When" })
export interface When extends Schema.Schema.Type<typeof When> {}

const FieldBase = {
  key: Schema.String,
  title: Schema.String.pipe(optional),
  description: Schema.String.pipe(optional),
  required: Schema.Boolean.pipe(optional),
  when: When.pipe(optional),
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
  title: Schema.String.pipe(optional),
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

export const Value = Schema.Union([Schema.String, Schema.Number, Schema.Boolean, Schema.Array(Schema.String)]).annotate({
  identifier: "Form.Value",
})
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

const Created = define({ type: "form.created", schema: { form: Info } })
const Replied = define({ type: "form.replied", schema: { id: ID, sessionID: Schema.String, answer: Answer } })
const Cancelled = define({ type: "form.cancelled", schema: { id: ID, sessionID: Schema.String } })

export const Event = { Created, Replied, Cancelled, Definitions: inventory(Created, Replied, Cancelled) }
