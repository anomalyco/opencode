import { expect, test } from "bun:test"
import { Virtualizer } from "@tanstack/solid-virtual"
import { observeElementOffsetReconnectAware } from "./observe-element-offset"

test("restores a view observed before its first attachment", async () => {
  const frame = openFrame()
  const targetWindow = frame.targetWindow
  const mutations = controlledMutations(targetWindow)
  const viewport = targetWindow.document.createElement("div")
  const instance = attachedVirtualizer(viewport, { scrollOffset: 240, isScrollingResetDelay: 0 })

  const connections: boolean[] = []

  const cleanup = observeElementOffsetReconnectAware(
    instance,
    (offset) => {
      instance.scrollOffset = offset
    },
    () => connections.push(viewport.isConnected),
  )

  try {
    mutations.append(targetWindow.document.body, viewport)
    await frames(2, targetWindow)
    expect(connections).toEqual([true])
    expect(instance.scrollOffset).toBe(0)
  } finally {
    cleanup()
    frame.close()
  }
})

test("reports a divergent native offset once and ignores equal offsets and unrelated mutations", async () => {
  const frame = openFrame()
  const targetWindow = frame.targetWindow
  const mutations = controlledMutations(targetWindow)
  const route = targetWindow.document.createElement("section")
  const viewport = targetWindow.document.createElement("div")
  const unrelated = targetWindow.document.createElement("div")
  route.append(viewport)
  targetWindow.document.body.append(route)

  const instance = attachedVirtualizer(viewport, { scrollOffset: 79_400, isScrollingResetDelay: 0 })

  const calls: [number, boolean][] = []

  const cleanup = observeElementOffsetReconnectAware(instance, (offset, isScrolling) => {
    calls.push([offset, isScrolling])
    instance.scrollOffset = offset
  })

  try {
    mutations.append(targetWindow.document.body, unrelated)
    mutations.remove(unrelated)
    expect(calls).toEqual([])

    mutations.remove(route)
    mutations.append(targetWindow.document.body, route)
    await frames(2, targetWindow)
    expect(calls).toEqual([[0, false]])

    mutations.remove(route)
    mutations.append(targetWindow.document.body, route)
    await frames(2, targetWindow)
    expect(calls).toEqual([[0, false]])
  } finally {
    cleanup?.()
    frame.close()
  }
})

test("keeps checking until stale reset-delay callbacks can no longer win", async () => {
  const frame = openFrame()
  const targetWindow = frame.targetWindow
  const mutations = controlledMutations(targetWindow)
  const animation = controlledAnimationFrames(targetWindow)
  const route = targetWindow.document.createElement("section")
  const viewport = targetWindow.document.createElement("div")
  route.append(viewport)
  targetWindow.document.body.append(route)

  const instance = attachedVirtualizer(viewport, { scrollOffset: 79_400, isScrollingResetDelay: 20 })

  const calls: number[] = []

  const cleanup = observeElementOffsetReconnectAware(instance, (offset) => {
    calls.push(offset)
    instance.scrollOffset = offset
  })

  try {
    mutations.remove(route)
    mutations.append(targetWindow.document.body, route)
    animation.run(16)
    expect(instance.scrollOffset).toBe(0)

    instance.scrollOffset = 79_400
    animation.run(32)
    animation.run(48)

    expect(instance.scrollOffset).toBe(0)
    expect(calls).toEqual([0, 0])
    expect(animation.pending()).toBe(0)
  } finally {
    cleanup?.()
    frame.close()
  }
})

test("settles on the live offset after a write whose scroll event is still pending", async () => {
  const route = document.createElement("section")
  const viewport = document.createElement("div")
  route.append(viewport)
  document.body.append(route)

  const instance = attachedVirtualizer(viewport, { scrollOffset: 0, isScrollingResetDelay: 10 })

  const calls: [number, boolean][] = []

  const cleanup = observeElementOffsetReconnectAware(instance, (offset, isScrolling) => {
    calls.push([offset, isScrolling])
    instance.scrollOffset = offset
  })

  try {
    viewport.scrollTop = 100
    viewport.dispatchEvent(new Event("scroll"))
    // A prepend anchor write lands before the reset delay; the browser has not dispatched its scroll event.
    viewport.scrollTop = 2_500
    await new Promise((resolve) => setTimeout(resolve, 25))

    expect(calls).toEqual([
      [100, true],
      [2_500, false],
    ])
  } finally {
    cleanup?.()
    route.remove()
  }
})

