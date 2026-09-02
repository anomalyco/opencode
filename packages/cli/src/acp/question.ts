import type { AgentSideConnection } from "@agentclientprotocol/sdk"
import type { EventSubscribeOutput, OpenCodeClient } from "@opencode-ai/client/promise"

type FormEvent = Extract<EventSubscribeOutput, { type: "form.created" }>
type QuestionField = Extract<FormEvent["data"]["form"]["fields"][number], { type: "string" | "multiselect" }>
type Connection = Partial<Pick<AgentSideConnection, "extMethod">>

type ElicitationResponse = {
  readonly action?: {
    readonly action?: "accept" | "decline" | "cancel"
    readonly content?: Readonly<Record<string, unknown>> | null
  }
}

export async function replyQuestion(input: {
  readonly client: OpenCodeClient
  readonly connection: Connection | undefined
  readonly event: FormEvent
  readonly clientSessionID: string
  readonly supported: boolean
}) {
  const form = input.event.data.form
  const cancel = () =>
    input.client.form.cancel({
      sessionID: form.sessionID,
      formID: form.id,
    })
  if (!input.supported || !input.connection?.extMethod) return cancel()
  const fields = form.fields.filter(
    (field): field is QuestionField => field.type === "string" || field.type === "multiselect",
  )
  if (fields.length !== form.fields.length) return cancel()

  const properties = Object.fromEntries(
    fields.map((field) => {
      const options = (field.options ?? []).map((option) => ({
        const: option.value,
        title: option.label,
        description: option.description,
      }))
      return [
        field.key,
        field.type === "multiselect"
          ? {
              type: "array",
              title: field.title,
              description: field.description,
              items: { anyOf: options },
            }
          : {
              type: "string",
              title: field.title,
              description: field.description,
              ...(options.length > 0 ? { oneOf: options } : {}),
            },
      ]
    }),
  )
  const response = (await input.connection
    .extMethod("session/elicitation", {
      mode: "form",
      sessionId: input.clientSessionID,
      message: form.fields[0]?.description ?? form.title,
      requestedSchema: {
        type: "object",
        properties,
        required: Object.keys(properties),
        title: form.title,
      },
    })
    .catch(() => undefined)) as ElicitationResponse | undefined
  if (response?.action?.action !== "accept") return cancel()

  const content = response.action.content ?? {}
  const answer = Object.fromEntries(
    fields.flatMap((field): ReadonlyArray<readonly [string, string | ReadonlyArray<string>]> => {
      const value = content[field.key]
      if (field.type === "multiselect" && Array.isArray(value)) {
        return [[field.key, value.flatMap((entry) => (typeof entry === "string" && entry.trim() ? [entry.trim()] : []))]]
      }
      if (field.type === "string" && typeof value === "string" && value.trim()) {
        return [[field.key, value.trim()]]
      }
      return []
    }),
  )
  return input.client.form.reply({
    sessionID: form.sessionID,
    formID: form.id,
    answer,
  })
}
