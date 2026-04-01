import type { Todo } from "@opencode-ai/sdk/v2"
import { AnimatedNumber } from "@opencode-ai/ui/animated-number"
import { Checkbox } from "@opencode-ai/ui/checkbox"
import { DockTray } from "@opencode-ai/ui/dock-surface"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { useSpring } from "@opencode-ai/ui/motion-spring"
import { TextReveal } from "@opencode-ai/ui/text-reveal"
import { TextStrikethrough } from "@opencode-ai/ui/text-strikethrough"
import { Index, createEffect, createMemo, createSignal, on, onCleanup } from "solid-js"
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

export function SessionTodoDock(props: {
  todos: Todo[]
  title: string
  collapseLabel: string
  expandLabel: string
  dockProgress?: number
  visualDuration?: number
  bounce?: number
  expandVisualDuration?: number
  expandBounce?: number
  collapseVisualDuration?: number
  collapseBounce?: number
  subtitleDuration?: number
  subtitleTravel?: number
  subtitleEdge?: number
  countDuration?: number
  countMask?: number
  countMaskHeight?: number
  countWidthDuration?: number
}) {
  const [store, setStore] = createStore({
    collapsed: false,
  })

  const toggle = () => setStore("collapsed", (value) => !value)

  const total = createMemo(() => props.todos.length)
  const done = createMemo(() => props.todos.filter((todo) => todo.status === "completed").length)
  const label = createMemo(() => `${done()} of ${total()} ${props.title.toLowerCase()} completed`)

  const active = createMemo(
    () =>
      props.todos.find((todo) => todo.status === "in_progress") ??
      props.todos.find((todo) => todo.status === "pending") ??
      props.todos.filter((todo) => todo.status === "completed").at(-1) ??
      props.todos[0],
  )

  const preview = createMemo(() => active()?.content ?? "")
  const config = createMemo(() =>
    store.collapsed
      ? {
          visualDuration: props.collapseVisualDuration ?? props.visualDuration ?? 0.3,
          bounce: props.collapseBounce ?? props.bounce ?? 0,
        }
      : {
          visualDuration: props.expandVisualDuration ?? props.visualDuration ?? 0.3,
          bounce: props.expandBounce ?? props.bounce ?? 0,
        },
  )
  const collapse = useSpring(() => (store.collapsed ? 1 : 0), config)
  const dock = createMemo(() => Math.max(0, Math.min(1, props.dockProgress ?? 1)))
  const shut = createMemo(() => 1 - dock())
  const value = createMemo(() => Math.max(0, Math.min(1, collapse())))
  const hide = createMemo(() => Math.max(value(), shut()))
  const off = createMemo(() => hide() > 0.98)
  const turn = createMemo(() => Math.max(0, Math.min(1, value())))
  const [height, setHeight] = createSignal(320)
  const full = createMemo(() => Math.max(78, height()))
  let contentRef: HTMLDivElement | undefined

  createEffect(() => {
    const el = contentRef
    if (!el) return
    const update = () => {
      setHeight(el.getBoundingClientRect().height)
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(el)
    onCleanup(() => observer.disconnect())
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
          onClick={toggle}
          onKeyDown={(event) => {
            if (event.key !== "Enter" && event.key !== " ") return
            event.preventDefault()
            toggle()
          }}
        >
          <span
            class="text-14-regular text-text-strong cursor-default inline-flex items-baseline shrink-0 whitespace-nowrap overflow-visible"
            aria-label={label()}
            style={{
              "--tool-motion-odometer-ms": `${props.countDuration ?? 600}ms`,
              "--tool-motion-mask": `${props.countMask ?? 18}%`,
              "--tool-motion-mask-height": `${props.countMaskHeight ?? 0}px`,
              "--tool-motion-spring-ms": `${props.countWidthDuration ?? 560}ms`,
              opacity: `${Math.max(0, Math.min(1, 1 - shut()))}`,
              filter: `blur(${Math.max(0, Math.min(1, shut())) * 2}px)`,
            }}
          >
            <AnimatedNumber value={done()} />
            <span class="mx-1">of</span>
            <AnimatedNumber value={total()} />
            <span>&nbsp;{props.title.toLowerCase()} completed</span>
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
              text={store.collapsed ? preview() : undefined}
              duration={props.subtitleDuration ?? 600}
              travel={props.subtitleTravel ?? 25}
              edge={props.subtitleEdge ?? 17}
              spring="cubic-bezier(0.34, 1, 0.64, 1)"
              springSoft="cubic-bezier(0.34, 1, 0.64, 1)"
              growOnly
              truncate
            />
          </div>
          <div class="ml-auto">
            <IconButton
              data-action="session-todo-toggle-button"
              data-collapsed={store.collapsed ? "true" : "false"}
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
                toggle()
              }}
              aria-label={store.collapsed ? props.expandLabel : props.collapseLabel}
            />
          </div>
        </div>

        <div
          data-slot="session-todo-list"
          aria-hidden={store.collapsed || off()}
          classList={{
            "pointer-events-none": hide() > 0.1,
          }}
          style={{
            visibility: off() ? "hidden" : "visible",
            opacity: `${Math.max(0, Math.min(1, 1 - hide()))}`,
            filter: `blur(${Math.max(0, Math.min(1, hide())) * 2}px)`,
          }}
        >
          <TodoList todos={props.todos} open={!store.collapsed} />
        </div>
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
          opacity: stuck() ? 1 : 0,
        }}
      />
    </div>
  )
}
