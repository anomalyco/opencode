import { describe, expect, test } from "bun:test"
import { nextTabListScrollLeft } from "./file-tab-scroll"

describe("nextTabListScrollLeft", () => {
  test("does not scroll when width shrinks", () => {
    const left = nextTabListScrollLeft({
      prevScrollWidth: 500,
      scrollWidth: 420,
      clientWidth: 300,
      prevContextOpen: false,
      contextOpen: false,
    })

    expect(left).toBeUndefined()
  })

  test("scrolls to start when context tab opens", () => {
    const left = nextTabListScrollLeft({
      prevScrollWidth: 400,
      scrollWidth: 500,
      clientWidth: 320,
      prevContextOpen: false,
      contextOpen: true,
    })

    expect(left).toBe(0)
  })

  test("scrolls to right edge for new file tabs", () => {
    const left = nextTabListScrollLeft({
      prevScrollWidth: 500,
      scrollWidth: 780,
      clientWidth: 300,
      prevContextOpen: true,
      contextOpen: true,
    })

    expect(left).toBe(480)
  })
})
