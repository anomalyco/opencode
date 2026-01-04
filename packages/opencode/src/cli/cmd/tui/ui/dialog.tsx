import { useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/solid"
import { batch, createContext, Show, useContext, type JSX, type ParentProps } from "solid-js"
import { useTheme } from "@tui/context/theme"
import { Renderable, RGBA } from "@opentui/core"
import { createStore } from "solid-js/store"
import { Clipboard } from "@tui/util/clipboard"
import { useToast } from "./toast"

export function Dialog(
  props: ParentProps<{
    size?: "medium" | "large"
    onClose: () => void
    handleEscape?: () => boolean
  }>,
) {
  const dimensions = useTerminalDimensions()
  const { theme } = useTheme()
  const renderer = useRenderer()

  return (
    <box
      onMouseUp={async () => {
        if (renderer.getSelection()) return
        props.onClose?.()
      }}
      width={dimensions().width}
      height={dimensions().height}
      alignItems="center"
      position="absolute"
      paddingTop={dimensions().height / 4}
      left={0}
      top={0}
      backgroundColor={RGBA.fromInts(0, 0, 0, 150)}
    >
      <box
        onMouseUp={async (e) => {
          if (renderer.getSelection()) return
          e.stopPropagation()
        }}
        width={props.size === "large" ? 80 : 60}
        maxWidth={dimensions().width - 2}
        backgroundColor={theme.backgroundPanel}
        paddingTop={1}
      >
        {props.children}
      </box>
    </box>
  )
}

function init() {
  const [store, setStore] = createStore({
    stack: [] as {
      element: JSX.Element
      onClose?: () => void
    }[],
    size: "medium" as "medium" | "large",
  })

  const escapeHandlers = new Map<number, () => boolean>()

  const renderer = useRenderer()
  let focus: Renderable | null
  function refocus() {
    setTimeout(() => {
      if (!focus) return
      if (focus.isDestroyed) return
      function find(item: Renderable) {
        for (const child of item.getChildren()) {
          if (child === focus) return true
          if (find(child)) return true
        }
        return false
      }
      const found = find(renderer.root)
      if (!found) return
      focus.focus()
    }, 1)
  }

  useKeyboard((evt) => {
    if (evt.name === "escape" && store.stack.length > 0) {
      if (evt.defaultPrevented) return
      const current = store.stack.at(-1)!
      const stackIndex = store.stack.length - 1
      const handleEscape = escapeHandlers.get(stackIndex)
      if (handleEscape) {
        const handled = handleEscape()
        if (handled) {
          evt.preventDefault()
          return
        }
      }
      current.onClose?.()
      const lastIndex = store.stack.length - 1
      escapeHandlers.delete(lastIndex)
      setStore("stack", store.stack.slice(0, -1))
      evt.preventDefault()
      refocus()
    }
  })

  return {
    clear() {
      for (const item of store.stack) {
        if (item.onClose) item.onClose()
      }
      escapeHandlers.clear()
      batch(() => {
        setStore("size", "medium")
        setStore("stack", [])
      })
      refocus()
    },
    replace(input: any, onClose?: () => void, handleEscape?: () => boolean) {
      if (store.stack.length === 0) {
        focus = renderer.currentFocusedRenderable
        focus?.blur()
      }
      for (const item of store.stack) {
        if (item.onClose) item.onClose()
      }
      escapeHandlers.clear()
      if (handleEscape) {
        escapeHandlers.set(0, handleEscape)
      }
      setStore("size", "medium")
      setStore("stack", [
        {
          element: input,
          onClose,
        },
      ])
    },
    get stack() {
      return store.stack
    },
    get size() {
      return store.size
    },
    setSize(size: "medium" | "large") {
      setStore("size", size)
    },
    focus: () => focus,
    setFocus: (f: Renderable | null) => {
      focus = f
    },
    refocus: () => refocus(),
    setStackHandleEscape: (handler: (() => boolean) | undefined) => {
      const stackIndex = store.stack.length - 1
      if (stackIndex >= 0) {
        if (handler) {
          escapeHandlers.set(stackIndex, handler)
        } else {
          escapeHandlers.delete(stackIndex)
        }
      }
    },
  }
}

export type DialogContext = ReturnType<typeof init>

const ctx = createContext<DialogContext>()

export function DialogProvider(props: ParentProps) {
  const value = init()
  const renderer = useRenderer()
  const toast = useToast()
  return (
    <ctx.Provider value={value}>
      {props.children}
      <box
        position="absolute"
        onMouseUp={async () => {
          const text = renderer.getSelection()?.getSelectedText()
          if (text && text.length > 0) {
            const base64 = Buffer.from(text).toString("base64")
            const osc52 = `\x1b]52;c;${base64}\x07`
            const finalOsc52 = process.env["TMUX"] ? `\x1bPtmux;\x1b${osc52}\x1b\\` : osc52
            /* @ts-expect-error */
            renderer.writeOut(finalOsc52)
            await Clipboard.copy(text)
              .then(() => toast.show({ message: "DEBUG YOU DINGUS: Copied to clipboard", variant: "info" }))
              .catch(toast.error)
            renderer.clearSelection()
          }
        }}
      >
        <Show when={value.stack.length}>
          <Dialog onClose={() => value.clear()} size={value.size}>
            {value.stack.at(-1)!.element}
          </Dialog>
        </Show>
      </box>
    </ctx.Provider>
  )
}

export function useDialog() {
  const value = useContext(ctx)
  if (!value) {
    throw new Error("useDialog must be used within a DialogProvider")
  }
  return value
}

export function useDialogEscape(handler: () => boolean) {
  const dialog = useDialog()
  dialog.setStackHandleEscape(handler)
}
