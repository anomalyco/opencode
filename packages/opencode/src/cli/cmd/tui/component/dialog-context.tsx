import { useTheme } from "../context/theme"
import { useSync } from "@tui/context/sync"
import { useLocal } from "@tui/context/local"
import { createMemo, Show } from "solid-js"
import { TextAttributes } from "@opentui/core"
import type { AssistantMessage } from "@opencode-ai/sdk/v2"

export function DialogContext(props: { sessionID: string }) {
  const sync = useSync()
  const local = useLocal()
  const theme = useTheme()

  const messages = createMemo(() => sync.data.message[props.sessionID] ?? [])

  const lastAssistant = createMemo(() => {
    const list = messages()
    return list.findLast((msg): msg is AssistantMessage => {
      if (msg.role !== "assistant") return false
      const promptTokens = msg.tokens.input + (msg.tokens.cache?.read ?? 0)
      return promptTokens > 0
    })
  })

  const usage = createMemo(() => {
    const msg = lastAssistant()
    if (!msg) return null

    const provider = sync.data.provider.find((p) => p.id === msg.providerID)
    const model = provider?.models[msg.modelID]
    const context = model?.limit?.context ?? 0
    const outputLimit = model?.limit?.output

    const outputBuffer = outputLimit != null ? Math.min(outputLimit, 32_000) : 32_000

    const usable = model?.limit?.input ?? Math.max(0, context - outputBuffer)
    const reserved = Math.max(0, context - usable)

    const promptTokens = msg.tokens.input + (msg.tokens.cache?.read ?? 0)

    return {
      tokens: promptTokens,
      limit: context,
      usable,
      reserved,
      modelID: msg.modelID,
      providerID: msg.providerID,
    }
  })

  const current = createMemo(() => local.model.current())

  const mismatch = createMemo(() => {
    const u = usage()
    const c = current()
    if (!u || !c) return false
    return u.modelID !== c.modelID || u.providerID !== c.providerID
  })

  const percent = createMemo(() => {
    const u = usage()
    if (!u || u.limit === 0) return 0
    return Math.min(100, Math.round((u.tokens / u.limit) * 100))
  })

  const reservedPercent = createMemo(() => {
    const u = usage()
    if (!u || u.limit === 0) return 0
    return Math.round((u.reserved / u.limit) * 100)
  })

  const usablePercent = createMemo(() => {
    const u = usage()
    if (!u || u.usable === 0) return 0
    return Math.min(100, Math.round((u.tokens / u.usable) * 100))
  })

  const totalBar = createMemo(() => {
    const u = usage()
    if (!u || u.limit === 0) return { used: "", available: "", reserved: "" }

    const width = 40
    const usedChars = Math.min(width, Math.round((u.tokens / u.limit) * width))
    const reservedChars = Math.max(0, Math.min(width - usedChars, Math.round((u.reserved / u.limit) * width)))
    const availableChars = Math.max(0, width - usedChars - reservedChars)

    return {
      used: "\u2588".repeat(usedChars),
      available: "\u2591".repeat(availableChars),
      reserved: "\u2588".repeat(reservedChars),
    }
  })

  const usableBar = createMemo(() => {
    const u = usage()
    if (!u || u.usable === 0) return { used: "", available: "" }

    const width = 40
    const usedChars = Math.min(width, Math.round((u.tokens / u.usable) * width))
    const availableChars = Math.max(0, width - usedChars)

    return {
      used: "\u2588".repeat(usedChars),
      available: "\u2591".repeat(availableChars),
    }
  })

  const cache = createMemo(() => {
    const msg = lastAssistant()
    if (!msg || !msg.tokens.cache) return null

    const cached = msg.tokens.cache.read ?? 0
    const fresh = msg.tokens.input
    const total = cached + fresh

    if (total === 0) return null

    const cachePercent = Math.round((cached / total) * 100)
    const freshPercent = 100 - cachePercent

    return {
      cached,
      fresh,
      total,
      cachePercent,
      freshPercent,
    }
  })

  const cacheBar = createMemo(() => {
    const stats = cache()
    if (!stats || stats.total === 0) return { cached: "", fresh: "" }

    const width = 40
    const cachedChars = Math.min(width, Math.round((stats.cached / stats.total) * width))
    const freshChars = Math.max(0, width - cachedChars)

    return {
      cached: "\u2588".repeat(cachedChars),
      fresh: "\u2591".repeat(freshChars),
    }
  })

  return (
    <box paddingLeft={2} paddingRight={2} gap={1} paddingBottom={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text fg={theme.theme.text} attributes={TextAttributes.BOLD}>
          Context Usage
        </text>
        <text fg={theme.theme.textMuted}>esc</text>
      </box>

      <Show
        when={usage()}
        fallback={
          <box paddingTop={1}>
            <text fg={theme.theme.textMuted}>No model requests yet in this session.</text>
          </box>
        }
      >
        {(u) => {
          const value = u()
          if (value.limit <= 0) {
            return (
              <box paddingTop={1}>
                <text fg={theme.theme.textMuted}>
                  Model limits unavailable for {value.providerID}/{value.modelID}.
                </text>
              </box>
            )
          }
          return (
            <box gap={1} paddingTop={1}>
              <text fg={theme.theme.text}>
                {value.providerID}/{value.modelID} {"\u00b7"} {value.tokens.toLocaleString()} /{" "}
                {value.limit.toLocaleString()} tokens ({percent()}%)
              </text>

              <text>
                <span style={{ fg: percent() > 80 ? theme.theme.error : theme.theme.success }}>{totalBar().used}</span>
                <span style={{ fg: theme.theme.textMuted }}>{totalBar().available}</span>
                <span style={{ fg: theme.theme.accent }}>{totalBar().reserved}</span>
              </text>

              <text fg={theme.theme.textMuted}>
                <span style={{ fg: percent() > 80 ? theme.theme.error : theme.theme.success }}>used {percent()}%</span>
                {" \u00b7 "}
                <span style={{ fg: theme.theme.textMuted }}>
                  available {Math.max(0, 100 - percent() - reservedPercent())}%
                </span>
                {" \u00b7 "}
                <span style={{ fg: theme.theme.accent }}>reserved {reservedPercent()}%</span>
              </text>

              <box gap={1} paddingTop={1}>
                <text fg={theme.theme.text}>
                  Usable input: {value.tokens.toLocaleString()} / {value.usable.toLocaleString()} tokens (
                  {usablePercent()}%)
                </text>

                <text>
                  <span style={{ fg: usablePercent() > 90 ? theme.theme.error : theme.theme.success }}>
                    {usableBar().used}
                  </span>
                  <span style={{ fg: theme.theme.textMuted }}>{usableBar().available}</span>
                </text>

                <text fg={theme.theme.textMuted}>
                  <span style={{ fg: usablePercent() > 90 ? theme.theme.error : theme.theme.success }}>
                    used {usablePercent()}%
                  </span>
                  {" \u00b7 "}
                  <span style={{ fg: theme.theme.textMuted }}>available {Math.max(0, 100 - usablePercent())}%</span>
                </text>
              </box>

              <Show when={cache()}>
                {(c) => {
                  const stats = c()
                  return (
                    <box gap={1} paddingTop={1}>
                      <text fg={theme.theme.text}>Last request: {stats.total.toLocaleString()} tokens</text>

                      <text>
                        <span style={{ fg: theme.theme.primary }}>{cacheBar().cached}</span>
                        <span style={{ fg: theme.theme.textMuted }}>{cacheBar().fresh}</span>
                      </text>

                      <text fg={theme.theme.textMuted}>
                        <span style={{ fg: theme.theme.primary }}>
                          cached {stats.cached.toLocaleString()} ({stats.cachePercent}%)
                        </span>
                        {" \u00b7 "}
                        <span style={{ fg: theme.theme.textMuted }}>
                          new {stats.fresh.toLocaleString()} ({stats.freshPercent}%)
                        </span>
                      </text>
                    </box>
                  )
                }}
              </Show>

              <Show when={mismatch()}>
                <box paddingTop={1}>
                  <text fg={theme.theme.warning}>
                    Note: Token usage reflects last request using {value.modelID}; current model is {current()!.modelID}
                    .
                  </text>
                </box>
              </Show>
            </box>
          )
        }}
      </Show>
    </box>
  )
}
