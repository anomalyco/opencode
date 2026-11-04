/** @jsxImportSource @opentui/solid */
import { CliRenderEvents } from "@opentui/core"
import { setRendererCapabilities } from "@opentui/core/testing"
import { testRender } from "@opentui/solid"
import { expect, jest, test } from "bun:test"
import path from "node:path"
import type { MediaItem } from "../../src/component/media/model"
import { ConfigProvider, useConfig, type Info, type Interface } from "../../src/config"
import { Keymap } from "../../src/context/keymap"
import { MediaHost, MediaProvider, registerMediaViews, useMedia, type MediaContext } from "../../src/context/media"
import { ThemeProvider } from "../../src/context/theme"
import { DialogProvider } from "../../src/ui/dialog"
import { ToastProvider } from "../../src/ui/toast"
import { emptyThemeSource, tmpdir } from "../fixture/fixture"
import { imageFixture, videoFixture } from "../fixture/media"
import { TestTuiContexts } from "../fixture/tui-environment"
import { createTuiResolvedConfig } from "../fixture/tui-runtime"

const image: MediaItem = { id: "image", kind: "image", mime: "image/png", uri: "", path: imageFixture }
const video: MediaItem = { id: "video", kind: "video", mime: "video/mp4", uri: "", path: videoFixture }

/** Config with rich media set to `enabled`, plus a service that saves updates to it. */
function richMediaConfig(enabled: boolean) {
  let info: Info = { experimental: { "rich-media": enabled } }
  const service: Interface = {
    get: async () => info,
    update: async (update) => {
      const next = structuredClone(info)
      update(next)
      info = next
      return next
    },
  }
  return [createTuiResolvedConfig(info), service] as const
}

// The test renderer sends no pixel query, so it would drop the terminal's reply; set what the reply would.
function setResolution(host: { app: { renderer: unknown } }, resolution: { width: number; height: number } | null) {
  ;(host.app.renderer as { _resolution: unknown })._resolution = resolution
}

async function renderHost(config = createTuiResolvedConfig(), service?: Interface) {
  const temporary = await tmpdir()
  let media: MediaContext | undefined
  let settings: ReturnType<typeof useConfig> | undefined
  function Probe() {
    media = useMedia()
    settings = useConfig()
    return null
  }
  const app = await testRender(
    () => (
      <TestTuiContexts directory={temporary.path} paths={{ state: temporary.path }}>
        <ConfigProvider config={config} service={service}>
          <ThemeProvider mode="dark" source={emptyThemeSource}>
            <Keymap.Provider>
              <ToastProvider>
                <DialogProvider>
                  <MediaProvider directory={path.join(temporary.path, "media")}>
                    <Probe />
                    <box width={80} height={20}>
                      <MediaHost />
                    </box>
                  </MediaProvider>
                </DialogProvider>
              </ToastProvider>
            </Keymap.Provider>
          </ThemeProvider>
        </ConfigProvider>
      </TestTuiContexts>
    ),
    { width: 80, height: 20, kittyKeyboard: true },
  )
  // The theme provider mounts its children once theme discovery resolves.
  const deadline = Date.now() + 5_000
  while (!media && Date.now() < deadline) {
    await Bun.sleep(1)
    await app.renderOnce()
  }
  return {
    app,
    media: () => media!,
    config: () => settings!,
    async [Symbol.asyncDispose]() {
      app.renderer.destroy()
      await temporary[Symbol.asyncDispose]()
    },
  }
}

test("renders the registered viewer and PiP while they are open", async () => {
  const restore = registerMediaViews({
    viewer: () => <text>viewer {useMedia().viewer()?.index}</text>,
    pip: () => <text>pip {useMedia().pip()?.item.id}</text>,
  })
  try {
    await using host = await renderHost()
    host.media().openViewer([], 0)
    expect(host.media().viewer()).toBeUndefined()
    host.media().openViewer([image, video], 5, { time: 1.5 })
    await host.app.renderOnce()
    expect(host.app.captureCharFrame()).toContain("viewer 1")
    expect(host.media().viewer()).toEqual({ items: [image, video], index: 1, time: 1.5 })

    host.media().openPip(video, { time: 0.5 })
    await host.app.renderOnce()
    expect(host.app.captureCharFrame()).toContain("pip video")
    expect(host.media().pip()).toEqual({ item: video, time: 0.5, playing: true })

    host.media().closeViewer()
    host.media().closePip()
    await host.app.renderOnce()
    expect(host.app.captureCharFrame()).not.toContain("viewer")
    expect(host.app.captureCharFrame()).not.toContain("pip")
  } finally {
    restore()
  }
})