test("cleanup suppresses queued delegated callbacks, reconnect checks, and later scrolls", async () => {
  const route = document.createElement("section")
  const viewport = document.createElement("div")
  route.append(viewport)
  document.body.append(route)

  const instance = attachedVirtualizer(viewport, { scrollOffset: 0, isScrollingResetDelay: 10 })

  const calls: [number, boolean][] = []

  const cleanup = observeElementOffsetReconnectAware(instance, (offset, isScrolling) => {
    calls.push([offset, isScrolling])
    instance.scrollOffset = offset
  })

  route.remove()
  document.body.append(route)
  await new Promise((resolve) => setTimeout(resolve, 0))
  viewport.scrollTop = 100
  viewport.dispatchEvent(new Event("scroll"))
  cleanup?.()
  viewport.dispatchEvent(new Event("scroll"))
  await new Promise((resolve) => setTimeout(resolve, 25))
  await frames(4)

  expect(calls).toEqual([[100, true]])
  route.remove()
})

// A real virtualizer attached to the viewport the way its mount does (scroll element plus the window that owns it),
// without starting its own rect and offset observers, so each test drives the observer under test directly.
function attachedVirtualizer(viewport: HTMLDivElement, state: { scrollOffset: number; isScrollingResetDelay: number }) {
  const instance = new Virtualizer<HTMLDivElement, HTMLDivElement>({
    count: 0,
    getScrollElement: () => viewport,
    estimateSize: () => 0,
    scrollToFn: () => {},
    observeElementRect: () => {},
    observeElementOffset: () => {},
    isScrollingResetDelay: state.isScrollingResetDelay,
  })

  instance.scrollElement = viewport
  instance.targetWindow = viewport.ownerDocument.defaultView
  instance.scrollOffset = state.scrollOffset

  return instance
}

// A separate window whose MutationObserver and animation frames a test can replace without touching the global
// window. happy-dom loads a srcdoc frame synchronously, so its window is ready once the frame is attached.
function openFrame() {
  const frame = document.createElement("iframe")
  frame.srcdoc = ""
  document.body.append(frame)
  const targetWindow = frame.contentDocument?.defaultView

  if (!targetWindow) throw new Error("Frame window did not load")

  return { targetWindow, close: () => frame.remove() }
}

async function frames(count: number, targetWindow: Window = window) {
  for (let index = 0; index < count; index++) {
    await new Promise<void>((resolve) => targetWindow.requestAnimationFrame(() => resolve()))
  }
}

function controlledMutations(targetWindow: Window & typeof globalThis) {
  let flush: () => void = () => {
    throw new Error("Mutation observer is not active")
  }

  // Delivers each operation's records as soon as it happens instead of at the next microtask.
  class ControlledMutationObserver extends targetWindow.MutationObserver {
    constructor(callback: MutationCallback) {
      super(callback)
      flush = () => callback(this.takeRecords(), this)
    }
  }

  Object.defineProperty(targetWindow, "MutationObserver", { value: ControlledMutationObserver })

  return {
    append(parent: Node, node: Node) {
      parent.appendChild(node)
      flush()
    },
    remove(node: Node) {
      const parent = node.parentNode

      if (!parent) throw new Error("Mutation target has no parent")
      parent.removeChild(node)
      flush()
    },
  }
}

function controlledAnimationFrames(targetWindow: Window) {
  let time = 0
  let id = 0
  const callbacks = new Map<number, FrameRequestCallback>()
  Object.defineProperty(targetWindow.performance, "now", { value: () => time })
  Object.defineProperty(targetWindow, "requestAnimationFrame", {
    value: (callback: FrameRequestCallback) => {
      id += 1
      callbacks.set(id, callback)

      return id
    },
  })
  Object.defineProperty(targetWindow, "cancelAnimationFrame", {
    value: (frame: number) => callbacks.delete(frame),
  })

  return {
    run(at: number) {
      time = at
      const pending = [...callbacks.values()]
      callbacks.clear()
      pending.forEach((callback) => callback(at))
    },
    pending: () => callbacks.size,
  }
}
