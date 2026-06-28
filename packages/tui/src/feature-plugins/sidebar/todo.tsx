import type { TuiPlugin, TuiPluginApi } from "@opencode-ai/plugin/tui"
import type { BuiltinTuiPlugin } from "../builtins"
import { createMemo, For, Show } from "solid-js"
import { TodoItem } from "../../component/todo-item"
import { SidebarSection } from "../../component/sidebar-section"

const id = "internal:sidebar-todo"

function View(props: { api: TuiPluginApi; session_id: string }) {
  const list = createMemo(() => props.api.state.session.todo(props.session_id))
  const show = createMemo(() => list().length > 0 && list().some((item) => item.status !== "completed"))

  return (
    <Show when={show()}>
      <SidebarSection title="Todo" collapsible={list().length > 2}>
        <For each={list()}>{(item) => <TodoItem status={item.status} content={item.content} />}</For>
      </SidebarSection>
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
