import {
  createContext,
  createMemo,
  createSignal,
  getOwner,
  Owner,
  ParentProps,
  runWithOwner,
  Show,
  useContext,
  type JSX,
} from "solid-js"
import { Dialog as Kobalte } from "@kobalte/core/dialog"

type DialogElement = () => JSX.Element

const Context = createContext<ReturnType<typeof init>>()

function init() {
  const [store, setStore] = createSignal<
    {
      element: DialogElement
      onClose?: () => void
      owner: Owner
    }[]
  >([])

  return {
    get stack() {
      return store()
    },
    push(element: DialogElement, owner: Owner, onClose?: () => void) {
      setStore((s) => [...s, { element, onClose, owner }])
    },
    pop() {
      const current = store().at(-1)
      current?.onClose?.()
      setStore((stack) => stack.slice(0, -1))
    },
    replace(element: DialogElement, owner: Owner, onClose?: () => void) {
      for (const item of store()) {
        item.onClose?.()
      }
      setStore([{ element, onClose, owner }])
    },
    clear() {
      for (const item of store()) {
        item.onClose?.()
      }
      setStore([])
    },
  }
}

export function DialogProvider(props: ParentProps) {
  const ctx = init()
  const last = createMemo(() => ctx.stack.at(-1))
  return (
    <Context.Provider value={ctx}>
      {props.children}
      <div data-component="dialog-stack">
        <Show when={last()}>
          {(item) =>
            runWithOwner(item().owner, () => {
              return (
                <Kobalte
                  modal
                  defaultOpen
                  onOpenChange={(open) => {
                    if (!open) {
                      item().onClose?.()
                      ctx.pop()
                    }
                  }}
                >
                  <Kobalte.Portal>
                    <Kobalte.Overlay data-component="dialog-overlay" />
                    {item().element()}
                  </Kobalte.Portal>
                </Kobalte>
              )
            })
          }
        </Show>
      </div>
    </Context.Provider>
  )
}

export function useDialog() {
  const ctx = useContext(Context)
  const owner = getOwner()
  if (!owner) {
    throw new Error("useDialog must be used within a DialogProvider")
  }
  if (!ctx) {
    throw new Error("useDialog must be used within a DialogProvider")
  }
  return {
    get stack() {
      return ctx.stack
    },
    replace(element: DialogElement, onClose?: () => void) {
      ctx.replace(element, owner, onClose)
    },
    push(element: DialogElement, onClose?: () => void) {
      ctx.push(element, owner, onClose)
    },
    pop() {
      ctx.pop()
    },
    clear() {
      ctx.clear()
    },
  }
}
