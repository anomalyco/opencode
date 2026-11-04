import { Content, Portal, Root, Trigger } from "@kobalte/core/tooltip"
import { createComputed, createEffect, Match, onCleanup, Show, splitProps, Switch, untrack, type JSX } from "solid-js"
import type { ComponentProps } from "solid-js"
import { createStore } from "solid-js/store"
import { spread } from "solid-js/web"
import "./tooltip.css"

export interface TooltipProps extends ComponentProps<typeof Root> {
  value: JSX.Element
  appearance?: "standard" | "compact" | "large"
  class?: string
  contentClass?: string
  contentStyle?: JSX.CSSProperties
  inactive?: boolean
  forceOpen?: boolean
  triggerTabIndex?: number
}

type TriggerHandlers = {
  onPointerEnter?: (event: PointerEvent) => void
  onFocus?: (event: FocusEvent) => void
}

export function Tooltip(props: TooltipProps) {
  let ref: HTMLDivElement | undefined
  let handlers: TriggerHandlers | undefined

  const [state, setState] = createStore({
    open: false,
    block: false,
    expand: false,
    // Kobalte's tooltip costs dozens of computations and listeners per trigger, and most triggers (an action on every
    // timeline row, a copy button on every code block) are never hovered. It mounts on the first interaction that
    // could open it, or as soon as a caller controls it with forceOpen.
    mounted: false,
  })

  const [local, others] = splitProps(props, [
    "children",
    "appearance",
    "class",
    "contentClass",
    "contentStyle",
    "inactive",
    "forceOpen",
    "triggerTabIndex",
    "ignoreSafeArea",
    "value",
  ])

  const close = () => setState("open", false)
  const controlled = () => local.forceOpen !== undefined

  const inside = () => {
    const active = document.activeElement

    if (!ref || !active) return false

    return ref.contains(active)
  }

  const drop = (expand = state.expand) => {
    if (expand || !state.block) return

    if (ref?.matches(":hover")) return

    if (inside()) return
    setState("block", false)
  }

  const sync = () => {
    // Expanded panels still need tooltips; only an open popup suppresses its trigger's tooltip.
    const expand = !!ref?.querySelector(
      '[aria-haspopup]:not([aria-haspopup="false"]):is([aria-expanded="true"], [data-expanded])',
    )

    setState("expand", expand)

    if (expand) {
      setState("block", true)
      close()

      return
    }

    drop(expand)
  }

  const leave = () => {
    // Kobalte's own pointerleave handler runs after this one and only starts the
    // skip-delay window for neighbouring tooltips if it still sees this one open.
    queueMicrotask(() => {
      if (!inside()) close()
      drop()
    })
  }

  const mount = (event: PointerEvent | FocusEvent) => {
    if (state.mounted) return
    setState("mounted", true)

    // Kobalte attached its listeners while this event was being dispatched, too late to receive it.
    if (event instanceof PointerEvent) handlers?.onPointerEnter?.(event)
    else handlers?.onFocus?.(event)
  }

  createComputed(() => {
    if (controlled()) setState("mounted", true)
  })

  createEffect(() => {
    if (!ref || !state.mounted) return
    untrack(sync)
    const obs = new MutationObserver(sync)
    obs.observe(ref, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["aria-expanded", "data-expanded", "aria-haspopup"],
    })
    onCleanup(() => obs.disconnect())
  })

  let justClickedTrigger = false

  // Kobalte's trigger takes over the element rendered below instead of rendering one, so mounting the tooltip leaves
  // the trigger and its children in place, with their focus and hover.
  const adopt = (triggerProps: TriggerHandlers) => {
    handlers = triggerProps

    if (!ref) return null
    // Kobalte owns the open state attributes from here, and spread never removes an attribute it did not set, so a
    // tooltip that mounts open would keep the closed marker.
    ref.removeAttribute("data-closed")
    spread(ref, triggerProps, false, true)

    return null
  }

  return (
    <Switch>
      <Match when={local.inactive}>{local.children}</Match>
      <Match when={true}>
        <div
          ref={(el) => {
            ref = el
            // Kobalte's trigger sets this on the element it renders; it sets it again here once it mounts.
            el.setAttribute("type", "button")
          }}
          data-closed=""
          tabIndex={local.triggerTabIndex}
          data-component="tooltip-v2-trigger"
          class={local.class}
          onPointerEnter={mount}
          onFocus={mount}
          onFocusOut={() => requestAnimationFrame(() => drop())}
        >
          {local.children}
        </div>
        <Show when={state.mounted}>
          <Root
            gutter={4}
            openDelay={400}
            skipDelayDuration={300}
            {...others}
            closeDelay={0}
            ignoreSafeArea={local.ignoreSafeArea ?? true}
            open={controlled() ? local.forceOpen : state.open}
            onOpenChange={(open) => {
              if (controlled()) return

              if (state.block && open) return

              if (justClickedTrigger) {
                justClickedTrigger = false

                return
              }

              setState("open", open)
            }}
          >
            {/* Kobalte calls leave inside its own pointerleave listener. As a separate listener, its microtask would
                close the tooltip before Kobalte's listener ran, which then skipped the skip-delay window. */}
            <Trigger as={adopt} onPointerLeave={leave} />
            <Portal>
              <Content
                ref={(el) => {
                  const theme = ref?.closest("[data-theme]")?.getAttribute("data-theme")

                  if (theme) el.setAttribute("data-theme", theme)
                }}
                data-component="tooltip-v2"
                data-appearance={local.appearance ?? "compact"}
                data-placement={props.placement}
                data-force-open={local.forceOpen}
                class={local.contentClass}
                style={local.contentStyle}
                onPointerDownOutside={(e) => {
                  if (ref === e.target || (e.target instanceof Node && ref?.contains(e.target))) {
                    justClickedTrigger = true
                  }

                  e.preventDefault()
                }}
              >
                {local.value}
              </Content>
            </Portal>
          </Root>
        </Show>
      </Match>
    </Switch>
  )
}
