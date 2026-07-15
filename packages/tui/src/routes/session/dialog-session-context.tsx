import { TextAttributes } from "@opentui/core"
import type { AssistantMessage } from "@opencode-ai/sdk/v2"
import { createMemo, For, Show } from "solid-js"
import { useTheme } from "../../context/theme"
import { useSync } from "../../context/sync"
import { useDialog } from "../../ui/dialog"
import { useBindings } from "../../keymap"

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
})

function tokenBar(pct: number) {
  const full = 30
  const filled = Math.round((pct / 100) * full)
  return "█".repeat(filled) + "░".repeat(Math.max(0, full - filled))
}

export function DialogSessionContext(props: { sessionID: string }) {
  const dialog = useDialog()
  const { theme } = useTheme()
  const sync = useSync()

  const session = createMemo(() => sync.session.get(props.sessionID))
  const messages = createMemo(() => sync.data.message[props.sessionID] ?? [])
  const sessionTokens = createMemo(() => session()?.tokens)
  const sessionCost = createMemo(() => session()?.cost ?? 0)

  const tokenTotal = createMemo(() => {
    const t = sessionTokens()
    if (!t) return 0
    return t.input + t.output + t.reasoning + t.cache.read + t.cache.write
  })

  const model = createMemo(() => {
    const last = messages().findLast(
      (item): item is AssistantMessage => item.role === "assistant" && item.tokens.output > 0,
    )
    if (!last) return
    return sync.data.provider.find((p) => p.id === last.providerID)?.models[last.modelID]
  })

  const contextLimit = createMemo(() => model()?.limit.context ?? 0)
  const contextPct = createMemo(() => (contextLimit() > 0 ? Math.round((tokenTotal() / contextLimit()) * 100) : 0))

  const assistantMessages = createMemo(() =>
    messages().filter(
      (msg): msg is AssistantMessage => msg.role === "assistant" && msg.tokens.output > 0,
    ),
  )

  useBindings(() => ({
    bindings: [
      { key: "return", desc: "Close", group: "Dialog", cmd: () => dialog.clear() },
      { key: "escape", desc: "Close", group: "Dialog", cmd: () => dialog.clear() },
    ],
  }))

  return (
    <box paddingLeft={2} paddingRight={2} gap={1} flexDirection="column" minHeight={10}>
      <box flexDirection="row" justifyContent="space-between">
        <text attributes={TextAttributes.BOLD} fg={theme.text}>
          Session Context
        </text>
        <text fg={theme.textMuted} onMouseUp={() => dialog.clear()}>
          esc/enter
        </text>
      </box>

      <box flexDirection="column" gap={1} paddingTop={1}>
        <Show when={contextLimit() > 0}>
          <text fg={theme.text}>
            Context Window: <text fg={theme.textMuted}>{tokenTotal().toLocaleString()} / {contextLimit().toLocaleString()} tokens ({contextPct()}%)</text>
          </text>
          <text fg={contextPct() > 80 ? theme.error : theme.textMuted}>
            {tokenBar(contextPct())}
          </text>
        </Show>

        <box paddingTop={1} flexDirection="column" gap={0}>
          <text attributes={TextAttributes.BOLD} fg={theme.text}>
            Breakdown
          </text>
          <Show when={sessionTokens()}>
            {(t) => (
              <>
                <text fg={theme.textMuted}>  Input:        {t().input.toLocaleString()} tokens</text>
                <text fg={theme.textMuted}>  Output:       {t().output.toLocaleString()} tokens</text>
                <text fg={theme.textMuted}>  Reasoning:    {t().reasoning.toLocaleString()} tokens</text>
                <text fg={theme.textMuted}>  Cache Read:   {t().cache.read.toLocaleString()} tokens</text>
                <text fg={theme.textMuted}>  Cache Write:  {t().cache.write.toLocaleString()} tokens</text>
              </>
            )}
          </Show>
          <Show when={sessionCost() > 0}>
            <text paddingTop={1} fg={theme.textMuted}>
              Total Cost: {money.format(sessionCost())}
            </text>
          </Show>
        </box>

        <Show when={assistantMessages().length > 0}>
          <box paddingTop={1} flexDirection="column" gap={0}>
            <text attributes={TextAttributes.BOLD} fg={theme.text}>
              Messages ({assistantMessages().length})
            </text>
            <For each={assistantMessages().slice().reverse()}>
              {(msg) => {
                const tokens =
                  msg.tokens.input + msg.tokens.output + msg.tokens.reasoning + msg.tokens.cache.read + msg.tokens.cache.write
                return (
                  <text fg={theme.textMuted}>
                    · {msg.agent ?? "default"} — {tokens.toLocaleString()} tokens
                    <Show when={msg.cost > 0}>
                      {" "}({money.format(msg.cost)})
                    </Show>
                  </text>
                )
              }}
            </For>
          </box>
        </Show>
      </box>
    </box>
  )
}
