import type { TuiPlugin, TuiPluginApi, TuiPluginModule } from "@opencode-ai/plugin/tui"
import { createMemo, createSignal, For, Show } from "solid-js"
import path from "path"

const id = "internal:sidebar-workspace-folders"

function basename(p: string): string {
  if (!p) return ""
  return path.basename(p) || p
}

function View(props: { api: TuiPluginApi }) {
  const [open, setOpen] = createSignal(true)
  const theme = () => props.api.theme.current

  const activeID = createMemo(() => props.api.state.multiRootWorkspace.current())
  const workspace = createMemo(() => {
    const id = activeID()
    if (!id) return undefined
    return props.api.state.multiRootWorkspace.get(id)
  })

  const primary = createMemo(() => props.api.state.path.directory)

  const folders = createMemo(() => {
    const ws = workspace()
    if (!ws) return []
    return ws.folders
  })

  return (
    <Show when={workspace() && folders().length > 1}>
      <box>
        <box flexDirection="row" gap={1} onMouseDown={() => folders().length > 2 && setOpen((x) => !x)}>
          <Show when={folders().length > 2}>
            <text fg={theme().text}>{open() ? "▼" : "▶"}</text>
          </Show>
          <text fg={theme().text}>
            <b>Workspace</b>
            <Show when={!open()}>
              <span style={{ fg: theme().textMuted }}>
                {" "}
                ({folders().length} folders)
              </span>
            </Show>
          </text>
        </box>
        <Show when={folders().length <= 2 || open()}>
          <For each={folders()}>
            {(folder) => {
              const isPrimary = createMemo(() => folder.path === primary())
              const label = folder.name ?? basename(folder.path)
              return (
                <box flexDirection="row" gap={1}>
                  <text flexShrink={0} fg={isPrimary() ? theme().primary : theme().textMuted}>
                    {isPrimary() ? "●" : "○"}
                  </text>
                  <text fg={theme().text} wrapMode="word">
                    {label}
                    <Show when={!isPrimary()}>
                      <span style={{ fg: theme().textMuted }}> · secondary</span>
                    </Show>
                  </text>
                </box>
              )
            }}
          </For>
        </Show>
      </box>
    </Show>
  )
}

const tui: TuiPlugin = async (api) => {
  api.slots.register({
    // Between context (100) and mcp (200), as outlined in the plan.
    order: 150,
    slots: {
      sidebar_content() {
        return <View api={api} />
      },
    },
  })
}

const plugin: TuiPluginModule & { id: string } = {
  id,
  tui,
}

export default plugin
