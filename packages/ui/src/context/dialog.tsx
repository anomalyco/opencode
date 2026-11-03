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

type FocusReturn = { element: HTMLElement; visible: boolean; range?: Range }

type Active = {
  id: string
  node: JSX.Element
  dispose: () => void
  owner: Owner
  onClose?: () => void
  setClosing: (closing: boolean) => void
  /** How long the dialog stays mounted once it starts closing, so its exit animation can finish. */
  exit: () => number
  /** Where focus was before this dialog opened, or before the dialogs it replaced opened. */
  focus?: FocusReturn
  returnFocus: () => void
}

const Context = createContext<ReturnType<typeof init>>()

// Lets the dialog rendered in a layer opt out of closing on a backdrop click, or ask for a longer exit animation. A
// contained layer also says which element holds it, so presses outside that element leave the dialog open.
const LayerContext = createContext<{
  setBackdropDismiss: (value: boolean) => void
  setExitDuration: (ms: number) => void
  container?: HTMLElement
}>()

export function useDialogLayer() {
  return useContext(LayerContext)
}

function init(container: () => HTMLElement | undefined) {
  const [stack, setStack] = createSignal<Active[]>([])
  // A dialog is closing from the moment its close starts until its exit animation ends and it is disposed.
  const closing = new Map<string, ReturnType<typeof setTimeout> | undefined>()
  // The same ids, reactive, so the top dialog that stays open owns the focus trap during an exit animation.
  const [exiting, setExiting] = createSignal<ReadonlySet<string>>(new Set())
  // The top dialog that stays open. A dialog without an exit animation leaves the DOM as soon as it starts closing, so
  // it stops being the active dialog then, not when it is disposed.
  const top = () => stack().findLast((item) => !exiting().has(item.id))
  const lock = { value: false }
  const state = { disposed: false }

  // Detach the stack before disposing, so cleanups that close dialogs find nothing to admit. Every dialog is
  // drained even when one throws. A replaced dialog that was not already closing still hears onClose.
  const disposeAll = (notify: boolean) => {
    const items = stack()
    const exited = new Set(closing.keys())
    setStack([])
    closing.forEach((timer) => clearTimeout(timer))
    closing.clear()
    setExiting(new Set<string>())
    items.forEach((item) => {
      if (notify && !exited.has(item.id)) isolate(() => item.onClose?.())
      isolate(item.dispose)
    })
  }

  onCleanup(() => {
    state.disposed = true
    disposeAll(false)
  })

  const finish = (current: Active) => {
    // Scheduled first, so the dialog still goes away when a callback throws.
    closing.set(
      current.id,
      setTimeout(() => {
        closing.delete(current.id)

        if (closing.size === 0) lock.value = false
        setExiting((ids) => new Set([...ids].filter((id) => id !== current.id)))
        setStack((items) => items.filter((item) => item.id !== current.id))
        current.dispose()
      }, current.exit()),
    )
    setExiting((ids) => new Set([...ids, current.id]))
    isolate(() => current.onClose?.())
    current.setClosing(true)

    // Only the top open dialog holds focus. It returns before close() does, as a native dialog's does, so an
    // action that runs after closing, such as a palette command that opens the terminal, can move it on.
    if (stack().findLast((item) => item === current || !closing.has(item.id)) === current) current.returnFocus()
  }

  /** Programmatic close. Without an id it closes the top dialog, one at a time; with an id it never waits. */
  const close = (id?: string) => {
    const current = id ? stack().find((item) => item.id === id) : stack().at(-1)

    if (!current || closing.has(current.id) || (!id && lock.value)) return
    closing.set(current.id, undefined)
    lock.value = true
    finish(current)
  }

  /** Escape, a backdrop click, or Kobalte dismissing: only the top dialog, and one per exit animation. */
  const dismiss = (id?: string) => {
    const current = stack().at(-1)

    if (!current || (id && current.id !== id) || closing.has(current.id) || lock.value) return
    closing.set(current.id, undefined)
    lock.value = true
    finish(current)
  }

  createEffect(() => {
    if (stack().length === 0) return

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return

      // Escape in the page around a contained stack belongs to the page.
      const within = container()

      if (within && event.target instanceof Node && !within.contains(event.target)) return

      // A control that cancels its own edit on Escape, such as an inline rename, keeps the dialog open.
      if (event.target instanceof Element && event.target.closest("[data-owns-escape]")) return
      dismiss()
      event.preventDefault()
      event.stopPropagation()
    }

    makeEventListener(window, "keydown", onKeyDown, { capture: true })
  })

  const mount = (
    element: DialogElement,
    owner: Owner,
    onClose: (() => void) | undefined,
    key: string | undefined,
    focus: FocusReturn | undefined,
  ) => {
    // A deferred open (e.g. from a focus callback) must not mount after the provider is gone.
    if (state.disposed) return
    const id = key ?? Math.random().toString(36).slice(2)

    // The layer follows the dialog's current place in the stack, so a new top dialog always renders above.
    const layer = () =>
      Math.max(
        0,
        stack().findIndex((item) => item.id === id),
      )

    const zIndex = () => String(50 + layer() * 10)
    // A function, not an inline `&&`: the compiler wraps an inline condition in a memo on every read of the prop, and
    // Kobalte reads it outside any owner, from outside-pointer handlers and while the closing dialog unmounts.
    const modal = () => !container() && top()?.id === id
    let dispose: (() => void) | undefined
    let setClosing: ((closing: boolean) => void) | undefined
    let layerRef: HTMLDivElement | undefined
    let exit = 100

    // Stacked dialogs render as sibling portals, so only the top layer may own the focus trap.
    const node = runWithOwner(owner, () =>
      createRoot((d: () => void) => {
        dispose = d
        const [closing, setClosingSignal] = createSignal(false)
        const [backdropDismiss, setBackdropDismiss] = createSignal(true)
        setClosing = setClosingSignal

        return (
          <Kobalte
            modal={modal()}
            open={!closing()}
            onOpenChange={(open: boolean) => {
              if (!open) dismiss(id)
            }}
          >
            <Kobalte.Portal mount={container()}>
              <Kobalte.Overlay
                data-component="dialog-overlay"
                style={{ "z-index": zIndex() }}
                onClick={() => {
                  if (backdropDismiss()) dismiss(id)
                }}
              />
              <div
                ref={layerRef}
                data-dialog-layer={layer()}
                style={{
                  position: "fixed",
                  inset: "0",
                  "z-index": zIndex(),
                  display: "flex",
                  "align-items": "center",
                  "justify-content": "center",
                  "pointer-events": "none",
                }}
              >
                <LayerContext.Provider
                  value={{ setBackdropDismiss, setExitDuration: (ms) => (exit = ms), container: container() }}
                >
                  {element()}
                </LayerContext.Provider>
              </div>
            </Kobalte.Portal>
          </Kobalte>
        )
      }),
    )

    if (!dispose || !setClosing) return

    const active: Active = {
      id,
      node,
      dispose,
      owner,
      onClose,
      setClosing,
      exit: () => exit,
      focus,
      returnFocus: () => {
        // A close inside a reactive update unmounts the dialog, and its focus trap, only when the update ends.
        if (layerRef?.contains(document.activeElement)) return queueMicrotask(() => returnFocus(focus, layerRef))
        returnFocus(focus, layerRef)
      },
    }

    setStack((items) => [...items, active])
  }

  const push = (element: DialogElement, owner: Owner, onClose?: () => void, id?: string) => {
    lock.value = false
    mount(element, owner, onClose, id, captureFocus())
  }

  const show = (element: DialogElement, owner: Owner, onClose?: () => void, id?: string) => {
    // A replacement returns focus to where the dialogs it replaces would have, not to their now-removed content.
    const focus = stack().length > 0 ? stack()[0].focus : captureFocus()
    disposeAll(true)
    lock.value = false
    mount(element, owner, onClose, id, focus)
  }

  return {
    stack,
    top,
    close,
    show,
    push,
  }
}

