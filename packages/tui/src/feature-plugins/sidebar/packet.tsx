import type { TuiPlugin, TuiPluginApi } from "@moks/plugin/tui"
import type { BuiltinTuiPlugin } from "../builtins"
import path from "node:path"
import { For, Show, createResource, onCleanup, onMount } from "solid-js"
import { loadPacket } from "./packet-data"

const id = "internal:sidebar-packet"

function View(props: { api: TuiPluginApi }) {
  const theme = () => props.api.theme.current
  const directory = props.api.state.path.directory
  const [data, { refetch }] = createResource(() => directory, (dir) => (dir ? loadPacket(dir) : undefined))

  onMount(() => {
    const timer = setInterval(() => void refetch(), 2000)
    onCleanup(() => clearInterval(timer))
  })

  return (
    <Show when={data()}>
      {(packet) => (
        <box gap={1}>
          <box>
            <text fg={theme().text}>
              <b>{packet().companyTitle}</b>
            </text>
            <For each={packet().reqs}>
              {(req) => (
                <box
                  flexDirection="row"
                  gap={1}
                  onMouseDown={() => {
                    const safe = path.basename(req.slug.trim())
                    if (!safe || safe === "." || safe === "..") return
                    void Bun.write(path.join(packet().company, ".moks", "focus"), safe).then(() => refetch())
                  }}
                >
                  <text fg={req.focused ? theme().text : theme().textMuted} wrapMode="none">
                    {req.focused ? "●" : " "} {req.slug}
                  </text>
                </box>
              )}
            </For>
          </box>
          <Show when={packet().packet}>
            {(focused) => (
              <box>
                <text fg={theme().text}>
                  <b>{focused().title}</b>
                </text>
                <Show when={focused().candidates.length === 0}>
                  <text fg={theme().textMuted}>No candidates yet.</text>
                </Show>
                <For each={focused().candidates}>
                  {(card) => (
                    <text fg={theme().textMuted} wrapMode="none">
                      {card.id}
                      {card.stage ? `  ${card.stage}` : ""}
                      {card.score !== undefined ? `  ${card.score}` : ""}
                    </text>
                  )}
                </For>
              </box>
            )}
          </Show>
        </box>
      )}
    </Show>
  )
}

const tui: TuiPlugin = async (api) => {
  api.slots.register({
    order: 50,
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
