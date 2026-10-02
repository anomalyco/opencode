import type {
  CreateElicitationResponse,
  ElicitationPropertySchema,
  ElicitationSchema,
  EnumOption,
} from "@agentclientprotocol/sdk"
import type { OpenCodeClient } from "@opencode/client/effect"
import { Form } from "@opencode/schema/form"
import { Session } from "@opencode/schema/session"
import { Cause, Effect, Option, Schema } from "effect"
import type { Capabilities } from "./capabilities"
import { ACPChild } from "./child"
import type { ACPConnection } from "./connection"

export type AskedForm = Omit<Form.Info, "id"> & { readonly id: string }
type InputField = Exclude<Form.Field, Form.ExternalField>
type SelectField = Form.StringField | Form.MultiselectField

const QuestionKind = "question"
// Form mode must not collect secrets; elicit only flows known to be credential-free.
const ElicitedKind = Schema.Struct({ kind: Schema.Literals([QuestionKind, "websearch.provider"]) })
const Credential = /password|passphrase|secret|token|api[_ -]?key|credential|private[_ -]?key/i
const ToolSource = Schema.Struct({ tool: Schema.Struct({ id: Schema.String }) })

type Input = {
  readonly client: OpenCodeClient
  readonly connection: ACPConnection.Interface
  readonly form: Form.Info
  readonly requestedSchema: ElicitationSchema
  readonly clientSessionID: string
  readonly child?: ACPChild.Session
  readonly toolCallSent: boolean
  readonly settled: Effect.Effect<void>
}

type Outcome = Form.Answer | "cancel" | "settled"

export const reply = Effect.fn("cli.acp.elicitation.reply")(function* (input: Input, cancelled: Effect.Effect<void>) {
  yield* Effect.uninterruptibleMask((restore) =>
    // The race starts racers in order and stops once one is done, so an earlier cancel never starts the ask.
    restore(
      cancelled.pipe(
        Effect.as("cancel" as const),
        Effect.raceFirst(input.settled.pipe(Effect.as("settled" as const))),
        Effect.raceFirst(ask(input)),
      ),
    ).pipe(
      Effect.tapCauseIf(Cause.hasDies, (cause) => Effect.logWarning("ACP elicitation failed", cause)),
      Effect.catchCause(() => Effect.succeed("cancel" as const)),
      Effect.flatMap((outcome) => respond(input, outcome)),
    ),
  )
})

export const UnshownQuestionMessage =
  "The question couldn't be shown to the user in this client. Continue without an answer: make reasonable assumptions and state them, or ask the user in your reply if you can't proceed."

function cancel(client: OpenCodeClient, form: Form.Info, message?: string) {
  return client.session.form.cancel({ sessionID: form.sessionID, formID: form.id, message }).pipe(
    Effect.catchTag(["FormAlreadySettledError", "FormNotFoundError"], () => Effect.void),
    Effect.catch(() =>
      Schema.decodeUnknownEffect(Session.ID)(form.sessionID).pipe(
        Effect.flatMap((sessionID) => client.session.interrupt({ sessionID })),
        Effect.ignore,
      ),
    ),
  )
}

export function requestedSchema(form: AskedForm, capabilities: Capabilities): ElicitationSchema | undefined {
  if (!capabilities.formElicitation) return undefined
  if (Option.isNone(Schema.decodeUnknownOption(ElicitedKind)(form.metadata))) return undefined
  if (form.fields.some(credentialLike)) return undefined
  const fields = form.fields.filter((field): field is InputField => field.type !== "external")
  if (fields.length !== form.fields.length || fields.some((field) => field.when?.length)) return undefined
  if (fields.some((field) => field.hidden && field.required && field.default === undefined)) return undefined
  const keys = new Set(fields.map((field) => field.key))
  const visible = fields.filter((field) => !field.hidden)
  if (!visible.every((field) => representable(field, keys))) return undefined
  return {
    type: "object",
    properties: Object.fromEntries(visible.flatMap(properties)),
    required: visible.filter((field) => field.required).map((field) => field.key),
  }
}

// The question tool returns the message to the model, so the turn continues instead of ending as interrupted.
export function cancelUnshown(client: OpenCodeClient, form: Form.Info) {
  return cancel(client, form, form.metadata?.kind === QuestionKind ? UnshownQuestionMessage : undefined).pipe(
    Effect.uninterruptible,
  )
}

function answer(form: AskedForm, response: CreateElicitationResponse): Form.Answer | undefined {
  if (response.action !== "accept") return undefined
  const content = Schema.decodeUnknownOption(Form.Answer)(response.content ?? {})
  if (Option.isNone(content)) return undefined
  return Object.fromEntries(
    form.fields.flatMap((field) => {
      const value = fieldAnswer(field, content.value)
      return value === undefined ? [] : [[field.key, value]]
    }),
  )
}

