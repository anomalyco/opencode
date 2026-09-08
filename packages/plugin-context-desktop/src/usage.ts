import type { ModelInfo, ProviderInfo, SessionMessageInfo } from "@opencode/client"

export function contextUsage(
  messages: readonly SessionMessageInfo[],
  models: readonly Pick<ModelInfo, "id" | "modelID" | "providerID" | "name" | "limit">[],
  providers: readonly Pick<ProviderInfo, "id" | "name">[],
) {
  const message = messages.findLast((item) => item.type === "assistant" && !!item.tokens)
  if (message?.type !== "assistant" || !message.tokens) return
  const model = models.find(
    (model) =>
      model.providerID === message.model.providerID &&
      (model.modelID === message.model.id || model.id === message.model.id),
  )
  const provider = providers.find((provider) => provider.id === message.model.providerID)
  const total =
    message.tokens.input +
    message.tokens.output +
    message.tokens.reasoning +
    message.tokens.cache.read +
    message.tokens.cache.write
  return {
    message,
    tokens: message.tokens,
    total,
    input: message.tokens.input,
    providerLabel: provider?.name ?? message.model.providerID,
    modelLabel: model?.name ?? message.model.id,
    limit: model?.limit.context,
    usage: model?.limit.context ? Math.round((total / model.limit.context) * 100) : null,
  }
}
