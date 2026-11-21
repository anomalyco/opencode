import { observeElementOffset, type Virtualizer } from "@tanstack/solid-virtual"
import {
  createReconnectState,
  DISPOSED_RECONNECT_EVENT,
  isReconnectObserverActive,
  transitionReconnect,
  type ReconnectEffect,
  type ReconnectEvent,
} from "./reconnect-machine"

export function observeElementOffsetReconnectAware<TScrollElement extends Element, TItemElement extends Element>(
  instance: Virtualizer<TScrollElement, TItemElement>,
  callback: (offset: number, isScrolling: boolean) => void,
  onReconnect?: () => void,
) {
  const element = instance.scrollElement
  let state = createReconnectState(!!element?.isConnected)
  let frame: number | undefined

  // TanStack resets isScrolling on a timer that reports the offset of the last scroll event. A virtualizer
  // write since then (prepend anchoring, size compensation) may not have dispatched its scroll event yet, and
  // compensating from that stale offset would undo the write, so a settled scroll reads the live scrollTop
  // (vertical only, like the reconnect check below).
  const deliver = (offset: number, isScrolling: boolean) => {
    if (!isReconnectObserverActive(state)) return
    callback(isScrolling || !element?.isConnected ? offset : element.scrollTop, isScrolling)
  }

  const cleanupOffset = observeElementOffset(instance, deliver)
  const targetWindow = instance.targetWindow
  const root = element?.closest("main") ?? element?.ownerDocument.body

  if (!element || !targetWindow || !root)
    return () => {
      state = transitionReconnect(state, DISPOSED_RECONNECT_EVENT).state
      cleanupOffset?.()
    }

  const dispatch = (event: ReconnectEvent) => {
    const next = transitionReconnect(state, event)
    state = next.state
    next.effects.forEach(run)
  }

  const run = (effect: ReconnectEffect) => {
    if (effect.type === "reconnected") return onReconnect?.()

    if (effect.type === "offset.deliver") return deliver(effect.offset, false)

    if (frame !== undefined) targetWindow.cancelAnimationFrame(frame)
    frame = undefined

    if (effect.type === "frame.cancel") return
    const attempt = effect.attempt
    frame = targetWindow.requestAnimationFrame((time) => {
      frame = undefined
      dispatch({
        type: "frame",
        attempt,
        time,
        connected: element.isConnected,
        nativeTop: element.scrollTop,
        virtualOffset: instance.scrollOffset,
      })
    })
  }

  const observer = new targetWindow.MutationObserver((records) => {
    if (!isReconnectObserverActive(state)) return
    const connected = element.isConnected

    // A detached view stays detached until it is back in the document, whatever else the page changes.
    if (!connected && state.status === "detached") return
    const added = connected && state.status !== "detached" && reattached(records, element)

    if (connected && state.status !== "detached" && !added) return
    dispatch({
      type: "mutated",
      connected,
      added,
      deadline: targetWindow.performance.now() + instance.options.isScrollingResetDelay,
    })
  })

  // Session routes are replaced below persistent main; body is the fallback for isolated hosts.
  observer.observe(root, { childList: true, subtree: true })

  return () => {
    observer.disconnect()
    dispatch(DISPOSED_RECONNECT_EVENT)
    cleanupOffset?.()
  }
}

// Whether a record outside the element inserted it or one of its ancestors: a move within the page.
function reattached(records: MutationRecord[], element: Element) {
  for (const record of records) {
    if (record.target === element || element.contains(record.target)) continue

    for (const node of record.addedNodes) {
      if (node === element || node.contains(element)) return true
    }
  }

  return false
}
