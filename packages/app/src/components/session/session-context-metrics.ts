import { costs, type CostStore } from "@opencode-ai/util/cost"
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

type Context = {
  message: AssistantMessage
  provider?: Provider
  model?: Model
  providerLabel: string
  modelLabel: string
  limit: number | undefined
  input: number
  output: number
  reasoning: number
  cacheRead: number
  cacheWrite: number
  total: number
  usage: number | null
}

type Metrics = {
  totalCost: number
  ownCost: number
  missing: string[]
  context: Context | undefined
}

const tokenTotal = (msg: AssistantMessage) => {
  return msg.tokens.input + msg.tokens.output + msg.tokens.reasoning + msg.tokens.cache.read + msg.tokens.cache.write
}

const lastAssistantWithTokens = (messages: Message[]) =>
  messages.findLast(
    (msg): msg is AssistantMessage => msg.role === "assistant" && tokenTotal(msg as AssistantMessage) > 0,
  )

const build = (messages: Message[] = [], providers: Provider[] = [], store?: CostStore): Metrics => {
  const id = messages[0]?.sessionID
  const result = store && id ? costs(id, store) : undefined

  const totalCost = result
    ? result.total
    : messages.reduce((sum, msg) => sum + (msg.role === "assistant" ? msg.cost : 0), 0)
  const ownCost = result ? result.own : totalCost
  const missing = result ? result.missing : []

  const message = lastAssistantWithTokens(messages)
  if (!message) return { totalCost, ownCost, missing, context: undefined }

  const provider = providers.find((item) => item.id === message.providerID)
  const model = provider?.models[message.modelID]
  const limit = model?.limit.context
  const total = tokenTotal(message)

  return {
    totalCost,
    ownCost,
    missing,
    context: {
      message,
      provider,
      model,
      providerLabel: provider?.name ?? message.providerID,
      modelLabel: model?.name ?? message.modelID,
      limit,
      input: message.tokens.input,
      output: message.tokens.output,
      reasoning: message.tokens.reasoning,
      cacheRead: message.tokens.cache.read,
      cacheWrite: message.tokens.cache.write,
      total,
      usage: limit ? Math.round((total / limit) * 100) : null,
    },
  }
}

export function getSessionContextMetrics(messages: Message[] = [], providers: Provider[] = [], store?: CostStore) {
  return build(messages, providers, store)
}
