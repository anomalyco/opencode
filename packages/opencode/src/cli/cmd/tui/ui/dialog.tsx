import { useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/solid"
import { batch, createContext, Show, useContext, type JSX, type ParentProps } from "solid-js"
import { useTheme } from "@tui/context/theme"
import { Renderable, RGBA, ScrollBoxRenderable } from "@opentui/core"
import { createStore } from "solid-js/store"
import { Clipboard } from "@tui/util/clipboard"
import { useToast } from "./toast"

export function Dialog(
  props: ParentProps<{
    size?: "medium" | "large"
    scrollable?: boolean
    onClose: () => void
  }>,
) {
  const dimensions = useTerminalDimensions()
  const { theme } = useTheme()
  const renderer = useRenderer()
  const maxHeight = () => Math.floor(dimensions().height / 2) - 6

  let scroll: ScrollBoxRenderable | undefined

  useKeyboard((evt) => {
    if (!props.scrollable) return
    if (!scroll) return
    if (evt.name === "up" || (evt.ctrl && evt.name === "p")) {
      scroll.scrollBy(-1)
      evt.preventDefault()
      evt.stopPropagation()
    }
    if (evt.name === "down" || (evt.ctrl && evt.name === "n")) {
      scroll.scrollBy(1)
      evt.preventDefault()
      evt.stopPropagation()
    }
    if (evt.name === "pageup") {
      scroll.scrollBy(-Math.floor(scroll.height / 2))
      evt.preventDefault()
      evt.stopPropagation()
    }
    if (evt.name === "pagedown") {
      scroll.scrollBy(Math.floor(scroll.height / 2))
      evt.preventDefault()
      evt.stopPropagation()
    }
    if (evt.name === "home") {
      scroll.scrollTo(0)
      evt.preventDefault()
      evt.stopPropagation()
    }
    if (evt.name === "end") {
      scroll.scrollTo(scroll.scrollHeight)
      evt.preventDefault()
      evt.stopPropagation()
    }
  })

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
        paddingBottom={1}
      >
        <Show when={props.scrollable} fallback={props.children}>
          <scrollbox
            ref={(r) => (scroll = r)}
            maxHeight={maxHeight()}
            verticalScrollbarOptions={{
              visible: true,
              trackOptions: {
                backgroundColor: theme.backgroundPanel,
                foregroundColor: theme.border,
              },
            }}
          >
            {props.children}
          </scrollbox>
        </Show>
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
    scrollable: false,
  })

  useKeyboard((evt) => {
    if (evt.name === "escape" && store.stack.length > 0) {
      const current = store.stack.at(-1)!
      current.onClose?.()
      setStore("stack", store.stack.slice(0, -1))
      evt.preventDefault()
      evt.stopPropagation()
      refocus()
    }
  })

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

  return {
    clear() {
      for (const item of store.stack) {
        if (item.onClose) item.onClose()
      }
      batch(() => {
        setStore("size", "medium")
        setStore("scrollable", false)
        setStore("stack", [])
      })
      refocus()
    },
    replace(input: any, onClose?: () => void) {
      if (store.stack.length === 0) {
        focus = renderer.currentFocusedRenderable
        focus?.blur()
      }
      for (const item of store.stack) {
        if (item.onClose) item.onClose()
      }
      batch(() => {
        setStore("size", "medium")
        setStore("scrollable", false)
        setStore("stack", [
          {
            element: input,
            onClose,
          },
        ])
      })
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
    get scrollable() {
      return store.scrollable
    },
    setScrollable(scrollable: boolean) {
      setStore("scrollable", scrollable)
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
            await Clipboard.copy(text)
              .then(() => toast.show({ message: "Copied to clipboard", variant: "info" }))
              .catch(toast.error)
            renderer.clearSelection()
          }
        }}
      >
        <Show when={value.stack.length}>
          <Dialog onClose={() => value.clear()} size={value.size} scrollable={value.scrollable}>
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
