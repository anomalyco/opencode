import { Plugin } from "@opencode/plugin/tui"
import { Task } from "@opencode/schema/task"
import { createEffect, createMemo, createSignal, For, on, onCleanup, Show, type Accessor } from "solid-js"
import { TodoItem } from "../../component/todo-item"

/**
 * The project's tasks from the task plugin's RPC. It refetches when the routed Session or the server connection
 * changes, and after every `changed` event: the event carries the list of whichever project changed, so reading the
 * routed project's list again is what keeps this panel from showing another project's tasks.
 */
export function createTasks(context: Plugin.Context, sessionID: Accessor<string>) {
  const [tasks, setTasks] = createSignal<ReadonlyArray<Task.Item>>([])
  const rpc = context.client.rpc(Task.Definition)
  const location = () => {
    const directory = context.data.session.get(sessionID())?.location.directory
    return directory ? { location: { directory } } : undefined
  }
  // A reply that lands after a newer fetch started is older than what the panel already shows.
  const turn = { value: 0 }
  const load = () => {
    const current = ++turn.value
    // A server without the task plugin answers with an error, and the panel stays hidden.
    void rpc.list({}, location()).then(
      (next) => {
        if (current === turn.value) setTasks(next)
      },
      () => undefined,
    )
  }
  onCleanup(rpc.events.on("changed", load))
  onCleanup(context.data.on("server.connected", load))
  createEffect(on(sessionID, () => load()))

  /** Moves a task to its next status, as a click on it does. */
  const advance = (item: Task.Item) =>
    rpc.update({ id: item.id, status: next(item.status) }, location()).catch((error) =>
      context.ui.toast.show({
        title: "Failed to update the task",
        message: error instanceof Error ? error.message : String(error),
        variant: "error",
      }),
    )

  return { tasks, advance }
}

/** A click cycles pending, in progress, completed. A cancelled task goes back to pending. */
export function next(status: Task.Status): Task.Status {
  if (status === "pending") return "in_progress"
  if (status === "in_progress") return "completed"
  return "pending"
}

export function SidebarTasks(props: { context: Plugin.Context; sessionID: string }) {
  const [view, updateView] = props.context.storage.store("view", { initial: { open: true } })
  const theme = props.context.theme
  const list = createTasks(props.context, () => props.sessionID)
  const remaining = createMemo(
    () => list.tasks().filter((item) => item.status === "pending" || item.status === "in_progress").length,
  )
  const collapsible = () => list.tasks().length > 2

  return (
    <Show when={list.tasks().length > 0}>
      <box>
        <box
          flexDirection="row"
          gap={1}
          onMouseDown={() => {
            if (!collapsible()) return
            void updateView((draft) => {
              draft.open = !draft.open
            }).catch((error) => console.error("Failed to persist task sidebar state", error))
          }}
        >
          <Show when={collapsible()}>
            <text fg={theme.text.base}>{view.open ? "▼" : "▶"}</text>
          </Show>
          <text fg={theme.text.base}>
            <b>Tasks</b>
            <span style={{ fg: theme.text.muted }}> ({remaining()} remaining)</span>
          </text>
        </box>
        <Show when={!collapsible() || view.open}>
          <For each={list.tasks()}>
            {(item) => (
              <box onMouseUp={() => void list.advance(item)}>
                <TodoItem theme={theme} todo={item} />
              </box>
            )}
          </For>
        </Show>
      </box>
    </Show>
  )
}

export default Plugin.define({
  id: "opencode.sidebar.tasks",
  setup(context) {
    context.ui.slot({
      append: "sidebar.content",
      render: (props) => <SidebarTasks context={context} sessionID={props.sessionID} />,
    })
  },
})
