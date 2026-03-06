import { describe, expect, test } from "bun:test"
import { shouldRender } from "./sync"

describe("prompt-input sync", () => {
  test("skips render while IME is composing", () => {
    const ok = shouldRender({
      composing: true,
      mirror: false,
      normalized: false,
      equal: false,
    })

    expect(ok).toBeFalse()
  })

  test("skips mirror render when editor is normalized", () => {
    const ok = shouldRender({
      composing: false,
      mirror: true,
      normalized: true,
      equal: false,
    })

    expect(ok).toBeFalse()
  })

  test("renders mirror update when editor is not normalized", () => {
    const ok = shouldRender({
      composing: false,
      mirror: true,
      normalized: false,
      equal: false,
    })

    expect(ok).toBeTrue()
  })

  test("skips non-mirror render when DOM and prompt are equal", () => {
    const ok = shouldRender({
      composing: false,
      mirror: false,
      normalized: true,
      equal: true,
    })

    expect(ok).toBeFalse()
  })
})
