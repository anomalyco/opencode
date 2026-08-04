import type { AssistantMessage, Message } from "@opencode-ai/sdk/v2/client"

type Provider = {
  id: string
  name?: string
  models: Record<string, Model | undefined>
}

type Model = {
  name?: string
  limit: {
    context: number
  }
}

type ModelKey = {
  providerID: string
  modelID: string
}

type Context = {
  message: AssistantMessage
  provider?: Provider
  model?: Model
  providerLabel: string
  modelLabel: string
  limit: number | undefined
  input: number
  total: number
  usage: number | null
}

const tokenTotal = (msg: AssistantMessage) => {
  return msg.tokens.input + msg.tokens.output + msg.tokens.reasoning + msg.tokens.cache.read + msg.tokens.cache.write
}

const lastAssistantWithTokens = (messages: Message[]) => {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (msg.role !== "assistant") continue
    if (tokenTotal(msg) <= 0) continue
    return msg
  }
  return undefined
}

const build = (messages: Message[] = [], providers: Provider[] = [], selected?: ModelKey): Context | undefined => {
  const message = lastAssistantWithTokens(messages)
  if (!message) return undefined

  const selectedProvider = selected ? providers.find((item) => item.id === selected.providerID) : undefined
  const selectedModel = selectedProvider?.models[selected?.modelID ?? ""]
  const provider = selectedModel ? selectedProvider : providers.find((item) => item.id === message.providerID)
  const model = selectedModel ?? provider?.models[message.modelID]
  const limit = model?.limit.context
  const total = tokenTotal(message)

  return {
    message,
    provider,
    model,
    providerLabel: provider?.name ?? selected?.providerID ?? message.providerID,
    modelLabel: model?.name ?? selected?.modelID ?? message.modelID,
    limit,
    input: message.tokens.input,
    total,
    usage: limit ? Math.round((total / limit) * 100) : null,
  }
}

export function getSessionContext(messages: Message[] = [], providers: Provider[] = [], selected?: ModelKey) {
  return build(messages, providers, selected)
}
