import {
  createContext,
  createEffect,
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
  const [active, setActive] = createSignal<
    | {
        id: string
        element: DialogElement
        onClose?: () => void
        owner: Owner
      }
    | undefined
  >()

  const result = {
    get active() {
      return active()
    },
    close() {
      active()?.onClose?.()
      setActive(undefined)
    },
    show(element: DialogElement, owner: Owner, onClose?: () => void) {
      active()?.onClose?.()
      const id = Math.random().toString(36).slice(2)
      setActive({
        id,
        element: () =>
          runWithOwner(owner, () => (
            <Show when={active()?.id === id}>
              <Kobalte
                modal
                open={true}
                onOpenChange={(open) => {
                  if (!open) {
                    console.log("closing")
                    result.close()
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
      })
    },
  }

  return result
}

export function DialogProvider(props: ParentProps) {
  const ctx = init()
  createEffect(() => {
    console.log("active", ctx.active)
  })
  return (
    <Context.Provider value={ctx}>
      {props.children}
      <div data-component="dialog-stack">{ctx.active?.element?.()}</div>
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
    get active() {
      return ctx.active
    },
    show(element: DialogElement, onClose?: () => void) {
      ctx.show(element, owner, onClose)
    },
    close() {
      ctx.close()
    },
  }
}
