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
  startTransition,
  For,
} from "solid-js"
import { Dialog as Kobalte } from "@kobalte/core/dialog"
import { makeEventListener } from "@solid-primitives/event-listener"

type DialogElement = () => JSX.Element

type DialogStackEntry = {
  id: string
  dispose: () => void
  notifyClose: () => void
}

type Active = DialogStackEntry & {
  node: JSX.Element
  owner: Owner
  setClosing: (closing: boolean) => void
}

export type DialogHandle = {
  id: string
  close: () => void
}

const Context = createContext<ReturnType<typeof init>>()

export function createDialogCloseNotifier(onClose?: () => void) {
  let notified = false

  return () => {
    if (notified) return
    notified = true
    onClose?.()
  }
}

export function createDialogStackTransitions<T extends DialogStackEntry>(onChange?: (items: T[]) => void) {
  let stack: T[] = []
  let locked = false
  const publish = () => onChange?.(stack)

  const close = (id?: string) => {
    const current = id ? stack.find((item) => item.id === id) : stack.at(-1)
    if (!current || locked) return
    locked = true
    current.notifyClose()
    return current
  }

  const handle = (item: T): DialogHandle => ({ id: item.id, close: () => close(item.id) })

  return {
    stack: () => stack,
    close,
    push: (create: (layer: number) => T) => {
      const item = create(stack.length)
      stack = [...stack, item]
      publish()
      return handle(item)
    },
    show: (create: (layer: number) => T) => {
      for (const item of stack) {
        item.notifyClose()
        item.dispose()
      }
      locked = false
      const item = create(0)
      stack = [item]
      publish()
      return handle(item)
    },
    remove: (id: string) => {
      stack = stack.filter((item) => item.id !== id)
      locked = false
      publish()
    },
    unlock: () => {
      locked = false
    },
  }
}

function init() {
  const [stack, setStack] = createSignal<Active[]>([])
  const transitions = createDialogStackTransitions<Active>(setStack)
  const timer = { current: undefined as ReturnType<typeof setTimeout> | undefined }

  onCleanup(() => {
    if (timer.current === undefined) return
    clearTimeout(timer.current)
    timer.current = undefined
  })

  const close = (id?: string) => {
    const current = transitions.close(id)
    if (!current) return
    current.setClosing(true)

    const closed = current.id
    if (timer.current !== undefined) {
      clearTimeout(timer.current)
      timer.current = undefined
    }

    timer.current = setTimeout(() => {
      timer.current = undefined
      current.dispose()
      transitions.remove(closed)
    }, 100)
  }

  createEffect(() => {
    if (stack().length === 0) return

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return
      close()
      event.preventDefault()
      event.stopPropagation()
    }

    makeEventListener(window, "keydown", onKeyDown, { capture: true })
  })

  const mount = (element: DialogElement, owner: Owner, onClose: (() => void) | undefined, layer: number): Active => {
    const id = Math.random().toString(36).slice(2)
    const zIndex = 50 + layer * 10
    let dispose: (() => void) | undefined
    let setClosing: ((closing: boolean) => void) | undefined

    const node = runWithOwner(owner, () =>
      createRoot((d: () => void) => {
        dispose = d
        const [closing, setClosingSignal] = createSignal(false)
        setClosing = setClosingSignal
        return (
          <Kobalte
            modal={stack().at(-1)?.id === id}
            open={!closing()}
            onOpenChange={(open: boolean) => {
              if (open || stack().at(-1)?.id !== id) return
              close(id)
            }}
          >
            <Kobalte.Portal>
              <Kobalte.Overlay
                data-component="dialog-overlay"
                style={{ "z-index": String(zIndex) }}
                onClick={() => close(id)}
              />
              <div
                data-dialog-layer={layer}
                style={{
                  position: "fixed",
                  inset: "0",
                  "z-index": String(zIndex),
                  display: "flex",
                  "align-items": "center",
                  "justify-content": "center",
                  "pointer-events": "none",
                }}
              >
                {element()}
              </div>
            </Kobalte.Portal>
          </Kobalte>
        )
      }),
    )

    if (!dispose || !setClosing) throw new Error("Failed to mount dialog")

    return { id, node, dispose, owner, notifyClose: createDialogCloseNotifier(onClose), setClosing }
  }

  const push = (element: DialogElement, owner: Owner, onClose?: () => void) => {
    if (timer.current !== undefined) {
      clearTimeout(timer.current)
      timer.current = undefined
    }
    transitions.unlock()
    return transitions.push((layer) => mount(element, owner, onClose, layer))
  }

  const show = (element: DialogElement, owner: Owner, onClose?: () => void) => {
    if (timer.current !== undefined) {
      clearTimeout(timer.current)
      timer.current = undefined
    }
    return transitions.show((layer) => mount(element, owner, onClose, layer))
  }

  return {
    stack,
    close,
    show,
    push,
  }
}

export function DialogProvider(props: ParentProps) {
  const ctx = init()
  return (
    <Context.Provider value={ctx}>
      {props.children}
      <div data-component="dialog-stack">
        <For each={ctx.stack()}>{(item) => item.node}</For>
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
    get active() {
      return ctx.stack().at(-1)
    },
    show(element: DialogElement, onClose?: () => void) {
      const base = ctx.stack().at(-1)?.owner ?? owner
      return startTransition(() => ctx.show(element, base, onClose))
    },
    push(element: DialogElement, onClose?: () => void) {
      const base = ctx.stack().at(-1)?.owner ?? owner
      return ctx.push(element, base, onClose)
    },
    close() {
      ctx.close()
    },
  }
}
