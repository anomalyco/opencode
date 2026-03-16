import { For, Show } from "solid-js"
import { useTheme } from "../context/theme"
import { useTabs } from "../context/tabs"
import { useSync } from "../context/sync"
import { TextAttributes } from "@opentui/core"

const STATUS_COLORS = {
  idle: "#22c55e",
  busy: "#f59e0b",
  error: "#ef4444",
} as const

function statusColor(type?: string) {
  if (type === "busy" || type === "retry") return STATUS_COLORS.busy
  return STATUS_COLORS.idle
}

function abbreviatePath(dir?: string) {
  if (!dir) return ""
  const segments = dir.split("/")
  return segments[segments.length - 1] || dir
}

export function TabBar() {
  const { theme } = useTheme()
  const tabs = useTabs()
  const sync = useSync()

  return (
    <box flexDirection="row" flexShrink={0} height={1} backgroundColor={theme.backgroundPanel}>
      <For each={tabs.tabs()}>
        {(tab) => {
          const isActive = () => tabs.active().id === tab.id
          const sessionStatus = () => (tab.sessionID ? sync.data.session_status[tab.sessionID] : undefined)
          const session = () => (tab.sessionID ? sync.data.session.find((s) => s.id === tab.sessionID) : undefined)
          const label = () => {
            const s = session()
            if (s?.displayName) return s.displayName
            if (s?.slug) return s.slug
            return tab.label
          }
          const dirLabel = () => abbreviatePath(tab.directory)
          const branch = () => session()?.gitBranch

          return (
            <box
              flexDirection="row"
              paddingLeft={1}
              paddingRight={1}
              backgroundColor={isActive() ? theme.background : theme.backgroundPanel}
              onMouseUp={() => tabs.activate(tab.id)}
            >
              <text fg={isActive() ? theme.primary : theme.textMuted} attributes={isActive() ? TextAttributes.BOLD : 0}>
                {label()}
              </text>
              <Show when={dirLabel()}>
                <text fg={theme.textMuted}>{" " + dirLabel()}</text>
              </Show>
              <Show when={branch()}>
                <text fg={theme.textMuted}>{" " + branch()}</text>
              </Show>
              <Show when={tab.sessionID}>
                <text fg={statusColor(sessionStatus()?.type)}> ●</text>
              </Show>
            </box>
          )
        }}
      </For>
      <box paddingLeft={1} paddingRight={1} onMouseUp={() => tabs.add()}>
        <text fg={theme.textMuted}>+</text>
      </box>
    </box>
  )
}
