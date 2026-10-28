import { describe, expect, test } from "bun:test"
import { nextTabStripScrollLeft } from "./tab-strip-scroll"

describe("nextTabStripScrollLeft", () => {
  test("does not scroll when width shrinks", () => {
    const left = nextTabStripScrollLeft({
      prevScrollWidth: 500,
      scrollWidth: 420,
      clientWidth: 300,
      prevLeadOpen: false,
      leadOpen: false,
    })

    expect(left).toBeUndefined()
  })

  test("scrolls to start when a leading tab opens", () => {
    const left = nextTabStripScrollLeft({
      prevScrollWidth: 400,
      scrollWidth: 500,
      clientWidth: 320,
      prevLeadOpen: false,
      leadOpen: true,
    })

    expect(left).toBe(0)
  })

  test("scrolls to right edge for new tabs", () => {
    const left = nextTabStripScrollLeft({
      prevScrollWidth: 500,
      scrollWidth: 780,
      clientWidth: 300,
      prevLeadOpen: true,
      leadOpen: true,
    })

    expect(left).toBe(480)
  })
})
