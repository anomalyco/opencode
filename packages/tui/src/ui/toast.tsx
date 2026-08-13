import { createContext, createSignal, onCleanup, useContext, type ParentProps, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { useTheme } from "../context/theme"
import { useRenderer, useTerminalDimensions } from "@opentui/solid"
import { SplitBorder } from "./border"
import { TextAttributes } from "@opentui/core"
import { tint } from "../theme/color"
export type ToastOptions = {
  title?: string
  message: string
  variant: "info" | "success" | "warning" | "error"
  duration: number
  action?: {
    label: string
    run: () => void
  }
}
type ToastInput = Omit<ToastOptions, "duration"> & { duration?: number }

function ToastSurface(props: {
  toast: ToastOptions
  pending?: number
  onHover?: (hovered: boolean) => void
  onActivate: () => void
}) {
  const theme = useTheme("overlay")
  const dimensions = useTerminalDimensions()
  const renderer = useRenderer()
  const [hovered, setHovered] = createSignal(false)
  const hover = (value: boolean) => {
    setHovered(value)
    props.onHover?.(value)
  }

  return (
    <box
      position="absolute"
      top={1}
      right={2}
      maxWidth={Math.min(60, dimensions().width - 6)}
      justifyContent="center"
      alignItems="flex-start"
      borderColor={theme.text.feedback[props.toast.variant].default}
      border={["left", "right"]}
      customBorderChars={SplitBorder.customBorderChars}
      onMouseOver={() => hover(true)}
      onMouseOut={() => hover(false)}
      onMouseUp={() => {
        if (renderer.getSelection()?.getSelectedText()) return
        props.onActivate()
      }}
    >
      <box
        width="100%"
        paddingLeft={2}
        paddingRight={2}
        paddingTop={1}
        paddingBottom={1}
        backgroundColor={
          hovered() ? tint(theme.background.default, theme.text.default, 0.04) : theme.background.default
        }
      >
        <Show
          when={props.toast.title}
          fallback={
            <box flexDirection="row" width="100%">
              <text fg={theme.text.default} wrapMode="word" flexGrow={1}>
                {props.toast.message}
              </text>
              <Show when={props.toast.action || hovered()}>
                <text
                  flexShrink={0}
                  marginLeft={2}
                  wrapMode="none"
                  attributes={hovered() ? TextAttributes.BOLD : undefined}
                  fg={hovered() ? theme.text.action.primary.default : theme.text.subdued}
                >
                  {hovered() && props.toast.action ? "› " : ""}
                  {props.toast.action?.label ?? "x"}
                </text>
              </Show>
            </box>
          }
        >
          <box flexDirection="row" width="100%" marginBottom={1}>
            <text attributes={TextAttributes.BOLD} fg={theme.text.default}>
              {props.toast.title}
            </text>
            <box flexGrow={1} />
            <Show when={props.toast.action || hovered()}>
              <text
                flexShrink={0}
                marginLeft={2}
                wrapMode="none"
                attributes={hovered() ? TextAttributes.BOLD : undefined}
                fg={hovered() ? theme.text.action.primary.default : theme.text.subdued}
              >
                {hovered() && props.toast.action ? "› " : ""}
                {props.toast.action?.label ?? "x"}
              </text>
            </Show>
          </box>
          <text fg={theme.text.default} wrapMode="word" width="100%">
            {props.toast.message}
          </text>
        </Show>
        <Show when={props.pending}>
          <text fg={theme.text.subdued} marginTop={1}>
            +{props.pending} more
          </text>
        </Show>
      </box>
    </box>
  )
}

export function Toast() {
  const toast = useToast()

  return (
    <Show when={toast.currentToast}>
      {(current) => (
        <ToastSurface
          toast={current()}
          pending={toast.pending}
          onHover={(hovered) => (hovered ? toast.pause() : toast.resume())}
          onActivate={toast.activate}
        />
      )}
    </Show>
  )
}

function init() {
  const [store, setStore] = createStore({
    currentToast: null as ToastOptions | null,
    queue: [] as ToastOptions[],
  })

  let timeoutHandle: NodeJS.Timeout | null = null
  let startedAt = 0
  let remaining = 0
  let paused = false

  const clear = () => {
    if (!timeoutHandle) return
    clearTimeout(timeoutHandle)
    timeoutHandle = null
  }

  const start = (duration: number) => {
    clear()
    remaining = duration
    startedAt = Date.now()
    timeoutHandle = setTimeout(() => dismiss(), duration).unref()
  }

  const dismiss = () => {
    clear()
    const next = store.queue[0]
    setStore("queue", (queue) => queue.slice(1))
    setStore("currentToast", next ?? null)
    if (!next) {
      paused = false
      return
    }
    remaining = next.duration
    if (!paused) start(next.duration)
  }

  const toast = {
    show(options: ToastInput) {
      const toastOptions = { ...options, duration: options.duration ?? 5000 }
      if (store.currentToast && (paused || store.queue.length > 0)) {
        setStore("queue", (queue) => [...queue, toastOptions])
        return
      }
      setStore("currentToast", toastOptions)
      start(toastOptions.duration)
    },
    error: (err: any) => {
      if (err instanceof Error)
        return toast.show({
          variant: "error",
          message: err.message,
        })
      toast.show({
        variant: "error",
        message: "An unknown error has occurred",
      })
    },
    pause() {
      if (!store.currentToast || paused) return
      paused = true
      remaining = Math.max(0, remaining - (Date.now() - startedAt))
      clear()
    },
    resume() {
      if (!store.currentToast || !paused) return
      paused = false
      start(remaining)
    },
    dismiss,
    activate() {
      const action = store.currentToast?.action
      dismiss()
      action?.run()
    },
    get currentToast(): ToastOptions | null {
      return store.currentToast
    },
    get pending() {
      return store.queue.length
    },
  }
  onCleanup(clear)
  return toast
}

export type ToastContext = ReturnType<typeof init>

const ctx = createContext<ToastContext>()

export function ToastProvider(props: ParentProps) {
  const value = init()
  return <ctx.Provider value={value}>{props.children}</ctx.Provider>
}

export function useToast() {
  const value = useContext(ctx)
  if (!value) {
    throw new Error("useToast must be used within a ToastProvider")
  }
  return value
}
