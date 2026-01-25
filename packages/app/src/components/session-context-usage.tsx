import { For, Match, Show, Switch, createMemo } from "solid-js"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { ProgressCircle } from "@opencode-ai/ui/progress-circle"
import { Button } from "@opencode-ai/ui/button"
import { useParams } from "@solidjs/router"
import { AssistantMessage } from "@opencode-ai/sdk/v2/client"

import { useLayout } from "@/context/layout"
import { useSync } from "@/context/sync"

interface SessionContextUsageProps {
  variant?: "button" | "indicator"
}

interface ProviderUsage {
  provider: string
  tokens: number
  cost: number
  requests: number
  percentage: number
}

interface ModelUsage {
  model: string
  provider: string
  input: number
  output: number
  cost: number
  requests: number
  total: number
}

function getProviderEmoji(provider: string): string {
  const p = provider.toLowerCase()
  if (p.includes("anthropic")) return "🟣"
  if (p.includes("google")) return "🔵"
  if (p.includes("openai")) return "🟢"
  if (p.includes("antigravity")) return "🌌"
  if (p.includes("xai") || p.includes("grok")) return "⚡"
  if (p.includes("groq")) return "🟠"
  if (p.includes("mistral")) return "🔶"
  if (p.includes("deepseek")) return "🐋"
  return "⚪"
}

function shortenModelName(model: string): string {
  return model
    .replace("claude-", "")
    .replace("gpt-", "")
    .replace("gemini-", "")
    .replace("-latest", "")
    .replace("-20250514", "")
    .replace("-20250219", "")
    .replace("-20241022", "")
    .replace("-20240620", "")
}

function formatCost(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 4,
    maximumFractionDigits: 4,
  }).format(n)
}

function getProviderLabel(provider: string): string {
  const p = provider.toLowerCase()
  if (p.includes("anthropic")) return "Anthropic"
  if (p.includes("google")) return "Google"
  if (p.includes("openai")) return "OpenAI"
  if (p.includes("antigravity")) return "Antigravity"
  if (p.includes("xai") || p.includes("grok")) return "xAI"
  return provider
}

