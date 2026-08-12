import { afterEach, describe, expect, jest, test } from "bun:test"
import { createRoot } from "solid-js"
import { createMarquee } from "../../src/component/session-tabs"

afterEach(() => jest.useRealTimers())

describe("session tab marquee", () => {
  test("starts for the hovered width and returns when the next tab fits", () => {
    jest.useFakeTimers()
    const scope = createRoot((dispose) => ({ marquee: createMarquee(() => false), dispose }))

    scope.marquee.enter("first", "opencode", 6)
    expect(scope.marquee.active()).toBe("first")
    expect(scope.marquee.offset()).toBe(0)

    jest.advanceTimersByTime(600)
    expect(scope.marquee.offset()).toBe(1)

    scope.marquee.enter("second", "short", 6)
    expect(scope.marquee.active()).toBe("first")
    expect(scope.marquee.offset()).toBe(1)

    jest.advanceTimersByTime(1_000)
    expect(scope.marquee.active()).toBe("first")
    expect(scope.marquee.offset()).toBe(0)

    jest.advanceTimersByTime(250)
    expect(scope.marquee.active()).toBeUndefined()
    scope.dispose()
  })

  test("keeps the leading fade through a natural loop boundary", () => {
    jest.useFakeTimers()
    const scope = createRoot((dispose) => ({ marquee: createMarquee(() => false), dispose }))

    scope.marquee.enter("first", "opencode", 6)
    jest.advanceTimersByTime(1_600)

    expect(scope.marquee.active()).toBe("first")
    expect(scope.marquee.offset()).toBe(0)
    expect(scope.marquee.leading()).toBe(1)
    scope.dispose()
  })

  test("finishes the current cycle after leaving", () => {
    jest.useFakeTimers()
    const scope = createRoot((dispose) => ({ marquee: createMarquee(() => false), dispose }))

    scope.marquee.enter("first", "opencode", 6)
    jest.advanceTimersByTime(700)
    scope.marquee.leave("first")
    jest.advanceTimersByTime(900)

    expect(scope.marquee.active()).toBe("first")
    expect(scope.marquee.offset()).toBe(0)

    jest.advanceTimersByTime(250)
    expect(scope.marquee.active()).toBeUndefined()
    expect(scope.marquee.offset()).toBe(0)
    scope.dispose()
  })
})
