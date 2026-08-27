export * as Expected from "./session-message.js"

// Partial expected values, not input fixtures. Keep each assertion's matcher and fields explicit.
export const user = <Text>(text: Text) => ({ type: "user" as const, text })

export const text = <Text>(text: Text) => ({ type: "text" as const, text })

export const reasoning = <Text>(text: Text) => ({ type: "reasoning" as const, text })

export const assistant = <const Fields extends object, Content>(fields: Fields, content: Content) => ({
  ...fields,
  type: "assistant" as const,
  content,
})

type ToolFields = {
  readonly input?: unknown
  readonly content?: unknown
  readonly metadata?: unknown
  readonly status?: never
}

type ToolIdentity = {
  readonly id?: unknown
  readonly name?: unknown
  readonly executed?: unknown
  readonly providerState?: unknown
  readonly providerResultState?: unknown
  readonly time?: unknown
}

export const completedTool = <Identity extends ToolIdentity, Fields extends ToolFields>(
  identity: Identity,
  fields: Fields,
) => ({
  ...identity,
  type: "tool" as const,
  state: { ...fields, status: "completed" as const },
})

export const failedTool = <Identity extends ToolIdentity, Fields extends ToolFields & { readonly error?: unknown }>(
  identity: Identity,
  fields: Fields,
) => ({
  ...identity,
  type: "tool" as const,
  state: { ...fields, status: "error" as const },
})
