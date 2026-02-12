import type { Todo } from "@opencode-ai/sdk/v2"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { For, Show, createMemo } from "solid-js"
import { createStore } from "solid-js/store"

function color(status: string) {
  if (status === "completed") return "var(--icon-success-base)"
  if (status === "in_progress") return "var(--icon-info-base)"
  if (status === "cancelled") return "var(--icon-critical-base)"
  return "var(--icon-weaker)"
}

export function SessionTodoDock(props: { todos: Todo[]; title: string; collapseLabel: string; expandLabel: string }) {
  const [store, setStore] = createStore({
    collapsed: false,
  })

  const progress = createMemo(() => {
    const total = props.todos.length
    if (total === 0) return ""
    const completed = props.todos.filter((todo) => todo.status === "completed").length
    return `${completed}/${total}`
  })

  const preview = createMemo(() => {
    const active =
      props.todos.find((todo) => todo.status === "in_progress") ??
      props.todos.find((todo) => todo.status === "pending") ??
      props.todos[0]
    if (!active) return ""
    return active.content
  })

  return (
    <div class="mb-3 rounded-md border border-border-weak-base bg-surface-raised-stronger-non-alpha shadow-xs-border">
      <div class="px-3 py-2 flex items-center gap-2">
        <span class="text-12-medium text-text-strong">{props.title}</span>
        <Show when={progress()}>
          <span class="text-12-regular text-text-weak">{progress()}</span>
        </Show>
        <div class="ml-auto">
          <IconButton
            icon="chevron-down"
            size="small"
            variant="ghost"
            classList={{ "rotate-180": !store.collapsed }}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => setStore("collapsed", (value) => !value)}
            aria-label={store.collapsed ? props.expandLabel : props.collapseLabel}
          />
        </div>
      </div>

      <Show when={store.collapsed} fallback={<TodoList todos={props.todos} />}>
        <div class="px-3 pb-3 text-12-regular text-text-base truncate">{preview()}</div>
      </Show>
    </div>
  )
}

function TodoList(props: { todos: Todo[] }) {
  return (
    <div class="px-3 pb-3 flex flex-col gap-1.5 max-h-42 overflow-y-auto no-scrollbar">
      <For each={props.todos}>
        {(todo) => (
          <div class="flex items-start gap-2 min-w-0">
            <span style={{ color: color(todo.status) }} class="text-12-medium leading-5 shrink-0">
              ●
            </span>
            <span
              class="text-12-regular min-w-0 break-words"
              style={{
                color: todo.status === "completed" || todo.status === "cancelled" ? "var(--text-weak)" : undefined,
                "text-decoration":
                  todo.status === "completed" || todo.status === "cancelled" ? "line-through" : undefined,
              }}
            >
              {todo.content}
            </span>
          </div>
        )}
      </For>
    </div>
  )
}
