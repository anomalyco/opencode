import { afterEach, describe, expect, jest, test } from "bun:test"
import { createRoot, createSignal } from "solid-js"
import { createMarquee, createTabMarquee, type TabMarqueeSpeed } from "../../src/component/session-tabs"

afterEach(() => jest.useRealTimers())

describe("session tab marquee", () => {
  test("starts for the hovered width and resets when the next tab fits", () => {
    jest.useFakeTimers()
    const scope = createRoot((dispose) => ({
      marquee: createMarquee(
        () => false,
        () => "normal",
      ),
      dispose,
    }))

    scope.marquee.enter("first", "opencode", 6)
    expect(scope.marquee.active()).toBe("first")
    expect(scope.marquee.offset()).toBe(0)

    jest.advanceTimersByTime(600)
    expect(scope.marquee.offset()).toBe(1)

    scope.marquee.enter("second", "short", 6)
    expect(scope.marquee.active()).toBeUndefined()
    expect(scope.marquee.offset()).toBe(0)
    expect(scope.marquee.leading()).toBe(0)
    scope.dispose()
  })

  test("stops after one cycle", () => {
    jest.useFakeTimers()
    const scope = createRoot((dispose) => ({
      marquee: createMarquee(
        () => false,
        () => "normal",
      ),
      dispose,
    }))

    scope.marquee.enter("first", "opencode", 6)
    jest.advanceTimersByTime(1_400)

    expect(scope.marquee.active()).toBe("first")
    expect(scope.marquee.offset()).toBe(0)
    expect(scope.marquee.leading()).toBe(0)
    scope.dispose()
  })

  test("slows the delay and interval", () => {
    jest.useFakeTimers()
    const scope = createRoot((dispose) => ({
      marquee: createMarquee(
        () => false,
        () => "slow",
      ),
      dispose,
    }))

    scope.marquee.enter("first", "opencode", 6)
    jest.advanceTimersByTime(600)
    expect(scope.marquee.offset()).toBe(0)

    jest.advanceTimersByTime(600)
    expect(scope.marquee.offset()).toBe(1)

    jest.advanceTimersByTime(159)
    expect(scope.marquee.offset()).toBe(1)

    jest.advanceTimersByTime(1)
    expect(scope.marquee.offset()).toBe(2)
    scope.dispose()
  })

  test("never scrolls when off", () => {
    jest.useFakeTimers()
    const scope = createRoot((dispose) => ({
      marquee: createMarquee(
        () => false,
        () => "off",
      ),
      dispose,
    }))

    scope.marquee.enter("first", "opencode", 6)
    jest.advanceTimersByTime(2_000)

    expect(scope.marquee.active()).toBeUndefined()
    expect(scope.marquee.offset()).toBe(0)
    scope.dispose()
  })

  test("cancels the pending scroll when the preset changes", () => {
    jest.useFakeTimers()
    const [speed, setSpeed] = createSignal<TabMarqueeSpeed>("normal")
    const scope = createRoot((dispose) => ({ marquee: createMarquee(() => false, speed), dispose }))

    scope.marquee.enter("first", "opencode", 6)
    jest.advanceTimersByTime(679)
    expect(scope.marquee.offset()).toBe(1)

    setSpeed("off")
    expect(scope.marquee.active()).toBeUndefined()
    expect(scope.marquee.offset()).toBe(0)

    jest.advanceTimersByTime(2_000)
    expect(scope.marquee.offset()).toBe(0)
    scope.dispose()
  })

  test("applies a slower preset without restarting the old scroll", () => {
    jest.useFakeTimers()
    const [speed, setSpeed] = createSignal<TabMarqueeSpeed>("normal")
    const scope = createRoot((dispose) => ({ marquee: createMarquee(() => false, speed), dispose }))

    scope.marquee.enter("first", "opencode", 6)
    jest.advanceTimersByTime(600)
    expect(scope.marquee.offset()).toBe(1)

    setSpeed("slow")
    scope.marquee.enter("first", "opencode", 6)
    jest.advanceTimersByTime(1_199)
    expect(scope.marquee.offset()).toBe(0)

    jest.advanceTimersByTime(1)
    expect(scope.marquee.offset()).toBe(1)
    scope.dispose()
  })

  test("resets immediately after leaving", () => {
    jest.useFakeTimers()
    const scope = createRoot((dispose) => ({
      marquee: createMarquee(
        () => false,
        () => "normal",
      ),
      dispose,
    }))

    scope.marquee.enter("first", "opencode", 6)
    jest.advanceTimersByTime(700)
    scope.marquee.leave("first")

    expect(scope.marquee.active()).toBeUndefined()
    expect(scope.marquee.offset()).toBe(0)
    expect(scope.marquee.leading()).toBe(0)
    scope.dispose()
  })

  test("resets when the pointer leaves the tab rail", () => {
    jest.useFakeTimers()
    const scope = createRoot((dispose) => ({
      marquee: createTabMarquee(
        () => false,
        () => "normal",
      ),
      dispose,
    }))

    scope.marquee.enter("first", "opencode", 6)
    jest.advanceTimersByTime(700)
    scope.marquee.leaveHovered()
    jest.advanceTimersByTime(0)

    expect(scope.marquee.hovered()).toBeUndefined()
    expect(scope.marquee.active()).toBeUndefined()
    expect(scope.marquee.offset()).toBe(0)
    scope.dispose()
  })
})
