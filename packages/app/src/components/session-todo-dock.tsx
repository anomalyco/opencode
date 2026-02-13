import type { Todo } from "@opencode-ai/sdk/v2"
import { Checkbox } from "@opencode-ai/ui/checkbox"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { For, Show, createMemo } from "solid-js"
import { createStore } from "solid-js/store"

function dot(status: Todo["status"]) {
  if (status !== "in_progress") return undefined
  return (
    <svg viewBox="0 0 10 10" width="8" height="8" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
      <circle cx="5" cy="5" r="2.25" />
    </svg>
  )
}

export function SessionTodoDock(props: { todos: Todo[]; title: string; collapseLabel: string; expandLabel: string }) {
  const [store, setStore] = createStore({
    collapsed: false,
  })

  const toggle = () => setStore("collapsed", (value) => !value)

  const summary = createMemo(() => {
    const total = props.todos.length
    if (total === 0) return ""
    const completed = props.todos.filter((todo) => todo.status === "completed").length
    return `${completed} of ${total} ${props.title.toLowerCase()} completed`
  })

  const preview = createMemo(() => {
    const active =
      props.todos.find((todo) => todo.status === "in_progress") ??
      props.todos.find((todo) => todo.status === "pending") ??
      props.todos.filter((todo) => todo.status === "completed").at(-1) ??
      props.todos[0]
    if (!active) return ""
    return active.content
  })

  return (
    <div
      classList={{
        "bg-background-base border border-border-weak-base relative z-0 rounded-[12px] overflow-clip": true,
        "h-20": store.collapsed,
      }}
    >
      <div
        class="pl-3 pr-2 py-2 flex items-center gap-2"
        role="button"
        tabIndex={0}
        onClick={toggle}
        onKeyDown={(event) => {
          if (event.key !== "Enter" && event.key !== " ") return
          event.preventDefault()
          toggle()
        }}
      >
        <span class="text-14-regular text-text-strong">{summary()}</span>
        <div class="ml-1 flex-1 min-w-0">
          <Show when={store.collapsed && preview()}>
            <div class="text-14-regular text-text-base truncate">{preview()}</div>
          </Show>
        </div>
        <div class="ml-1">
          <IconButton
            icon="chevron-down"
            size="normal"
            variant="ghost"
            classList={{ "rotate-180": !store.collapsed }}
            onMouseDown={(event) => {
              event.preventDefault()
              event.stopPropagation()
            }}
            onClick={(event) => {
              event.stopPropagation()
              toggle()
            }}
            aria-label={store.collapsed ? props.expandLabel : props.collapseLabel}
          />
        </div>
      </div>

      <div hidden={store.collapsed}>
        <TodoList todos={props.todos} />
      </div>
    </div>
  )
}

function TodoList(props: { todos: Todo[] }) {
  return (
    <div class="px-3 pb-11 flex flex-col gap-1.5 max-h-42 overflow-y-auto no-scrollbar">
      <For each={props.todos}>
        {(todo) => (
          <Checkbox
            readOnly
            checked={todo.status === "completed"}
            indeterminate={todo.status === "in_progress"}
            icon={dot(todo.status)}
          >
            <span
              class="text-14-regular min-w-0 break-words"
              style={{
                color: todo.status === "completed" ? "var(--text-base)" : "var(--text-strong)",
                "text-decoration":
                  todo.status === "completed" || todo.status === "cancelled" ? "line-through" : undefined,
              }}
            >
              {todo.content}
            </span>
          </Checkbox>
        )}
      </For>
    </div>
  )
}
