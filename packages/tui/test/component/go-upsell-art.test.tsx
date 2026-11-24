import { expect, spyOn, test } from "bun:test"
/** @jsxImportSource @opentui/solid */
import { OptimizedBuffer, RGBA } from "@opentui/core"
import { ManualClock, setRendererCapabilities } from "@opentui/core/testing"
import { testRender } from "@opentui/solid"
import { createSignal, Show } from "solid-js"
import "../../src/component/go-upsell-art"
import type { GoUpsellArtRenderable } from "../../src/component/go-upsell-art"
import { countTickers } from "../fixture/animation-ticks"

const colors = {
  background: RGBA.fromHex("#0a0a0a"),
  primary: RGBA.fromHex("#fab283"),
  logoBase: RGBA.fromHex("#9a9a9a"),
}

test("the art ticks at 30 fps only while drawn and animating, and leaves nothing ticking after repeated opens", async () => {
  const [open, setOpen] = createSignal(true)
  const [visible, setVisible] = createSignal(true)
  const [animate, setAnimate] = createSignal(true)
  let art: GoUpsellArtRenderable | undefined
  using tickers = countTickers()
  const clock = new ManualClock()
  const app = await testRender(
    () => (
      <box width="100%" height="100%">
        <Show when={open()}>
          <go_upsell_art
            ref={(value: GoUpsellArtRenderable) => (art = value)}
            width="100%"
            height="100%"
            visible={visible()}
            animate={animate()}
            {...colors}
          />
        </Show>
      </box>
    ),
    { width: 60, height: 20, clock, maxFps: Number.POSITIVE_INFINITY },
  )
  let frames = 0
  app.renderer.on("frame", () => frames++)
  const run = async (ms: number) => {
    frames = 0
    for (let elapsed = 5; elapsed <= ms; elapsed += 5) {
      clock.advance(5)
      await app.renderer.idle()
    }
    return frames
  }
  const draws = spyOn(OptimizedBuffer.prototype, "withBuffers")
  const setCell = spyOn(OptimizedBuffer.prototype, "setCell")

  try {
    setRendererCapabilities(app.renderer, { rgb: false })
    await app.renderOnce()
    expect([art!.animationFps, tickers()]).toEqual([30, 1])
    // Each frame is one direct write into the art's own buffer, never a draw call per cell.
    expect(draws).toHaveBeenCalledTimes(1)
    expect(setCell).not.toHaveBeenCalled()
    expect(app.captureCharFrame()).toContain("█▀▀▀ █▀▀█")
    await run(1000)
    const pictures = new Set<string>()
    let drawn = 0
    for (let i = 0; i < 6; i++) {
      drawn += await run(500)
      pictures.add(JSON.stringify(app.captureSpans().lines))
    }
    // The art moves, not only redraws.
    expect([drawn, pictures.size]).toEqual([90, 6])

    // Hidden, the first tick after a frame that did not draw it stops the clock.
    setVisible(false)
    await run(100)
    expect(await run(1000)).toBe(0)
    expect([clock.pendingTimerCount, tickers()]).toEqual([0, 0])
    setVisible(true)
    await run(1000)
    expect(await run(3000)).toBe(90)

    // A still frame is drawn once and then reused.
    setAnimate(false)
    expect(art!.animationFps).toBeUndefined()
    draws.mockClear()
    expect(await run(1000)).toBe(1)
    await app.renderOnce()
    expect(draws).toHaveBeenCalledTimes(1)
    setAnimate(true)

    for (let i = 0; i < 20; i++) {
      const previous = art!
      setOpen(false)
      await app.renderOnce()
      expect(previous.isDestroyed).toBe(true)
      expect(tickers()).toBe(0)
      setOpen(true)
      expect(art).not.toBe(previous)
      expect(tickers()).toBe(1)
    }

    setOpen(false)
    expect(await run(1000)).toBe(1)
    expect(tickers()).toBe(0)
    expect(clock.pendingTimerCount).toBe(0)
  } finally {
    draws.mockRestore()
    setCell.mockRestore()
    app.renderer.destroy()
  }
})
