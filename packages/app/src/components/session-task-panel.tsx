import { createMemo, For, Show } from "solid-js"
import { useSync } from "@/context/sync"
import { useParams } from "@solidjs/router"
import { Icon } from "@opencode-ai/ui/icon"
import type { Todo } from "@opencode-ai/sdk/v2/client"

function TaskItem(props: { todo: Todo }) {
  return (
    <div
      classList={{
        "flex items-start gap-3 p-3 rounded-lg border transition-colors": true,
        "border-border-base bg-surface-base": props.todo.status === "pending",
        "border-border-warning-base bg-surface-warning-base/10": props.todo.status === "in_progress",
        "border-border-success-base/50 bg-surface-success-base/5": props.todo.status === "completed",
        "border-border-weak-base bg-surface-weak-base/50 opacity-60": props.todo.status === "cancelled",
      }}
    >
      <div
        classList={{
          "mt-0.5 shrink-0": true,
          "text-icon-success-base": props.todo.status === "completed",
          "text-icon-warning-base": props.todo.status === "in_progress",
          "text-icon-weak": props.todo.status === "cancelled" || props.todo.status === "pending",
        }}
      >
        <Show
          when={props.todo.status === "completed"}
          fallback={
            <Show
              when={props.todo.status === "in_progress"}
              fallback={
                <Show
                  when={props.todo.status === "cancelled"}
                  fallback={<Icon name="circle-check" size="small" class="opacity-30" />}
                >
                  <Icon name="close" size="small" />
                </Show>
              }
            >
              <Icon name="dot-grid" size="small" class="animate-pulse" />
            </Show>
          }
        >
          <Icon name="check" size="small" />
        </Show>
      </div>
      <div class="flex-1 min-w-0">
        <span
          classList={{
            "text-14-regular": true,
            "text-text-base": props.todo.status !== "cancelled" && props.todo.status !== "completed",
            "text-text-weak line-through": props.todo.status === "cancelled",
            "text-text-weak": props.todo.status === "completed",
          }}
        >
          {props.todo.content}
        </span>
      </div>
    </div>
  )
}

export function SessionTaskPanel() {
  const sync = useSync()
  const params = useParams()

  const todos = createMemo(() => {
    const sessionID = params.id
    if (!sessionID) return []
    return sync.data.todo[sessionID] ?? []
  })

  return (
    <div class="h-full flex flex-col overflow-hidden">
      <div class="flex-1 overflow-y-auto px-6 py-4">
        <Show when={todos().length === 0}>
          <div class="flex flex-col items-center justify-center h-full text-text-weak">
            <Icon name="checklist" size="large" class="mb-2 opacity-50" />
            <span class="text-14-regular">No tasks yet</span>
          </div>
        </Show>
        <Show when={todos().length > 0}>
          <div class="flex flex-col gap-2">
            <For each={todos()}>{(todo) => <TaskItem todo={todo} />}</For>
          </div>
        </Show>
      </div>
    </div>
  )
}
