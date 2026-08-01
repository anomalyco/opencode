import { expect, test } from "bun:test"
import { type Virtualizer } from "@tanstack/solid-virtual"
import { mutationNodesContainElement, observeElementOffsetReconnectAware } from "./observe-element-offset"

type TestWindow = Window & typeof globalThis

function createDOM() {
  // The app unit suite shares one globally registered HappyDOM window. Use a
  // separate document so neighboring tests that replace document.body cannot
  // detach this test's scroll element while its MutationObserver is running.
  const document = globalThis.document.implementation.createHTMLDocument("offset observer")
  return { testWindow: globalThis.window, document }
}

test("matches only the scroll element or an ancestor containing it", () => {
  const { document } = createDOM()
  const route = document.createElement("section")
  const viewport = document.createElement("div")
  const child = document.createElement("div")
  const sibling = document.createElement("div")
  route.append(viewport)
  viewport.append(child)

  expect(mutationNodesContainElement([viewport], viewport)).toBe(true)
  expect(mutationNodesContainElement([route], viewport)).toBe(true)
  expect(mutationNodesContainElement([child, sibling], viewport)).toBe(false)
})

test("reports a divergent native offset once and ignores equal offsets and unrelated mutations", async () => {
  const { testWindow, document } = createDOM()
  const route = document.createElement("section")
  const viewport = document.createElement("div")
  const unrelated = document.createElement("div")
  route.append(viewport)
  document.body.append(route)
  const instance = {
    scrollElement: viewport,
    targetWindow: testWindow,
    scrollOffset: 79_400,
    options: {
      horizontal: false,
      isRtl: false,
      isScrollingResetDelay: 0,
      useScrollendEvent: false,
    },
  } as unknown as Virtualizer<HTMLDivElement, HTMLDivElement>
  const calls: [number, boolean][] = []
  const cleanup = observeElementOffsetReconnectAware(instance, (offset, isScrolling) => {
    calls.push([offset, isScrolling])
    instance.scrollOffset = offset
  })

  document.body.append(unrelated)
  unrelated.remove()
  await frames(testWindow, 2)
  expect(calls).toEqual([])

  route.remove()
  document.body.append(route)
  await waitUntil(testWindow, () => calls.length === 1)
  expect(calls).toEqual([[0, false]])

  route.remove()
  document.body.append(route)
  await frames(testWindow, 5)
  expect(calls).toEqual([[0, false]])

  cleanup?.()
})

test("keeps checking until stale reset-delay callbacks can no longer win", async () => {
  const { testWindow, document } = createDOM()
  const route = document.createElement("section")
  const viewport = document.createElement("div")
  route.append(viewport)
  document.body.append(route)
  const instance = {
    scrollElement: viewport,
    targetWindow: testWindow,
    scrollOffset: 79_400,
    options: {
      horizontal: false,
      isRtl: false,
      isScrollingResetDelay: 20,
      useScrollendEvent: false,
    },
  } as unknown as Virtualizer<HTMLDivElement, HTMLDivElement>
  const calls: number[] = []
  const cleanup = observeElementOffsetReconnectAware(instance, (offset) => {
    calls.push(offset)
    instance.scrollOffset = offset
  })

  route.remove()
  document.body.append(route)
  await waitUntil(testWindow, () => instance.scrollOffset === 0)
  expect(instance.scrollOffset).toBe(0)

  instance.scrollOffset = 79_400
  await waitUntil(testWindow, () => calls.length === 2)

  expect(instance.scrollOffset).toBe(0)
  expect(calls).toEqual([0, 0])
  cleanup?.()
})

test.each([
  { name: "LTR", isRtl: false, expected: 240 },
  { name: "RTL", isRtl: true, expected: -240 },
])("reports the TanStack horizontal $name offset after reconnect", async ({ isRtl, expected }) => {
  const { testWindow, document } = createDOM()
  const route = document.createElement("section")
  const viewport = document.createElement("div")
  route.append(viewport)
  document.body.append(route)
  viewport.scrollLeft = 240
  const instance = {
    scrollElement: viewport,
    targetWindow: testWindow,
    scrollOffset: 0,
    options: {
      horizontal: true,
      isRtl,
      isScrollingResetDelay: 0,
      useScrollendEvent: false,
    },
  } as unknown as Virtualizer<HTMLDivElement, HTMLDivElement>
  const calls: [number, boolean][] = []
  const cleanup = observeElementOffsetReconnectAware(instance, (offset, isScrolling) => {
    calls.push([offset, isScrolling])
    instance.scrollOffset = offset
  })

  route.remove()
  document.body.append(route)
  await waitUntil(testWindow, () => calls.length === 1)

  expect(calls).toEqual([[expected, false]])
  cleanup?.()
})

test("cleanup suppresses an already queued delegated offset callback", async () => {
  const { testWindow, document } = createDOM()
  const viewport = document.createElement("div")
  document.body.append(viewport)
  viewport.scrollTop = 100
  const instance = {
    scrollElement: viewport,
    targetWindow: testWindow,
    scrollOffset: 0,
    options: {
      horizontal: false,
      isRtl: false,
      isScrollingResetDelay: 10,
      useScrollendEvent: false,
    },
  } as unknown as Virtualizer<HTMLDivElement, HTMLDivElement>
  const calls: [number, boolean][] = []
  const cleanup = observeElementOffsetReconnectAware(instance, (offset, isScrolling) =>
    calls.push([offset, isScrolling]),
  )

  viewport.dispatchEvent(new testWindow.Event("scroll"))
  cleanup?.()
  await waitUntil(testWindow, () => calls.length === 1)

  expect(calls).toEqual([[100, true]])
})

test("cleanup cancels reconnect checks and delegated offset observation", async () => {
  const { testWindow, document } = createDOM()
  const route = document.createElement("section")
  const viewport = document.createElement("div")
  route.append(viewport)
  document.body.append(route)
  const instance = {
    scrollElement: viewport,
    targetWindow: testWindow,
    scrollOffset: 0,
    options: {
      horizontal: false,
      isRtl: false,
      isScrollingResetDelay: 50,
      useScrollendEvent: false,
    },
  } as unknown as Virtualizer<HTMLDivElement, HTMLDivElement>
  const calls: number[] = []
  const cleanup = observeElementOffsetReconnectAware(instance, (offset) => calls.push(offset))

  route.remove()
  document.body.append(route)
  await new Promise<void>((resolve) => testWindow.setTimeout(resolve, 0))
  cleanup?.()
  instance.scrollOffset = 100
  viewport.dispatchEvent(new testWindow.Event("scroll"))
  await frames(testWindow, 4)

  expect(calls).toEqual([])
})

async function waitUntil(testWindow: TestWindow, predicate: () => boolean, timeoutMs = 2_000) {
  const deadline = testWindow.performance.now() + timeoutMs
  while (!predicate()) {
    if (testWindow.performance.now() >= deadline) throw new Error(`condition was not met within ${timeoutMs}ms`)
    await new Promise<void>((resolve) => testWindow.setTimeout(resolve, 5))
    await frames(testWindow, 1)
  }
}

async function frames(testWindow: TestWindow, count: number) {
  for (let index = 0; index < count; index++) {
    await new Promise<void>((resolve) => testWindow.requestAnimationFrame(() => resolve()))
  }
}
