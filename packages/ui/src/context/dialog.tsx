import {
  createContext,
  createRoot,
  createSignal,
  getOwner,
  type Owner,
  type ParentProps,
  runWithOwner,
  useContext,
  type JSX,
} from "solid-js"
import { Dialog as Kobalte } from "@kobalte/core/dialog"

type DialogElement = () => JSX.Element

type Active = {
  id: string
  node: JSX.Element
  dispose: () => void
  owner: Owner
  onClose?: () => void
}

const Context = createContext<ReturnType<typeof init>>()

function init() {
  const [active, setActive] = createSignal<Active | undefined>()

  const close = () => {
    const current = active()
    if (!current) return
    current.onClose?.()
    current.dispose()
    setActive(undefined)
  }

  const show = (element: DialogElement, owner: Owner, onClose?: () => void) => {
    close()

    const id = Math.random().toString(36).slice(2)
    let dispose: (() => void) | undefined

    const node = runWithOwner(owner, () =>
      createRoot((d) => {
        dispose = d
        return (
          <Kobalte
            modal
            open={true}
            onOpenChange={(open) => {
              if (open) return
              close()
            }}
          >
            <Kobalte.Portal>
              <Kobalte.Overlay data-component="dialog-overlay" />
              {element()}
            </Kobalte.Portal>
          </Kobalte>
        )
      }),
    )

    if (!dispose) return

    setActive({ id, node, dispose, owner, onClose })
  }

  return {
    get active() {
      return active()
    },
    close,
    show,
  }
}

export function DialogProvider(props: ParentProps) {
  const ctx = init()
  return (
    <Context.Provider value={ctx}>
      {props.children}
      <div data-component="dialog-stack">{ctx.active?.node}</div>
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
      const base = ctx.active?.owner ?? owner
      ctx.show(element, base, onClose)
    },
    close() {
      ctx.close()
    },
  }
}
