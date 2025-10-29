import { createContext, useContext, type ParentProps, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { useTheme } from "@tui/context/theme"
import { SplitBorder } from "../component/border"

export interface ToastOptions {
  message: string | null
  duration?: number
  type: "info" | "success" | "warning" | "error"
}

export function Toast() {
  const toast = useToast()
  const { theme } = useTheme()

  return (
    <Show when={toast.currentToast}>
      {(current) => (
        <box
          position="absolute"
          justifyContent="center"
          alignItems="center"
          top={2}
          right={2}
          paddingLeft={2}
          paddingRight={2}
          paddingTop={1}
          paddingBottom={1}
          backgroundColor={theme.backgroundPanel}
          borderColor={theme[current().type]}
          border={["left", "right"]}
          customBorderChars={SplitBorder.customBorderChars}
        >
          <text>{current().message}</text>
        </box>
      )}
    </Show>
  )
}

function init() {
  const [store, setStore] = createStore({
    currentToast: null as ToastOptions | null,
  })

  let timeoutHandle: NodeJS.Timeout | null = null

  return {
    show(options: ToastOptions) {
      const { duration, ...currentToast } = options
      setStore("currentToast", currentToast)
      if (timeoutHandle) clearTimeout(timeoutHandle)
      timeoutHandle = setTimeout(() => {
        setStore("currentToast", null)
      }, duration ?? 5000).unref()
    },
    get currentToast(): ToastOptions | null {
      return store.currentToast
    },
  }
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
