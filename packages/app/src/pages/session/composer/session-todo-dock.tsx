import type { Todo } from "@opencode-ai/sdk/v2"
import { Checkbox } from "@opencode-ai/ui/checkbox"
import { DockTray } from "@opencode-ai/ui/dock-surface"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { For, Show, createEffect, createMemo, createSignal, on, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"

function dot(status: Todo["status"]) {
  if (status !== "in_progress") return undefined
  return (
    <svg
      viewBox="0 0 12 12"
      width="12"
      height="12"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
      class="block"
    >
      <circle
        cx="6"
        cy="6"
        r="3"
        style={{
          animation: "var(--animate-pulse-scale)",
          "transform-origin": "center",
          "transform-box": "fill-box",
        }}
      />
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

  const active = createMemo(
    () =>
      props.todos.find((todo) => todo.status === "in_progress") ??
      props.todos.find((todo) => todo.status === "pending") ??
      props.todos.filter((todo) => todo.status === "completed").at(-1) ??
      props.todos[0],
  )

  const preview = createMemo(() => active()?.content ?? "")

  return (
    <DockTray
      data-component="session-todo-dock"
      classList={{
        "h-[78px]": store.collapsed,
      }}
    >
      <div
        data-action="session-todo-toggle"
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
        <span class="text-14-regular text-text-strong cursor-default">{summary()}</span>
        <Show when={store.collapsed}>
          <div class="ml-1 flex-1 min-w-0">
            <Show when={preview()}>
              <div class="text-14-regular text-text-base truncate cursor-default">{preview()}</div>
            </Show>
          </div>
        </Show>
        <div classList={{ "ml-auto": !store.collapsed, "ml-1": store.collapsed }}>
          <IconButton
            data-action="session-todo-toggle-button"
            icon="chevron-down"
            size="normal"
            variant="ghost"
            classList={{ "rotate-180": store.collapsed }}
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

      <div data-slot="session-todo-list" hidden={store.collapsed}>
        <TodoList todos={props.todos} open={!store.collapsed} />
      </div>
    </DockTray>
  )
}

function TodoList(props: { todos: Todo[]; open: boolean }) {
  const [stuck, setStuck] = createSignal(false)
  const [scrolling, setScrolling] = createSignal(false)
  let scrollRef!: HTMLDivElement
  let timer: number | undefined

  const inProgress = createMemo(() => props.todos.findIndex((todo) => todo.status === "in_progress"))

  const ensure = () => {
    if (!props.open) return
    if (scrolling()) return
    if (!scrollRef || scrollRef.offsetParent === null) return

    const el = scrollRef.querySelector("[data-in-progress]")
    if (!(el instanceof HTMLElement)) return

    const topFade = 16
    const bottomFade = 44
    const container = scrollRef.getBoundingClientRect()
    const rect = el.getBoundingClientRect()
    const top = rect.top - container.top + scrollRef.scrollTop
    const bottom = rect.bottom - container.top + scrollRef.scrollTop
    const viewTop = scrollRef.scrollTop + topFade
    const viewBottom = scrollRef.scrollTop + scrollRef.clientHeight - bottomFade

    if (top < viewTop) {
      scrollRef.scrollTop = Math.max(0, top - topFade)
    } else if (bottom > viewBottom) {
      scrollRef.scrollTop = bottom - (scrollRef.clientHeight - bottomFade)
    }

    setStuck(scrollRef.scrollTop > 0)
  }

  createEffect(
    on([() => props.open, inProgress], () => {
      if (!props.open || inProgress() < 0) return
      requestAnimationFrame(ensure)
    }),
  )

  onCleanup(() => {
    if (!timer) return
    window.clearTimeout(timer)
  })

  return (
    <div class="relative">
      <div
        class="px-3 pb-11 flex flex-col gap-1.5 max-h-42 overflow-y-auto no-scrollbar"
        ref={scrollRef}
        style={{ "overflow-anchor": "none" }}
        onScroll={(e) => {
          setStuck(e.currentTarget.scrollTop > 0)
          setScrolling(true)
          if (timer) window.clearTimeout(timer)
          timer = window.setTimeout(() => {
            setScrolling(false)
            if (inProgress() < 0) return
            requestAnimationFrame(ensure)
          }, 250)
        }}
      >
        <For each={props.todos}>
          {(todo) => (
            <Checkbox
              readOnly
              checked={todo.status === "completed"}
              indeterminate={todo.status === "in_progress"}
              data-in-progress={todo.status === "in_progress" ? "" : undefined}
              icon={dot(todo.status)}
              style={{ "--checkbox-align": "flex-start", "--checkbox-offset": "1px" }}
            >
              <span
                class="text-14-regular min-w-0 break-words"
                classList={{
                  "text-text-weak": todo.status === "completed" || todo.status === "cancelled",
                  "text-text-strong": todo.status !== "completed" && todo.status !== "cancelled",
                }}
                style={{
                  "line-height": "var(--line-height-normal)",
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
      <div
        class="pointer-events-none absolute top-0 left-0 right-0 h-4 transition-opacity duration-150"
        style={{
          background: "linear-gradient(to bottom, var(--background-base), transparent)",
          opacity: stuck() ? 1 : 0,
        }}
      />
    </div>
  )
}
