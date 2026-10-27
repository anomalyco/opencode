import { Popover } from "@kobalte/core/popover"
import { AnimatedNumber } from "@opencode/ui/animated-number"
import { ProgressCircle } from "@opencode/ui/progress-circle"
import { createEffect, createMemo, For, on, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/runtime/i18n/language"
import { useComposerLaneAlignment } from "./composer-lane"
import { currentTodo, todoFinished, type Todo, type TodoStatus } from "./todos"
import "./todo-pill.css"

// The agent's plan as one capsule in the composer lane, beside the background activity capsule: progress and the todo
// in hand, opening a popover with the whole list.
export function SessionTodoPill(props: { todos: readonly Todo[]; defaultOpen?: boolean }) {
  const language = useLanguage()
  const alignment = useComposerLaneAlignment()
  const [state, setState] = createStore({ open: props.defaultOpen ?? false })

  const done = createMemo(() => props.todos.filter((todo) => todo.status === "completed").length)
  const finished = createMemo(() => props.todos.filter(todoFinished).length)
  const current = createMemo(() => currentTodo(props.todos))
  const label = () => language.plural("session.todo.label", props.todos.length, { done: String(done()) })
  const placement = () => (({ center: "top", start: "top-start", end: "top-end" }) as const)[alignment()]

  return (
    // Sits beside the activity capsule, on the side away from the lane's aligned edge.
    <div
      data-component="session-todo-pill"
      class="flex min-w-0 shrink"
      classList={{ "-order-1": alignment() === "end", "order-1": alignment() !== "end" }}
    >
      <Popover open={state.open} onOpenChange={(open) => setState("open", open)} placement={placement()} gutter={8}>
        <Popover.Trigger
          as="button"
          type="button"
          data-slot="session-todo-pill"
          aria-label={label()}
          class="pointer-events-auto flex h-7 min-w-0 max-w-full items-center gap-2 rounded-[12px] border-[0.5px] border-v2-border-border-muted bg-v2-background-bg-base ps-2.5 pe-2.5 text-[13px] font-[440] leading-text-compact tracking-[-0.04px] whitespace-nowrap text-v2-text-text-base shadow-[var(--v2-elevation-raised)] outline-none"
        >
          <ProgressCircle
            percentage={props.todos.length ? (finished() / props.todos.length) * 100 : 0}
            size={14}
            strokeWidth={2}
            class="shrink-0"
          />
          <span data-slot="session-todo-count" class="shrink-0 tabular-nums text-v2-text-text-muted">
            {language
              .t("session.todo.progress", { done: "\u0000", total: String(props.todos.length) })
              .split("\u0000")
              .flatMap((part, index) => (index === 0 ? [part] : [<AnimatedNumber value={done()} />, part]))}
          </span>
          <Show when={current()}>
            {(todo) => (
              <span dir="auto" class="min-w-0 max-w-[260px] truncate">
                {todo().content}
              </span>
            )}
          </Show>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content data-slot="session-todo-panel" aria-label={label()} class="outline-none">
            <div class="flex items-center gap-2 px-2 pt-1 pb-1.5">
              <span class="flex-1 text-[11px] font-[530] uppercase leading-[var(--line-height-tight)] tracking-[0.05px] text-v2-text-text-muted">
                {language.t("session.todo.title")}
              </span>
              <span class="text-[11px] tabular-nums leading-[var(--line-height-tight)] text-v2-text-text-faint">
                {language.t("session.todo.progress", { done: String(done()), total: String(props.todos.length) })}
              </span>
            </div>
            <TodoList todos={props.todos} />
          </Popover.Content>
        </Popover.Portal>
      </Popover>
    </div>
  )
}

function TodoList(props: { todos: readonly Todo[] }) {
  let list: HTMLDivElement | undefined

  // Keep the todo in progress in view as the plan advances.
  createEffect(
    on(
      () => props.todos.findIndex((todo) => todo.status === "in_progress"),
      (index) => {
        if (index < 0 || !list) return
        list.children[index]?.scrollIntoView({ block: "nearest" })
      },
    ),
  )

  return (
    <div
      ref={list}
      data-slot="session-todo-list"
      data-scrollable
      class="flex max-h-[232px] flex-col overflow-y-auto px-1 pb-1"
    >
      <For each={props.todos}>
        {(todo) => (
          <div
            data-slot="session-todo-row"
            data-status={todo.status}
            class="flex min-h-7 shrink-0 items-start gap-2 rounded-[4px] px-1.5 py-1.5"
          >
            <TodoGlyph status={todo.status} />
            <span
              dir="auto"
              data-slot="session-todo-text"
              class="min-w-0 flex-1 text-[13px] leading-[var(--line-height-compact)]"
            >
              {todo.content}
            </span>
          </div>
        )}
      </For>
    </div>
  )
}

function TodoGlyph(props: { status: TodoStatus }) {
  return (
    <svg
      data-slot="session-todo-glyph"
      data-status={props.status}
      viewBox="0 0 16 16"
      width="16"
      height="16"
      fill="none"
      aria-hidden="true"
      class="shrink-0"
    >
      <Show when={props.status === "completed"}>
        <circle cx="8" cy="8" r="6" fill="currentColor" />
        <path
          d="M5.4 8.2 7.2 9.9 10.6 6.2"
          stroke="var(--v2-background-bg-base)"
          stroke-width="1.5"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </Show>
      <Show when={props.status !== "completed"}>
        <circle
          cx="8"
          cy="8"
          r="5.5"
          stroke="currentColor"
          stroke-dasharray={props.status === "pending" ? "2.2 1.9" : undefined}
        />
      </Show>
      <Show when={props.status === "in_progress"}>
        <circle data-slot="session-todo-pulse" cx="8" cy="8" r="2.75" fill="currentColor" />
      </Show>
      <Show when={props.status === "cancelled"}>
        <path d="M5.5 8h5" stroke="currentColor" stroke-linecap="round" />
      </Show>
    </svg>
  )
}