const ask = Effect.fnUntraced(function* (input: Input) {
  const source = input.toolCallSent ? Schema.decodeUnknownOption(ToolSource)(input.form.metadata) : Option.none()
  const toolCallID = Option.getOrUndefined(Option.map(source, (metadata) => metadata.tool.id))
  const response = yield* input.connection.createElicitation({
    mode: "form",
    sessionId: input.clientSessionID,
    ...(toolCallID ? { toolCallId: ACPChild.toolCallID(input.child, toolCallID) } : {}),
    message: ACPChild.title(input.child, input.form.title),
    requestedSchema: input.requestedSchema,
  })
  return answer(input.form, response) ?? "cancel"
})

function respond(input: Input, outcome: Outcome) {
  if (outcome === "settled") return Effect.void
  if (outcome === "cancel") return cancel(input.client, input.form)
  return input.client.session.form
    .reply({ sessionID: input.form.sessionID, formID: input.form.id, answer: outcome })
    .pipe(
      Effect.catchTag(["FormAlreadySettledError", "FormNotFoundError"], () => Effect.void),
      Effect.catch((cause) =>
        Effect.logWarning("ACP form reply failed", cause).pipe(Effect.andThen(cancel(input.client, input.form))),
      ),
    )
}

function credentialLike(field: Form.Field) {
  const labels =
    field.type === "string" || field.type === "multiselect" ? (field.options ?? []).map((option) => option.label) : []
  return [field.key, field.title, field.description, ...labels].some(
    (text) => text !== undefined && Credential.test(text),
  )
}

function representable(field: InputField, keys: ReadonlySet<string>) {
  if (field.type !== "string" && field.type !== "multiselect") return true
  if (!hasOptions(field)) return true
  const values = new Set(field.options?.map((option) => option.value))
  const defaults =
    field.default === undefined ? [] : typeof field.default === "string" ? [field.default] : field.default
  if (defaults.some((value) => !values.has(value))) return false
  if (!field.custom) return true
  if (field.required || keys.has(customKey(field))) return false
  return field.type === "string" || (field.minItems === undefined && field.maxItems === undefined)
}

function properties(field: InputField): Array<[string, ElicitationPropertySchema]> {
  const base = { title: field.title, description: field.description }
  switch (field.type) {
    case "string": {
      if (!hasOptions(field)) return [[field.key, { type: "string", ...base, ...text(field), default: field.default }]]
      const select: ElicitationPropertySchema = {
        type: "string",
        ...base,
        oneOf: options(field),
        default: field.default,
      }
      return field.custom ? [[field.key, select], other(field, "Type your own answer")] : [[field.key, select]]
    }
    case "multiselect": {
      const select: ElicitationPropertySchema = {
        type: "array",
        ...base,
        items: { anyOf: options(field) },
        minItems: field.required ? Math.max(field.minItems ?? 0, 1) : field.minItems,
        maxItems: field.maxItems,
        default: field.default,
      }
      return field.custom ? [[field.key, select], other(field, "Add your own answer")] : [[field.key, select]]
    }
    case "number":
    case "integer":
      return [
        [
          field.key,
          { type: field.type, ...base, minimum: field.minimum, maximum: field.maximum, default: field.default },
        ],
      ]
    case "boolean":
      return [[field.key, { type: "boolean", ...base, default: field.default }]]
  }
}

function other(field: SelectField, description: string): [string, ElicitationPropertySchema] {
  return [
    customKey(field),
    {
      type: "string",
      title: `${field.title ?? field.key} (other)`,
      description,
      ...(field.type === "string" ? text(field) : {}),
    },
  ]
}

// Core rejects an empty string for a required field.
function text(field: Form.StringField) {
  return {
    format: field.format,
    minLength: field.required ? Math.max(field.minLength ?? 0, 1) : field.minLength,
    maxLength: field.maxLength,
    pattern: field.pattern,
  }
}

function options(field: SelectField): EnumOption[] {
  return (field.options ?? []).map((option) => ({
    const: option.value,
    title: option.label,
    description: option.description,
  }))
}

function fieldAnswer(field: Form.Field, content: Form.Answer) {
  if (field.type !== "external" && field.hidden) return field.default
  const value = content[field.key]
  if ((field.type !== "string" && field.type !== "multiselect") || !field.custom || !hasOptions(field)) return value
  const custom = content[customKey(field)]
  if (typeof custom !== "string" || custom.trim() === "") return value
  if (field.type === "string") return custom
  return Array.isArray(value) ? [...value, custom] : [custom]
}

function hasOptions(field: SelectField) {
  return field.type === "multiselect" || field.options !== undefined
}

function customKey(field: SelectField) {
  return `${field.key}_custom`
}

export * as ACPElicitation from "./elicitation"
