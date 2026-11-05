import { afterEach, expect, test } from "bun:test"
import { createAutoScroll } from "@opencode/ui/hooks"
import { createRoot } from "solid-js"

const cleanups: (() => void)[] = []

afterEach(() => cleanups.splice(0).forEach((cleanup) => cleanup()))

function mount(options: Parameters<typeof createAutoScroll>[0]) {
  const main = document.createElement("main")
  const surface = document.createElement("div")
  const viewport = document.createElement("div")
  const content = document.createElement("div")
  surface.append(viewport)
  viewport.append(content)
  main.append(surface)
  document.body.append(main)

  const size = { scrollHeight: 300, scrollTop: 200 }
  Object.defineProperties(viewport, {
    clientHeight: { value: 100 },
    scrollHeight: { get: () => size.scrollHeight },
    scrollTop: {
      get: () => size.scrollTop,
      set: (value: number) => {
        size.scrollTop = Math.max(0, Math.min(value, size.scrollHeight - 100))
      },
    },
  })

  const scroll = createRoot((dispose) => {
    cleanups.push(() => {
      dispose()
      main.remove()
    })
    const scroll = createAutoScroll(options)
    scroll.scrollRef(viewport)
    scroll.contentRef(content)

    return scroll
  })

  const reattach = async () => {
    surface.remove()
    viewport.scrollTop = 0
    main.append(surface)
    await Promise.resolve()
  }

  return { scroll, size, viewport, reattach }
}

test("restores bottom anchoring when Suspense reattaches the scroll viewport", async () => {
  const working = mount({ working: () => true })
  await working.reattach()
  expect(working.viewport.scrollTop).toBe(200)

  const idle = mount({ working: () => false })
  await idle.reattach()
  expect(idle.viewport.scrollTop).toBe(200)
})

test("keeps the user's pause when Suspense reattaches the scroll viewport", async () => {
  const view = mount({ working: () => true })
  view.scroll.pause()
  expect(view.scroll.userScrolled()).toBe(true)

  await view.reattach()
  expect(view.scroll.userScrolled()).toBe(true)
  expect(view.viewport.scrollTop).toBe(0)
})

test("a user scroll next to the last programmatic target pauses instead of snapping back", () => {
  const view = mount({ working: () => true })
  view.viewport.scrollTop = 0
  view.scroll.forceScrollToBottom()
  expect(view.viewport.scrollTop).toBe(200)
  view.scroll.handleScroll()

  view.size.scrollHeight = 350
  view.viewport.scrollTop = 199
  view.scroll.handleScroll()

  expect(view.viewport.scrollTop).toBe(199)
  expect(view.scroll.userScrolled()).toBe(true)
})

test("content that grows after a programmatic scroll is followed", () => {
  const view = mount({ working: () => true })
  view.viewport.scrollTop = 0
  view.scroll.forceScrollToBottom()

  view.size.scrollHeight = 350
  view.scroll.handleScroll()

  expect(view.viewport.scrollTop).toBe(250)
  expect(view.scroll.userScrolled()).toBe(false)
})
