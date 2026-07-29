import type { ComponentProps, JSX } from "solid-js"
import { Show, children, createContext, splitProps, useContext } from "solid-js"
import { Portal } from "solid-js/web"
import { ButtonV2 } from "./button-v2"
import {
  ToastV2StackRegion,
  ToastV2StackRenderContext,
  toastV2Stack,
  type ToastV2StackRegionProps,
} from "./toast-v2-stack"
import "./toast-v2.css"

export interface ToastV2RegionProps extends ToastV2StackRegionProps {}

function ToastV2Region(props: ToastV2RegionProps) {
  return (
    <Portal>
      <ToastV2StackRegion {...props} />
    </Portal>
  )
}

const ToastV2Context = createContext<number>()

export interface ToastV2RootComponentProps extends ComponentProps<"div"> {
  toastId: number
  duration?: number
  persistent?: boolean
}

function ToastV2Root(props: ToastV2RootComponentProps) {
  const [local, rest] = splitProps(props, ["toastId", "duration", "persistent", "children"])
  const stacked = useContext(ToastV2StackRenderContext)
  if (stacked) return <ToastV2Context.Provider value={local.toastId}>{local.children}</ToastV2Context.Provider>
  return (
    <ToastV2Context.Provider value={local.toastId}>
      <div data-component="toast-v2" {...rest}>
        {local.children}
      </div>
    </ToastV2Context.Provider>
  )
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
  const toastId = useContext(ToastV2Context)
  const [local, rest] = splitProps(props, ["children", "onClick"])
  return (
    <button
      type="button"
      data-slot="toast-v2-close-button"
      aria-label="Dismiss"
      {...rest}
      onClick={(event) => {
        if (typeof local.onClick === "function") local.onClick(event)
        if (!event.defaultPrevented && toastId !== undefined) toasterV2.dismiss(toastId)
      }}
    >
      {local.children ?? (
        <svg
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
        >
          <path d="M4.25 11.75L11.75 4.25" stroke="currentColor" />
          <path d="M11.75 11.75L4.25 4.25" stroke="currentColor" />
        </svg>
      )}
    </button>
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
  show(render: (props: { toastId: number }) => JSX.Element) {
    const toastId = --toastV2Id
    toastV2Stack.show({ id: toastId, revision: 1, render: () => render({ toastId }) })
    return toastId
  },
  dismiss(toastId?: number) {
    if (toastId === undefined) {
      activeToastV2ByKey.clear()
      activeToastV2ById.clear()
    } else {
      releaseToastV2(activeToastV2ById.get(toastId))
    }
    return toastV2Stack.dismiss(toastId)
  },
}

interface ActiveToastV2 {
  id: number
  key: string
  revision: number
}

const activeToastV2ByKey = new Map<string, ActiveToastV2>()
const activeToastV2ById = new Map<number, ActiveToastV2>()

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
  const toasts = toastV2Stack.getToasts()

  if (active && toasts[0]?.id === active.id) {
    active.revision++
    publishToastV2(active, opts)
    return active.id
  }

  if (active && toasts.some((item) => item.id === active.id)) toasterV2.dismiss(active.id)
  releaseToastV2(active)

  const entry = { id: --toastV2Id, key, revision: 1 }
  activeToastV2ByKey.set(key, entry)
  activeToastV2ById.set(entry.id, entry)
  publishToastV2(entry, opts)
  return entry.id
}

function publishToastV2(entry: ActiveToastV2, opts: ToastV2Options) {
  toastV2Stack.show({
    id: entry.id,
    revision: entry.revision,
    variant: opts.variant,
    duration: opts.duration,
    persistent: opts.persistent,
    render: () => {
      const resolvedIcon = children(() => opts.icon)
      const icon = resolvedIcon()
      const renderedIcon = typeof Node !== "undefined" && icon instanceof Node ? icon.cloneNode(true) : icon
      return (
        <ToastV2Context.Provider value={entry.id}>
          <div data-slot="toast-v2-header">
            <Show when={renderedIcon}>
              <ToastV2.Icon>{renderedIcon}</ToastV2.Icon>
            </Show>
            <ToastV2.Content>
              <Show when={opts.title}>
                <ToastV2.Title>{opts.title}</ToastV2.Title>
              </Show>
              <Show when={opts.description}>
                <ToastV2.Description>{opts.description}</ToastV2.Description>
              </Show>
            </ToastV2.Content>
            <ToastV2.CloseButton />
          </div>
          <Show when={opts.actions?.length}>
            <ToastV2.Actions>
              {opts.actions!.map((action) => (
                <ButtonV2
                  variant={action.variant === "secondary" ? "ghost" : "neutral"}
                  size="small"
                  data-action-variant={action.variant ?? "primary"}
                  onClick={() => {
                    if (typeof action.onClick === "function") action.onClick()
                    toasterV2.dismiss(entry.id)
                  }}
                >
                  {action.label}
                </ButtonV2>
              ))}
            </ToastV2.Actions>
          </Show>
        </ToastV2Context.Provider>
      )
    },
    onDismiss: () => releaseToastV2(entry),
    onAutoClose: () => releaseToastV2(entry),
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
