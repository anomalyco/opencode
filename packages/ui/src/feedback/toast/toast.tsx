import { Toaster, toast, type ToasterProps } from "solid-sonner"
import { isRTL } from "@kobalte/core/i18n"
import type { ComponentProps, JSX } from "solid-js"
import { createContext, onCleanup, onMount, splitProps, useContext } from "solid-js"
import { Portal } from "solid-js/web"
import { useI18n } from "../../context/i18n"
import "../../actions/button/button.css"
import "./toast.css"

export interface ToastRegionProps extends ToasterProps {}

function ToastRegion(props: ToastRegionProps) {
  const i18n = useI18n()
  const [local, rest] = splitProps(props, ["class", "className", "style", "toastOptions", "swipeDirections"])
  onMount(() => {
    const sync = () => {
      document.querySelectorAll<HTMLElement>(".toast-v2-region .toast-v2").forEach((element) => {
        const hidden = element.dataset.visible === "false"
        element.inert = hidden
        element.tabIndex = hidden ? -1 : 0
      })
    }
    let connected = false
    const connect = () => {
      const regions = document.querySelectorAll(".toast-v2-region")
      if (!regions.length) return
      observer.disconnect()
      regions.forEach((region) => {
        observer.observe(region, {
          subtree: true,
          childList: true,
          attributes: true,
          attributeFilter: ["data-visible"],
        })
      })
      connected = true
      sync()
    }
    const observer = new MutationObserver(() => {
      if (!connected) connect()
      else sync()
    })
    observer.observe(document.body, { subtree: true, childList: true })
    queueMicrotask(connect)
    onCleanup(() => observer.disconnect())
  })
  return (
    <Portal>
      <Toaster
        position={isRTL(i18n.locale()) ? "bottom-left" : "bottom-right"}
        offset={isRTL(i18n.locale()) ? { left: 32, bottom: 48 } : { right: 32, bottom: 48 }}
        mobileOffset={16}
        gap={12}
        duration={5000}
        swipeDirections={["bottom"]}
        className={["toast-v2-region", local.className, local.class].filter(Boolean).join(" ")}
        style={{ "--width": "320px", ...local.style } as JSX.CSSProperties}
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
        if (typeof local.onClick === "function") local.onClick(event)
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

let toastV2Id = 0

export const toaster = {
  show(render: (props: { toastId: number }) => JSX.Element, options?: { duration?: number; persistent?: boolean }) {
    const toastId = --toastV2Id
    toast.custom((id) => render({ toastId: Number(id) }), {
      id: toastId,
      className: "toast-v2",
      duration: options?.persistent ? Number.POSITIVE_INFINITY : options?.duration,
      unstyled: true,
    })
    return toastId
  },
  dismiss(toastId?: number) {
    if (toastId === undefined) {
      activeToastByKey.clear()
      activeToastById.clear()
    } else {
      releaseToast(activeToastById.get(toastId))
    }
    return toast.dismiss(toastId)
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
  icon?: JSX.Element
  variant?: "default" | "success" | "error" | "loading"
  duration?: number
  persistent?: boolean
  actions?: ToastAction[]
}

interface ActiveToast {
  id: number
  key: string
  options: ToastOptions
  actions?: JSX.Element
}

const activeToastByKey = new Map<string, ActiveToast>()
const activeToastById = new Map<number, ActiveToast>()

export function showToast(options: ToastOptions | string) {
  const opts: ToastOptions = typeof options === "string" ? { description: options } : options
  const key = JSON.stringify({
    title: opts.title,
    description: opts.description,
    variant: opts.variant,
    duration: opts.duration,
    persistent: opts.persistent,
    actions: opts.actions?.map((action) => [action.label, action.variant]),
  })
  const active = activeToastByKey.get(key)
  const toasts = toast.getToasts()

  if (active && toasts.at(-1)?.id === active.id) {
    active.options = opts
    publishToast(active)
    pulseToast(active.id)
    return active.id
  }

  if (active && toasts.some((item) => item.id === active.id)) toaster.dismiss(active.id)
  releaseToast(active)

  const entry: ActiveToast = { id: --toastV2Id, key, options: opts }
  entry.actions = createToastActions(entry)
  activeToastByKey.set(key, entry)
  activeToastById.set(entry.id, entry)
  publishToast(entry)
  return entry.id
}

function publishToast(entry: ActiveToast) {
  const release = () => releaseToast(entry)
  toast(entry.options.title ?? "", {
    id: entry.id,
    description: entry.options.description,
    icon: entry.options.icon,
    action: entry.actions,
    closeButton: true,
    duration: entry.options.persistent ? Number.POSITIVE_INFINITY : entry.options.duration,
    className: `toast-v2 toast-v2--${entry.options.variant ?? "default"}`,
    testId: `toast-v2-${entry.id}`,
    unstyled: true,
    onDismiss: release,
    onAutoClose: release,
  })
}

function createToastActions(entry: ActiveToast) {
  if (!entry.options.actions?.length) return undefined
  return (
    <Toast.Actions>
      {/* Static map, not <For>: this JSX is created imperatively outside any Solid
          root, where a <For> computation would never be disposed. */}
      {entry.options.actions.map((action, index) => (
        <button
          type="button"
          data-component="button-v2"
          data-variant={action.variant === "secondary" ? "ghost" : "neutral"}
          data-size="small"
          data-action-variant={action.variant ?? "primary"}
          onClick={() => {
            const onClick = entry.options.actions?.[index]?.onClick
            if (typeof onClick === "function") onClick()
            toaster.dismiss(entry.id)
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
    if (!element || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return
    element.animate([{ scale: 1 }, { scale: 1.025 }, { scale: 1 }], { duration: 160, easing: "ease-out" })
  })
}

function releaseToast(entry: ActiveToast | undefined) {
  if (!entry) return
  if (activeToastByKey.get(entry.key) === entry) activeToastByKey.delete(entry.key)
  if (activeToastById.get(entry.id) === entry) activeToastById.delete(entry.id)
}

export interface ToastPromiseOptions<T, U = unknown> {
  loading?: JSX.Element
  success?: (data: T) => JSX.Element
  error?: (error: U) => JSX.Element
}
