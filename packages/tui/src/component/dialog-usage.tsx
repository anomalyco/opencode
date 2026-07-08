import { createMemo, For, Show } from "solid-js"
import { TextAttributes } from "@opentui/core"
import type { AssistantMessage } from "@opencode-ai/sdk/v2"
import { useRoute } from "../context/route"
import { useSync } from "../context/sync"
import { useTheme } from "../context/theme"
import { useDialog } from "../ui/dialog"
import { Locale } from "../util/locale"
import { useTerminalDimensions } from "@opentui/solid"

export function DialogUsage() {
  const route = useRoute()
  const sync = useSync()
  const { theme } = useTheme()
  const dialog = useDialog()

  const sessionID = createMemo(() => (route.data.type === "session" ? route.data.sessionID : undefined))

  const session = createMemo(() => {
    const id = sessionID()
    if (!id) return
    return sync.session.get(id)
  })

  const messages = createMemo(() => {
    const id = sessionID()
    if (!id) return [] as AssistantMessage[]
    return (sync.data.message[id] ?? []).filter(
      (m): m is AssistantMessage => m.role === "assistant" && m.tokens !== undefined,
    )
  })

  const sessionTotals = createMemo(() => {
    const msgs = messages()
    let input = 0
    let output = 0
    let reasoning = 0
    let cacheRead = 0
    let cacheWrite = 0
    let cost = 0

    for (const msg of msgs) {
      if (!msg.tokens) continue
      input += msg.tokens.input
      output += msg.tokens.output
      reasoning += msg.tokens.reasoning
      cacheRead += msg.tokens.cache.read
      cacheWrite += msg.tokens.cache.write

      const model = sync.data.provider.find((p) => p.id === msg.providerID)?.models[msg.modelID]
      if (model?.cost) {
        cost += msg.tokens.input * model.cost.input + msg.tokens.output * model.cost.output
      }
    }

    return { input, output, reasoning, cacheRead, cacheWrite, total: input + output + reasoning + cacheRead + cacheWrite, cost }
  })

  const modelBreakdown = createMemo(() => {
    const msgs = messages()
    const byModel: Record<string, { providerID: string; modelID: string; input: number; output: number; reasoning: number; tokens: number }> = {}

    for (const msg of msgs) {
      if (!msg.tokens) continue
      const key = `${msg.providerID}/${msg.modelID}`
      if (!byModel[key]) {
        byModel[key] = { providerID: msg.providerID, modelID: msg.modelID, input: 0, output: 0, reasoning: 0, tokens: 0 }
      }
      byModel[key].input += msg.tokens.input
      byModel[key].output += msg.tokens.output
      byModel[key].reasoning += msg.tokens.reasoning
      byModel[key].tokens += msg.tokens.input + msg.tokens.output + msg.tokens.reasoning + msg.tokens.cache.read + msg.tokens.cache.write
    }

    return Object.entries(byModel).map(([key, data]) => {
      const model = sync.data.provider.find((p) => p.id === data.providerID)?.models[data.modelID]
      const contextLimit = model?.limit.context ?? 0
      const contextPct = contextLimit > 0 ? Math.round((data.tokens / contextLimit) * 100) : undefined
      return { key, ...data, contextLimit, contextPct }
    })
  })

  const providerRateLimits = createMemo(() => {
    const results: { providerID: string; name: string; limit: Record<string, string>; remaining: Record<string, string>; reset: Record<string, string> }[] = []
    for (const p of sync.data.provider) {
      const rl = (p.options as Record<string, unknown>)?.rateLimit as { limit?: Record<string, string>; remaining?: Record<string, string>; reset?: Record<string, string> } | undefined
      if (!rl?.remaining && !rl?.limit) continue
      results.push({
        providerID: p.id,
        name: p.name,
        limit: rl.limit ?? {},
        remaining: rl.remaining ?? {},
        reset: rl.reset ?? {},
      })
    }
    return results
  })

  const allSessionsTotals = createMemo(() => {
    let sessions = 0
    let input = 0
    let output = 0
    let reasoning = 0
    let cacheRead = 0
    let cacheWrite = 0
    let cost = 0

    for (const s of sync.data.session) {
      sessions++
      if (s.tokens) {
        input += s.tokens.input
        output += s.tokens.output
        reasoning += s.tokens.reasoning
        cacheRead += s.tokens.cache.read
        cacheWrite += s.tokens.cache.write
      }
      cost += s.cost ?? 0
    }

    return { sessions, input, output, reasoning, cacheRead, cacheWrite, total: input + output + reasoning + cacheRead + cacheWrite, cost }
  })

  const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 6 })
  const moneyShort = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" })

  useTerminalDimensions()

  return (
    <box paddingLeft={2} paddingRight={2} gap={1} paddingBottom={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text attributes={TextAttributes.BOLD} fg={theme.text}>Usage & Cost</text>
        <text fg={theme.textMuted} onMouseUp={() => dialog.clear()}>esc</text>
      </box>

      <Show when={session()}>
        {(s) => (
          <box flexDirection="column" gap={1}>
            <text fg={theme.text}>
              Session: <text fg={theme.text}>{s().title}</text>
            </text>

            <box flexDirection="column" gap={0}>
              <text attributes={TextAttributes.BOLD} fg={theme.textMuted}>Session Tokens</text>
              <box flexDirection="row" gap={2} paddingLeft={1}>
                <text fg={theme.text}>Total:</text>
                <text fg={theme.text}>{Locale.number(sessionTotals().total)}</text>
              </box>
              <box flexDirection="row" gap={2} paddingLeft={1}>
                <text fg={theme.text}>Input:</text>
                <text fg={theme.text}>{Locale.number(sessionTotals().input)}</text>
              </box>
              <box flexDirection="row" gap={2} paddingLeft={1}>
                <text fg={theme.text}>Output:</text>
                <text fg={theme.text}>{Locale.number(sessionTotals().output)}</text>
              </box>
              <box flexDirection="row" gap={2} paddingLeft={1}>
                <text fg={theme.text}>Reasoning:</text>
                <text fg={theme.text}>{Locale.number(sessionTotals().reasoning)}</text>
              </box>
              <box flexDirection="row" gap={2} paddingLeft={1}>
                <text fg={theme.text}>Cache (R/W):</text>
                <text fg={theme.text}>{Locale.number(sessionTotals().cacheRead)} / {Locale.number(sessionTotals().cacheWrite)}</text>
              </box>
              <box flexDirection="row" gap={2} paddingLeft={1}>
                <text fg={theme.text}>Est. Cost:</text>
                <Show when={sessionTotals().cost > 0} fallback={<text fg={theme.textMuted}>N/A</text>}>
                  <text fg={theme.text}>{money.format(sessionTotals().cost)}</text>
                </Show>
              </box>
            </box>
          </box>
        )}
      </Show>

      <Show when={modelBreakdown().length > 0}>
        <box flexDirection="column" gap={0}>
          <text attributes={TextAttributes.BOLD} fg={theme.textMuted}>Models Used</text>
          <For each={modelBreakdown()}>
            {(item) => (
              <box flexDirection="column" gap={0} paddingLeft={1}>
                <box flexDirection="row" gap={1}>
                  <text fg={theme.text}>{item.providerID}/</text>
                  <text fg={theme.text}>{item.modelID}</text>
                </box>
                <box flexDirection="row" gap={2} paddingLeft={1}>
                  <text fg={theme.textMuted}>Tokens:</text>
                  <text fg={theme.text}>
                    {Locale.number(item.tokens)}
                    <Show when={item.contextPct !== undefined}>
                      {` (${item.contextPct}% of ${Locale.number(item.contextLimit)})`}
                    </Show>
                  </text>
                </box>
              </box>
            )}
          </For>
        </box>
      </Show>

      <Show when={providerRateLimits().length > 0}>
        <box flexDirection="column" gap={0}>
          <text attributes={TextAttributes.BOLD} fg={theme.textMuted}>Provider Rate Limits</text>
          <For each={providerRateLimits()}>
            {(p) => (
              <box flexDirection="column" gap={0} paddingLeft={1}>
                <text fg={theme.text}>{p.name}</text>
                <For each={Object.keys(p.remaining).length > 0 ? Object.keys(p.remaining) : Object.keys(p.limit)}>
                  {(key) => {
                    const limit = p.limit[key]
                    const remaining = p.remaining[key]
                    const reset = p.reset[key]
                    const used = limit && remaining ? Number(limit) - Number(remaining) : undefined
                    const pct = limit && remaining ? Math.round((Number(remaining) / Number(limit)) * 100) : undefined
                    return (
                      <box flexDirection="row" gap={2} paddingLeft={1}>
                        <text fg={theme.textMuted}>{key}:</text>
                        <text fg={theme.text}>
                          {remaining ? `${Locale.number(Number(remaining))}` : ""}
                          {limit ? ` / ${Locale.number(Number(limit))}` : ""}
                        </text>
                        <Show when={pct !== undefined}>
                          <text fg={pct !== undefined && pct < 25 ? theme.error : theme.textMuted}>
                            ({pct}% left)
                          </text>
                        </Show>
                        <Show when={used !== undefined && used > 0}>
                          <text fg={theme.textMuted}>used {Locale.number(used!)}</text>
                        </Show>
                        <Show when={reset}>
                          <text fg={theme.textMuted}>reset: {reset}</text>
                        </Show>
                      </box>
                    )
                  }}
                </For>
              </box>
            )}
          </For>
        </box>
      </Show>

      <box flexDirection="column" gap={0}>
        <text attributes={TextAttributes.BOLD} fg={theme.textMuted}>All Sessions</text>
        <box flexDirection="row" gap={2} paddingLeft={1}>
          <text fg={theme.text}>Sessions:</text>
          <text fg={theme.text}>{Locale.number(allSessionsTotals().sessions)}</text>
        </box>
        <box flexDirection="row" gap={2} paddingLeft={1}>
          <text fg={theme.text}>Total Tokens:</text>
          <text fg={theme.text}>{Locale.number(allSessionsTotals().total)}</text>
        </box>
        <box flexDirection="row" gap={2} paddingLeft={1}>
          <text fg={theme.text}>Total Cost:</text>
          <Show when={allSessionsTotals().cost > 0} fallback={<text fg={theme.textMuted}>N/A</text>}>
            <text fg={theme.text}>{moneyShort.format(allSessionsTotals().cost)}</text>
          </Show>
        </box>
      </box>
    </box>
  )
}
