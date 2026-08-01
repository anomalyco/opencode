import { observeElementOffset, type Virtualizer } from "@tanstack/solid-virtual"

export function observeElementOffsetReconnectAware<TScrollElement extends Element, TItemElement extends Element>(
  instance: Virtualizer<TScrollElement, TItemElement>,
  callback: (offset: number, isScrolling: boolean) => void,
) {
  let active = true
  const deliver = (offset: number, isScrolling: boolean) => {
    if (!active) return
    callback(offset, isScrolling)
  }
  const cleanupOffset = observeElementOffset(instance, deliver)
  const element = instance.scrollElement
  const targetWindow = instance.targetWindow
  const root = element?.closest("main") ?? element?.ownerDocument.body
  if (!element || !targetWindow || !root)
    return () => {
      active = false
      cleanupOffset?.()
    }

  let removed = false
  let frame: number | undefined
  let reconnectFrame: number | undefined
  const clearCheck = () => {
    if (frame === undefined) return
    targetWindow.cancelAnimationFrame(frame)
    frame = undefined
  }
  const clearReconnect = () => {
    if (reconnectFrame === undefined) return
    targetWindow.cancelAnimationFrame(reconnectFrame)
    reconnectFrame = undefined
  }
  const startCheck = () => {
    clearCheck()
    const deadline = targetWindow.performance.now() + instance.options.isScrollingResetDelay
    let framesAfterDeadline = 0
    const check = (time: number) => {
      frame = undefined
      if (element.isConnected) {
        const offset = instance.options.horizontal
          ? element.scrollLeft * (instance.options.isRtl ? -1 : 1)
          : element.scrollTop
        if (instance.scrollOffset === null || Math.abs(offset - instance.scrollOffset) > 1) deliver(offset, false)
      }
      if (time >= deadline) framesAfterDeadline += 1
      if (framesAfterDeadline >= 2) return
      frame = targetWindow.requestAnimationFrame(check)
    }
    frame = targetWindow.requestAnimationFrame(check)
  }
  const reconcileReconnect = () => {
    reconnectFrame = undefined
    if (!removed || !element.isConnected) return
    removed = false
    startCheck()
  }
  const scheduleReconnect = () => {
    if (reconnectFrame !== undefined) return
    reconnectFrame = targetWindow.requestAnimationFrame(reconcileReconnect)
  }
  const observer = new targetWindow.MutationObserver((records) => {
    if (!active) return

    let relevant = false
    for (const record of records) {
      if (record.target === element || element.contains(record.target)) continue
      if (mutationNodesContainElement(record.removedNodes, element)) {
        removed = true
        clearCheck()
        relevant = true
      }
      if (mutationNodesContainElement(record.addedNodes, element)) relevant = true
    }

    // HappyDOM and browsers may report a synchronous move in one batch, split it
    // across callbacks, or expose addition before removal. Reconcile after mutation
    // delivery and rely on the element's final connection state instead of record order.
    if (relevant) scheduleReconnect()
  })
  // Session routes are replaced below persistent main; body is the fallback for isolated hosts.
  observer.observe(root, { childList: true, subtree: true })

  return () => {
    active = false
    observer.disconnect()
    clearReconnect()
    clearCheck()
    cleanupOffset?.()
  }
}

export function mutationNodesContainElement(nodes: Iterable<Node>, element: Element) {
  return [...nodes].some((node) => node === element || node.contains(element))
}
