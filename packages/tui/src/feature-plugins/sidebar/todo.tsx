import { Plugin } from "@opencode/plugin/tui"
import type { SessionMessageInfo } from "@opencode/client"
import { createEffect, createMemo, createSignal, For, Show } from "solid-js"
import { TodoItem } from "../../component/todo-item"
import { sessionTodos, type Todo } from "../../util/todo"

export function SidebarTodo(props: { context: Plugin.Context; sessionID: string }) {
  const [view, updateView] = props.context.storage.store("view", { initial: { open: true } })
  const theme = props.context.theme
  const sessionID = props.sessionID
  const messages = () => props.context.data.session.message.list(sessionID)
  const localList = createMemo(() =>
    sessionTodos(messages(), props.context.data.session.get(sessionID)?.revert?.messageID),
  )

  const [fetchedTodos, setFetchedTodos] = createSignal<Todo[]>([])
  const [checkedSession, setCheckedSession] = createSignal<string | undefined>(undefined)

  // After a restart or in long sessions, the loaded window may not include an older `todowrite` call. Fetch the latest
  // messages once without paging through the whole transcript or growing the plugin API.
  createEffect(() => {
    const id = sessionID
    if (localList().length > 0) {
      setFetchedTodos([])
      return
    }
    // An empty store means the session has no messages, or the history sync has not published its first page yet.
    // Either way nothing can be older than the window, and the effect runs again when the page arrives.
    if (messages().length === 0) return
    if (checkedSession() === id) return
    setCheckedSession(id)
    setFetchedTodos([])

    void props.context.client.message
      .list({ sessionID: id, limit: 100, order: "desc" })
      .then((res: { readonly data: ReadonlyArray<SessionMessageInfo> }) => {
        // The server returns newest first, but `sessionTodos` reads the latest call in transcript order.
        const todos = sessionTodos(res.data.toReversed(), props.context.data.session.get(id)?.revert?.messageID)
        if (checkedSession() === id) setFetchedTodos(todos)
      })
      .catch((error: unknown) => console.error("Failed to fetch session todos", error))
  })

  const list = createMemo(() => (localList().length > 0 ? localList() : fetchedTodos()))

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
