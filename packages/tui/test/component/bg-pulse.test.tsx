/** @jsxImportSource @opentui/solid */
import { BoxRenderable, RGBA } from "@opentui/core"
import { testRender } from "@opentui/solid"
import { expect, spyOn, test } from "bun:test"
import { createSignal, Show } from "solid-js"
import { BgPulse } from "../../src/component/bg-pulse"
import { ConfigProvider, useConfig } from "../../src/config"
import { createTuiResolvedConfig } from "../fixture/tui-runtime"

test("animation owns its timer without changing renderer FPS and stops when hidden, disabled or unmounted", async () => {
  const settings = { animations: false }
  const [visible, setVisible] = createSignal(true)
  const [mounted, setMounted] = createSignal(true)
  const [color, setColor] = createSignal(RGBA.fromHex("#f5a742"))
  let config!: ReturnType<typeof useConfig>
  let box!: BoxRenderable

  function Art() {
    config = useConfig()
    return (
      <box ref={box} visible={visible()} width="100%" height="100%">
        <Show when={mounted()}>
          <BgPulse backgroundPanel={RGBA.fromHex("#161616")} primary={color()} logoBase={RGBA.fromHex("#b0b0b0")} />
        </Show>
      </box>
    )
  }

  const app = await testRender(
    () => (
      <ConfigProvider
        config={createTuiResolvedConfig(settings)}
        service={{
          get: async () => settings,
          update: async (update) => {
            update(settings)
            return settings
          },
        }}
      >
        <Art />
      </ConfigProvider>
    ),
    { width: 40, height: 12, targetFps: 60, maxFps: 60 },
  )

  try {
    await app.renderOnce()
    const art = box.getChildren()[0]
    const requests = spyOn(art, "requestRender")
    const still = app.captureSpans()
    await Bun.sleep(80)
    expect(requests).not.toHaveBeenCalled()
    await app.renderOnce()
    expect(app.captureSpans()).toEqual(still)

    setColor(RGBA.fromHex("#2060a0"))
    await app.renderOnce()
    expect(app.captureSpans()).not.toEqual(still)
    const recolored = app.captureSpans()
    await app.renderOnce()
    expect(app.captureSpans()).toEqual(recolored)

    await config.update((draft) => {
      draft.animations = true
    })
    requests.mockClear()
    await Bun.sleep(80)
    expect(requests).toHaveBeenCalled()
    await app.renderOnce()
    expect(app.captureSpans()).not.toEqual(recolored)
    expect(art.live).toBeFalse()
    expect(app.renderer.liveRequestCount).toBe(0)
    expect(app.renderer.targetFps).toBe(60)
    expect(app.renderer.maxFps).toBe(60)

    setVisible(false)
    await app.renderOnce()
    requests.mockClear()
    await Bun.sleep(80)
    expect(requests).not.toHaveBeenCalled()
    setVisible(true)
    await app.renderOnce()
    await config.update((draft) => {
      draft.animations = false
    })
    await app.renderOnce()
    const frozen = app.captureSpans()
    requests.mockClear()
    await Bun.sleep(80)
    expect(requests).not.toHaveBeenCalled()
    await app.renderOnce()
    expect(app.captureSpans()).toEqual(frozen)

    await config.update((draft) => {
      draft.animations = true
    })
    setMounted(false)
    await app.renderOnce()
    await new Promise<void>((resolve) => process.nextTick(resolve))
    expect(art.isDestroyed).toBeTrue()
    requests.mockClear()
    await Bun.sleep(80)
    expect(requests).not.toHaveBeenCalled()
    expect(app.renderer.targetFps).toBe(60)
    expect(app.renderer.maxFps).toBe(60)
    requests.mockRestore()
  } finally {
    app.renderer.destroy()
  }
})
