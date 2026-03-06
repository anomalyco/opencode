import { Index, createEffect, createMemo, createSignal, on, onCleanup } from "solid-js"
import { useI18n } from "../../context/i18n"
import { AnimatedNumber } from "../animated-number"
import { Checkbox } from "../checkbox"
import { IconButton } from "../icon-button"
import { TextReveal } from "../text-reveal"
import { TextStrikethrough } from "../text-strikethrough"
import type { TodoItem } from "./types"

const SUBTITLE = { duration: 600, travel: 25, edge: 17 }
const COUNT = { duration: 600, mask: 18, maskHeight: 0, widthDuration: 560 }

interface Props {
  todos: TodoItem[]
  collapsed: boolean
  onToggle: () => void
  progress: number
  collapse: number
  visibleHeight: number
  hide: number
  shut: number
  bottom: number
  onContentRef: (el: HTMLDivElement) => void
}

function dot(status: TodoItem["status"]) {
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

export function ComposerTodoTray(props: Props) {
  const i18n = useI18n()
  const [stuck, setStuck] = createSignal(false)
  const [scrolling, setScrolling] = createSignal(false)
  let scroll: HTMLDivElement | undefined
  let timer: number | undefined

  const total = createMemo(() => props.todos.length)
  const done = createMemo(() => props.todos.filter((item) => item.status === "completed").length)
  const activeIndex = createMemo(() => props.todos.findIndex((item) => item.status === "in_progress"))
  const active = createMemo(
    () =>
      props.todos.find((item) => item.status === "in_progress") ??
      props.todos.find((item) => item.status === "pending") ??
      props.todos.filter((item) => item.status === "completed").at(-1) ??
      props.todos[0],
  )
  const preview = createMemo(() => active()?.content ?? "")

  const ensure = () => {
    if (props.collapsed) return
    if (scrolling()) return
    if (!scroll || scroll.offsetParent === null) return

    const el = scroll.querySelector("[data-in-progress]")
    if (!(el instanceof HTMLElement)) return

    const topFade = 16
    const bottomFade = 44
    const box = scroll.getBoundingClientRect()
    const rect = el.getBoundingClientRect()
    const top = rect.top - box.top + scroll.scrollTop
    const bottom = rect.bottom - box.top + scroll.scrollTop
    const viewTop = scroll.scrollTop + topFade
    const viewBottom = scroll.scrollTop + scroll.clientHeight - bottomFade

    if (top < viewTop) {
      scroll.scrollTop = Math.max(0, top - topFade)
    } else if (bottom > viewBottom) {
      scroll.scrollTop = bottom - (scroll.clientHeight - bottomFade)
    }

    setStuck(scroll.scrollTop > 0)
  }

  createEffect(
    on([() => props.collapsed, activeIndex], () => {
      if (props.collapsed || activeIndex() < 0) return
      requestAnimationFrame(ensure)
    }),
  )

  onCleanup(() => {
    if (!timer) return
    window.clearTimeout(timer)
  })

  return (
    <div
      data-dock-surface="tray"
      style={{
        position: "absolute",
        bottom: `${props.bottom}px`,
        left: 0,
        right: 0,
        "z-index": 5,
        "max-height": `${props.visibleHeight}px`,
        "overflow-x": "visible",
        "overflow-y": "hidden",
        "border-color": "light-dark(#dcd9d9, #3e3a3a)",
        "pointer-events": props.progress < 0.98 ? "none" : "auto",
        transform: `translateY(${(1 - props.progress) * 12}px)`,
      }}
    >
      <div ref={props.onContentRef}>
        <div
          style={{
            display: "flex",
            "align-items": "center",
            gap: "8px",
            padding: "8px 8px 8px 12px",
            height: "40px",
            cursor: "pointer",
            overflow: "visible",
          }}
          onClick={props.onToggle}
        >
          <span
            style={{
              "font-size": "14px",
              color: "var(--text-strong)",
              "white-space": "nowrap",
              display: "inline-flex",
              "align-items": "baseline",
              "flex-shrink": 0,
              overflow: "visible",
              cursor: "default",
              "--tool-motion-odometer-ms": `${COUNT.duration}ms`,
              "--tool-motion-mask": `${COUNT.mask}%`,
              "--tool-motion-mask-height": `${COUNT.maskHeight}px`,
              "--tool-motion-spring-ms": `${COUNT.widthDuration}ms`,
              opacity: `${1 - props.shut}`,
              filter: props.shut > 0.01 ? `blur(${props.shut * 2}px)` : "none",
            }}
          >
            <AnimatedNumber value={done()} />
            <span style={{ margin: "0 4px" }}>{i18n.t("ui.todo.word.of")}</span>
            <AnimatedNumber value={total()} />
            <span>&nbsp;{i18n.t("ui.todo.word.completed")}</span>
          </span>

          <div
            style={{
              "margin-left": "4px",
              "min-width": 0,
              overflow: "hidden",
              flex: "1 1 auto",
              "max-width": "100%",
            }}
          >
            <TextReveal
              class="text-14-regular text-text-base cursor-default"
              text={props.collapsed ? preview() : undefined}
              duration={SUBTITLE.duration}
              travel={SUBTITLE.travel}
              edge={SUBTITLE.edge}
              spring="cubic-bezier(0.34, 1, 0.64, 1)"
              springSoft="cubic-bezier(0.34, 1, 0.64, 1)"
              growOnly
              truncate
            />
          </div>

          <div style={{ "margin-left": "auto" }}>
            <IconButton
              icon="chevron-down"
              size="normal"
              variant="ghost"
              style={{ transform: `rotate(${props.collapse * 180}deg)` }}
              onMouseDown={(event: MouseEvent) => {
                event.preventDefault()
                event.stopPropagation()
              }}
              onClick={(event: MouseEvent) => {
                event.stopPropagation()
                props.onToggle()
              }}
              aria-label={props.collapsed ? i18n.t("ui.todo.expand") : i18n.t("ui.todo.collapse")}
            />
          </div>
        </div>

        <div
          style={{
            position: "relative",
            opacity: `${1 - props.hide}`,
            filter: props.hide > 0.01 ? `blur(${props.hide * 2}px)` : "none",
            visibility: props.hide > 0.98 ? "hidden" : "visible",
            "pointer-events": props.hide > 0.1 ? "none" : "auto",
          }}
        >
          <div style={{ position: "relative" }}>
            <div
              ref={(el) => {
                scroll = el
              }}
              class="no-scrollbar"
              style={{
                padding: "0 12px 44px",
                display: "flex",
                "flex-direction": "column",
                gap: "6px",
                "max-height": "200px",
                "overflow-y": "auto",
                "overflow-anchor": "none",
              }}
              onScroll={(event) => {
                setStuck(event.currentTarget.scrollTop > 0)
                setScrolling(true)
                if (timer) window.clearTimeout(timer)
                timer = window.setTimeout(() => {
                  setScrolling(false)
                  if (activeIndex() < 0) return
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
                      transition: "opacity 220ms cubic-bezier(0.22, 1, 0.36, 1)",
                      opacity: todo().status === "pending" ? "0.5" : "1",
                    }}
                  >
                    <TextStrikethrough
                      active={todo().status === "completed" || todo().status === "cancelled"}
                      text={todo().content}
                      class="text-14-regular min-w-0 break-words"
                      style={{
                        "line-height": "var(--line-height-normal)",
                        transition: "color 220ms cubic-bezier(0.22, 1, 0.36, 1)",
                        color:
                          todo().status === "completed" || todo().status === "cancelled"
                            ? "var(--text-weak)"
                            : "var(--text-strong)",
                      }}
                    />
                  </Checkbox>
                )}
              </Index>
            </div>
            <div
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                right: 0,
                height: "16px",
                background: "linear-gradient(to bottom, var(--background-base), transparent)",
                "pointer-events": "none",
                opacity: stuck() ? 1 : 0,
                transition: "opacity 150ms ease",
                "z-index": 2,
              }}
            />
            <div
              style={{
                position: "absolute",
                bottom: 0,
                left: 0,
                right: 0,
                height: "56px",
                background: "linear-gradient(to bottom, transparent, var(--background-base) 85%)",
                "pointer-events": "none",
                "z-index": 2,
              }}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
