import type { AssistantMessage } from "@opencode-ai/sdk/v2"
import type { TuiPlugin, TuiPluginApi, TuiPluginModule, TuiThemeCurrent } from "@opencode-ai/plugin/tui"
import { createMemo, For, Show } from "solid-js"
import { useSync, type TokensLiveData } from "@tui/context/sync"
import { formatTokenNumber, formatCost } from "@/session/live-token-math"
import { computeCacheHitRate } from "@/session/context-window"
import { computeUsageCost, getModelPricing } from "@/session/pricing"

const id = "internal:sidebar-context"

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
})

function getBarColor(percent: number, theme: TuiThemeCurrent) {
  if (percent < 60) return theme.success
  if (percent < 80) return theme.warning
  return theme.error
}

type ModelUsage = {
  model: string
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  cost: number
}

function View(props: { api: TuiPluginApi; session_id: string }) {
  const sync = useSync()
  const theme = () => props.api.theme.current
  const msg = createMemo(() => props.api.state.session.messages(props.session_id))

  // Recursively collect sessionID + all descendant session IDs
  const descendantSessionIDs = createMemo(() => {
    const allSessions = sync.data.session ?? []
    const byParent = new Map<string, string[]>()
    for (const s of allSessions) {
      const pid = (s as any).parentID
      if (!pid) continue
      const list = byParent.get(pid) ?? []
      list.push(s.id)
      byParent.set(pid, list)
    }
    const ids = new Set<string>([props.session_id])
    const stack = [props.session_id]
    while (stack.length > 0) {
      const current = stack.pop()!
      const kids = byParent.get(current) ?? []
      for (const k of kids) {
        if (!ids.has(k)) { ids.add(k); stack.push(k) }
      }
    }
    return [...ids]
  })

  // All messages across the session tree, flattened
  const allMessages = createMemo(() => {
    const result: AssistantMessage[] = []
    for (const id of descendantSessionIDs()) {
      const msgs = sync.data.message?.[id] ?? []
      for (const m of msgs) {
        if (m.role === "assistant") result.push(m as AssistantMessage)
      }
    }
    return result
  })

  // Cost: compute via our pricing (not am.cost which is often 0)
  const cost = createMemo(() => {
    let total = 0
    for (const am of allMessages()) {
      const pricing = getModelPricing(am.modelID)
      total += computeUsageCost({
        input: am.tokens.input,
        output: am.tokens.output,
        cacheRead: am.tokens.cache.read,
        cacheWrite: am.tokens.cache.write,
      }, pricing)
    }
    return total
  })

  const live = createMemo(() => sync.data.tokensLive[props.session_id] as TokensLiveData | undefined)

  const state = createMemo(() => {
    const liveData = live()

    if (liveData) {
      const tokens = liveData.inputTokens + liveData.cacheReadTokens + liveData.cacheWriteTokens
        + (liveData.phase === "final" ? liveData.outputTokens : 0)
      const percent = liveData.contextLimit > 0
        ? Math.round((tokens / liveData.contextLimit) * 100)
        : null
      return {
        tokens,
        percent,
        input: liveData.inputTokens,
        output: liveData.phase === "final" ? liveData.outputTokens : null,
        cacheRead: liveData.cacheReadTokens,
        cacheWrite: liveData.cacheWriteTokens,
        streaming: liveData.phase === "streaming",
      }
    }

    const last = msg().findLast((item): item is AssistantMessage => item.role === "assistant" && item.tokens.output > 0)
    if (!last) {
      return {
        tokens: 0,
        percent: null,
        input: 0,
        output: 0 as number | null,
        cacheRead: 0,
        cacheWrite: 0,
        streaming: false,
      }
    }

    const tokens =
      last.tokens.input + last.tokens.output + last.tokens.reasoning + last.tokens.cache.read + last.tokens.cache.write
    const model = props.api.state.provider.find((item) => item.id === last.providerID)?.models[last.modelID]
    return {
      tokens,
      percent: model?.limit?.context ? Math.round((tokens / model.limit.context) * 100) : null,
      input: last.tokens.input,
      output: last.tokens.output as number | null,
      cacheRead: last.tokens.cache.read,
      cacheWrite: last.tokens.cache.write,
      streaming: false,
    }
  })

  const cacheHit = createMemo(() => {
    const s = state()
    return computeCacheHitRate({ input: s.input, cacheRead: s.cacheRead, cacheWrite: s.cacheWrite })
  })

  const progressBar = createMemo(() => {
    const percent = state().percent
    if (percent === null) return null
    const clamped = Math.min(100, Math.max(0, percent))
    const filled = Math.round((clamped / 100) * 20)
    return "█".repeat(filled) + "░".repeat(20 - filled)
  })

  const modelBreakdown = createMemo(() => {
    const byModel = new Map<string, ModelUsage>()
    for (const am of allMessages()) {
      const pricing = getModelPricing(am.modelID)
      const itemCost = computeUsageCost({
        input: am.tokens.input,
        output: am.tokens.output,
        cacheRead: am.tokens.cache.read,
        cacheWrite: am.tokens.cache.write,
      }, pricing)
      const existing = byModel.get(am.modelID)
      if (existing) {
        existing.input += am.tokens.input
        existing.output += am.tokens.output
        existing.cacheRead += am.tokens.cache.read
        existing.cacheWrite += am.tokens.cache.write
        existing.cost += itemCost
      } else {
        byModel.set(am.modelID, {
          model: am.modelID,
          input: am.tokens.input,
          output: am.tokens.output,
          cacheRead: am.tokens.cache.read,
          cacheWrite: am.tokens.cache.write,
          cost: itemCost,
        })
      }
    }
    if (byModel.size < 2) return []
    return [...byModel.values()].sort((a, b) => b.cost - a.cost)
  })

  return (
    <box>
      <text fg={theme().text}>
        <b>Context</b>
      </text>
      <text fg={theme().textMuted}>{state().tokens.toLocaleString()} tokens</text>
      <Show when={progressBar()}>
        {(bar) => (
          <text fg={getBarColor(state().percent!, theme())}>
            {bar()} {state().percent}% used
          </text>
        )}
      </Show>
      <Show when={!progressBar()}>
        <text fg={theme().textMuted}>{state().percent ?? 0}% used</text>
      </Show>
      <Show when={state().streaming}>
        <text fg={theme().textMuted}>◌ generating…</text>
      </Show>
      <Show when={!state().streaming && state().output !== null}>
        <text fg={theme().textMuted}>{formatTokenNumber(state().output!)} output</text>
      </Show>
      <Show when={cacheHit() !== null}>
        <text fg={theme().textMuted}>cache hit: {cacheHit()}%</text>
      </Show>
      <text fg={theme().textMuted}>{money.format(cost())} spent</text>

      <Show when={modelBreakdown().length > 0}>
        <text fg={theme().text}>Usage by model</text>
        <For each={modelBreakdown()}>
          {(m) => (
            <box>
              <text fg={theme().text}>  {m.model}:</text>
              <text fg={theme().textMuted}>
                {"    "}
                {formatTokenNumber(m.input)} input, {formatTokenNumber(m.output)} output, {formatTokenNumber(m.cacheRead)} cache read, {formatTokenNumber(m.cacheWrite)} cache write ({formatCost(m.cost)})
              </text>
            </box>
          )}
        </For>
      </Show>
    </box>
  )
}

const tui: TuiPlugin = async (api) => {
  api.slots.register({
    order: 100,
    slots: {
      sidebar_content(_ctx, props) {
        return <View api={api} session_id={props.session_id} />
      },
    },
  })
}

const plugin: TuiPluginModule & { id: string } = {
  id,
  tui,
}

export default plugin
