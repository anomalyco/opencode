import { createMemo, createSignal, For, Show } from "solid-js"
import { useTheme } from "@tui/context/theme"
import { useTab, type Tab } from "@tui/context/tab"
import { useSync } from "@tui/context/sync"
import { Session } from "@/session"
import { Locale } from "@/util/locale"
import { useKV } from "@tui/context/kv"
import { useTerminalDimensions } from "@opentui/solid"

export type TabStatus = "idle" | "busy" | "attention" | "error" | "done"

export function tabStatus(route: Tab["route"], sync: ReturnType<typeof useSync>): TabStatus {
  if (route.type !== "session") return "idle"
  const id = route.sessionID
  const ss = sync.data.session_status?.[id]

  const permissions = sync.data.permission[id]
  const questions = sync.data.question[id]
  if ((permissions && permissions.length > 0) || (questions && questions.length > 0)) return "attention"

  if (ss?.type === "retry") return "error"
  if (ss?.type === "busy") return "busy"

  const messages = sync.data.message[id]
  if (messages && messages.length > 0) {
    const last = messages.at(-1)
    if (last?.role === "assistant" && last.error && last.error.name !== "MessageAbortedError") return "error"
    if (last?.role === "assistant" && last.time.completed) return "done"
  }

  return "idle"
}

export function tabStatusIndicator(s: TabStatus, theme: ReturnType<typeof useTheme>["theme"]) {
  switch (s) {
    case "busy":
      return { symbol: "◉", color: theme.info }
    case "attention":
      return { symbol: "△", color: theme.warning }
    case "error":
      return { symbol: "✕", color: theme.error }
    case "done":
      return { symbol: "✓", color: theme.success }
    default:
      return undefined
  }
}

export function tabTitle(route: Tab["route"], sync: ReturnType<typeof useSync>) {
  if (route.type === "home") return "Home"
  if (route.type === "session") {
    const session = sync.session.get(route.sessionID)
    if (!session) return "Session"
    if (Session.isDefaultTitle(session.title)) return "New Session"
    return session.title
  }
  return "Tab"
}

export const STATUS_LABEL: Record<TabStatus, string> = {
  idle: "Idle",
  busy: "Processing",
  attention: "Needs attention",
  error: "Error",
  done: "Done",
}

// Compute max title length per tab given terminal width.
// Priority (always reserved first → last):
//   1. "+" button: 3 chars
//   2. Dividers between tabs: count-1 chars
//   3. Close buttons (when >1 tab): 2 chars each
//   4. Indicator + number prefix " X N:": 5 chars each
//   5. Padding around title " " + " ": 2 chars each
//   6. Title: whatever remains, split evenly
function budget(width: number, count: number, hasClose: boolean) {
  const plus = 3
  const dividers = Math.max(0, count - 1)
  const close = hasClose ? count * 2 : 0
  const prefix = count * 5 // " X N:"
  const padding = count * 2 // space before indicator + space after title
  const fixed = plus + dividers + close + prefix + padding
  const remaining = Math.max(0, width - fixed)
  return Math.max(0, Math.floor(remaining / Math.max(1, count)))
}

export function TabBar() {
  const tab = useTab()
  const sync = useSync()
  const kv = useKV()
  const { theme } = useTheme()
  const dimensions = useTerminalDimensions()
  const alwaysShow = createMemo(() => kv.get("tab_bar_visible", true))
  const visible = createMemo(() => tab.tabs.length > 1 || alwaysShow())
  const hasClose = createMemo(() => tab.tabs.length > 1)
  const titleMax = createMemo(() => budget(dimensions().width, tab.tabs.length, hasClose()))

  return (
    <Show when={visible()}>
      <box flexDirection="row" flexShrink={0} height={1}>
        <box flexDirection="row" flexGrow={1} flexShrink={1} overflow="hidden">
          <For each={tab.tabs}>
            {(t, idx) => {
              const active = createMemo(() => t.id === tab.active.id)
              const title = createMemo(() => {
                const limit = titleMax()
                if (limit <= 0) return ""
                const raw = tabTitle(t.route, sync)
                if (raw.length <= limit) return raw
                if (limit <= 1) return raw[0]
                return Locale.truncate(raw, limit)
              })
              const ts = createMemo(() => tabStatus(t.route, sync))
              const ind = createMemo(() => tabStatusIndicator(ts(), theme))
              const [hover, setHover] = createSignal(false)
              const [closeHover, setCloseHover] = createSignal(false)

              return (
                <box
                  flexDirection="row"
                  flexShrink={1}
                  onMouseUp={() => tab.select(t.id)}
                  onMouseOver={() => setHover(true)}
                  onMouseOut={() => setHover(false)}
                  backgroundColor={
                    active() ? theme.backgroundPanel : hover() ? theme.backgroundElement : theme.background
                  }
                >
                  <text fg={active() ? theme.text : theme.textMuted} wrapMode="none">
                    {" "}
                    <span style={{ fg: ind()?.color }}>{ind() ? ind()!.symbol : " "}</span> {idx() + 1}:{title()}{" "}
                  </text>
                  <Show when={hasClose()}>
                    <box
                      flexShrink={0}
                      onMouseUp={(e) => {
                        e.stopPropagation?.()
                        tab.close(t.id)
                      }}
                      onMouseOver={() => setCloseHover(true)}
                      onMouseOut={() => setCloseHover(false)}
                    >
                      <text fg={closeHover() ? theme.error : active() ? theme.textMuted : theme.border}>x </text>
                    </box>
                  </Show>
                  <Show when={idx() < tab.tabs.length - 1}>
                    <text fg={theme.border} wrapMode="none">
                      │
                    </text>
                  </Show>
                </box>
              )
            }}
          </For>
        </box>
        <NewTabButton />
      </box>
    </Show>
  )
}

function NewTabButton() {
  const tab = useTab()
  const { theme } = useTheme()
  const [hover, setHover] = createSignal(false)

  return (
    <box
      flexShrink={0}
      onMouseUp={() => tab.create()}
      onMouseOver={() => setHover(true)}
      onMouseOut={() => setHover(false)}
      backgroundColor={hover() ? theme.backgroundElement : theme.background}
    >
      <text fg={hover() ? theme.text : theme.textMuted}> + </text>
    </box>
  )
}
