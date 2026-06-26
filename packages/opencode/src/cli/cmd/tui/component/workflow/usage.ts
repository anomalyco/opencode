import { createMemo, type Accessor } from "solid-js"
import { useSync } from "@tui/context/sync"
import { Locale } from "@/util/locale"

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" })

export type Usage = {
  context: string
  cost: string | undefined
  tokens: number
  pct: number | undefined
}

export function useUsage(sessionID: Accessor<string | undefined>): Accessor<Usage | undefined> {
  const sync = useSync()
  return createMemo(() => {
    const id = sessionID()
    if (!id) return
    const session = sync.session.get(id)
    const msg = sync.data.message[id] ?? []
    const last = msg.findLast((item): item is import("@opencode-ai/sdk/v2").AssistantMessage =>
      item.role === "assistant" && item.tokens.output > 0,
    )
    if (!last) return

    const tokens =
      last.tokens.input + last.tokens.output + last.tokens.reasoning + last.tokens.cache.read + last.tokens.cache.write
    if (tokens <= 0) return

    const model = sync.data.provider.find((item) => item.id === last.providerID)?.models[last.modelID]
    const limit = model?.limit.context
    const pct = limit ? Math.round((tokens / limit) * 100) : undefined
    const cost = session?.cost ?? 0
    return {
      context: pct !== undefined ? `${Locale.number(tokens)} (${pct}%)` : Locale.number(tokens),
      cost: cost > 0 ? money.format(cost) : undefined,
      tokens,
      pct,
    }
  })
}

export function contextPct(sessionID: string, sync: ReturnType<typeof useSync>): number | undefined {
  const msg = sync.data.message[sessionID] ?? []
  const last = msg.findLast((item): item is import("@opencode-ai/sdk/v2").AssistantMessage =>
    item.role === "assistant" && item.tokens.output > 0,
  )
  if (!last) return
  const tokens =
    last.tokens.input + last.tokens.output + last.tokens.reasoning + last.tokens.cache.read + last.tokens.cache.write
  if (tokens <= 0) return
  const model = sync.data.provider.find((item) => item.id === last.providerID)?.models[last.modelID]
  const limit = model?.limit.context
  return limit ? Math.round((tokens / limit) * 100) : undefined
}

export * as WorkflowUsage from "./usage"