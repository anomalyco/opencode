import type { TuiPlugin, TuiPluginApi } from "@opencode-ai/plugin/tui"
import type { BuiltinTuiPlugin } from "../builtins"
import { createMemo, For, Show } from "solid-js"
import { SidebarSection } from "../../component/sidebar-section"

const id = "internal:sidebar-lsp"

function View(props: { api: TuiPluginApi }) {
  const theme = () => props.api.theme.current
  const list = createMemo(() => props.api.state.lsp())
  const off = createMemo(() => !props.api.state.config.lsp)

  return (
    <SidebarSection title="LSP" collapsible={list().length > 2}>
      <Show when={list().length === 0}>
        <text fg={theme().textMuted}>{off() ? "LSPs are disabled" : "LSPs will activate as files are read"}</text>
      </Show>
      <For each={list()}>
        {(item) => (
          <box flexDirection="row" gap={1}>
            <text
              flexShrink={0}
              style={{
                fg: item.status === "connected" ? theme().success : theme().error,
              }}
            >
              •
            </text>
            <text fg={theme().textMuted}>
              {item.id} {item.root}
            </text>
          </box>
        )}
      </For>
    </SidebarSection>
  )
}

const tui: TuiPlugin = async (api) => {
  api.slots.register({
    order: 300,
    slots: {
      sidebar_content() {
        return <View api={api} />
      },
    },
  })
}

const plugin: BuiltinTuiPlugin = {
  id,
  tui,
}

export default plugin
