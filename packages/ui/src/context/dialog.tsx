import { For, Show, type JSX } from "solid-js"
import { createStore } from "solid-js/store"
import { createSimpleContext } from "@opencode-ai/ui/context"

type DialogElement = JSX.Element | (() => JSX.Element)

export const { use: useDialog, provider: DialogProvider } = createSimpleContext({
  name: "Dialog",
  init: () => {
    const [store, setStore] = createStore({
      stack: [] as {
        element: DialogElement
        onClose?: () => void
      }[],
    })

    return {
      get stack() {
        return store.stack
      },
      push(element: DialogElement, onClose?: () => void) {
        setStore("stack", (s) => [...s, { element, onClose }])
      },
      pop() {
        const current = store.stack.at(-1)
        current?.onClose?.()
        setStore("stack", store.stack.slice(0, -1))
      },
      replace(element: DialogElement, onClose?: () => void) {
        for (const item of store.stack) {
          item.onClose?.()
        }
        setStore("stack", [{ element, onClose }])
      },
      clear() {
        for (const item of store.stack) {
          item.onClose?.()
        }
        setStore("stack", [])
      },
    }
  },
})

import { Dialog as Kobalte } from "@kobalte/core/dialog"

export function DialogRoot(props: { children?: JSX.Element }) {
  const dialog = useDialog()
  return (
    <>
      {props.children}
      <Show when={dialog.stack.length > 0}>
        <div data-component="dialog-stack">
          <For each={dialog.stack}>
            {(item, index) => (
              <Show when={index() === dialog.stack.length - 1}>
                <Kobalte
                  modal
                  defaultOpen
                  onOpenChange={(open) => {
                    if (!open) {
                      item.onClose?.()
                      dialog.pop()
                    }
                  }}
                >
                  <Kobalte.Portal>
                    <Kobalte.Overlay data-component="dialog-overlay" />
                    {typeof item.element === "function" ? item.element() : item.element}
                  </Kobalte.Portal>
                </Kobalte>
              </Show>
            )}
          </For>
        </div>
      </Show>
    </>
  )
}
