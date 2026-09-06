import { afterEach, describe, expect, jest, test } from "bun:test"
import { ManualClock } from "@opentui/core/testing"
import { testRender } from "@opentui/solid"
import { createMarquee, createTabMarquee } from "../../src/component/session-tabs"

afterEach(() => jest.useRealTimers())

async function setup<T>(create: () => T) {
  let marquee!: T
  const app = await testRender(
    () => {
      marquee = create()
      return null
    },
    { clock: new ManualClock() },
  )
  return { marquee, dispose: () => app.renderer.destroy() }
}

describe("session tab marquee", () => {
  test("starts for the hovered width and resets when the next tab fits", async () => {
    const scope = await setup(() => createMarquee(() => false))
    jest.useFakeTimers()

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

  test("stops after one cycle", async () => {
    const scope = await setup(() => createMarquee(() => false))
    jest.useFakeTimers()

    scope.marquee.enter("first", "opencode", 6)
    jest.advanceTimersByTime(1_400)

    expect(scope.marquee.active()).toBe("first")
    expect(scope.marquee.offset()).toBe(0)
    expect(scope.marquee.leading()).toBe(0)
    scope.dispose()
  })

  test("resets immediately after leaving", async () => {
    const scope = await setup(() => createMarquee(() => false))
    jest.useFakeTimers()

    scope.marquee.enter("first", "opencode", 6)
    jest.advanceTimersByTime(700)
    scope.marquee.leave("first")

    expect(scope.marquee.active()).toBeUndefined()
    expect(scope.marquee.offset()).toBe(0)
    expect(scope.marquee.leading()).toBe(0)
    scope.dispose()
  })

  test("resets when the pointer leaves the tab rail", async () => {
    const scope = await setup(() => createTabMarquee(() => false))
    jest.useFakeTimers()

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
