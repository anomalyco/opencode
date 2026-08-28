import { Toaster, toast, type ToasterProps } from "solid-sonner"
import { isRTL } from "@kobalte/core/i18n"
import type { ComponentProps, JSX } from "solid-js"
import { createContext, onCleanup, onMount, splitProps, useContext } from "solid-js"
import { Portal } from "solid-js/web"
import { useI18n } from "../../context/i18n"
import "./button-v2.css"
import "./toast-v2.css"

export interface ToastV2RegionProps extends ToasterProps {}

function ToastV2Region(props: ToastV2RegionProps) {
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

const ToastV2Context = createContext<number>()

export interface ToastV2RootComponentProps {
  toastId: number
  children?: JSX.Element
}

function ToastV2Root(props: ToastV2RootComponentProps) {
  return <ToastV2Context.Provider value={props.toastId}>{props.children}</ToastV2Context.Provider>
}

function ToastV2Icon(props: ComponentProps<"div">) {
  return <div data-slot="toast-v2-icon" {...props} />
}

function ToastV2Content(props: ComponentProps<"div">) {
  return <div data-slot="toast-v2-content" {...props} />
}

function ToastV2Title(props: ComponentProps<"div">) {
  return <div data-slot="toast-v2-title" {...props} />
}

function ToastV2Description(props: ComponentProps<"div">) {
  return <div data-slot="toast-v2-description" {...props} />
}

function ToastV2Actions(props: ComponentProps<"div">) {
  return <div data-slot="toast-v2-actions" {...props} />
}

function ToastV2CloseButton(props: ComponentProps<"button">) {
  const i18n = useI18n()
  const toastId = useContext(ToastV2Context)
  const [local, rest] = splitProps(props, ["children", "onClick"])
  return (
    <button
      type="button"
      data-slot="toast-v2-close-button"
      aria-label={i18n.t("ui.common.dismiss")}
      {...rest}
      onClick={(event) => {
        if (typeof local.onClick === "function") local.onClick(event)
        if (!event.defaultPrevented && toastId !== undefined) toasterV2.dismiss(toastId)
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

export const ToastV2 = Object.assign(ToastV2Root, {
  Region: ToastV2Region,
  Icon: ToastV2Icon,
  Content: ToastV2Content,
  Title: ToastV2Title,
  Description: ToastV2Description,
  Actions: ToastV2Actions,
  CloseButton: ToastV2CloseButton,
})

let toastV2Id = 0

export const toasterV2 = {
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
      activeToastV2ByKey.clear()
      activeToastV2ById.clear()
    } else {
      releaseToastV2(activeToastV2ById.get(toastId))
    }
    return toast.dismiss(toastId)
  },
}

export interface ToastV2Action {
  label: string
  variant?: "primary" | "secondary"
  onClick: "dismiss" | (() => void)
}

export interface ToastV2Options {
  title?: string
  description?: string
  icon?: JSX.Element
  variant?: "default" | "success" | "error" | "loading"
  duration?: number
  persistent?: boolean
  actions?: ToastV2Action[]
}

interface ActiveToastV2 {
  id: number
  key: string
  options: ToastV2Options
  actions?: JSX.Element
}

const activeToastV2ByKey = new Map<string, ActiveToastV2>()
const activeToastV2ById = new Map<number, ActiveToastV2>()

export function showToastV2(options: ToastV2Options | string) {
  const opts: ToastV2Options = typeof options === "string" ? { description: options } : options
  const key = JSON.stringify({
    title: opts.title,
    description: opts.description,
    variant: opts.variant,
    duration: opts.duration,
    persistent: opts.persistent,
    actions: opts.actions?.map((action) => [action.label, action.variant]),
  })
  const active = activeToastV2ByKey.get(key)
  const toasts = toast.getToasts()

  if (active && toasts.at(-1)?.id === active.id) {
    active.options = opts
    publishToastV2(active)
    pulseToastV2(active.id)
    return active.id
  }

  if (active && toasts.some((item) => item.id === active.id)) toasterV2.dismiss(active.id)
  releaseToastV2(active)

  const entry: ActiveToastV2 = { id: --toastV2Id, key, options: opts }
  entry.actions = createToastV2Actions(entry)
  activeToastV2ByKey.set(key, entry)
  activeToastV2ById.set(entry.id, entry)
  publishToastV2(entry)
  return entry.id
}

function publishToastV2(entry: ActiveToastV2) {
  const release = () => releaseToastV2(entry)
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

function createToastV2Actions(entry: ActiveToastV2) {
  if (!entry.options.actions?.length) return undefined
  return (
    <ToastV2.Actions>
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
            toasterV2.dismiss(entry.id)
          }}
        >
          {action.label}
        </button>
      ))}
    </ToastV2.Actions>
  )
}

function pulseToastV2(toastId: number) {
  if (typeof document === "undefined" || typeof requestAnimationFrame === "undefined") return
  requestAnimationFrame(() => {
    const element = document.querySelector<HTMLElement>(`[data-testid="toast-v2-${toastId}"]`)
    if (!element || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return
    element.animate([{ scale: 1 }, { scale: 1.025 }, { scale: 1 }], { duration: 160, easing: "ease-out" })
  })
}

function releaseToastV2(entry: ActiveToastV2 | undefined) {
  if (!entry) return
  if (activeToastV2ByKey.get(entry.key) === entry) activeToastV2ByKey.delete(entry.key)
  if (activeToastV2ById.get(entry.id) === entry) activeToastV2ById.delete(entry.id)
}

export interface ToastV2PromiseOptions<T, U = unknown> {
  loading?: JSX.Element
  success?: (data: T) => JSX.Element
  error?: (error: U) => JSX.Element
}
