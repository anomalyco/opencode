import { describe, expect, test } from "bun:test"
import { createScrollSpy, pickOffsetId, pickVisibleId } from "./scroll-spy"

const rect = (top: number, height = 80): DOMRect =>
  ({
    x: 0,
    y: top,
    top,
    left: 0,
    right: 800,
    bottom: top + height,
    width: 800,
    height,
    toJSON: () => ({}),
  }) as DOMRect

const setRect = (el: Element, top: number, height = 80) => {
  Object.defineProperty(el, "getBoundingClientRect", {
    configurable: true,
    value: () => rect(top, height),
  })
}

describe("pickVisibleId", () => {
  test("prefers higher intersection ratio", () => {
    const id = pickVisibleId(
      [
        { id: "a", ratio: 0.2, top: 100 },
        { id: "b", ratio: 0.8, top: 300 },
      ],
      120,
    )

    expect(id).toBe("b")
  })

  test("breaks ratio ties by nearest line", () => {
    const id = pickVisibleId(
      [
        { id: "a", ratio: 0.5, top: 90 },
        { id: "b", ratio: 0.5, top: 140 },
      ],
      130,
    )

    expect(id).toBe("b")
  })
})

describe("pickOffsetId", () => {
  test("uses binary search cutoff", () => {
    const id = pickOffsetId(
      [
        { id: "a", top: 0 },
        { id: "b", top: 200 },
        { id: "c", top: 400 },
      ],
      350,
    )

    expect(id).toBe("b")
  })
})

describe("createScrollSpy fallback", () => {
  test("tracks active id from offsets and dirty refresh", () => {
    const active: string[] = []
    const root = document.createElement("div") as HTMLDivElement
    const one = document.createElement("div")
    const two = document.createElement("div")
    const three = document.createElement("div")

    root.append(one, two, three)
    document.body.append(root)

    Object.defineProperty(root, "scrollTop", { configurable: true, writable: true, value: 250 })
    setRect(root, 0, 800)
    setRect(one, -250)
    setRect(two, -50)
    setRect(three, 150)

    const queue: FrameRequestCallback[] = []
    const flush = () => {
      const run = [...queue]
      queue.length = 0
      for (const cb of run) cb(0)
    }

    const spy = createScrollSpy({
      onActive: (id) => active.push(id),
      raf: (cb) => (queue.push(cb), queue.length),
      caf: () => {},
      IntersectionObserver: undefined,
      ResizeObserver: undefined,
      MutationObserver: undefined,
    })

    spy.setContainer(root)
    spy.register(one, "a")
    spy.register(two, "b")
    spy.register(three, "c")
    spy.onScroll()
    flush()

    expect(spy.getActiveId()).toBe("b")
    expect(active.at(-1)).toBe("b")

    root.scrollTop = 450
    setRect(one, -450)
    setRect(two, -250)
    setRect(three, -50)
    spy.onScroll()
    flush()
    expect(spy.getActiveId()).toBe("c")

    root.scrollTop = 250
    setRect(one, -250)
    setRect(two, 250)
    setRect(three, 150)
    spy.markDirty()
    spy.onScroll()
    flush()
    expect(spy.getActiveId()).toBe("a")

    spy.destroy()
  })
})
