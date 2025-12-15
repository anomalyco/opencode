import {
  createContext,
  createEffect,
  createMemo,
  createSignal,
  For,
  getOwner,
  Owner,
  ParentProps,
  runWithOwner,
  Show,
  useContext,
  type JSX,
} from "solid-js"
import { Dialog as Kobalte } from "@kobalte/core/dialog"
import { iife } from "@opencode-ai/util/iife"

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

  const result = {
    get stack() {
      return store()
    },
    pop() {
      const current = store().at(-1)
      if (!current) return
      current?.onClose?.()
      setStore((stack) => {
        stack.pop()
        return [...stack]
      })
    },
    replace(element: DialogElement, owner: Owner, onClose?: () => void) {
      for (const item of store()) {
        item.onClose?.()
      }
      setStore([
        {
          element: () =>
            runWithOwner(owner, () => (
              <Show when={result.stack.at(-1)?.owner === owner}>
                <Kobalte
                  modal
                  defaultOpen
                  onOpenChange={(open) => {
                    if (!open) {
                      onClose?.()
                      result.pop()
                    }
                  }}
                >
                  <Kobalte.Portal>
                    <Kobalte.Overlay data-component="dialog-overlay" />
                    {element()}
                  </Kobalte.Portal>
                </Kobalte>
              </Show>
            )),
          onClose,
          owner,
        },
      ])
    },
    clear() {
      for (const item of store()) {
        item.onClose?.()
      }
      setStore([])
    },
  }
  return result
}

export function DialogProvider(props: ParentProps) {
  const ctx = init()
  return (
    <Context.Provider value={ctx}>
      {props.children}
      <div data-component="dialog-stack">
        <For each={ctx.stack}>{(item) => <>{item.element()}</>}</For>
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
    pop() {
      ctx.pop()
    },
    clear() {
      ctx.clear()
    },
  }
}
