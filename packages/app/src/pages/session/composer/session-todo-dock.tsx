import type { Todo } from "@opencode-ai/sdk/v2"
import { AnimatedNumber } from "@opencode-ai/ui/animated-number"
import { DockTray } from "@opencode-ai/ui/dock-surface"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { useSpring } from "@opencode-ai/ui/motion-spring"
import { TextReveal } from "@opencode-ai/ui/text-reveal"
import { createResizeObserver } from "@solid-primitives/resize-observer"
import { Index, createEffect, createMemo } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/context/language"
import { SessionTodoList } from "@/pages/session/composer/session-todo-list"

const doneToken = "\u0000done\u0000"
const totalToken = "\u0000total\u0000"

export function SessionTodoDock(props: {
  sessionID?: string
  todos: Todo[]
  collapsed: boolean
  onToggle: () => void
  collapseLabel: string
  expandLabel: string
  dockProgress: number
}) {
  const language = useLanguage()
  const [store, setStore] = createStore({
    height: 320,
  })

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
  const collapse = useSpring(() => (props.collapsed ? 1 : 0), { visualDuration: 0.3, bounce: 0 })
  const dock = createMemo(() => Math.max(0, Math.min(1, props.dockProgress)))
  const shut = createMemo(() => 1 - dock())
  const value = createMemo(() => Math.max(0, Math.min(1, collapse())))
  const hide = createMemo(() => Math.max(value(), shut()))
  const off = createMemo(() => hide() > 0.98)
  const turn = createMemo(() => Math.max(0, Math.min(1, value())))
  const full = createMemo(() => Math.max(78, store.height))
  let contentRef: HTMLDivElement | undefined

  createEffect(() => {
    const el = contentRef
    if (!el) return
    const update = () => {
      setStore("height", el.getBoundingClientRect().height)
    }
    update()
    createResizeObserver(el, update)
  })

  return (
    <DockTray
      data-component="session-todo-dock"
      style={{
        "overflow-x": "visible",
        "overflow-y": "hidden",
        "max-height": `${Math.max(78, full() - value() * (full() - 78))}px`,
      }}
    >
      <div ref={contentRef}>
        <div
          data-action="session-todo-toggle"
          class="pl-3 pr-2 py-2 flex items-center gap-2 overflow-visible"
          role="button"
          tabIndex={0}
          onClick={props.onToggle}
          onKeyDown={(event) => {
            if (event.key !== "Enter" && event.key !== " ") return
            event.preventDefault()
            props.onToggle()
          }}
        >
          <span
            class="text-14-regular text-text-strong cursor-default inline-flex items-baseline shrink-0 overflow-visible"
            aria-label={label()}
            style={{
              "--tool-motion-odometer-ms": "600ms",
              "--tool-motion-mask": "18%",
              "--tool-motion-mask-height": "0px",
              "--tool-motion-spring-ms": "560ms",
              "white-space": "pre",
              opacity: `${Math.max(0, Math.min(1, 1 - shut()))}`,
            }}
          >
            <Index each={progress()}>
              {(item) =>
                item() === doneToken ? (
                  <AnimatedNumber value={done()} />
                ) : item() === totalToken ? (
                  <AnimatedNumber value={total()} />
                ) : (
                  <span>{item()}</span>
                )
              }
            </Index>
          </span>
          <div
            data-slot="session-todo-preview"
            class="ml-1 min-w-0 overflow-hidden"
            style={{
              flex: "1 1 auto",
              "max-width": "100%",
            }}
          >
            <TextReveal
              class="text-14-regular text-text-base cursor-default"
              text={props.collapsed ? preview() : undefined}
              duration={600}
              travel={25}
              edge={17}
              spring="cubic-bezier(0.34, 1, 0.64, 1)"
              springSoft="cubic-bezier(0.34, 1, 0.64, 1)"
              growOnly
              truncate
            />
          </div>
          <div class="ml-auto">
            <IconButton
              data-action="session-todo-toggle-button"
              data-collapsed={props.collapsed ? "true" : "false"}
              icon="chevron-down"
              size="normal"
              variant="ghost"
              style={{ transform: `rotate(${turn() * 180}deg)` }}
              onMouseDown={(event) => {
                event.preventDefault()
                event.stopPropagation()
              }}
              onClick={(event) => {
                event.stopPropagation()
                props.onToggle()
              }}
              aria-label={props.collapsed ? props.expandLabel : props.collapseLabel}
            />
          </div>
        </div>

        <div
          data-slot="session-todo-list"
          aria-hidden={props.collapsed || off()}
          classList={{
            "pointer-events-none": hide() > 0.1,
          }}
          style={{
            visibility: off() ? "hidden" : "visible",
            opacity: `${Math.max(0, Math.min(1, 1 - hide()))}`,
          }}
        >
          <SessionTodoList todos={props.todos} />
        </div>
      </div>
    </DockTray>
  )
}
