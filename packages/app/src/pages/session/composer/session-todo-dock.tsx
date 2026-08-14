import type { Todo } from "@/types"
import { AnimatedNumber } from "@opencode-ai/ui/animated-number"
import { Checkbox } from "@opencode-ai/ui/checkbox"
import { TextStrikethrough } from "@opencode-ai/ui/text-strikethrough"
import { Index, Match, Switch, createMemo } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/context/language"
import { SessionComposerPullout } from "./session-composer-pullout"

const doneToken = "\u0000done\u0000"
const totalToken = "\u0000total\u0000"

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

export function SessionTodoDock(props: {
  todos: Todo[]
  collapsed: boolean
  onToggle: () => void
  collapseLabel: string
  expandLabel: string
  dockProgress: number
}) {
  const language = useLanguage()

  const total = createMemo(() => props.todos.length)
  const done = createMemo(() => props.todos.filter((todo) => todo.status === "completed").length)
  const label = createMemo(() => language.t("session.todo.progress", { done: done(), total: total() }))
  const progress = createMemo(() =>
    language
      .t("session.todo.progress", { done: doneToken, total: totalToken })
      .split(/(\u0000done\u0000|\u0000total\u0000)/),
  )

  const active = createMemo(
    () =>
      props.todos.find((todo) => todo.status === "in_progress") ??
      props.todos.find((todo) => todo.status === "pending") ??
      props.todos.filter((todo) => todo.status === "completed").at(-1) ??
      props.todos[0],
  )

  const preview = createMemo(() => active()?.content ?? "")
  return (
    <SessionComposerPullout
      name="todo"
      label={
        <Index each={progress()}>
          {(item) => (
            <Switch fallback={<span>{item()}</span>}>
              <Match when={item() === doneToken}>
                <AnimatedNumber value={done()} />
              </Match>
              <Match when={item() === totalToken}>
                <AnimatedNumber value={total()} />
              </Match>
            </Switch>
          )}
        </Index>
      }
      ariaLabel={label()}
      preview={props.collapsed ? preview() : undefined}
      collapsed={props.collapsed}
      onToggle={props.onToggle}
      collapseLabel={props.collapseLabel}
      expandLabel={props.expandLabel}
      dockProgress={props.dockProgress}
    >
      <TodoList todos={props.todos} />
    </SessionComposerPullout>
  )
}

function TodoList(props: { todos: Todo[] }) {
  const [store, setStore] = createStore({
    stuck: false,
  })

  return (
    <div class="relative">
      <div
        class="px-3 pb-11 flex flex-col gap-1.5 max-h-42 overflow-y-auto no-scrollbar"
        style={{ "overflow-anchor": "none" }}
        onScroll={(e) => {
          setStore("stuck", e.currentTarget.scrollTop > 0)
        }}
      >
        <Index each={props.todos}>
          {(todo) => (
            <Checkbox
              readOnly
              checked={todo().status === "completed"}
              indeterminate={todo().status === "in_progress"}
              data-in-progress={todo().status === "in_progress" ? "" : undefined}
              data-state={todo().status}
              icon={dot(todo().status)}
              style={{
                "--checkbox-align": "flex-start",
                "--checkbox-offset": "1px",
                transition: "opacity 220ms var(--tool-motion-ease, cubic-bezier(0.22, 1, 0.36, 1))",
                opacity: todo().status === "pending" ? "0.94" : "1",
              }}
            >
              <TextStrikethrough
                active={todo().status === "completed" || todo().status === "cancelled"}
                text={todo().content}
                class="text-14-regular min-w-0 break-words"
                style={{
                  "line-height": "var(--line-height-normal)",
                  transition:
                    "color 220ms var(--tool-motion-ease, cubic-bezier(0.22, 1, 0.36, 1)), opacity 220ms var(--tool-motion-ease, cubic-bezier(0.22, 1, 0.36, 1))",
                  color:
                    todo().status === "completed" || todo().status === "cancelled"
                      ? "var(--text-weak)"
                      : "var(--text-strong)",
                  opacity: todo().status === "pending" ? "0.92" : "1",
                }}
              />
            </Checkbox>
          )}
        </Index>
      </div>
      <div
        class="pointer-events-none absolute top-0 left-0 right-0 h-4 transition-opacity duration-150"
        style={{
          background: "linear-gradient(to bottom, var(--background-base), transparent)",
          opacity: store.stuck ? 1 : 0,
        }}
      />
    </div>
  )
}
