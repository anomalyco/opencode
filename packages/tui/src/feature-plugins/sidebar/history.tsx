import type { TuiPlugin, TuiPluginApi } from "@opencode-ai/plugin/tui"
import type { BuiltinTuiPlugin } from "../builtins"
import { createMemo, createSignal, For, Show } from "solid-js"
import { scrollToMessage } from "../../context/scroll-to-message"
import { Locale } from "../../util/locale"
import type { Part, UserMessage } from "@opencode-ai/sdk/v2"

const id = "internal:sidebar-history"

function View(props: { api: TuiPluginApi; session_id: string }) {
  const [open, setOpen] = createSignal(true)
  const theme = () => props.api.theme.current

  const items = createMemo(() => {
    const msgs = props.api.state.session.messages(props.session_id)
    return msgs
      .filter((m): m is UserMessage => m.role === "user")
      .map((m) => {
        const parts = props.api.state.part(m.id)
        const text = parts
          .filter((p): p is Extract<Part, { type: "text" }> => p.type === "text" && !p.synthetic)
          .map((p) => p.text)
          .join("\n\n")
        return { id: m.id, text }
      })
      .filter((item) => item.text.length > 0)
      .reverse()
  })

  return (
    <Show when={items().length > 0}>
      <box>
        <box flexDirection="row" gap={1} onMouseDown={() => items().length > 2 && setOpen((x) => !x)}>
          <Show when={items().length > 2}>
            <text fg={theme().text}>{open() ? "▼" : "▶"}</text>
          </Show>
          <text fg={theme().text}>
            <b>History</b>
          </text>
        </box>
        <Show when={items().length <= 2 || open()}>
          <scrollbox height={8} flexShrink={0}>
            <For each={items()}>
              {(entry) => (
                <box onMouseUp={() => scrollToMessage(entry.id)}>
                  <text fg={theme().textMuted} wrapMode="none" maxWidth={36}>
                    {Locale.truncateMiddle(entry.text.split("\n")[0], 34)}
                  </text>
                </box>
              )}
            </For>
          </scrollbox>
        </Show>
      </box>
    </Show>
  )
}

const tui: TuiPlugin = async (api) => {
  api.slots.register({
    order: 600,
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
