import type { AssistantMessage, Message, Provider } from "@opencode-ai/sdk/v2"

export type ContextUsage = {
  readonly tokens: number
  readonly percent: number | null
}

export function contextUsage(
  messages: ReadonlyArray<Message>,
  providers: ReadonlyArray<Provider>,
): ContextUsage | undefined {
  const last = messages.findLast(
    (item): item is AssistantMessage => item.role === "assistant" && item.tokens.output > 0,
  )
  if (!last) return
  const tokens =
    last.tokens.input + last.tokens.output + last.tokens.reasoning + last.tokens.cache.read + last.tokens.cache.write
  const model = providers.find((item) => item.id === last.providerID)?.models[last.modelID]
  return { tokens, percent: model?.limit.context ? Math.round((tokens / model.limit.context) * 100) : null }
}
