import { Toaster, toast, type ToasterProps } from "solid-sonner"
import { boundToastDescription } from "./description"
import { isRTL } from "@kobalte/core/i18n"
import type { ComponentProps, JSX } from "solid-js"
import { createContext, onCleanup, splitProps, useContext } from "solid-js"
import { Portal } from "solid-js/web"
import { useI18n } from "../../context/i18n"
import "../../actions/button/button.css"
import "./toast.css"
import { prefersReducedMotion } from "../../motion"
import {
  createToastRegistryState,
  selectToastOptions,
  transitionToastRegistry,
  type ToastRegistryEvent,
  type ToastRegistryTransition,
} from "./machine"

export interface ToastRegionProps extends ToasterProps {}

function ToastRegion(props: ToastRegionProps) {
  const i18n = useI18n()
  const [local, rest] = splitProps(props, ["class", "className", "style", "toastOptions", "swipeDirections"])

  // The Portal's container holds the toast region whenever it exists. Watching the container, not the whole body,
  // keeps every DOM change elsewhere in the page (each streamed delta, each mounted row) from scanning the document.
  const observe = (container: HTMLDivElement) => {
    // A modal dialog hides what's outside it from assistive tech. The region is in the Portal's own div, so that div,
    // rather than the toaster, is what the dialog would hide.
    container.setAttribute("data-kb-top-layer", "")

    const sync = () => {
      container.querySelectorAll<HTMLElement>(".toast-v2-region .toast-v2").forEach((element) => {
        const hidden = element.dataset.visible === "false"
        element.inert = hidden
        element.tabIndex = hidden ? -1 : 0
      })
    }

    const observer = new MutationObserver(sync)
    observer.observe(container, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-visible"] })
    sync()
    onCleanup(() => observer.disconnect())
  }

  return (
    <Portal ref={observe}>
      <Toaster
        position={isRTL(i18n.locale()) ? "bottom-left" : "bottom-right"}
        offset={isRTL(i18n.locale()) ? { left: 32, bottom: 48 } : { right: 32, bottom: 48 }}
        mobileOffset={16}
        gap={12}
        duration={5000}
        swipeDirections={["bottom"]}
        className={["toast-v2-region", local.className, local.class].filter(Boolean).join(" ")}
        style={{ "--width": "320px", ...local.style }}
        toastOptions={{
          ...local.toastOptions,
          unstyled: true,
          closeButton: true,
          closeButtonAriaLabel: local.toastOptions?.closeButtonAriaLabel ?? i18n.t("ui.common.dismiss"),
        }}
        {...rest}
      />
    </Portal>
  )
}

const ToastContext = createContext<number>()

export interface ToastRootComponentProps {
  toastId: number
  children?: JSX.Element
}

function ToastRoot(props: ToastRootComponentProps) {
  return <ToastContext.Provider value={props.toastId}>{props.children}</ToastContext.Provider>
}

function ToastIcon(props: ComponentProps<"div">) {
  return <div data-slot="toast-v2-icon" {...props} />
}

function ToastContent(props: ComponentProps<"div">) {
  return <div data-slot="toast-v2-content" {...props} />
}

function ToastTitle(props: ComponentProps<"div">) {
  return <div data-slot="toast-v2-title" {...props} />
}

function ToastDescription(props: ComponentProps<"div">) {
  return <div data-slot="toast-v2-description" {...props} />
}

function ToastActions(props: ComponentProps<"div">) {
  return <div data-slot="toast-v2-actions" {...props} />
}

function ToastCloseButton(props: ComponentProps<"button">) {
  const i18n = useI18n()
  const toastId = useContext(ToastContext)
  const [local, rest] = splitProps(props, ["children", "onClick"])

  return (
    <button
      type="button"
      data-slot="toast-v2-close-button"
      aria-label={i18n.t("ui.common.dismiss")}
      {...rest}
      onClick={(event) => {
        if (local.onClick instanceof Function) local.onClick(event)

        if (!event.defaultPrevented && toastId !== undefined) toaster.dismiss(toastId)
      }}
    >
      {local.children ?? <CloseIcon />}
    </button>
  )
}

function CloseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M4.25 11.75L11.75 4.25" stroke="currentColor" />
      <path d="M11.75 11.75L4.25 4.25" stroke="currentColor" />
    </svg>
  )
}

export const Toast = Object.assign(ToastRoot, {
  Region: ToastRegion,
  Icon: ToastIcon,
  Content: ToastContent,
  Title: ToastTitle,
  Description: ToastDescription,
  Actions: ToastActions,
  CloseButton: ToastCloseButton,
})

