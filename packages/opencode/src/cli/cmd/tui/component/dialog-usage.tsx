import { TextAttributes } from "@opentui/core"
import { useTheme } from "../context/theme"
import { useDialog } from "@tui/ui/dialog"
import { useSync } from "@tui/context/sync"
import { createMemo, For } from "solid-js"
import { Locale } from "@/util/locale"

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
})

export function DialogUsage() {
  const sync = useSync()
  const { theme } = useTheme()
  const dialog = useDialog()

  const sessions = createMemo(() => sync.data.session)

  const totals = createMemo(() => {
    let input = 0
    let output = 0
    let reasoning = 0
    let cacheRead = 0
    let cacheWrite = 0
    let cost = 0
    for (const s of sessions()) {
      const t = s.tokens
      if (!t) continue
      input += t.input
      output += t.output
      reasoning += t.reasoning
      cacheRead += t.cache.read
      cacheWrite += t.cache.write
      cost += s.cost ?? 0
    }
    const total = input + output + reasoning + cacheRead + cacheWrite
    return { input, output, reasoning, cacheRead, cacheWrite, total, cost }
  })

  const recent = createMemo(() => {
    const dayStart = new Date()
    dayStart.setHours(0, 0, 0, 0)
    let input = 0
    let output = 0
    let reasoning = 0
    let cacheRead = 0
    let cacheWrite = 0
    let cost = 0
    for (const s of sessions()) {
      if (s.time.updated < dayStart.getTime()) continue
      const t = s.tokens
      if (!t) continue
      input += t.input
      output += t.output
      reasoning += t.reasoning
      cacheRead += t.cache.read
      cacheWrite += t.cache.write
      cost += s.cost ?? 0
    }
    return { input, output, reasoning, cacheRead, cacheWrite, cost }
  })

  return (
    <box paddingLeft={2} paddingRight={2} gap={1} paddingBottom={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text fg={theme.text} attributes={TextAttributes.BOLD}>
          Token Usage
        </text>
        <text fg={theme.textMuted} onMouseUp={() => dialog.clear()}>
          esc
        </text>
      </box>

      <text fg={theme.textMuted}>All sessions</text>
      <box flexDirection="row" gap={1} paddingLeft={2}>
        <text fg={theme.textMuted} width={18}>Total</text>
        <text fg={theme.text}>{Locale.number(totals().total)}</text>
      </box>
      <box flexDirection="row" gap={1} paddingLeft={2}>
        <text fg={theme.textMuted} width={18}>Input</text>
        <text fg={theme.text}>{Locale.number(totals().input)}</text>
      </box>
      <box flexDirection="row" gap={1} paddingLeft={2}>
        <text fg={theme.textMuted} width={18}>Output</text>
        <text fg={theme.text}>{Locale.number(totals().output)}</text>
      </box>
      <box flexDirection="row" gap={1} paddingLeft={2}>
        <text fg={theme.textMuted} width={18}>Reasoning</text>
        <text fg={theme.text}>{Locale.number(totals().reasoning)}</text>
      </box>
      <box flexDirection="row" gap={1} paddingLeft={2}>
        <text fg={theme.textMuted} width={18}>Cache read</text>
        <text fg={theme.text}>{Locale.number(totals().cacheRead)}</text>
      </box>
      <box flexDirection="row" gap={1} paddingLeft={2}>
        <text fg={theme.textMuted} width={18}>Cache write</text>
        <text fg={theme.text}>{Locale.number(totals().cacheWrite)}</text>
      </box>
      <box flexDirection="row" gap={1} paddingLeft={2}>
        <text fg={theme.textMuted} width={18}>Cost</text>
        <text fg={theme.text}>{money.format(totals().cost)}</text>
      </box>

      <text fg={theme.textMuted}>Today</text>
      <box flexDirection="row" gap={1} paddingLeft={2}>
        <text fg={theme.textMuted} width={18}>Tokens</text>
        <text fg={theme.text}>{Locale.number(recent().input + recent().output + recent().reasoning + recent().cacheRead + recent().cacheWrite)}</text>
      </box>
      <box flexDirection="row" gap={1} paddingLeft={2}>
        <text fg={theme.textMuted} width={18}>Cost</text>
        <text fg={theme.text}>{money.format(recent().cost)}</text>
      </box>

      <For each={sessions().filter((s) => s.tokens).slice(0, 10)}>
        {(s) => {
          const t = s.tokens!
          const total = t.input + t.output + t.reasoning + t.cache.read + t.cache.write
          if (total <= 0) return <></>
          return (
            <box flexDirection="row" gap={1} paddingLeft={2}>
              <text fg={theme.textMuted} width={18}>{Locale.truncate(s.title || s.id, 16)}</text>
              <text fg={theme.text}>{Locale.number(total)}</text>
              <text fg={theme.textMuted}>{(s.cost ?? 0) > 0 ? money.format(s.cost ?? 0) : ""}</text>
            </box>
          )
        }}
      </For>
    </box>
  )
}