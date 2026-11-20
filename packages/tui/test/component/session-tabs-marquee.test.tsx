/** @jsxImportSource @opentui/solid */
import { describe, expect, test } from "bun:test"
import { ManualClock } from "@opentui/core/testing"
import { testRender } from "@opentui/solid"
import { createMarquee, createTabMarquee } from "../../src/component/session-tabs"

// The marquee waits and scrolls on the renderer's clock, so a manual clock drives it.
async function mount<T>(create: () => T) {
  const clock = new ManualClock()
  let marquee!: T
  const app = await testRender(
    () => {
      marquee = create()
      return <box />
    },
    { width: 10, height: 1, clock, maxFps: Number.POSITIVE_INFINITY },
  )
  return Object.assign(app, {
    marquee,
    clock,
    async advance(ms: number) {
      for (let elapsed = 5; elapsed <= ms; elapsed += 5) {
        clock.advance(5)
        await app.renderer.idle()
      }
    },
  })
}

describe("session tab marquee", () => {
  test("starts for the hovered width and resets when the next tab fits", async () => {
    await using app = await mount(() => createMarquee(() => false))

    app.marquee.enter("first", "opencode", 6)
    expect(app.marquee.active()).toBe("first")
    expect(app.marquee.offset()).toBe(0)

    await app.advance(600)
    expect(app.marquee.offset()).toBe(1)

    app.marquee.enter("second", "short", 6)
    expect(app.marquee.active()).toBeUndefined()
    expect(app.marquee.offset()).toBe(0)
    expect(app.marquee.leading()).toBe(0)
  })

  test("stops after one cycle", async () => {
    await using app = await mount(() => createMarquee(() => false))

    app.marquee.enter("first", "opencode", 6)
    // Steps are due every 80 ms from clock zero: the first after the 600 ms delay is at 720 ms.
    await app.advance(1_500)

    expect(app.marquee.active()).toBe("first")
    expect(app.marquee.offset()).toBe(0)
    expect(app.marquee.leading()).toBe(0)
    expect(app.clock.pendingTimerCount).toBe(0)
  })

  test("scrolls by the clock's tick count, so a late frame does not fall behind", async () => {
    const offset = async (late: boolean) => {
      await using app = await mount(() => createMarquee(() => false))
      app.marquee.enter("first", "a long session title that scrolls", 6)
      await app.advance(700)
      if (late) (app.clock.advance(400), await app.renderOnce(), await app.renderer.idle())
      else await app.advance(400)
      await app.renderOnce()
      return app.marquee.offset()
    }
    const steady = await offset(false)
    expect(steady).toBeGreaterThan(5)
    expect(await offset(true)).toBe(steady)
  })

  test("resets immediately after leaving", async () => {
    await using app = await mount(() => createMarquee(() => false))

    app.marquee.enter("first", "opencode", 6)
    await app.advance(700)
    app.marquee.leave("first")

    expect(app.marquee.active()).toBeUndefined()
    expect(app.marquee.offset()).toBe(0)
    expect(app.marquee.leading()).toBe(0)
    expect(app.clock.pendingTimerCount).toBe(0)
  })

  test("resets when the pointer leaves the tab rail", async () => {
    await using app = await mount(() => createTabMarquee(() => false))

    app.marquee.enter("first", "opencode", 6)
    await app.advance(700)
    app.marquee.leaveHovered()
    await Bun.sleep(5)

    expect(app.marquee.hovered()).toBeUndefined()
    expect(app.marquee.active()).toBeUndefined()
    expect(app.marquee.offset()).toBe(0)
  })
})
