import { createComputed, createMemo, createSignal, on, onCleanup, onMount, untrack } from "solid-js"
import {
  createDisclosureState,
  transitionDisclosure,
  viewDisclosure,
  type DisclosureEffect,
  type DisclosureEvent,
  type DisclosureQueue,
} from "./disclosure-machine"

const deferredMounts: Array<() => void> = []

let deferredFrame: number | undefined

function flushDeferredMounts() {
  // Timeline tools are mounted top-to-bottom, but the viewport starts at the latest turn.
  // Pop from the end so heavy default-open bodies near the bottom become interactive first.
  const mount = deferredMounts.pop()
  deferredFrame = deferredMounts.length > 0 ? requestAnimationFrame(flushDeferredMounts) : undefined
  mount?.()
}

function scheduleDeferredMount(mount: () => void) {
  deferredMounts.push(mount)

  if (deferredFrame === undefined)
    deferredFrame = requestAnimationFrame(() => {
      deferredFrame = requestAnimationFrame(flushDeferredMounts)
    })

  return () => {
    const index = deferredMounts.indexOf(mount)

    if (index >= 0) deferredMounts.splice(index, 1)

    if (deferredMounts.length > 0 || deferredFrame === undefined) return
    cancelAnimationFrame(deferredFrame)
    deferredFrame = undefined
  }
}

function scheduleFrameMount(mount: () => void) {
  const frame = requestAnimationFrame(mount)

  return () => cancelAnimationFrame(frame)
}

/**
 * Open state for a collapsible body, controlled when `open` returns a boolean and uncontrolled otherwise. An
 * uncontrolled one follows `defaultOpen` until the user toggles it. With `defer`, the body mounts a frame after it opens.
 */
export function createDisclosure(options: {
  open?: () => boolean | undefined
  defaultOpen?: () => boolean
  forceOpen?: () => boolean
  defer?: () => boolean
  /** How a body that starts open and deferred waits for its first frame. */
  queue?: DisclosureQueue
  locked?: () => boolean
  pending?: () => boolean
  allowOpenWhilePending?: () => boolean
  onOpenChange?: (open: boolean) => void
}) {
  const props = () => ({
    open: options.open?.(),
    defaultOpen: options.defaultOpen?.() ?? false,
    forceOpen: options.forceOpen?.() ?? false,
    defer: options.defer?.() ?? false,
  })

  const capabilities = () => ({
    locked: options.locked?.() ?? false,
    pending: options.pending?.() ?? false,
    allowOpenWhilePending: options.allowOpenWhilePending?.() ?? false,
  })

  const initial = createDisclosureState(untrack(props), options.queue ?? "frame")
  const [state, setState] = createSignal(initial.state)
  const cancels = new Map<number, () => void>()

  const dispatch = (event: DisclosureEvent) => {
    const next = transitionDisclosure(untrack(state), event)

    if (next.state !== untrack(state)) setState(next.state)
    next.effects.forEach(run)
  }

  const run = (effect: DisclosureEffect) => {
    if (effect.type === "notify") return options.onOpenChange?.(effect.open)

    if (effect.type === "cancel-mount") {
      cancels.get(effect.attempt)?.()
      cancels.delete(effect.attempt)

      return
    }

    const ready = () => {
      cancels.delete(effect.attempt)
      dispatch({ type: "mount.ready", attempt: effect.attempt })
    }

    cancels.set(effect.attempt, (effect.queue === "deferred" ? scheduleDeferredMount : scheduleFrameMount)(ready))
  }

  // Synchronous, so a closed body never renders as mounted for a pass.
  createComputed(on(props, (value) => dispatch({ type: "props.sync", props: value }), { defer: true }))
  onMount(() => initial.effects.forEach(run))
  onCleanup(() => dispatch({ type: "disposed" }))

  const view = createMemo(() => viewDisclosure(state(), capabilities()))
  const open = () => view().open

  const setOpen = (value: boolean) =>
    dispatch({
      type: "toggle.requested",
      open: value,
      defer: untrack(props).defer,
      capabilities: untrack(capabilities),
    })

  return {
    open,
    mounted: () => view().mounted,
    canToggle: () => view().canToggle,
    setOpen,
    toggle: () => setOpen(!untrack(open)),
  }
}