export const toaster = {
  show(
    render: (props: { toastId: number }) => JSX.Element,
    options?: {
      duration?: number
      persistent?: boolean
      /** Reactive value the toast's height depends on; sonner re-measures when it changes. */
      resize?: () => void
    },
  ) {
    dispatchRegistry({ type: "custom.shown" })
    const toastId = registry.nextId
    toast.custom((id) => render({ toastId: Number(id) }), {
      id: toastId,
      className: "toast-v2",
      duration: options?.persistent ? Number.POSITIVE_INFINITY : options?.duration,
      unstyled: true,
      // Sonner only re-measures on title/description changes, so a function-valued description is
      // the hook for a custom toast whose height depends on reactive state. It renders nothing;
      // toast.css collapses the empty description element.
      description: options?.resize
        ? (): JSX.Element => {
            options.resize?.()

            return undefined
          }
        : undefined,
    })

    return toastId
  },
  dismiss(toastId?: number) {
    dispatchRegistry({ type: "toast.dismissed", id: toastId })

    return toastId
  },
}

export interface ToastAction {
  label: string
  variant?: "primary" | "secondary"
  onClick: "dismiss" | (() => void)
}

export interface ToastOptions {
  title?: string
  description?: string
  /** An element, or a render function the toast calls under its own owner, for icons created from imperative code. */
  icon?: JSX.Element | (() => JSX.Element)
  variant?: "default" | "success" | "error" | "loading"
  duration?: number
  persistent?: boolean
  actions?: ToastAction[]
}

let registry = createToastRegistryState<ToastOptions>()

function dispatchRegistry(event: ToastRegistryEvent<ToastOptions>) {
  applyRegistry(transitionToastRegistry(registry, event))
}

function applyRegistry<T extends ToastRegistryTransition<ToastOptions>>(transition: T) {
  registry = transition.state
  transition.effects.forEach((effect) => {
    if (effect.type === "sonner.publish") return publishToast(effect.id, effect.options)

    if (effect.type === "sonner.dismiss") return toast.dismiss(effect.id)
    pulseToast(effect.id)
  })

  return transition
}

export function showToast(options: ToastOptions | string) {
  // SAFETY: `options` is declared `ToastOptions | string`; `typeof` separates the string shorthand from the object.
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- see SAFETY above
  const opts = boundToastDescription(typeof options === "string" ? { description: options } : options)

  const key = JSON.stringify({
    title: opts.title,
    description: opts.description,
    variant: opts.variant,
    duration: opts.duration,
    persistent: opts.persistent,
    actions: opts.actions?.map((action) => [action.label, action.variant]),
  })

  const toasts = toast.getToasts()

  return applyRegistry(
    transitionToastRegistry(registry, {
      type: "toast.shown",
      key,
      options: opts,
      liveIds: new Set(toasts.map((item) => item.id)),
      topmostLiveId: toasts.at(-1)?.id,
    }),
  ).id
}

function publishToast(id: number, options: ToastOptions) {
  // solid-sonner calls these as the toast starts to leave, 200ms before it drops the toast from `getToasts()`.
  const release = () => void dispatchRegistry({ type: "toast.released", id })
  // `toast.message` updates a toast with the same id in place; `toast()` would append a duplicate record.
  toast.message(options.title ?? "", {
    id,
    description: options.description,
    // SAFETY: solid-sonner inserts `icon` as a JSX child, and Solid calls a function child under the toast's render
    // owner; solid-sonner's type omits function children.
    icon: options.icon as JSX.Element,
    action: createToastActions(id, options.actions),
    closeButton: true,
    duration: options.persistent ? Number.POSITIVE_INFINITY : options.duration,
    className: `toast-v2 toast-v2--${options.variant ?? "default"}`,
    testId: `toast-v2-${id}`,
    unstyled: true,
    onDismiss: release,
    onAutoClose: release,
  })
}

function createToastActions(id: number, actions: ToastAction[] | undefined) {
  if (!actions?.length) return undefined

  return (
    <Toast.Actions>
      {/* Static map, not <For>: this JSX is created imperatively outside any Solid
          root, where a <For> computation would never be disposed. */}
      {actions.map((action, index) => (
        <button
          type="button"
          data-component="button-v2"
          data-variant={action.variant === "secondary" ? "ghost" : "neutral"}
          data-size="small"
          data-action-variant={action.variant ?? "primary"}
          onClick={() => {
            // A toast that already closed, such as on a second click during its exit animation, runs nothing.
            const options = selectToastOptions(registry, id)

            if (!options) return
            const onClick = options.actions?.[index]?.onClick

            if (onClick && onClick !== "dismiss") onClick()
            toaster.dismiss(id)
          }}
        >
          {action.label}
        </button>
      ))}
    </Toast.Actions>
  )
}

function pulseToast(toastId: number) {
  if (typeof document === "undefined" || typeof requestAnimationFrame === "undefined") return
  requestAnimationFrame(() => {
    const element = document.querySelector<HTMLElement>(`[data-testid="toast-v2-${toastId}"]`)

    if (!element || prefersReducedMotion()) return
    element.animate([{ scale: 1 }, { scale: 1.025 }, { scale: 1 }], { duration: 160, easing: "ease-out" })
  })
}

export interface ToastPromiseOptions<T, U = unknown> {
  loading?: JSX.Element
  success?: (data: T) => JSX.Element
  error?: (error: U) => JSX.Element
}
