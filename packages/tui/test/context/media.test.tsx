/** @jsxImportSource @opentui/solid */
import { CliRenderEvents, type BoxRenderable, type ScrollBoxRenderable } from "@opentui/core"
import { ManualClock, setRendererCapabilities } from "@opentui/core/testing"
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

test("players go to the four tiles showing the most of themselves, and stay two seconds with tiles that drop out", async () => {
  const clock = new ManualClock()
  const boxes: BoxRenderable[] = []
  let scroll: ScrollBoxRenderable | undefined
  // A 9-row scroll box over twelve 2-row tiles: four show whole, and the fifth shows its first row.
  await using host = await renderMedia(
    () => (
      <scrollbox ref={(element: ScrollBoxRenderable) => (scroll = element)} height={9}>
        <For each={Array.from({ length: 12 })}>
          {() => <box ref={(element: BoxRenderable) => boxes.push(element)} height={2} flexShrink={0} />}
        </For>
      </scrollbox>
    ),
    false,
    clock,
  )
  const media = host.media()
  const keys = boxes.map((_, index) => String(index))
  const untrack = keys.map((key, index) => media.trackPoster(key, boxes[index]!))
  let opened = 0
  let open: string[] = []
  const settle = async () => {
    await host.app.renderOnce()
    const next = keys.filter(media.posterOpen)
    opened += next.filter((key) => !open.includes(key)).length
    open = next
  }
  await settle()
  // Tiles within half the box's height show before they scroll in.
  expect(keys.filter(media.posterShown).join()).toBe("0,1,2,3,4,5,6")
  expect(open.join()).toBe("0,1,2,3")

  // Scrolled a row, tile 4 shows whole and takes a player from tile 0, now half hidden, which keeps its own for now.
  // Scrolling back and forth over that edge opens no player again.
  for (const top of [1, 0, 1, 0, 1]) {
    scroll!.scrollTo(top)
    clock.advance(500)
    await settle()
    expect(open.join()).toBe("0,1,2,3,4")
  }
  expect(opened).toBe(5)
  clock.advance(2_000)
  await settle()
  expect(open.join()).toBe("1,2,3,4")

  // Under the viewer, every tile keeps its player only as long, so a quick look opens no player again.
  media.openViewer([image("image")], 0)
  clock.advance(1_000)
  await settle()
  media.closeViewer()
  await settle()
  expect(open.join()).toBe("1,2,3,4")
  media.openViewer([image("image")], 0)
  await settle()
  clock.advance(2_000)
  await settle()
  expect(open).toEqual([])
  media.closeViewer()
  await settle()
  expect(open.join()).toBe("1,2,3,4")
  expect(opened).toBe(9)

  // With no tile left, nothing follows the scroll box.
  untrack.forEach((stop) => stop())
  await settle()
  expect(keys.filter(media.posterShown)).toEqual([])
  expect(scroll!.verticalScrollBar.listenerCount("change")).toBe(0)
  expect(scroll!.content.listenerCount("resize")).toBe(0)
})
