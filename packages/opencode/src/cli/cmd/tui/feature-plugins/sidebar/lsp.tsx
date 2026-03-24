import type { TuiPlugin } from "@opencode-ai/plugin/tui"
import { createMemo, For, Show, createSignal } from "solid-js"
import { useSync } from "../../context/sync"
import { useTheme } from "../../context/theme"

function View() {
  const sync = useSync()
  const { theme } = useTheme()
  const [open, setOpen] = createSignal(true)
  const list = createMemo(() => sync.data.lsp.map((item) => ({ id: item.id, root: item.root, status: item.status })))

  return (
    <box>
      <box flexDirection="row" gap={1} onMouseDown={() => list().length > 2 && setOpen((x) => !x)}>
        <Show when={list().length > 2}>
          <text fg={theme.text}>{open() ? "▼" : "▶"}</text>
        </Show>
        <text fg={theme.text}>
          <b>LSP</b>
        </text>
      </box>
      <Show when={list().length <= 2 || open()}>
        <Show when={list().length === 0}>
          <text fg={theme.textMuted}>
            {sync.data.config.lsp === false
              ? "LSPs have been disabled in settings"
              : "LSPs will activate as files are read"}
          </text>
        </Show>
        <For each={list()}>
          {(item) => (
            <box flexDirection="row" gap={1}>
              <text
                flexShrink={0}
                style={{
                  fg: {
                    connected: theme.success,
                    error: theme.error,
                  }[item.status],
                }}
              >
                •
              </text>
              <text fg={theme.textMuted}>
                {item.id} {item.root}
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
    order: 300,
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
