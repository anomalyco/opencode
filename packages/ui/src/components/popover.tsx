import { CloseButton, Content, Description, Portal, Root, Title, Trigger } from "@kobalte/core/popover"
import {
  ComponentProps,
  JSXElement,
  ParentProps,
  Show,
  createComputed,
  createContext,
  createEffect,
  createSignal,
  onCleanup,
  splitProps,
  untrack,
  useContext,
  ValidComponent,
} from "solid-js"
import { useI18n } from "../context/i18n"
import { Icon } from "@opencode/ui/icon"
import { IconButton } from "@opencode/ui/icon-button"
import {
  createPopoverState,
  EMPTY_POPOVER_STACK,
  selectPopoverOpen,
  selectPreventCloseAutoFocus,
  transitionPopover,
  transitionPopoverStack,
  type PopoverEvent,
  type PopoverStackEvent,
} from "./popover-machine"

export interface PopoverProps<T extends ValidComponent = "div">
  extends ParentProps,
    Omit<ComponentProps<typeof Root>, "children"> {
  trigger?: JSXElement
  triggerAs?: T
  triggerProps?: ComponentProps<T>
  title?: JSXElement
  description?: JSXElement
  class?: ComponentProps<"div">["class"]
  classList?: ComponentProps<"div">["classList"]
  style?: ComponentProps<"div">["style"]
  portal?: boolean
}

type PopoverLayer = {
  trigger: () => HTMLElement | undefined
  content: () => HTMLElement | undefined
  dismiss: (reason: "escape" | "outside") => void
}

// Every open popover shares one set of window listeners, so Escape closes only the newest popover and a press inside a
// portaled child keeps its parent open.
let stack = EMPTY_POPOVER_STACK

let nextLayerID = 0

const layers = new Map<number, PopoverLayer>()

const PopoverParentContext = createContext<number | null>(null)

function dispatchStack(event: PopoverStackEvent) {
  const previous = stack
  const transition = transitionPopoverStack(previous, event)
  stack = transition.state

  if (previous.entries.length === 0 && stack.entries.length > 0) {
    window.addEventListener("keydown", onStackKeyDown, true)
    window.addEventListener("pointerdown", onStackInteract, true)
    window.addEventListener("focusin", onStackInteract, true)
  }

  if (previous.entries.length > 0 && stack.entries.length === 0) {
    window.removeEventListener("keydown", onStackKeyDown, true)
    window.removeEventListener("pointerdown", onStackInteract, true)
    window.removeEventListener("focusin", onStackInteract, true)
  }

  transition.effects.forEach((effect) => layers.get(effect.id)?.dismiss(effect.reason))
}

function onStackKeyDown(event: KeyboardEvent) {
  // A dialog opened above the popover already took this Escape.
  if (event.key !== "Escape" || event.defaultPrevented) return
  const owner = event.target instanceof Element ? event.target.closest("[data-owns-escape]") : null

  // A control inside the popover that cancels its own edit on Escape, such as a comment editor, keeps it open.
  if (owner && ![...layers.values()].some((layer) => layer.trigger() === owner || layer.content() === owner)) return
  dispatchStack({ type: "escape.pressed" })
  event.preventDefault()
  event.stopPropagation()
}

function onStackInteract(event: Event) {
  const target = event.target

  if (!(target instanceof Node)) return

  const insideIds = new Set(
    [...layers].flatMap(([id, layer]) =>
      layer.trigger()?.contains(target) || layer.content()?.contains(target) ? [id] : [],
    ),
  )

  dispatchStack({ type: "outside.interacted", insideIds })
}

export function Popover<T extends ValidComponent = "div">(props: PopoverProps<T>) {
  const i18n = useI18n()

  const [local, rest] = splitProps(props, [
    "trigger",
    "triggerAs",
    "triggerProps",
    "title",
    "description",
    "class",
    "classList",
    "style",
    "children",
    "portal",
    "open",
    "defaultOpen",
    "onOpenChange",
    "modal",
  ])

  const id = ++nextLayerID
  const parentId = useContext(PopoverParentContext)
  const [popover, setPopover] = createSignal(createPopoverState(local.open, local.defaultOpen))
  let triggerRef: HTMLElement | undefined
  let contentRef: HTMLElement | undefined

  const dispatch = (event: PopoverEvent) => {
    const transition = transitionPopover(untrack(popover), event)
    setPopover(transition.state)
    transition.effects.forEach((effect) => {
      local.onOpenChange?.(effect.open)
      // A controlled owner that kept `open` refuses the close, which clears the pending dismiss reason.
      dispatch({ type: "props.synced", open: untrack(() => local.open) })
    })
  }

  createComputed(() => dispatch({ type: "props.synced", open: local.open }))

  createEffect(() => {
    if (!selectPopoverOpen(popover())) return
    layers.set(id, {
      trigger: () => triggerRef,
      content: () => contentRef,
      dismiss: (reason) => dispatch({ type: "dismiss", reason }),
    })
    dispatchStack({ type: "layer.opened", id, parentId })
    onCleanup(() => {
      dispatchStack({ type: "layer.closed", id })
      layers.delete(id)
    })
  })

  onCleanup(() => dispatch({ type: "disposed" }))

  const content = () => (
    <Content
      ref={(el: HTMLElement | undefined) => {
        contentRef = el
      }}
      data-component="popover-content"
      data-owns-escape={selectPopoverOpen(popover()) ? "" : undefined}
      classList={{
        ...local.classList,
        [local.class ?? ""]: !!local.class,
      }}
      style={local.style}
      onEscapeKeyDown={preventDismiss}
      onPointerDownOutside={preventDismiss}
      onFocusOutside={preventDismiss}
      onCloseAutoFocus={(event: Event) => {
        if (selectPreventCloseAutoFocus(untrack(popover))) event.preventDefault()
        dispatch({ type: "close-auto-focus.handled" })
      }}
    >
      {/* <Arrow data-slot="popover-arrow" /> */}
      <Show when={local.title}>
        <div data-slot="popover-header">
          <Title data-slot="popover-title">{local.title}</Title>
          <CloseButton
            data-slot="popover-close-button"
            as={IconButton}
            icon={<Icon name="close" />}
            variant="ghost"
            aria-label={i18n.t("ui.common.close")}
          />
        </div>
      </Show>
      <Show when={local.description}>
        <Description data-slot="popover-description">{local.description}</Description>
      </Show>
      <div data-slot="popover-body">
        <PopoverParentContext.Provider value={id}>{local.children}</PopoverParentContext.Provider>
      </div>
    </Content>
  )

  return (
    <Root
      gutter={4}
      {...rest}
      open={selectPopoverOpen(popover())}
      onOpenChange={(open) => dispatch({ type: "kobalte.changed", open })}
      modal={local.modal ?? false}
    >
      <Trigger
        ref={(el: HTMLElement) => {
          triggerRef = el
        }}
        as={local.triggerAs ?? "div"}
        data-slot="popover-trigger"
        data-owns-escape={selectPopoverOpen(popover()) ? "" : undefined}
        // SAFETY: `triggerProps` are `ComponentProps<T>` for `triggerAs`, the component Kobalte renders; Kobalte's
        // polymorphic props cannot follow the generic `T`.
        {...(local.triggerProps as any)}
      >
        {local.trigger}
      </Trigger>
      <Show when={local.portal ?? true} fallback={content()}>
        <Portal>{content()}</Portal>
      </Show>
    </Root>
  )
}

// The shared window listeners decide when a popover dismisses; Kobalte only closes it from the trigger or close button.
function preventDismiss(event: Event) {
  event.preventDefault()
}
