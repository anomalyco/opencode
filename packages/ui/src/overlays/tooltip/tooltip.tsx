import { Content, Portal, Root, Trigger } from "@kobalte/core/tooltip"
import { createComputed, createSignal, onCleanup, onMount, Show, splitProps, untrack, type JSX } from "solid-js"
import type { ComponentProps } from "solid-js"
import { spread } from "solid-js/web"
import {
  createTooltipState,
  DISPOSED_EVENT,
  FOCUSED,
  KOBALTE_CLOSED,
  KOBALTE_OPENED,
  LEAVE_SETTLED,
  POINTER_ENTERED,
  POINTER_INSIDE,
  POINTER_LEFT,
  POINTER_OUTSIDE,
  POPUP_COLLAPSED,
  POPUP_EXPANDED,
  PRESS_ENDED,
  selectTooltipForceOpen,
  selectTooltipMounted,
  selectTooltipOpen,
  selectTooltipPressing,
  selectTooltipTracking,
  syncPropsEvent,
  transitionTooltip,
  TRIGGER_PRESSED,
  type TooltipEvent,
  type TooltipState,
} from "./machine"
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

// Expanded panels still need tooltips; only an open popup suppresses its trigger's tooltip.
const POPUP = '[aria-haspopup]:not([aria-haspopup="false"]):is([aria-expanded="true"], [data-expanded])'

export function Tooltip(props: TooltipProps) {
  return (
    <Show when={!props.inactive} fallback={props.children}>
      <ActiveTooltip {...props} />
    </Show>
  )
}

function ActiveTooltip(props: TooltipProps) {
  let ref: HTMLDivElement | undefined
  let handlers: TriggerHandlers | undefined
  let observer: MutationObserver | undefined

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

  // Kobalte's tooltip costs dozens of computations and listeners per trigger, and most triggers (an action on every
  // timeline row, a copy button on every code block) are never hovered. It mounts on the first interaction that could
  // open it, or as soon as a caller controls it with forceOpen.
  const [tooltip, setTooltip] = createSignal(createTooltipState(local.forceOpen, !!others.disabled))

  const dispatch = (event: TooltipEvent, source?: PointerEvent | FocusEvent) => {
    const previous = untrack(tooltip)
    const transition = transitionTooltip(previous, event)

    if (transition.state !== previous) {
      setTooltip(transition.state)
      reconcile(previous, transition.state)
    }

    for (const effect of transition.effects) {
      if (effect === "schedule-leave") queueMicrotask(settleLeave)

      // Kobalte attached its listeners while this event was being dispatched, too late to receive it.
      if (effect === "replay" && source instanceof PointerEvent) handlers?.onPointerEnter?.(source)

      if (effect === "replay" && source instanceof FocusEvent) handlers?.onFocus?.(source)
    }
  }

  // Kobalte's own pointerleave handler runs after this one and only starts the skip-delay window for neighbouring
  // tooltips if it still sees this one open.
  const settleLeave = () => dispatch(LEAVE_SETTLED)
  const syncPopup = () => dispatch(ref?.querySelector(POPUP) ? POPUP_EXPANDED : POPUP_COLLAPSED)
  // The press's click, if any, follows its pointerup in the same task.
  const onPressEnd = () => setTimeout(dispatch, 0, PRESS_ENDED)

  const onPointerMove = (event: PointerEvent) => {
    if (!ref) return
    const box = ref.getBoundingClientRect()

    const inside =
      event.clientX >= box.left && event.clientX <= box.right && event.clientY >= box.top && event.clientY <= box.bottom

    dispatch(inside ? POINTER_INSIDE : POINTER_OUTSIDE)
  }

  // Attaches the listeners and observer the state needs and detaches the rest.
  const reconcile = (previous: TooltipState, state: TooltipState) => {
    const pressing = selectTooltipPressing(state)

    if (pressing && !selectTooltipPressing(previous)) {
      window.addEventListener("pointerup", onPressEnd, true)
      window.addEventListener("pointercancel", onPressEnd, true)
    }

    if (!pressing && selectTooltipPressing(previous)) {
      window.removeEventListener("pointerup", onPressEnd, true)
      window.removeEventListener("pointercancel", onPressEnd, true)
    }

    const tracking = selectTooltipTracking(state)

    if (tracking && !selectTooltipTracking(previous)) {
      window.addEventListener("pointermove", onPointerMove, { capture: true, passive: true })
    }

    if (!tracking && selectTooltipTracking(previous)) window.removeEventListener("pointermove", onPointerMove, true)

    if (state.status === "disposed") {
      observer?.disconnect()

      return
    }

    if (!ref || observer || !selectTooltipMounted(state)) return
    observer = new MutationObserver(syncPopup)
    observer.observe(ref, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["aria-expanded", "data-expanded", "aria-haspopup"],
    })
    syncPopup()
  }

  createComputed(() => dispatch(syncPropsEvent(local.forceOpen, !!others.disabled)))
  onMount(() => reconcile(untrack(tooltip), untrack(tooltip)))
  onCleanup(() => dispatch(DISPOSED_EVENT))

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
    <>
      {/* These listeners are attached before Kobalte's, so the machine sees each hover and focus first. */}
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
        onPointerEnter={(event) => {
          if (event.pointerType !== "touch") dispatch(POINTER_ENTERED, event)
        }}
        onFocus={(event) => dispatch(FOCUSED, event)}
      >
        {local.children}
      </div>
      <Show when={selectTooltipMounted(tooltip())}>
        <Root
          gutter={4}
          openDelay={400}
          skipDelayDuration={300}
          {...others}
          closeDelay={0}
          ignoreSafeArea={local.ignoreSafeArea ?? true}
          open={selectTooltipOpen(tooltip())}
          onOpenChange={(open) => dispatch(open ? KOBALTE_OPENED : KOBALTE_CLOSED)}
        >
          {/* Kobalte calls these inside its own listeners. As separate listeners, the leave microtask would close the
              tooltip before Kobalte's listener ran, which then skipped the skip-delay window. */}
          <Trigger
            as={adopt}
            onPointerDown={() => dispatch(TRIGGER_PRESSED)}
            onPointerLeave={(event: PointerEvent) => {
              if (event.pointerType !== "touch") dispatch(POINTER_LEFT)
            }}
          />
          <Portal>
            <Content
              // A modal dialog hides what's outside it from assistive tech, and this tip is portaled outside it.
              data-kb-top-layer=""
              ref={(el) => {
                const theme = ref?.closest("[data-theme]")?.getAttribute("data-theme")

                if (theme) el.setAttribute("data-theme", theme)
              }}
              data-component="tooltip-v2"
              data-appearance={local.appearance ?? "compact"}
              data-placement={props.placement}
              data-force-open={selectTooltipForceOpen(tooltip())}
              class={local.contentClass}
              style={local.contentStyle}
              onPointerDownOutside={preventDismiss}
            >
              {local.value}
            </Content>
          </Portal>
        </Root>
      </Show>
    </>
  )
}

// A press on the trigger is outside the tooltip's layer; the machine decides whether it closes the tooltip.
function preventDismiss(event: Event) {
  event.preventDefault()
}
