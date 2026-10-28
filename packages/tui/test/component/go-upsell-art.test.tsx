import { expect, spyOn, test } from "bun:test"
/** @jsxImportSource @opentui/solid */
import { OptimizedBuffer, RGBA } from "@opentui/core"
import { testRender } from "@opentui/solid"
import { createSignal, Show } from "solid-js"
import "../../src/component/go-upsell-art"
import type { GoUpsellArtRenderable } from "../../src/component/go-upsell-art"

const colors = {
  background: RGBA.fromHex("#0a0a0a"),
  primary: RGBA.fromHex("#fab283"),
  logoBase: RGBA.fromHex("#9a9a9a"),
}

test("the art stops every frame when hidden, closed, or still, and leaves nothing live after repeated opens", async () => {
  const [open, setOpen] = createSignal(true)
  const [visible, setVisible] = createSignal(true)
  const [animate, setAnimate] = createSignal(true)
  let art: GoUpsellArtRenderable | undefined
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
    { width: 60, height: 20 },
  )
  const draws = spyOn(OptimizedBuffer.prototype, "withBuffers")
  const setCell = spyOn(OptimizedBuffer.prototype, "setCell")

  try {
    await app.renderOnce()
    expect(app.renderer.liveRequestCount).toBe(1)
    // Each frame is one direct write into the art's own buffer, never a draw call per cell.
    expect(draws).toHaveBeenCalledTimes(1)
    expect(setCell).not.toHaveBeenCalled()
    expect(app.captureCharFrame()).toContain("█▀▀▀ █▀▀█")

    setVisible(false)
    expect(app.renderer.liveRequestCount).toBe(0)
    setVisible(true)
    expect(app.renderer.liveRequestCount).toBe(1)

    // A still frame is drawn once and then reused.
    setAnimate(false)
    expect(app.renderer.liveRequestCount).toBe(0)
    draws.mockClear()
    await app.renderOnce()
    await app.renderOnce()
    expect(draws).toHaveBeenCalledTimes(1)
    setAnimate(true)

    for (let i = 0; i < 20; i++) {
      const previous = art!
      setOpen(false)
      expect(app.renderer.liveRequestCount).toBe(0)
      expect(app.renderer.root.liveCount).toBe(0)
      await app.renderOnce()
      expect(previous.isDestroyed).toBe(true)
      expect(previous.live).toBe(false)
      setOpen(true)
      expect(art).not.toBe(previous)
      expect(app.renderer.liveRequestCount).toBe(1)
    }

    setOpen(false)
    await app.renderOnce()
    expect(app.renderer.liveRequestCount).toBe(0)
    expect(app.renderer.isRunning).toBe(false)
    const frames = app.renderer.frameId
    await Bun.sleep(120)
    expect(app.renderer.frameId).toBe(frames)
  } finally {
    draws.mockRestore()
    setCell.mockRestore()
    app.renderer.destroy()
  }
})
