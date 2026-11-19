import { Plugin } from "@opencode/plugin/tui"
import { Todo } from "@opencode/schema/todo"
import { createEffect, createMemo, createSignal, For, on, Show } from "solid-js"
import { TodoItem } from "../../component/todo-item"
import { sessionTodos } from "../../util/todo"

export function SidebarTodo(props: { context: Plugin.Context; sessionID: string }) {
  const [view, updateView] = props.context.storage.store("view", { initial: { open: true } })
  const theme = props.context.theme
  const session = () => props.context.data.session.get(props.sessionID)
  const loaded = createMemo(() =>
    sessionTodos(props.context.data.session.message.list(props.sessionID), session()?.revert?.messageID),
  )
  // Only the latest page of messages is loaded, so a list written before it comes from the todo RPC, which reads the
  // whole history. A server without the RPC answers with an error, and the sidebar shows no list.
  const rpc = props.context.client.rpc(Todo.Definition)
  const [earlier, setEarlier] = createSignal<ReadonlyArray<Todo.Info>>([])
  const request = createMemo(
    () => {
      const current = session()
      if (!current || loaded() !== undefined) return undefined
      return { sessionID: current.id, directory: current.location.directory, boundary: current.revert?.messageID }
    },
    undefined,
    {
      equals: (a, b) => a?.sessionID === b?.sessionID && a?.directory === b?.directory && a?.boundary === b?.boundary,
    },
  )
  createEffect(
    on(request, (current) => {
      setEarlier([])
      if (!current) return
      void rpc.get({ sessionID: current.sessionID }, { location: { directory: current.directory } }).then(
        (todos) => {
          if (request() === current) setEarlier(todos)
        },
        () => undefined,
      )
    }),
  )
  const list = () => loaded() ?? earlier()
  const remaining = createMemo(
    () => list().filter((item) => item.status === "pending" || item.status === "in_progress").length,
  )

  return (
    <Show when={list().length > 0}>
      <box>
        <box
          flexDirection="row"
          gap={1}
          onMouseDown={() => {
            if (list().length <= 2) return
            void updateView((draft) => {
              draft.open = !draft.open
            }).catch((error) => console.error("Failed to persist todo sidebar state", error))
          }}
        >
          <Show when={list().length > 2}>
            <text fg={theme.text.base}>{view.open ? "▼" : "▶"}</text>
          </Show>
          <text fg={theme.text.base}>
            <b>Todo</b>
            <Show when={list().length > 2 && !view.open}>
              <span style={{ fg: theme.text.muted }}> ({remaining()} remaining)</span>
            </Show>
          </text>
        </box>
        <Show when={list().length <= 2 || view.open}>
          <For each={list()}>{(item) => <TodoItem theme={theme} todo={item} />}</For>
        </Show>
      </box>
    </Show>
  )
}

export default Plugin.define({
  id: "opencode.sidebar.todo",
  setup(context) {
    context.ui.slot({
      append: "sidebar.content",
      render: (props) => <SidebarTodo context={context} sessionID={props.sessionID} />,
    })
  },
})
