import type { TuiPlugin } from "@opencode-ai/plugin/tui"
import { createMemo, For, Match, Show, Switch, createSignal } from "solid-js"
import { useSync } from "../../context/sync"
import { useTheme } from "../../context/theme"

function View() {
  const sync = useSync()
  const { theme } = useTheme()
  const [open, setOpen] = createSignal(true)

  const list = createMemo(() =>
    Object.entries(sync.data.mcp)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, item]) => ({
        name,
        status: item.status,
        error: item.status === "failed" ? item.error : undefined,
      })),
  )

  const on = createMemo(() => list().filter((item) => item.status === "connected").length)
  const bad = createMemo(
    () =>
      list().filter(
        (item) =>
          item.status === "failed" || item.status === "needs_auth" || item.status === "needs_client_registration",
      ).length,
  )

  const dot: Record<string, typeof theme.success> = {
    connected: theme.success,
    failed: theme.error,
    disabled: theme.textMuted,
    needs_auth: theme.warning,
    needs_client_registration: theme.error,
  }

  return (
    <Show when={list().length > 0}>
      <box>
        <box flexDirection="row" gap={1} onMouseDown={() => list().length > 2 && setOpen((x) => !x)}>
          <Show when={list().length > 2}>
            <text fg={theme.text}>{open() ? "▼" : "▶"}</text>
          </Show>
          <text fg={theme.text}>
            <b>MCP</b>
            <Show when={!open()}>
              <span style={{ fg: theme.textMuted }}>
                {" "}
                ({on()} active{bad() > 0 ? `, ${bad()} error${bad() > 1 ? "s" : ""}` : ""})
              </span>
            </Show>
          </text>
        </box>
        <Show when={list().length <= 2 || open()}>
          <For each={list()}>
            {(item) => (
              <box flexDirection="row" gap={1}>
                <text
                  flexShrink={0}
                  style={{
                    fg: dot[item.status],
                  }}
                >
                  •
                </text>
                <text fg={theme.text} wrapMode="word">
                  {item.name}{" "}
                  <span style={{ fg: theme.textMuted }}>
                    <Switch fallback={item.status}>
                      <Match when={item.status === "connected"}>Connected</Match>
                      <Match when={item.status === "failed"}>
                        <i>{item.error}</i>
                      </Match>
                      <Match when={item.status === "disabled"}>Disabled</Match>
                      <Match when={item.status === "needs_auth"}>Needs auth</Match>
                      <Match when={item.status === "needs_client_registration"}>Needs client ID</Match>
                    </Switch>
                  </span>
                </text>
              </box>
            )}
          </For>
        </Show>
      </box>
    </Show>
  )
}

const tui: TuiPlugin = async (api) => {
  api.slots.register({
    order: 200,
    slots: {
      sidebar_content() {
        return <View />
      },
    },
  })
}

export default {
  tui,
}
