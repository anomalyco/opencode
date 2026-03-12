import { createMemo, For, Show } from "solid-js"
import { useSync } from "../context/sync"
import { useTheme } from "../context/theme"

export function TeamTasksPanel(props: { teamID: string }) {
  const sync = useSync()
  const { theme } = useTheme()

  const tasks = createMemo(() => sync.data.team_task[props.teamID] ?? [])

  const pendingTasks = createMemo(() => tasks().filter((t) => t.status === "pending"))
  const inProgressTasks = createMemo(() => tasks().filter((t) => t.status === "in_progress"))
  const completedTasks = createMemo(() => tasks().filter((t) => t.status === "completed"))

  return (
    <box
      backgroundColor={theme.backgroundPanel}
      paddingTop={1}
      paddingBottom={1}
      paddingLeft={2}
      paddingRight={2}
      borderStyle="single"
      borderColor={theme.border}
      maxHeight={15}
      flexShrink={0}
    >
      <scrollbox
        flexGrow={1}
        verticalScrollbarOptions={{
          trackOptions: {
            backgroundColor: theme.background,
            foregroundColor: theme.borderActive,
          },
        }}
      >
        <text fg={theme.text}>
          <b>Team Tasks</b>
          <span style={{ fg: theme.textMuted }}> ({tasks().length} total)</span>
        </text>

        <Show when={tasks().length === 0}>
          <text fg={theme.textMuted}>No tasks in this team yet.</text>
        </Show>

        <Show when={inProgressTasks().length > 0}>
          <box marginTop={1}>
            <text fg={theme.warning}>
              <b>In Progress ({inProgressTasks().length})</b>
            </text>
            <For each={inProgressTasks()}>
              {(task) => (
                <box flexDirection="row" gap={1}>
                  <text fg={theme.warning}>•</text>
                  <text fg={theme.text} wrapMode="word">
                    {task.title}
                    <Show when={task.assigned_to}>
                      <span style={{ fg: theme.textMuted }}> → {task.assigned_to}</span>
                    </Show>
                  </text>
                </box>
              )}
            </For>
          </box>
        </Show>

        <Show when={pendingTasks().length > 0}>
          <box marginTop={1}>
            <text fg={theme.textMuted}>
              <b>Pending ({pendingTasks().length})</b>
            </text>
            <For each={pendingTasks()}>
              {(task) => (
                <box flexDirection="row" gap={1}>
                  <text fg={theme.textMuted}>○</text>
                  <text fg={theme.textMuted} wrapMode="word">
                    {task.title}
                  </text>
                </box>
              )}
            </For>
          </box>
        </Show>

        <Show when={completedTasks().length > 0}>
          <box marginTop={1}>
            <text fg={theme.success}>
              <b>Completed ({completedTasks().length})</b>
            </text>
            <For each={completedTasks()}>
              {(task) => (
                <box flexDirection="row" gap={1}>
                  <text fg={theme.success}>✓</text>
                  <text fg={theme.textMuted} wrapMode="word">
                    {task.title}
                  </text>
                </box>
              )}
            </For>
          </box>
        </Show>
      </scrollbox>
    </box>
  )
}
