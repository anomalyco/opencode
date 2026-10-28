import type { TuiPlugin, TuiPluginApi } from "@opencode-ai/plugin/tui"
import type { BuiltinTuiPlugin } from "../builtins"
import { createMemo, For, Show, createSignal, useContext } from "solid-js"
import { unwrap } from "solid-js/store"
import { TodoItem } from "../../component/todo-item"
import { useClipboard } from "../../context/clipboard"
import { PromptRefContext } from "../../context/prompt"
import { copyText, onClick } from "../../ui/click"

const id = "internal:sidebar-todo"

function View(props: { api: TuiPluginApi; session_id: string }) {
  const [open, setOpen] = createSignal(true)
  const theme = () => props.api.theme.current
  const clipboard = useClipboard()
  const prompt = useContext(PromptRefContext)
  const list = createMemo(() => props.api.state.session.todo(props.session_id))
  // A clicked todo is copied and added to the end of the prompt, so it can be
  // quoted to the agent or pasted elsewhere.
  const pick = (content: string) => {
    copyText(clipboard, props.api.ui.toast, content, "the todo")
    const ref = prompt?.current
    if (!ref) return
    const input = ref.current.input
    ref.set({
      ...unwrap(ref.current),
      input: input && !/\s$/.test(input) ? `${input} ${content}` : `${input}${content}`,
    })
  }
  const show = createMemo(() => list().length > 0 && list().some((item) => item.status !== "completed"))

  return (
    <Show when={show()}>
      <box>
        <box flexDirection="row" gap={1} onMouseDown={() => list().length > 2 && setOpen((x) => !x)}>
          <Show when={list().length > 2}>
            <text fg={theme().text}>{open() ? "▼" : "▶"}</text>
          </Show>
          <text fg={theme().text}>
            <b>Todo</b>
          </text>
        </box>
        <Show when={list().length <= 2 || open()}>
          <For each={list()}>
            {(item) => (
              <box {...onClick(() => pick(item.content))}>
                <TodoItem status={item.status} content={item.content} />
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
    order: 400,
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
