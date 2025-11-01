import { createEffect, For, Show, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import { Icon, Checkbox } from "@opencode-ai/ui"
import { useSDK } from "@/context/sdk"
import { useLocal } from "@/context/local"
import type { Todo } from "@opencode-ai/sdk"

interface TodoItemProps {
  todo: Todo
}

function TodoItem(props: TodoItemProps) {
  const isCompleted = () => props.todo.status === "completed"

  return (
    <Checkbox readOnly checked={isCompleted()}>
      <div data-slot="todo-content" data-completed={isCompleted()}>
        {props.todo.content}
      </div>
    </Checkbox>
  )
}

export function TodoList() {
  const sdk = useSDK()
  const local = useLocal()
  const sessionID = () => local.session.active()?.id

  const [store, setStore] = createStore<{
    todos: Todo[]
    loading: boolean
  }>({
    todos: [],
    loading: true,
  })

  // Fetch todos initially (only when session changes)
  createEffect(() => {
    const id = sessionID()
    if (!id) {
      setStore("todos", [])
      setStore("loading", false)
      return
    }

    const fetchTodos = async () => {
      try {
        setStore("loading", true)
        const response = await sdk.client.session.todo({ path: { id } })
        if (response.data) {
          setStore("todos", response.data)
        }
      } catch (error) {
        console.error("Failed to fetch todos:", error)
      } finally {
        setStore("loading", false)
      }
    }

    fetchTodos()
  })

  // Listen for real-time todo updates
  createEffect(() => {
    const unsubscribe = sdk.event.listen((e) => {
      if (e.details.type === "todo.updated") {
        const event = e.details
        if (event.properties.sessionID === sessionID()) {
          setStore("todos", event.properties.todos)
        }
      }
    })

    onCleanup(() => unsubscribe())
  })

  const completedTodos = () => store.todos.filter((t) => t.status === "completed")

  return (
    <div class="flex flex-col h-full border-l border-border-base">
      {/* Header */}
      <div class="flex items-center justify-between px-3 py-3 border-b border-border-base -mt-[10px]">
        <div class="flex items-center gap-2">
          <Icon name="checklist" class="w-5 h-5" />
          <h2 class="text-16-medium">To-dos</h2>
        </div>
        <span class="text-14-regular text-text-weak">
          {completedTodos().length}/{store.todos.length}
        </span>
      </div>

      {/* Todo List */}
      <div class="flex-1 overflow-y-auto pr-3 py-4">
        <Show when={store.loading}>
          <div class="flex items-center justify-center py-8">
            <p class="text-14-regular text-text-weak">Loading todos...</p>
          </div>
        </Show>

        <Show when={!store.loading && store.todos.length === 0}>
          <div class="flex flex-col items-center justify-center py-8 text-center">
            <Icon name="checklist" class="w-12 h-12 text-text-weak mb-2" />
            <p class="text-14-regular text-text-weak">No todos yet</p>
            <p class="text-12-regular text-text-muted mt-1">Ask the AI to create todos for you</p>
          </div>
        </Show>

        <Show when={!store.loading && store.todos.length > 0}>
          <div data-component="todos" class="pl-[15px]">
            <For each={store.todos}>{(todo) => <TodoItem todo={todo} />}</For>
          </div>
        </Show>
      </div>
    </div>
  )
}
