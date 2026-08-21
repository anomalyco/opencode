import { IconButton } from "@opencode-ai/ui/icon-button"
import { Icon } from "@opencode-ai/ui/icon"
import { useSpring } from "@opencode-ai/ui/motion-spring"
import { createResizeObserver } from "@solid-primitives/resize-observer"
import { createEffect, createMemo, type JSX } from "solid-js"
import { createStore } from "solid-js/store"

export function SessionBackgroundPullout(props: {
  label: JSX.Element
  ariaLabel: string
  multiline?: boolean
  collapsed: boolean
  collapsible?: boolean
  onToggle: () => void
  collapseLabel: string
  expandLabel: string
  children: JSX.Element
}) {
  const [store, setStore] = createStore({ height: 78, header: 42 })
  const collapse = useSpring(() => (props.collapsed ? 1 : 0), { visualDuration: 0.3, bounce: 0 })
  const value = createMemo(() => Math.max(0, Math.min(1, collapse())))
  const off = createMemo(() => value() > 0.98)
  const base = createMemo(() => Math.max(78, store.header + 36))
  const full = createMemo(() => Math.max(base(), store.height))
  let contentRef: HTMLDivElement | undefined
  let headerRef: HTMLDivElement | undefined

  createEffect(() => {
    const element = contentRef
    const header = headerRef
    if (!element || !header) return
    const update = () => {
      setStore("height", (height) => Math.max(height, element.scrollHeight))
      setStore("header", header.getBoundingClientRect().height)
    }
    update()
    createResizeObserver([element, header], update)
  })

  return (
    <div
      data-component="session-background-dock"
      class="w-full overflow-hidden rounded-xl border-[0.5px] border-v2-border-border-base bg-v2-background-bg-layer-01"
      style={{
        "overflow-x": "visible",
        "overflow-y": "hidden",
        "max-height": `${Math.max(base(), full() - value() * (full() - base()))}px`,
      }}
    >
      <div ref={contentRef}>
        <div
          ref={headerRef}
          data-action="session-background-toggle"
          class="flex items-center gap-2 overflow-visible pl-4 pr-2"
          classList={{
            "h-[42px]": !props.multiline,
            "min-h-[42px] py-2": props.multiline,
          }}
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
            class="cursor-default inline-flex items-baseline shrink-0 overflow-visible font-[440] text-[13px] leading-5 tracking-[-0.04px] text-v2-text-text-muted"
            aria-label={props.ariaLabel}
            style={{
              "--tool-motion-odometer-ms": "600ms",
              "--tool-motion-mask": "18%",
              "--tool-motion-mask-height": "0px",
              "--tool-motion-spring-ms": "560ms",
              "white-space": "pre",
            }}
          >
            {props.label}
          </span>
          {props.collapsible !== false && (
            <div class="ml-auto">
              <IconButton
                data-action="session-background-toggle-button"
                data-collapsed={props.collapsed ? "true" : "false"}
                icon={<Icon name="chevron-down" />}
                size="normal"
                variant="ghost"
                style={{ transform: `rotate(${value() * 180}deg)` }}
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
          )}
        </div>
        <div
          data-slot="session-background-list"
          aria-hidden={props.collapsed || off()}
          classList={{ "pointer-events-none": value() > 0.1 }}
          style={{ visibility: off() ? "hidden" : "visible", opacity: `${Math.max(0, 1 - value())}` }}
        >
          {props.children}
        </div>
      </div>
    </div>
  )
}
