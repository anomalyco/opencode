import { IconButton } from "@opencode-ai/ui/icon-button"
import { useSpring } from "@opencode-ai/ui/motion-spring"
import { TextReveal } from "@opencode-ai/ui/text-reveal"
import { createResizeObserver } from "@solid-primitives/resize-observer"
import { createEffect, createMemo, type JSX } from "solid-js"
import { createStore } from "solid-js/store"

export function SessionComposerPullout(props: {
  name: "background"
  label: JSX.Element
  ariaLabel: string
  preview?: string
  multiline?: boolean
  collapsed: boolean
  collapsible?: boolean
  onToggle: () => void
  collapseLabel: string
  expandLabel: string
  dockProgress?: number
  children: JSX.Element
}) {
  const [store, setStore] = createStore({ height: 78, header: 42 })
  const collapse = useSpring(() => (props.collapsed ? 1 : 0), { visualDuration: 0.3, bounce: 0 })
  const dock = createMemo(() => Math.max(0, Math.min(1, props.dockProgress ?? 1)))
  const shut = createMemo(() => 1 - dock())
  const value = createMemo(() => Math.max(0, Math.min(1, collapse())))
  const hide = createMemo(() => Math.max(value(), shut()))
  const off = createMemo(() => hide() > 0.98)
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
      data-component={`session-${props.name}-dock`}
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
          data-action={`session-${props.name}-toggle`}
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
              opacity: `${Math.max(0, Math.min(1, 1 - shut()))}`,
            }}
          >
            {props.label}
          </span>
          <div
            data-slot={`session-${props.name}-preview`}
            class="ml-1 min-w-0 overflow-hidden"
            style={{ flex: "1 1 auto", "max-width": "100%", transform: "translateY(1px)" }}
          >
            <TextReveal
              class="cursor-default text-[13px] font-[440] leading-5 tracking-[-0.04px] text-v2-text-text-faint"
              text={props.preview}
              duration={600}
              travel={25}
              edge={17}
              spring="cubic-bezier(0.34, 1, 0.64, 1)"
              springSoft="cubic-bezier(0.34, 1, 0.64, 1)"
              growOnly
              truncate
            />
          </div>
          {props.collapsible !== false && (
            <div class="ml-auto">
              <IconButton
                data-action={`session-${props.name}-toggle-button`}
                data-collapsed={props.collapsed ? "true" : "false"}
                icon="chevron-down"
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
          data-slot={`session-${props.name}-list`}
          aria-hidden={props.collapsed || off()}
          classList={{ "pointer-events-none": hide() > 0.1 }}
          style={{ visibility: off() ? "hidden" : "visible", opacity: `${Math.max(0, 1 - hide())}` }}
        >
          {props.children}
        </div>
      </div>
    </div>
  )
}
