import {
  type Accessor,
  createContext,
  createEffect,
  createMemo,
  createRoot,
  createSignal,
  getOwner,
  onCleanup,
  type Owner,
  type ParentProps,
  runWithOwner,
  untrack,
  useContext,
  type JSX,
  startTransition,
  For,
} from "solid-js"
import { Dialog as Kobalte } from "@kobalte/core/dialog"
import { makeEventListener } from "@solid-primitives/event-listener"
import { uuid } from "@opencode/util/uuid"
import {
  createDialogStackState,
  selectLayerClosing,
  selectLayerIndex,
  selectLayerModal,
  selectTopDialog,
  transitionDialogStack,
  type DialogStackEffect,
  type DialogStackEvent,
} from "./dialog-machine"

type DialogElement = () => JSX.Element

export type FocusReturn = { element: HTMLElement; visible: boolean; range?: Range }

/** What an open mounts: its content, the owner it renders under, and who hears that it closed. */
type DialogRequest = { element: DialogElement; owner: Owner; onClose?: () => void }

type Layer = {
  attempt: number
  node: JSX.Element
  owner: Owner
  onClose?: () => void
  dispose: () => void
  ref: () => HTMLDivElement | undefined
}

const Context = createContext<ReturnType<typeof init>>()

// Lets the dialog rendered in a layer opt out of closing on a backdrop click, or ask for a longer exit animation. A
// contained layer also says which element holds it, so presses outside that element leave the dialog open.
const LayerContext = createContext<{
  readonly id: string
  /** This layer's mount, which a `close()` from inside it targets. */
  readonly attempt: number
  /** True from the moment this dialog starts closing, through its exit animation. */
  readonly closing: Accessor<boolean>
  setBackdropDismiss: (value: boolean) => void
  setExitDuration: (ms: number) => void
  container?: HTMLElement
}>()

export function useDialogLayer() {
  return useContext(LayerContext)
}

