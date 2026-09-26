import { expect, test } from "bun:test"
import type { ScrollBoxRenderable } from "@opentui/core"
import { ManualClock } from "@opentui/core/testing"
import { testRender, useRenderer } from "@opentui/solid"
import { createSignal, For } from "solid-js"
import { adjacentPageTop, createPagedScroll, pagePad, pageStep, pageTarget } from "../../src/routes/session/paged-scroll"

const HEIGHT = 12

async function mount(enabled?: () => boolean, suspended?: () => boolean, overlap?: () => number) {
  const clock = new ManualClock()
  const [lines, setLines] = createSignal<string[]>([])
  let scroll: ScrollBoxRenderable | undefined
  let paged: ReturnType<typeof createPagedScroll> | undefined

  const app = await testRender(
    () => {
      const renderer = useRenderer()
      paged = createPagedScroll({
        enabled: enabled ?? (() => true),
        scroll: () => scroll,
        suspended: suspended ?? (() => false),
        overlap: overlap ?? (() => 0),
        renderer,
      })
      return (
        <box width="100%" height="100%" flexDirection="column">
          <scrollbox
            ref={(value: ScrollBoxRenderable) => (scroll = value)}
            flexGrow={1}
            minHeight={1}
            stickyScroll={false}
            stickyStart="bottom"
          >
            <For each={lines()}>{(line) => <text width="100%">{line}</text>}</For>
          </scrollbox>
        </box>
      )
    },
    { width: 40, height: HEIGHT, useThread: false, clock },
  )

  app.renderer.pause()
  const renderFrames = async (count: number) => {
    for (let frame = 0; frame < count; frame++) await app.renderOnce()
  }
  const append = (line: string) => setLines((current) => [...current, line])

  return {
    app,
    page: () => scroll!.viewport.height,
    top: () => scroll!.scrollTop,
    following: () => paged!.following(),
    geometry: () => paged!.geometry(),
    scrollBy: (amount: number) => scroll!.scrollBy(amount),
    scrollTo: (position: number) => scroll!.scrollTo(position),
    scrollToBottom: () => scroll!.scrollTo(scroll!.scrollHeight),
    append,
    renderFrames,
  }
}

// The regression this guards: applying the page padding after the frame that grows the content let
// native sticky-follow move the viewport one row and bounce back on every streamed line. Paged
// follow must only ever move in whole-page jumps.
test("paged follow never moves the viewport within a page", async () => {
  const fx = await mount()
  try {
    await fx.renderFrames(4)
    const page = fx.page()
    expect(page).toBe(HEIGHT)

    const deltas: number[] = []
    let previous = fx.top()
    const sample = async (count: number) => {
      for (let frame = 0; frame < count; frame++) {
        await fx.app.renderOnce()
        const current = fx.top()
        deltas.push(current - previous)
        previous = current
      }
    }
    await sample(1)
    deltas.length = 0

    for (let index = 0; index < page * 3; index++) {
      fx.append(`line ${index + 1}`)
      await sample(4)
    }

    expect(deltas.filter((delta) => delta !== 0 && delta !== page)).toEqual([])
    expect(deltas.filter((delta) => delta === page).length).toBeGreaterThanOrEqual(2)
  } finally {
    fx.app.renderer.destroy()
  }
})

test("follow pauses when the reader scrolls away and resumes at the bottom", async () => {
  const fx = await mount()
  try {
    await fx.renderFrames(4)
    const page = fx.page()
    for (let index = 0; index < page + 3; index++) fx.append(`line ${index + 1}`)
    await fx.renderFrames(6)

    expect(fx.following()).toBe(true)
    fx.scrollBy(-3)
    await fx.renderFrames(4)
    expect(fx.following()).toBe(false)

    const paused = fx.top()
    for (let index = 0; index < 3; index++) fx.append(`late ${index + 1}`)
    await fx.renderFrames(6)
    expect(fx.top()).toBe(paused)

    fx.scrollToBottom()
    await fx.renderFrames(6)
    expect(fx.following()).toBe(true)
    expect(fx.top()).toBeGreaterThan(paused)
  } finally {
    fx.app.renderer.destroy()
  }
})

test("overlap advances by page minus overlap and keeps the previous rows on screen", () => {
  const page = 12
  const overlap = 5
  expect(pageStep(page, overlap)).toBe(7)
  expect(pageTarget(page, page, overlap)).toBe(0)
  expect(pageTarget(page + 1, page, overlap)).toBe(7)
  expect(pageTarget(page + 7, page, overlap)).toBe(7)
  expect(pageTarget(page + 8, page, overlap)).toBe(14)
  expect(pagePad(page + 8, page, overlap)).toBe(6)
})

