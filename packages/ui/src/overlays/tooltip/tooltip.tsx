import { Content, Portal, Root, Trigger, useTooltipContext, type TooltipContextValue } from "@kobalte/core/tooltip"
import { makeEventListener } from "@solid-primitives/event-listener"
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
  selectTooltipDismissed,
  selectTooltipForceOpen,
  selectTooltipMounted,
  selectTooltipOpen,
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
  onPointerEnter: (event: PointerEvent) => void
  onFocus: (event: FocusEvent) => void
  onBlur: (event: FocusEvent) => void
  onClick: (event: MouseEvent) => void
}

// Expanded panels still need tooltips; only an open popup suppresses its trigger's tooltip.
const POPUP = '[aria-haspopup]:not([aria-haspopup="false"]):is([aria-expanded="true"], [data-expanded])'

// A closing popup can restore focus to its button. Only Tab should open the button's tooltip.
let triggers = 0

let tabbing = false

function startTab(event: KeyboardEvent) {
  tabbing = event.key === "Tab"
}

function endTab() {
  tabbing = false
}

function listenForTab() {
  if (++triggers === 1) {
    window.addEventListener("keydown", startTab, true)
    window.addEventListener("keyup", endTab, true)
    window.addEventListener("pointerdown", endTab, true)
    window.addEventListener("blur", endTab)
  }

  onCleanup(() => {
    if (--triggers) return
    window.removeEventListener("keydown", startTab, true)
    window.removeEventListener("keyup", endTab, true)
    window.removeEventListener("pointerdown", endTab, true)
    window.removeEventListener("blur", endTab)
    endTab()
  })
}

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

  let kobalte: TooltipContextValue | undefined

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

  const dispatch = (event: TooltipEvent, source?: PointerEvent) => {
    const previous = untrack(tooltip)
    const transition = transitionTooltip(previous, event)

    if (transition.state !== previous) {
      setTooltip(transition.state)
      reconcile(previous, transition.state)
    }

    for (const effect of transition.effects) {
      if (effect === "schedule-leave") queueMicrotask(settleLeave)

      // hideTooltip starts the skip window; cancelling a pending hover shouldn't.
      if (effect === "cancel-opening") kobalte?.cancelOpening()

      if (effect === "hide") kobalte?.hideTooltip(true)

      // Kobalte attached its listeners while this event was being dispatched, too late to receive it.
      if (effect === "replay" && source) handlers?.onPointerEnter(source)
    }
  }

  // Kobalte's own pointerleave handler runs after this one and only starts the skip-delay window for neighbouring
  // tooltips if it still sees this one open.
  const settleLeave = () => dispatch(LEAVE_SETTLED)
  const syncPopup = () => dispatch(ref?.querySelector(POPUP) ? POPUP_EXPANDED : POPUP_COLLAPSED)

  const onPointerMove = (event: PointerEvent) => {
    if (!ref) return
    const box = ref.getBoundingClientRect()

    const inside =
      event.clientX >= box.left && event.clientX <= box.right && event.clientY >= box.top && event.clientY <= box.bottom

    dispatch(inside ? POINTER_INSIDE : POINTER_OUTSIDE)
  }

  // Attaches the listeners and observer the state needs and detaches the rest.
  const reconcile = (previous: TooltipState, state: TooltipState) => {
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
  onMount(listenForTab)
  onMount(() => reconcile(untrack(tooltip), untrack(tooltip)))
  onCleanup(() => dispatch(DISPOSED_EVENT))

  // Kobalte's trigger takes over the element rendered below instead of rendering one, so mounting the tooltip leaves
  // the trigger and its children in place, with their focus and hover.
  const adopt = (triggerProps: TriggerHandlers) => {
    handlers = triggerProps
    kobalte = useTooltipContext()

    if (!ref) return null
    // Tab-close buttons stop pointerdown propagation.
    makeEventListener(
      ref,
      "pointerdown",
      (event) => {
        if (event.pointerType !== "touch") dispatch(TRIGGER_PRESSED)
      },
      true,
    )

    // Kobalte owns the open state attributes from here, and spread never removes an attribute it did not set, so a
    // tooltip that mounts open would keep the closed marker.
    ref.removeAttribute("data-closed")
    const [, rest] = splitProps(triggerProps, ["onFocus", "onBlur", "onClick"])
    spread(ref, rest, false, true)

    return null
  }

  return (
    <>
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
        onFocusIn={(event) => {
          if (!tabbing && (event.target !== ref || selectTooltipDismissed(untrack(tooltip)))) return
          dispatch(FOCUSED)
          handlers?.onFocus(event)
        }}
        onFocusOut={(event) => handlers?.onBlur(event)}
        onClick={(event) => {
          if (event instanceof PointerEvent && event.pointerType === "touch") return
          handlers?.onClick(event)
        }}
      >
        {local.children}
      </div>
      <Show when={selectTooltipMounted(tooltip())}>
        <Root
          gutter={4}
          openDelay={600}
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
