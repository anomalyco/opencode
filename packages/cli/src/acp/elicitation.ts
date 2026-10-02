import type {
  CreateElicitationResponse,
  ElicitationPropertySchema,
  ElicitationSchema,
  EnumOption,
} from "@agentclientprotocol/sdk"
import { isFormAlreadySettledError, isFormNotFoundError, type OpenCodeClient } from "@opencode/client/promise"
import { Form } from "@opencode/schema/form"
import { Cause, Effect, Option, Schema } from "effect"
import type { ACPConnection } from "./connection"
import type { ACPService } from "./service"

/** A form as the event stream carries it, with an unbranded ID. */
export type AskedForm = Omit<Form.Info, "id"> & { readonly id: string }
type InputField = Exclude<Form.Field, Form.ExternalField>
type SelectField = Form.StringField | Form.MultiselectField

// Form mode must not collect secrets, so only forms from flows known not to ask for credentials are elicited.
const QuestionKind = "question"
const ElicitedKind = Schema.Struct({ kind: Schema.Literals([QuestionKind, "websearch.provider"]) })
const Credential = /password|passphrase|secret|token|api[_ -]?key|credential|private[_ -]?key/i
const ToolSource = Schema.Struct({ tool: Schema.Struct({ id: Schema.String }) })

type Input = {
  readonly client: OpenCodeClient
  readonly connection: ACPConnection.Interface
  readonly form: AskedForm
  readonly requestedSchema: ElicitationSchema
  readonly clientSessionID: string
  readonly child?: { readonly id: string; readonly title?: string }
  /** Whether the asking tool call reached the client as a `session/update` tool call. */
  readonly toolCallSent: boolean
  /** Completes once the form is answered or cancelled elsewhere. */
  readonly settled: Effect.Effect<void>
}

type Outcome = Form.Answer | "cancel" | "settled"

/**
 * Asks the client, then resolves the form on the server. Once `cancelled` completes, the client's request is
 * cancelled or never sent, and the form is cancelled. Once `settled` completes, the client's request is cancelled and
 * the server is left alone. Resolving on the server is uninterruptible.
 */
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

/** Cancels a form, interrupting its session when the server can't cancel it. */
function cancel(client: OpenCodeClient, form: AskedForm, message?: string) {
  return settle(() => client.session.form.cancel({ sessionID: form.sessionID, formID: form.id, message })).pipe(
    Effect.catch(() =>
      Effect.tryPromise(() => client.session.interrupt({ sessionID: form.sessionID })).pipe(Effect.ignore),
    ),
  )
}

/**
 * The form-mode schema for a form, or undefined when the form is cancelled instead: the client lacks form
 * elicitation, the form is not from an allowed flow or has a field whose key, title, description, or option label
 * looks like a credential, or ACP can't represent it faithfully. Unrepresentable forms have `external` fields, `when`
 * conditions, a hidden required field without a default, a default outside a field's options, or a free-text answer
 * alongside options that must also satisfy `required` or item bounds across both inputs. Hidden fields are not asked
 * and answer with their default.
 */
export function requestedSchema(form: AskedForm, capabilities: ACPService.Capabilities): ElicitationSchema | undefined {
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

/**
 * Cancels a form that `requestedSchema` won't show. A question is cancelled with a message the question tool returns
 * to the model, so the turn continues instead of ending as interrupted; other forms are cancelled silently.
 */
export function cancelUnshown(client: OpenCodeClient, form: AskedForm) {
  return cancel(client, form, form.metadata?.kind === QuestionKind ? UnshownQuestionMessage : undefined)
}

/** The answer for an accepted response, or undefined when the user declined, cancelled, or sent invalid content. */
export function answer(form: AskedForm, response: CreateElicitationResponse): Form.Answer | undefined {
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
    ...(toolCallID ? { toolCallId: input.child ? `${input.child.id}:${toolCallID}` : toolCallID } : {}),
    message: input.child?.title ? `${input.child.title}: ${input.form.title}` : input.form.title,
    requestedSchema: input.requestedSchema,
  })
  return answer(input.form, response) ?? "cancel"
})

function respond(input: Input, outcome: Outcome) {
  if (outcome === "settled") return Effect.void
  if (outcome === "cancel") return cancel(input.client, input.form)
  return settle(() =>
    input.client.session.form.reply({ sessionID: input.form.sessionID, formID: input.form.id, answer: outcome }),
  ).pipe(
    Effect.catch((cause) =>
      Effect.logWarning("ACP form reply failed", cause).pipe(Effect.andThen(cancel(input.client, input.form))),
    ),
  )
}

// A form already answered or cancelled elsewhere needs nothing more.
function settle(evaluate: () => Promise<void>) {
  return Effect.tryPromise({ try: evaluate, catch: (cause) => cause }).pipe(
    Effect.catch((cause) =>
      isFormAlreadySettledError(cause) || isFormNotFoundError(cause) ? Effect.void : Effect.fail(cause),
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

// A free-text answer next to a field's options is a separate optional property that wins over the selection.
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

// Core rejects an empty string for a required field, so the client is told it needs at least one character.
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
