import {
  createContext,
  createEffect,
  createRoot,
  createSignal,
  getOwner,
  onCleanup,
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
  setClosing: (closing: boolean) => void
}

const Context = createContext<ReturnType<typeof init>>()

function init() {
  const [active, setActive] = createSignal<Active | undefined>()
  const [renders, setRenders] = createSignal<Record<string, JSX.Element>>({})
  let closing = false

  const close = () => {
    const current = active()
    if (!current || closing) return
    closing = true
    current.onClose?.()
    current.setClosing(true)
    setTimeout(() => {
      current.dispose()
      setActive(undefined)
      closing = false
    }, 100)
  }

  createEffect(() => {
    if (!active()) return

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return
      close()
      event.preventDefault()
      event.stopPropagation()
    }

    window.addEventListener("keydown", onKeyDown, true)
    onCleanup(() => window.removeEventListener("keydown", onKeyDown, true))
  })

  const show = (element: DialogElement, owner: Owner, onClose?: () => void) => {
    // Immediately dispose any existing dialog when showing a new one
    const current = active()
    if (current) {
      current.dispose()
      setActive(undefined)
    }
    closing = false

    const id = Math.random().toString(36).slice(2)
    let dispose: (() => void) | undefined
    let setClosing: ((closing: boolean) => void) | undefined

    const node = runWithOwner(owner, () =>
      createRoot((d: () => void) => {
        dispose = d
        const [closing, setClosingSignal] = createSignal(false)
        setClosing = setClosingSignal
        return (
          <Kobalte
            modal
            open={!closing()}
            onOpenChange={(open: boolean) => {
              if (open) return
              close()
            }}
          >
            <Kobalte.Portal>
              <Kobalte.Overlay data-component="dialog-overlay" onClick={close} />
              {element()}
            </Kobalte.Portal>
          </Kobalte>
        )
      }),
    )

    if (!dispose || !setClosing) return

    setActive({ id, node, dispose, owner, onClose, setClosing })
  }

  const render = (element: JSX.Element, id: string, owner: Owner) => {
    setRenders((renders) => ({ ...renders, [id]: element }))
    show(() => element, owner, () => {
      setRenders((renders) => {
        const { [id]: _, ...rest } = renders
        return rest
      })
    })
  }

  const isActive = (id: string) => {
    return renders()[id] !== undefined
  }

  return {
    get active() {
      return active()
    },
    isActive,
    close,
    show,
    render,
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
    isActive(id: string) {
      return ctx.isActive(id)
    },
    show(element: DialogElement, onClose?: () => void) {
      const base = ctx.active?.owner ?? owner
      ctx.show(element, base, onClose)
    },
    render(element: JSX.Element, id: string) {
      const base = ctx.active?.owner ?? owner
      ctx.render(element, id, base)
    },
    close() {
      ctx.close()
    },
  }
}
