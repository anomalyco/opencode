export * as Expected from "./session-message.js"

// These are partial expectations, not complete message fixtures or schema constructors.
export const user = <Text>(text: Text) => ({ type: "user" as const, text })

export const text = <Text>(text: Text) => ({ type: "text" as const, text })

export const reasoning = <Text>(text: Text) => ({ type: "reasoning" as const, text })

export const assistant = <const Finish, Content>(finish: Finish, content: Content) => ({
  type: "assistant" as const,
  finish,
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