/** Runs a dialog callback so its throw is reported without stopping the caller's cleanup. */
function isolate(fn: () => void) {
  try {
    fn()
  } catch (error) {
    console.error("[dialog]", error)
  }
}

/** Remembers the focused element and, in editable content, the caret, which focusing alone does not restore. */
function captureFocus(): FocusReturn | undefined {
  const element = document.activeElement

  if (!(element instanceof HTMLElement) || element === document.body) return
  const selection = document.getSelection()
  // Closing with Escape counts as keyboard use, so Chromium would ring a control the pointer had focused.
  const visible = element.matches(":focus-visible")

  if (!element.isContentEditable || !selection?.rangeCount || !element.contains(selection.anchorNode)) {
    return { element, visible }
  }

  return { element, visible, range: selection.getRangeAt(0).cloneRange() }
}

/** Kobalte only returns focus to a dialog trigger, and these dialogs open without one. */
function returnFocus(focus: FocusReturn | undefined, layer: HTMLElement | undefined) {
  const active = document.activeElement

  if (!focus?.element.isConnected) return

  // Something outside the closed dialog already has focus, for example because the dialog's onClose moved it.
  if (active && active !== document.body && !layer?.contains(active)) return
  focus.element.focus({ preventScroll: true, focusVisible: focus.visible })

  if (!focus.range || !focus.element.contains(focus.range.commonAncestorContainer)) return
  const selection = document.getSelection()
  selection?.removeAllRanges()
  selection?.addRange(focus.range)
}

/**
 * `container` keeps the dialogs inside one element, as a component preview does: they render in it, non-modal, and the
 * page around it stays usable. The element must be a containing block for fixed positioning (e.g. `contain: layout`).
 */
export function DialogProvider(props: ParentProps<{ container?: HTMLElement }>) {
  const ctx = init(() => props.container)

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
    /** The top dialog that is open. One that has started closing no longer counts, though it waits to be disposed. */
    get active() {
      return ctx.top()
    },
    /**
     * id lets the caller close this dialog later rather than whichever is on top. Opening is deferred; once
     * signal aborts, the open neither mounts nor replaces anything and onClose runs as for a replaced dialog.
     */
    show(element: DialogElement, onClose?: () => void, id?: string, signal?: AbortSignal) {
      const base = ctx.stack().at(-1)?.owner ?? owner

      return startTransition(() => {
        if (signal?.aborted) return isolate(() => onClose?.())
        ctx.show(element, base, onClose, id)
      })
    },
    push(element: DialogElement, onClose?: () => void, id?: string, signal?: AbortSignal) {
      const base = ctx.stack().at(-1)?.owner ?? owner

      return startTransition(() => {
        if (signal?.aborted) return isolate(() => onClose?.())
        ctx.push(element, base, onClose, id)
      })
    },
    close(id?: string) {
      ctx.close(id)
    },
  }
}
