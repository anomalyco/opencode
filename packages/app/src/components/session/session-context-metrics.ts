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
  ctxInput: number
  ctxTotal: number
  usage: number | null
  sessInput: number
  sessOutput: number
  sessReasoning: number
  sessCacheRead: number
  sessCacheWrite: number
  sessTotal: number
}

const ctxTokenTotal = (msg: AssistantMessage) => {
  return msg.tokens.input + msg.tokens.output + msg.tokens.reasoning + msg.tokens.cache.read + msg.tokens.cache.write
}

const lastAssistantWithTokens = (messages: Message[]) => {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (msg.role !== "assistant") continue
    if (ctxTokenTotal(msg) <= 0) continue
    return msg
  }
}

const sumSessionTokens = (messages: Message[]) => {
  const total = {
    input: 0,
    output: 0,
    reasoning: 0,
    cacheRead: 0,
    cacheWrite: 0,
  }

  for (const msg of messages) {
    if (msg.role !== "assistant") continue
    total.input += msg.tokens.input
    total.output += msg.tokens.output
    total.reasoning += msg.tokens.reasoning
    total.cacheRead += msg.tokens.cache.read
    total.cacheWrite += msg.tokens.cache.write
  }

  return {
    ...total,
    total: total.input + total.output + total.reasoning + total.cacheRead + total.cacheWrite,
  }
}

const build = (messages: Message[] = [], providers: Provider[] = []): Context | undefined => {
  const message = lastAssistantWithTokens(messages)
  if (!message) return undefined

  const provider = providers.find((item) => item.id === message.providerID)
  const model = provider?.models[message.modelID]
  const limit = model?.limit.context
  const ctxTotal = ctxTokenTotal(message)
  const sess = sumSessionTokens(messages)

  return {
    message,
    provider,
    model,
    providerLabel: provider?.name ?? message.providerID,
    modelLabel: model?.name ?? message.modelID,
    limit,
    ctxInput: message.tokens.input,
    ctxTotal,
    usage: limit ? Math.round((ctxTotal / limit) * 100) : null,
    sessInput: sess.input,
    sessOutput: sess.output,
    sessReasoning: sess.reasoning,
    sessCacheRead: sess.cacheRead,
    sessCacheWrite: sess.cacheWrite,
    sessTotal: sess.total,
  }
}

export function getSessionContext(messages: Message[] = [], providers: Provider[] = []) {
  return build(messages, providers)
}