test("re-reads the image protocol when the terminal reports capabilities", async () => {
  await using host = await renderHost()
  expect(host.media().capabilities()).toEqual({ protocol: "blocks", thumbnailFps: 12 })
  host.app.renderer.emit(
    CliRenderEvents.CAPABILITIES,
    setRendererCapabilities(host.app.renderer, { kitty_graphics: true }),
  )
  expect(host.media().capabilities()).toEqual({ protocol: "kitty", thumbnailFps: 15 })
})

test("re-reads the pixel resolution after startup and after each resize", async () => {
  await using host = await renderHost(...richMediaConfig(true))
  const renderer = host.app.renderer
  renderer.emit(CliRenderEvents.CAPABILITIES, setRendererCapabilities(renderer, { sixel: true }))
  // Sixel needs the pixel resolution, which arrives later without an event.
  expect(host.media().capabilities().protocol).toBe("blocks")
  expect(host.media().cellAspect()).toBe(2)
  const report = async () => {
    setResolution(host, { width: 800, height: 480 })
    const deadline = Date.now() + 2_000
    while (host.media().capabilities().protocol !== "sixel" && Date.now() < deadline) await Bun.sleep(10)
  }
  await report()
  expect(host.media().capabilities()).toEqual({ protocol: "sixel", thumbnailFps: 10 })
  expect(host.media().cellAspect()).toBe(2.4)
  expect(host.media().cellPixels()).toBe(10)

  // A resize forgets the resolution until the terminal reports it again.
  host.app.resize(40, 20)
  expect(host.media().capabilities().protocol).toBe("blocks")
  await report()
  expect(host.media().capabilities().protocol).toBe("sixel")
  expect(host.media().cellPixels()).toBe(20)
})

test("polls for the pixel resolution only with rich media on and for a bounded time", async () => {
  await using host = await renderHost(...richMediaConfig(false))
  jest.useFakeTimers()
  try {
    const renderer = host.app.renderer
    renderer.emit(CliRenderEvents.CAPABILITIES, setRendererCapabilities(renderer, { sixel: true }))
    setResolution(host, { width: 800, height: 480 })
    jest.advanceTimersByTime(1_000)
    expect(host.media().capabilities().protocol).toBe("blocks")

    setResolution(host, null)
    await host.config().update((draft) => {
      draft.experimental = { "rich-media": true }
    })
    jest.advanceTimersByTime(10_000)
    setResolution(host, { width: 800, height: 480 })
    jest.advanceTimersByTime(1_000)
    expect(host.media().capabilities().protocol).toBe("blocks")

    // A resize asks again.
    host.app.resize(40, 20)
    setResolution(host, { width: 800, height: 480 })
    jest.advanceTimersByTime(250)
    expect(host.media().capabilities().protocol).toBe("sixel")
  } finally {
    jest.useRealTimers()
  }
})

test("closes the viewer, picture-in-picture and inline playback when the experiment turns off", async () => {
  const restore = registerMediaViews({ viewer: () => <text>viewer</text>, pip: () => <text>pip</text> })
  try {
    await using host = await renderHost(...richMediaConfig(true))
    host.media().openViewer([video], 0)
    host.media().openPip(video)
    host.media().setActiveTile("tile")
    await host.app.renderOnce()
    expect(host.app.captureCharFrame()).toContain("viewer")

    await host.config().update((draft) => {
      draft.experimental = { "rich-media": false }
    })
    expect(host.media().viewer()).toBeUndefined()
    expect(host.media().pip()).toBeUndefined()
    expect(host.media().activeTile()).toBeUndefined()
    await host.app.renderOnce()
    expect(host.app.captureCharFrame()).not.toContain("viewer")
  } finally {
    restore()
  }
})