test("adjacent page tops snap to step boundaries", () => {
  expect(adjacentPageTop(21, 7, -1)).toBe(14)
  expect(adjacentPageTop(21, 7, 1)).toBe(28)
  expect(adjacentPageTop(20, 7, -1)).toBe(14)
  expect(adjacentPageTop(20, 7, 1)).toBe(21)
  expect(adjacentPageTop(0, 7, -1)).toBe(0)
})

test("overlapped paging only advances by the step", async () => {
  const overlap = 5
  const fx = await mount(undefined, undefined, () => overlap)
  try {
    await fx.renderFrames(4)
    const page = fx.page()
    const step = page - overlap

    const deltas: number[] = []
    let previous = fx.top()
    const sample = async (count: number) => {
      for (let frame = 0; frame < count; frame++) {
        await fx.app.renderOnce()
        const current = fx.top()
        deltas.push(current - previous)
        previous = current
      }
    }
    await sample(1)
    deltas.length = 0

    for (let index = 0; index < page * 3; index++) {
      fx.append(`line ${index + 1}`)
      await sample(4)
    }

    expect(deltas.filter((delta) => delta !== 0 && delta !== step)).toEqual([])
    expect(deltas.filter((delta) => delta === step).length).toBeGreaterThanOrEqual(2)
  } finally {
    fx.app.renderer.destroy()
  }
})

test("page navigation revisits the exact pages the transcript was generated on", async () => {
  const overlap = 5
  const fx = await mount(undefined, undefined, () => overlap)
  try {
    await fx.renderFrames(4)
    const page = fx.geometry()!.page

    const tops: number[] = []
    let previous = fx.top()
    for (let index = 0; index < page * 3; index++) {
      fx.append(`line ${index + 1}`)
      await fx.renderFrames(4)
      const current = fx.top()
      if (current !== previous) {
        tops.push(current)
        previous = current
      }
    }
    expect(tops.length).toBeGreaterThanOrEqual(2)

    const { step, latest } = fx.geometry()!
    expect(tops[tops.length - 1]).toBe(latest)

    const visited: number[] = [fx.top()]
    let current = fx.top()
    for (let index = 0; index < tops.length; index++) {
      const target = Math.max(0, Math.min(adjacentPageTop(current, step, -1), latest))
      fx.scrollTo(target)
      await fx.renderFrames(2)
      current = fx.top()
      visited.push(current)
    }
    expect(visited).toEqual([...[...tops].reverse(), 0])

    for (let index = 0; index < tops.length; index++) {
      const target = Math.min(adjacentPageTop(current, step, 1), latest)
      fx.scrollTo(target)
      await fx.renderFrames(2)
      current = fx.top()
    }
    expect(current).toBe(latest)
  } finally {
    fx.app.renderer.destroy()
  }
})

test("enabling paged output mid-session does not pull a scrolled-away reader down", async () => {
  const [enabled, setEnabled] = createSignal(false)
  const fx = await mount(enabled)
  try {
    await fx.renderFrames(4)
    const page = fx.page()
    for (let index = 0; index < page * 2; index++) fx.append(`line ${index + 1}`)
    await fx.renderFrames(6)

    fx.scrollTo(2)
    await fx.renderFrames(2)
    const away = fx.top()
    expect(away).toBe(2)

    setEnabled(true)
    await fx.renderFrames(6)
    expect(fx.following()).toBe(false)
    expect(fx.top()).toBe(away)
  } finally {
    fx.app.renderer.destroy()
  }
})

test("repositioning while suspended pauses follow and does not snap back", async () => {
  const [suspended, setSuspended] = createSignal(false)
  const fx = await mount(undefined, suspended)
  try {
    await fx.renderFrames(4)
    const page = fx.page()
    for (let index = 0; index < page * 2; index++) fx.append(`line ${index + 1}`)
    await fx.renderFrames(6)
    expect(fx.following()).toBe(true)

    setSuspended(true)
    await fx.renderFrames(2)
    fx.scrollTo(3)
    await fx.renderFrames(2)
    expect(fx.following()).toBe(false)

    setSuspended(false)
    await fx.renderFrames(6)
    expect(fx.following()).toBe(false)
    expect(fx.top()).toBe(3)
  } finally {
    fx.app.renderer.destroy()
  }
})