function init(container: () => HTMLElement | undefined) {
  const [machine, setMachine] = createSignal(createDialogStackState<FocusReturn>())
  const [layers, setLayers] = createSignal<Layer[]>([])
  const timers = new Map<number, ReturnType<typeof setTimeout>>()
  // Events an effect raises synchronously (a dialog closing as it renders or disposes) wait behind it.
  const queue: DialogStackEvent<FocusReturn, DialogRequest>[] = []

  const dispatch = (event: DialogStackEvent<FocusReturn, DialogRequest>) => {
    queue.push(event)

    if (queue.length === 1) untrack(drain)
  }

  const drain = () => {
    const event = queue[0]

    if (!event) return

    try {
      const prev = machine()
      const next = transitionDialogStack(prev, event)

      // Committed before the effects, so a closing layer's Kobalte dialog has closed by the time focus returns. A reader
      // of the state or an effect that throws must not stop the queue or skip the other effects.
      if (next.state !== prev) isolate(() => setMachine(next.state))
      next.effects.forEach((effect) => isolate(() => run(effect)))
    } finally {
      queue.shift()
      drain()
    }
  }

  const run = (effect: DialogStackEffect<FocusReturn, DialogRequest>) => {
    if (effect.type === "mount") return mount(effect)

    if (effect.type === "discard") return void (effect.notify && effect.request.onClose?.())

    if (effect.type === "timer.start") {
      clearTimeout(timers.get(effect.attempt))
      timers.set(
        effect.attempt,
        setTimeout(() => dispatch({ type: "exit.completed", attempt: effect.attempt }), effect.delayMs),
      )

      return
    }

    if (effect.type === "timer.stop") {
      clearTimeout(timers.get(effect.attempt))
      timers.delete(effect.attempt)

      return
    }

    const layer = layers().find((item) => item.attempt === effect.attempt)

    if (effect.type === "notify.close") return layer?.onClose?.()

    if (effect.type === "focus.return") {
      const ref = layer?.ref()

      // A close inside a reactive update unmounts the dialog, and its focus trap, only when the update ends.
      if (ref?.contains(document.activeElement)) return queueMicrotask(() => returnFocus(effect.focus, ref))

      return returnFocus(effect.focus, ref)
    }

    timers.delete(effect.attempt)
    setLayers((items) => items.filter((item) => item.attempt !== effect.attempt))

    if (effect.notify) isolate(() => layer?.onClose?.())
    layer?.dispose()
  }

  onCleanup(() => dispatch({ type: "disposed" }))

  // Escape is captured only while a dialog is open, not while the last one plays its exit animation.
  const open = createMemo(() => !!selectTopDialog(machine()))

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Escape") return

    // Escape in the page around a contained stack belongs to the page.
    const within = container()

    if (within && event.target instanceof Node && !within.contains(event.target)) return

    // A control that cancels its own edit on Escape, such as an inline rename, keeps the dialog open.
    if (event.target instanceof Element && event.target.closest("[data-owns-escape]")) return
    dispatch({ type: "dismiss" })
    event.preventDefault()
    event.stopPropagation()
  }

  createEffect(() => {
    if (!open()) return

    makeEventListener(window, "keydown", onKeyDown, { capture: true })
  })

  const mount = (effect: Extract<DialogStackEffect<FocusReturn, DialogRequest>, { type: "mount" }>) => {
    const attempt = effect.attempt
    const zIndex = () => String(50 + selectLayerIndex(machine(), attempt) * 10)
    // A function, not an inline `&&`: the compiler wraps an inline condition in a memo on every read of the prop, and
    // Kobalte reads it outside any owner, from outside-pointer handlers and while the closing dialog unmounts.
    const modal = () => selectLayerModal(machine(), attempt, !!container())
    let ref: HTMLDivElement | undefined
    let dispose = () => {}

    const node = runWithOwner(effect.request.owner, () =>
      createRoot((d: () => void) => {
        dispose = d
        const closing = createMemo(() => selectLayerClosing(machine(), attempt))

        return (
          <Kobalte
            modal={modal()}
            open={!closing()}
            onOpenChange={(open: boolean) => {
              if (!open) dispatch({ type: "layer.dismiss", attempt })
            }}
          >
            <Kobalte.Portal mount={container()}>
              <Kobalte.Overlay
                data-component="dialog-overlay"
                style={{ "z-index": zIndex() }}
                onClick={() => dispatch({ type: "backdrop.click", attempt })}
              />
              <div
                ref={ref}
                data-dialog-layer={selectLayerIndex(machine(), attempt)}
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
                  value={{
                    id: effect.id,
                    attempt,
                    closing,
                    setBackdropDismiss: (enabled) => dispatch({ type: "layer.backdrop-dismiss", attempt, enabled }),
                    setExitDuration: (exitMs) => dispatch({ type: "layer.exit-duration", attempt, exitMs }),
                    container: container(),
                  }}
                >
                  {effect.request.element()}
                </LayerContext.Provider>
              </div>
            </Kobalte.Portal>
          </Kobalte>
        )
      }),
    )

    setLayers((items) => [
      ...items,
      {
        attempt,
        node,
        owner: effect.request.owner,
        onClose: effect.request.onClose,
        dispose,
        ref: () => ref,
      },
    ])
  }

  return {
    dispatch,
    active: () => selectTopDialog(machine()),
    /** Stacked dialogs render under the owner of the dialog below, so they see the same context. */
    base: () => layers().at(-1)?.owner,
    open: (mode: "show" | "push", request: DialogRequest, id: string | undefined, aborted: boolean) =>
      dispatch({ type: "open", mode, id: id ?? uuid(), aborted, focus: captureFocus(), request }),
    layers,
  }
}

/** Runs a dialog callback so its throw is reported without stopping the caller's cleanup. */
function isolate(fn: () => void) {
  void Promise.try(fn).catch((cause: unknown) => console.error("[dialog]", cause))
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
        <For each={ctx.layers()}>{(item) => item.node}</For>
      </div>
    </Context.Provider>
  )
}

export function useDialog() {
  const ctx = useContext(Context)
  const layer = useContext(LayerContext)
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
      return ctx.active()
    },
    /** Inside a dialog, true from the moment that dialog starts closing; outside every dialog, false. */
    get closing() {
      return layer?.closing() ?? false
    },
    /**
     * id lets the caller close this dialog later rather than whichever is on top. Opening is deferred; once
     * signal aborts, the open neither mounts nor replaces anything and onClose runs as for a replaced dialog.
     */
    show(element: DialogElement, onClose?: () => void, id?: string, signal?: AbortSignal) {
      const base = ctx.base() ?? owner

      return startTransition(() => ctx.open("show", { element, owner: base, onClose }, id, !!signal?.aborted))
    },
    push(element: DialogElement, onClose?: () => void, id?: string, signal?: AbortSignal) {
      const base = ctx.base() ?? owner

      return startTransition(() => ctx.open("push", { element, owner: base, onClose }, id, !!signal?.aborted))
    },
    /**
     * Programmatic close. With an id it closes that dialog at once. Without one, called inside a dialog, it closes that
     * dialog; outside every dialog it closes the top one. Either way one at a time, so a double click closes one dialog.
     */
    close(id?: string) {
      ctx.dispatch({ type: "close", id, layer: layer?.attempt })
    },
    /** Dismisses the top open dialog, as Escape does; with an id, only while that dialog is on top. */
    dismiss(id?: string) {
      ctx.dispatch({ type: "dismiss", id })
    },
  }
}
