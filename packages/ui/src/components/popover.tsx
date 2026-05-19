import { Popover as Kobalte } from "@kobalte/core/popover"
import {
  ComponentProps,
  JSXElement,
  ParentProps,
  Show,
  createEffect,
  onCleanup,
  splitProps,
  ValidComponent,
} from "solid-js"
import { createStore } from "solid-js/store"
import { useI18n } from "../context/i18n"
import { IconButton } from "./icon-button"

function debug() {
  if (typeof window === "undefined") return false
  try {
    return window.localStorage.getItem("opencode.ui.debug") === "1"
  } catch {
    return false
  }
}

function log(_kind: string, _fields: Record<string, string | number | boolean | undefined>) {
}

export interface PopoverProps<T extends ValidComponent = "div">
  extends ParentProps,
    Omit<ComponentProps<typeof Kobalte>, "children"> {
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

  const [state, setState] = createStore({
    contentRef: undefined as HTMLElement | undefined,
    triggerRef: undefined as HTMLElement | undefined,
    dismiss: null as "escape" | "outside" | null,
    uncontrolledOpen: local.defaultOpen ?? false,
  })

  const controlled = () => local.open !== undefined
  const opened = () => {
    if (controlled()) return local.open ?? false
    return state.uncontrolledOpen
  }

  const onOpenChange = (next: boolean) => {
    log("toggle", {
      open: next,
      modal: local.modal ?? false,
      controlled: controlled(),
      trigger: !!state.triggerRef,
      content: !!state.contentRef,
    })
    if (next) setState("dismiss", null)
    if (local.onOpenChange) local.onOpenChange(next)
    if (controlled()) return
    setState("uncontrolledOpen", next)
  }

  createEffect(() => {
    if (!opened()) return
    log("effect-open", {
      modal: local.modal ?? false,
      trigger: !!state.triggerRef,
      content: !!state.contentRef,
    })

    const inside = (node: Node | null | undefined) => {
      if (!node) return false
      const content = state.contentRef
      if (content && content.contains(node)) return true
      const trigger = state.triggerRef
      if (trigger && trigger.contains(node)) return true
      return false
    }

    const close = (reason: "escape" | "outside") => {
      setState("dismiss", reason)
      onOpenChange(false)
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return
      close("escape")
      event.preventDefault()
      event.stopPropagation()
    }

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (inside(target)) return
      log("pointerdown-outside", {
        dismiss: state.dismiss ?? "none",
      })
      close("outside")
    }

    const onFocusIn = (event: FocusEvent) => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (inside(target)) return
      log("focus-outside", {
        dismiss: state.dismiss ?? "none",
      })
      close("outside")
    }

    window.addEventListener("keydown", onKeyDown, true)
    window.addEventListener("pointerdown", onPointerDown, true)
    window.addEventListener("focusin", onFocusIn, true)

    onCleanup(() => {
      window.removeEventListener("keydown", onKeyDown, true)
      window.removeEventListener("pointerdown", onPointerDown, true)
      window.removeEventListener("focusin", onFocusIn, true)
    })
  })

  const content = () => (
    <>
      <Show when={local.modal && opened()}>
        <div data-component="dialog-overlay" />
      </Show>
      <Kobalte.Content
        ref={(el: HTMLElement | undefined) => setState("contentRef", el)}
        data-component="popover-content"
        classList={{
          ...(local.classList ?? {}),
          [local.class ?? ""]: !!local.class,
        }}
        style={local.style}
        onOpenAutoFocus={(event: Event) => {
          if (debug()) {
            log("open-autofocus", {
              dismiss: state.dismiss ?? "none",
              width: state.contentRef ? Math.round(state.contentRef.getBoundingClientRect().width) : "none",
              height: state.contentRef ? Math.round(state.contentRef.getBoundingClientRect().height) : "none",
              nodes: state.contentRef ? state.contentRef.querySelectorAll("*").length : "none",
            })
          }
          event.preventDefault()
        }}
        onCloseAutoFocus={(event: Event) => {
          // Only Escape-dismiss should return focus to the trigger for keyboard a11y.
          // Hover/outside/programmatic close must NOT steal focus back, otherwise
          // Kobalte calls trigger.focus() and the browser paints a :focus-visible ring
          // around the trigger (e.g. extra-agent IconButton blue outline after hover-out).
          if (state.dismiss !== "escape") event.preventDefault()
          setState("dismiss", null)
        }}
      >
        {/* <Kobalte.Arrow data-slot="popover-arrow" /> */}
        <Show when={local.title}>
          <div data-slot="popover-header">
            <Kobalte.Title data-slot="popover-title">{local.title}</Kobalte.Title>
            <Kobalte.CloseButton
              data-slot="popover-close-button"
              as={IconButton}
              icon="close"
              variant="ghost"
              aria-label={i18n.t("ui.common.close")}
            />
          </div>
        </Show>
        <Show when={local.description}>
          <Kobalte.Description data-slot="popover-description">{local.description}</Kobalte.Description>
        </Show>
        <div data-slot="popover-body">{local.children}</div>
      </Kobalte.Content>
    </>
  )

  return (
    <Kobalte gutter={4} {...rest} open={opened()} onOpenChange={onOpenChange} modal={local.modal ?? false}>
      <Kobalte.Trigger
        ref={(el: HTMLElement) => setState("triggerRef", el)}
        as={local.triggerAs ?? "div"}
        data-slot="popover-trigger"
        {...(local.triggerProps as any)}
      >
        {local.trigger}
      </Kobalte.Trigger>
      <Show when={local.portal ?? true} fallback={content()}>
        <Kobalte.Portal>{content()}</Kobalte.Portal>
      </Show>
    </Kobalte>
  )
}
