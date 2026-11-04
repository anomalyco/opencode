/** @jsxImportSource @opentui/solid */
import { CliRenderEvents, type BoxRenderable } from "@opentui/core"
import { setRendererCapabilities } from "@opentui/core/testing"
import { expect, jest, test } from "bun:test"
import { For } from "solid-js"
import { image, renderMedia, video } from "../fixture/media"

test("re-reads the protocol on capability reports and the pixel size after resizes, polling a bounded time", async () => {
  await using host = await renderMedia(() => null)
  const renderer = host.app.renderer
  const media = host.media()
  const state = () => ({
    protocol: media.protocol(),
    thumbnailFps: media.thumbnailFps(),
    cellAspect: media.cellAspect(),
    cellPixels: media.cellPixels(),
  })
  // The test renderer sends no pixel query, so it would drop the terminal's reply; set what the reply would.
  const report = (resolution: { width: number; height: number } | null) =>
    Object.assign(renderer, { _resolution: resolution })
  expect(state()).toEqual({ protocol: "blocks", thumbnailFps: 12, cellAspect: 2, cellPixels: 2 })
  renderer.emit(CliRenderEvents.CAPABILITIES, setRendererCapabilities(renderer, { kitty_graphics: true }))
  expect(state()).toEqual({ protocol: "kitty", thumbnailFps: 15, cellAspect: 2, cellPixels: 10 })
  jest.useFakeTimers()
  try {
    // Sixel needs the pixel resolution, which arrives later without an event; only rich media asks for it, and only
    // for 10 seconds after it turns on or the terminal resizes.
    renderer.emit(CliRenderEvents.CAPABILITIES, setRendererCapabilities(renderer, { sixel: true }))
    report({ width: 800, height: 480 })
    jest.advanceTimersByTime(1_000)
    expect(media.protocol()).toBe("blocks")
    report(null)
    await host.setRichMedia(true)
    jest.advanceTimersByTime(10_000)
    report({ width: 800, height: 480 })
    jest.advanceTimersByTime(1_000)
    expect(media.protocol()).toBe("blocks")
    host.app.resize(40, 20)
    report({ width: 800, height: 480 })
    jest.advanceTimersByTime(250)
    expect(state()).toEqual({ protocol: "sixel", thumbnailFps: 10, cellAspect: 1.2, cellPixels: 20 })
  } finally {
    jest.useRealTimers()
  }
})

test("opens clamped requests, and turning rich media off closes the viewer, picture-in-picture and inline playback", async () => {
  await using host = await renderMedia(() => null, true)
  const media = host.media()
  media.openViewer([], 0)
  expect(media.viewer()).toBeUndefined()
  media.openViewer([image("image"), video("video")], 5, { time: 1.5 })
  expect(media.viewer()).toMatchObject({ index: 1, time: 1.5 })
  media.openPip(video("video"))
  media.setActiveTile("tile")
  await host.setRichMedia(false)
  expect(media.viewer()).toBeUndefined()
  expect(media.pip()).toBeUndefined()
  expect(media.activeTile()).toBeUndefined()
})

test("sends Kitty frames through files while rich media is on, and stops when the provider unmounts", async () => {
  await using host = await renderMedia(() => null)
  const renderer = host.app.renderer
  expect(renderer.kittyImageTransport).toBe("raw")
  await host.setRichMedia(true)
  expect(renderer.kittyImageTransport).toBe("file")
  await host.setRichMedia(false)
  expect(renderer.kittyImageTransport).toBe("raw")

  await host.setRichMedia(true)
  host.unmount()
  expect(renderer.kittyImageTransport).toBe("raw")
})

test("lets the four video tiles that came on screen last keep a poster player, the next in line once one leaves", async () => {
  const boxes: BoxRenderable[] = []
  await using host = await renderMedia(() => (
    <box flexDirection="column">
      <For each={[0, 1, 2, 3, 4]}>{() => <box ref={(element: BoxRenderable) => boxes.push(element)} height={1} />}</For>
    </box>
  ))
  const media = host.media()
  const keys = ["a", "b", "c", "d", "e"]
  const untrack = keys.map((key, index) => media.trackPoster(key, () => boxes[index]))
  await host.app.renderOnce()
  expect(keys.filter(media.posterShown)).toEqual(keys)
  expect(keys.filter(media.posterOpen)).toEqual(["b", "c", "d", "e"])

  untrack[2]!()
  expect(keys.filter(media.posterOpen)).toEqual(["a", "b", "d", "e"])
  // A tile that leaves the screen drops off the list.
  boxes[4]!.visible = false
  await host.app.renderOnce()
  expect(keys.filter(media.posterShown)).toEqual(["a", "b", "d"])
  expect(keys.filter(media.posterOpen)).toEqual(["a", "b", "d"])

  // Back on screen, it is the latest to come on screen, and the tile on screen longest gives up its player.
  media.trackPoster("c", () => boxes[2])
  boxes[4]!.visible = true
  await host.app.renderOnce()
  expect(keys.filter(media.posterOpen)).toEqual(["b", "c", "d", "e"])
  boxes[0]!.visible = false
  await host.app.renderOnce()
  boxes[0]!.visible = true
  await host.app.renderOnce()
  expect(keys.filter(media.posterOpen)).toEqual(["a", "c", "d", "e"])
})
