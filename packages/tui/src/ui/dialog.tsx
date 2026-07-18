import { useRenderer, useTerminalDimensions } from "@opentui/solid"
import {
  batch,
  createContext,
  createEffect,
  For,
  onCleanup,
  Show,
  useContext,
  type Accessor,
  type JSX,
  type ParentProps,
} from "solid-js"
import { useTheme } from "../context/theme"
import { MouseButton, Renderable, RGBA } from "@opentui/core"
import { createStore } from "solid-js/store"
import { useToast } from "./toast"
import { Flag } from "@kancode/core/flag/flag"
import { useBindings, useOpencodeModeStack } from "../keymap"
import { useClipboard } from "../context/clipboard"

export type DialogSize = "medium" | "large" | "xlarge"

/** Dialog panel width as a fraction of the terminal (clamped to terminal-4). */
export function dialogWidth(size: DialogSize, terminalWidth: number) {
  const max = Math.max(20, terminalWidth - 4)
  if (size === "xlarge") return max
  if (size === "large") return Math.min(max, Math.max(40, Math.floor(terminalWidth * 0.8)))
  return Math.min(max, Math.max(32, Math.floor(terminalWidth * 0.6)))
}

/** Top inset so the panel sits near the top and can grow with the terminal. */
export function dialogPaddingTop(size: DialogSize, terminalHeight: number) {
  const ratio = size === "xlarge" ? 0.05 : size === "large" ? 0.08 : 0.1
  return Math.max(1, Math.floor(terminalHeight * ratio))
}

/**
 * Suggested max height for scrollable dialog lists.
 * `chrome` covers title/filter/footer/padding inside the panel.
 */
export function dialogListHeight(size: DialogSize, terminalHeight: number, chrome = 10) {
  return Math.max(8, terminalHeight - dialogPaddingTop(size, terminalHeight) - chrome)
}

export function Dialog(
  props: ParentProps<{
    size?: DialogSize
    onClose: () => void
  }>,
) {
  const dimensions = useTerminalDimensions()
  const { theme } = useTheme()
  const renderer = useRenderer()

  let dismiss = false
  const size = () => props.size ?? "medium"

  return (
    <box
      onMouseDown={() => {
        dismiss = !!renderer.getSelection()
      }}
      onMouseUp={() => {
        if (dismiss) {
          dismiss = false
          return
        }
        props.onClose?.()
      }}
      width={dimensions().width}
      height={dimensions().height}
      alignItems="center"
      position="absolute"
      zIndex={3000}
      paddingTop={dialogPaddingTop(size(), dimensions().height)}
      left={0}
      top={0}
      backgroundColor={RGBA.fromInts(0, 0, 0, 150)}
    >
      <box
        onMouseUp={(e: { stopPropagation(): void }) => {
          // A selection release must bubble up to the copy-on-select handler in
          // DialogProvider; the backdrop's dismiss flag keeps it from closing the dialog.
          if (renderer.getSelection()?.getSelectedText()) return
          dismiss = false
          e.stopPropagation()
        }}
        width={dialogWidth(size(), dimensions().width)}
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
    size: "medium" as DialogSize,
  })

  const renderer = useRenderer()
  const modeStack = useOpencodeModeStack()

  createEffect(() => {
    if (store.stack.length === 0) return
    const popMode = modeStack.push("modal")
    onCleanup(popMode)
  })

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

  function pop() {
    if (renderer.getSelection()) {
      renderer.clearSelection()
    }
    const current = store.stack.at(-1)
    current?.onClose?.()
    const next = store.stack.slice(0, -1)
    setStore("stack", next)
    if (next.length === 0) {
      setStore("size", "medium")
      // Only return focus to the prompt when the whole stack is gone.
      // Popping a nested dialog (e.g. note → model) must not focus the
      // obscured prompt underneath the remaining dialog.
      refocus()
      return
    }
    renderer.currentFocusedRenderable?.blur()
  }

  useBindings(() => ({
    enabled: store.stack.length > 0 && !renderer.getSelection()?.getSelectedText(),
    bindings: [
      {
        key: "escape",
        desc: "Close dialog",
        group: "Dialog",
        cmd: pop,
      },
      {
        key: "ctrl+c",
        desc: "Close dialog",
        group: "Dialog",
        cmd: pop,
      },
    ],
  }))

  return {
    clear() {
      for (const item of store.stack) {
        if (item.onClose) item.onClose()
      }
      batch(() => {
        setStore("size", "medium")
        setStore("stack", [])
      })
      refocus()
    },
    pop,
    /** Push a dialog on top of the current one. Escape/pop returns to the previous. */
    push(input: any, onClose?: () => void) {
      if (store.stack.length === 0) {
        focus = renderer.currentFocusedRenderable
        focus?.blur()
      }
      setStore("stack", [
        ...store.stack,
        {
          element: input,
          onClose,
        },
      ])
    },
    replace(input: any, onClose?: () => void) {
      if (store.stack.length === 0) {
        focus = renderer.currentFocusedRenderable
        focus?.blur()
      }
      for (const item of store.stack) {
        if (item.onClose) item.onClose()
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
    setSize(size: DialogSize) {
      setStore("size", size)
    },
  }
}

export type DialogContext = ReturnType<typeof init>

const ctx = createContext<DialogContext>()

/** True when this dialog layer is the top of the stack (receives keys). */
const layerActiveCtx = createContext<Accessor<boolean>>()

export function useDialogLayerActive() {
  return useContext(layerActiveCtx) ?? (() => true)
}

export function DialogProvider(props: ParentProps) {
  const value = init()
  const renderer = useRenderer()
  const toast = useToast()
  const clipboard = useClipboard()

  function copySelection() {
    const text = renderer.getSelection()?.getSelectedText()
    if (!text || !clipboard.write) return false
    void clipboard.write(text).then(
      () => toast.show({ message: "Copied to clipboard", variant: "info" }),
      (error) => toast.error(error),
    )
    renderer.clearSelection()
    return true
  }

  return (
    <ctx.Provider value={value}>
      {props.children}
      <box
        position="absolute"
        zIndex={3000}
        onMouseDown={(evt: { button: number; preventDefault(): void; stopPropagation(): void }) => {
          if (!Flag.OPENCODE_EXPERIMENTAL_DISABLE_COPY_ON_SELECT) return
          if (evt.button !== MouseButton.RIGHT) return

          if (!copySelection()) return
          evt.preventDefault()
          evt.stopPropagation()
        }}
        onMouseUp={!Flag.OPENCODE_EXPERIMENTAL_DISABLE_COPY_ON_SELECT ? copySelection : undefined}
      >
        <Show when={value.stack.length}>
          <Dialog onClose={() => value.clear()} size={value.size}>
            {/* Keep underlying layers mounted so push/pop preserves state and
                avoids remount lag. Only the top layer is visible / active. */}
            <For each={value.stack}>
              {(item, index) => {
                const active = () => index() === value.stack.length - 1
                return (
                  <layerActiveCtx.Provider value={active}>
                    <box visible={active()} flexGrow={1} flexDirection="column">
                      {item.element}
                    </box>
                  </layerActiveCtx.Provider>
                )
              }}
            </For>
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