function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}K`
  return tokens.toString()
}

export function SessionContextUsage(props: SessionContextUsageProps) {
  const sync = useSync()
  const params = useParams()
  const layout = useLayout()

  const variant = createMemo(() => props.variant ?? "button")
  const sessionKey = createMemo(() => `${params.dir}${params.id ? "/" + params.id : ""}`)
  const tabs = createMemo(() => layout.tabs(sessionKey()))
  const messages = createMemo(() => (params.id ? (sync.data.message[params.id] ?? []) : []))

  const cost = createMemo(() => {
    const total = messages().reduce((sum, x) => sum + (x.role === "assistant" ? x.cost : 0), 0)
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(total)
  })

  // Per-provider usage breakdown
  const providerUsage = createMemo((): ProviderUsage[] => {
    const byProvider = new Map<string, { tokens: number; cost: number; requests: number }>()
    
    for (const msg of messages()) {
      if (msg.role !== "assistant") continue
      const assistant = msg as AssistantMessage
      const providerId = assistant.providerID
      if (!providerId) continue
      
      const tokens = assistant.tokens.input + assistant.tokens.output + 
                     assistant.tokens.reasoning + assistant.tokens.cache.read + 
                     assistant.tokens.cache.write
      
      const existing = byProvider.get(providerId) || { tokens: 0, cost: 0, requests: 0 }
      existing.tokens += tokens
      existing.cost += assistant.cost || 0
      existing.requests += 1
      byProvider.set(providerId, existing)
    }
    
    const totalTokens = Array.from(byProvider.values()).reduce((sum, x) => sum + x.tokens, 0)
    
    const result: ProviderUsage[] = []
    for (const [provider, usage] of byProvider) {
      result.push({
        provider,
        tokens: usage.tokens,
        cost: usage.cost,
        requests: usage.requests,
        percentage: totalTokens > 0 ? (usage.tokens / totalTokens) * 100 : 0,
      })
    }
    
    return result.sort((a, b) => b.tokens - a.tokens)
  })

  // Per-model usage breakdown
  const modelUsage = createMemo((): ModelUsage[] => {
    const byModel = new Map<string, { provider: string; input: number; output: number; cost: number; requests: number }>()

    for (const msg of messages()) {
      if (msg.role !== "assistant") continue
      const assistant = msg as AssistantMessage
      const providerId = assistant.providerID || "unknown"
      const modelId = assistant.modelID || "unknown"
      const key = `${providerId}:${modelId}`

      const existing = byModel.get(key) || { provider: providerId, input: 0, output: 0, cost: 0, requests: 0 }
      existing.input += assistant.tokens.input + assistant.tokens.cache.read
      existing.output += assistant.tokens.output + assistant.tokens.reasoning
      existing.cost += assistant.cost || 0
      existing.requests += 1
      byModel.set(key, existing)
    }

    const result: ModelUsage[] = []
    for (const [key, usage] of byModel) {
      const modelId = key.split(":").slice(1).join(":")
      result.push({
        model: modelId,
        provider: usage.provider,
        input: usage.input,
        output: usage.output,
        cost: usage.cost,
        requests: usage.requests,
        total: usage.input + usage.output,
      })
    }

    return result.sort((a, b) => b.total - a.total)
  })

  const totalTokens = createMemo(() => {
    return providerUsage().reduce((sum, x) => sum + x.tokens, 0)
  })

  const context = createMemo(() => {
    const last = messages().findLast((x) => {
      if (x.role !== "assistant") return false
      const total = x.tokens.input + x.tokens.output + x.tokens.reasoning + x.tokens.cache.read + x.tokens.cache.write
      return total > 0
    }) as AssistantMessage
    if (!last) return
    const total =
      last.tokens.input + last.tokens.output + last.tokens.reasoning + last.tokens.cache.read + last.tokens.cache.write
    const model = sync.data.provider.all.find((x) => x.id === last.providerID)?.models[last.modelID]
    return {
      tokens: total.toLocaleString(),
      percentage: model?.limit.context ? Math.round((total / model.limit.context) * 100) : null,
    }
  })

  const openContext = () => {
    if (!params.id) return
    layout.review.open()
    tabs().open("context")
    tabs().setActive("context")
  }

  const circle = () => (
    <div class="p-1">
      <ProgressCircle size={16} strokeWidth={2} percentage={context()?.percentage ?? 0} />
    </div>
  )

  const tooltipValue = () => (
    <div class="min-w-48">
      {/* Provider Usage Breakdown */}
      <Show when={providerUsage().length > 0}>
        <div class="mb-2 pb-2 border-b border-border-base/30">
          <div class="text-11-medium text-text-invert-base mb-1.5">Provider Usage</div>
          <For each={providerUsage()}>
            {(usage) => (
              <div class="flex items-center justify-between gap-3 py-0.5">
                <div class="flex items-center gap-1.5">
                  <span>{getProviderEmoji(usage.provider)}</span>
                  <span class="text-text-invert-base text-11-regular">{getProviderLabel(usage.provider)}</span>
                </div>
                <div class="flex items-center gap-2">
                  <span class="text-text-invert-strong text-11-medium">{formatTokens(usage.tokens)}</span>
                  <span class="text-text-invert-weak text-10-regular w-8 text-right">{Math.round(usage.percentage)}%</span>
                </div>
              </div>
            )}
          </For>
          <div class="flex items-center justify-between gap-3 pt-1 mt-1 border-t border-border-base/20">
            <span class="text-text-invert-base text-11-medium">Total</span>
            <span class="text-text-invert-strong text-11-medium">{formatTokens(totalTokens())}</span>
          </div>
        </div>
      </Show>

      {/* Model Usage Breakdown */}
      <Show when={modelUsage().length > 0}>
        <div class="mb-2 pb-2 border-b border-border-base/30">
          <div class="text-11-medium text-text-invert-base mb-1.5">Model Usage</div>
          <For each={modelUsage()}>
            {(usage) => (
              <div class="py-0.5">
                <div class="flex items-center justify-between gap-3">
                  <div class="flex items-center gap-1.5">
                    <span>{getProviderEmoji(usage.provider)}</span>
                    <span class="text-text-invert-base text-11-regular truncate max-w-32">{shortenModelName(usage.model)}</span>
                  </div>
                  <span class="text-text-invert-weak text-10-regular">{usage.requests}x</span>
                </div>
                <div class="flex items-center justify-between gap-3 pl-5">
                  <span class="text-text-invert-weak text-10-regular">↑{formatTokens(usage.input)} ↓{formatTokens(usage.output)}</span>
                  <span class="text-text-invert-strong text-10-medium">{formatCost(usage.cost)}</span>
                </div>
              </div>
            )}
          </For>
        </div>
      </Show>

      {/* Context Window Usage */}
      <Show when={context()}>
        {(ctx) => (
          <div class="mb-1">
            <div class="flex items-center gap-2">
              <span class="text-text-invert-strong">{ctx().tokens}</span>
              <span class="text-text-invert-base">Context Tokens</span>
            </div>
            <div class="flex items-center gap-2">
              <span class="text-text-invert-strong">{ctx().percentage ?? 0}%</span>
              <span class="text-text-invert-base">Window Usage</span>
            </div>
          </div>
        )}
      </Show>
      
      {/* Cost */}
      <div class="flex items-center gap-2">
        <span class="text-text-invert-strong">{cost()}</span>
        <span class="text-text-invert-base">Total Cost</span>
      </div>
      
      <Show when={variant() === "button"}>
        <div class="text-11-regular text-text-invert-base mt-2 pt-1 border-t border-border-base/20">Click to view context</div>
      </Show>
    </div>
  )

  return (
    <Show when={params.id}>
      <Tooltip value={tooltipValue()} placement="top">
        <Switch>
          <Match when={variant() === "indicator"}>{circle()}</Match>
          <Match when={true}>
            <Button type="button" variant="ghost" class="size-6" onClick={openContext}>
              {circle()}
            </Button>
          </Match>
        </Switch>
      </Tooltip>
    </Show>
  )
}
