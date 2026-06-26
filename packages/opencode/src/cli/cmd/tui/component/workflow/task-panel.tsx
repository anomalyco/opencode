import { createMemo, For, Show, type Accessor } from "solid-js"
import { useTheme } from "@tui/context/theme"
import { SplitBorder } from "@tui/component/border"
import { useWorkflow } from "./use-workflow"

export function TaskPanel(props: { sessionID: Accessor<string | undefined> }) {
  const { theme } = useTheme()
  const wf = useWorkflow(props.sessionID)
  const open = createMemo(() => wf.state()?.taskPanelOpen ?? false)
  const todos = createMemo(() => wf.latestTodos())
  const done = createMemo(() => todos().filter((t) => t.status === "completed").length)

  return (
    <Show when={open() && todos().length > 0}>
      <box
        flexShrink={0}
        {...SplitBorder}
        border={["left"]}
        borderColor={theme.border}
        backgroundColor={theme.backgroundPanel}
        paddingLeft={2}
        paddingRight={1}
        paddingTop={0}
        paddingBottom={0}
      >
        <text fg={theme.textMuted} wrapMode="none">
          Tasks {done()}/{todos().length}
        </text>
        <For each={todos()}>
          {(todo) => (
            <box flexDirection="row" gap={1}>
              <Show
                when={todo.status === "completed"}
                fallback={
                  <Show
                    when={todo.status === "in_progress"}
                    fallback={<text fg={theme.textMuted}>❌</text>}
                  >
                    <text fg={theme.warning}>🔧</text>
                  </Show>
                }
              >
                <text fg={theme.success}>✅</text>
              </Show>
              <text fg={todo.status === "in_progress" ? theme.text : theme.textMuted} wrapMode="none">
                {todo.content}
              </text>
            </box>
          )}
        </For>
      </box>
    </Show>
  )
}

export * as WorkflowTaskPanel from "./task-panel"