import { expect, test } from "bun:test"
import { createAutoScroll } from "@opencode-ai/ui/hooks"
import { createRoot } from "solid-js"

test("restores bottom anchoring when Suspense reattaches the scroll viewport", async () => {
  const main = document.createElement("main")
  const surface = document.createElement("div")
  const viewport = document.createElement("div")
  const content = document.createElement("div")
  surface.append(viewport)
  viewport.append(content)
  main.append(surface)
  document.body.append(main)

  let scrollTop = 200
  Object.defineProperties(viewport, {
    clientHeight: { value: 100 },
    scrollHeight: { value: 300 },
    scrollTop: {
      get: () => scrollTop,
      set: (value: number) => {
        scrollTop = Math.min(value, 200)
      },
    },
  })

  const dispose = createRoot((dispose) => {
    const scroll = createAutoScroll({ working: () => true })
    scroll.scrollRef(viewport)
    scroll.contentRef(content)
    return dispose
  })

  surface.remove()
  viewport.scrollTop = 0
  main.append(surface)
  await Promise.resolve()

  expect(viewport.scrollTop).toBe(200)

  dispose()
  main.remove()
})
