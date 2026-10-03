import path from "path"
import type { TuiPlugin, TuiPluginApi } from "@opencode-ai/plugin/tui"
import type { ToolPart } from "@opencode-ai/sdk/v2"
import type { BuiltinTuiPlugin } from "../builtins"
import { createMemo, For, Show, createSignal } from "solid-js"

const id = "internal:sidebar-skills"

function View(props: { api: TuiPluginApi; session_id: string }) {
  const [open, setOpen] = createSignal(true)
  const theme = () => props.api.theme.current
  const all = createMemo(() => props.api.state.skills())
  const invoked = createMemo(() => {
    const names = props.api.state
      .session.messages(props.session_id)
      .flatMap((message) =>
        props.api.state
          .part(message.id)
          .filter((part): part is ToolPart => part.type === "tool" && part.tool === "skill"),
      )
      .map((part) => part.state.input.name)
      .filter((name): name is string => typeof name === "string")
    return new Set(names)
  })
  const list = createMemo(() => all().filter((item) => invoked().has(item.name)))

  const source = (location: string) => {
    if (location === "<built-in>") return "built-in"
    if (location.startsWith(props.api.state.path.worktree)) return "project"
    const configDir = path.dirname(props.api.state.path.config)
    if (configDir && configDir !== "." && location.startsWith(configDir)) return "global"
    return "external"
  }

  return (
    <box>
      <box flexDirection="row" gap={1} onMouseDown={() => list().length > 2 && setOpen((x) => !x)}>
        <Show when={list().length > 2}>
          <text fg={theme().text}>{open() ? "▼" : "▶"}</text>
        </Show>
        <text fg={theme().text}>
          <b>Active Skills</b>
        </text>
      </box>
      <Show when={list().length <= 2 || open()}>
        <Show when={list().length === 0}>
          <text fg={theme().textMuted}>No skills loaded</text>
        </Show>
        <For each={list()}>
          {(item) => (
            <box flexDirection="row" gap={1}>
              <text
                flexShrink={0}
                style={{
                  fg: theme().success,
                }}
              >
                •
              </text>
              <text fg={theme().text} wrapMode="word">
                {item.name}{" "}
                <span style={{ fg: theme().textMuted }}>{source(item.location)}</span>
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
    order: 250,
    slots: {
      sidebar_content(_ctx, props) {
        return <View api={api} session_id={props.session_id} />
      },
    },
  })
}

const plugin: BuiltinTuiPlugin = {
  id,
  tui,
}

export default plugin
