import { createMemo, For, Show } from "solid-js"
import { useTheme } from "@tui/context/theme"
import { useRoute } from "@tui/context/route"
import { useSync } from "@tui/context/sync"
import { useKeybind } from "@tui/context/keybind"
import { useSessionTabs, type VisibleTab } from "@tui/context/session-tabs"
import { Spinner } from "@tui/component/spinner"

const MAX_TITLE = 26

function truncate(text: string, max: number) {
  if (text.length <= max) return text
  return text.slice(0, max - 1) + "…"
}

export function SessionTabs() {
  const { theme } = useTheme()
  const route = useRoute()
  const sync = useSync()
  const tabs = useSessionTabs()
  const keybind = useKeybind()

  const items = createMemo(() =>
    tabs
      .visible()
      .map((tab) => ({ ...tab, session: sync.session.get(tab.id) }))
      .filter(
        (entry): entry is VisibleTab & { session: NonNullable<ReturnType<typeof sync.session.get>> } =>
          Boolean(entry.session),
      ),
  )

  const activeID = () => (route.data.type === "session" ? route.data.sessionID : undefined)

  return (
    <box flexShrink={0} paddingRight={1} gap={0}>
      <box flexDirection="row" paddingBottom={1}>
        <text fg={theme.textMuted}>
          <b>SESSIONS</b>
        </text>
        <box flexGrow={1} />
        <text fg={theme.textMuted}>{items().length > 0 ? `${items().length}` : ""}</text>
      </box>

      <Show
        when={items().length > 0}
        fallback={
          <box flexShrink={0}>
            <text fg={theme.textMuted}>No active sessions.</text>
            <text fg={theme.textMuted}>
              Press <span style={{ fg: theme.text }}>{keybind.print("session_tab_pin")}</span> in a session to pin it.
            </text>
          </box>
        }
      >
        <box flexShrink={0} gap={0}>
          <For each={items()}>
            {(entry) => {
              const status = () => sync.data.session_status?.[entry.id]
              const isActive = () => activeID() === entry.id
              const isBusy = () => status()?.type === "busy"
              const isRetry = () => status()?.type === "retry"
              const isPinned = () => entry.pinned
              const accent = () => (isPinned() ? theme.primary : theme.secondary)
              return (
                <box
                  flexDirection="row"
                  paddingLeft={1}
                  paddingRight={1}
                  gap={1}
                  onMouseUp={() => route.navigate({ type: "session", sessionID: entry.id })}
                  backgroundColor={isActive() ? theme.backgroundElement : undefined}
                >
                  <text fg={isActive() ? accent() : theme.textMuted}>{isActive() ? "▌" : " "}</text>
                  <box flexGrow={1} flexShrink={1}>
                    <text fg={isActive() ? theme.text : theme.textMuted}>
                      <Show when={isActive()} fallback={truncate(entry.session.title, MAX_TITLE)}>
                        <b>{truncate(entry.session.title, MAX_TITLE)}</b>
                      </Show>
                    </text>
                  </box>
                  <Show when={isBusy()}>
                    <Spinner color={accent()} />
                  </Show>
                  <Show when={!isBusy() && isRetry()}>
                    <text fg={accent()}>↻</text>
                  </Show>
                  <Show when={!isBusy() && !isRetry()}>
                    <text fg={isActive() ? accent() : theme.textMuted}>{isPinned() ? "●" : "○"}</text>
                  </Show>
                </box>
              )
            }}
          </For>
        </box>
        <box flexShrink={0} paddingTop={1}>
          <text fg={theme.textMuted}>
            <span style={{ fg: theme.text }}>{keybind.print("session_tab_pin")}</span> · pin / unpin
          </text>
        </box>
      </Show>
    </box>
  )
}
