/** @jsxImportSource @opentui/solid */
import { CliRenderEvents, type BoxRenderable, type ScrollBoxRenderable } from "@opentui/core"
import { ManualClock, setRendererCapabilities } from "@opentui/core/testing"
import { expect, test } from "bun:test"
import { createSignal, For, type JSX } from "solid-js"
import { image, renderMedia, video } from "../fixture/media"

test("re-reads the protocol on capability reports and the pixel size after resizes, polling a bounded time", async () => {
  const clock = new ManualClock()
  await using host = await renderMedia(() => null, false, clock)
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

  // Sixel needs the pixel resolution, which arrives later without an event; only rich media asks for it, and only
  // for 10 seconds after it turns on or the terminal resizes.
  renderer.emit(CliRenderEvents.CAPABILITIES, setRendererCapabilities(renderer, { sixel: true }))
  report({ width: 800, height: 480 })
  clock.advance(1_000)
  expect(media.protocol()).toBe("blocks")
  report(null)
  await host.setRichMedia(true)
  clock.advance(10_000)
  report({ width: 800, height: 480 })
  clock.advance(1_000)
  expect(media.protocol()).toBe("blocks")
  host.app.resize(40, 20)
  report({ width: 800, height: 480 })
  clock.advance(250)
  expect(state()).toEqual({ protocol: "sixel", thumbnailFps: 10, cellAspect: 1.2, cellPixels: 20 })
})

test("rich media sends Kitty frames through files, and turning it off closes every player and restores the transport", async () => {
  await using host = await renderMedia(() => null)
  const media = host.media()
  const renderer = host.app.renderer
  expect(renderer.kittyImageTransport).toBe("raw")
  await host.setRichMedia(true)
  expect(renderer.kittyImageTransport).toBe("file")

  // Requests open clamped to the gallery, and an empty gallery opens nothing.
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
  // Nothing moves, so only the grace timer asks for the placement that takes tile 0's player.
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
  expect(host.app.renderer.listenerCount(CliRenderEvents.FRAME)).toBe(0)
})

test("a tile under a hidden ancestor drops its player, and gets it back when the ancestor shows again", async () => {
  const clock = new ManualClock()
  const [visible, setVisible] = createSignal(true)
  let tile: BoxRenderable | undefined
  // Like the session pane under a fullscreen panel, the box keeps its width while hidden, so nothing resizes.
  await using host = await renderMedia(
    () => (
      <box position="absolute" width={40} height={20} visible={visible()}>
        <scrollbox height={9}>
          <box ref={(element: BoxRenderable) => (tile = element)} height={2} flexShrink={0} />
          <box height={20} flexShrink={0} />
        </scrollbox>
      </box>
    ),
    false,
    clock,
  )
  const media = host.media()
  media.trackPoster("tile", tile!)
  const state = async () => {
    await host.app.renderOnce()
    return { shown: media.posterShown("tile"), open: media.posterOpen("tile") }
  }
  expect(await state()).toEqual({ shown: true, open: true })

  // Nothing moves; the tile keeps its player only the usual two seconds.
  setVisible(false)
  expect(await state()).toEqual({ shown: false, open: true })
  clock.advance(2_000)
  expect(await state()).toEqual({ shown: false, open: false })

  setVisible(true)
  expect(await state()).toEqual({ shown: true, open: true })
  // Only the visibility check follows frames, not another measurement each frame.
  expect(host.app.renderer.listenerCount(CliRenderEvents.FRAME)).toBe(1)
})

// Each change brings the tile from beyond half a scroll box or screen away to within it, through one event alone.
test.each([
  {
    event: "the scroll box content resizes",
    view: (grown: () => boolean, tile: () => JSX.Element) => (
      <scrollbox height={9}>
        <box height={grown() ? 2 : 20} flexShrink={0} />
        {tile()}
        <box height={10} flexShrink={0} />
      </scrollbox>
    ),
  },
  {
    event: "the scroll box resizes",
    view: (grown: () => boolean, tile: () => JSX.Element) => (
      <scrollbox height={grown() ? 9 : 4}>
        <box height={12} flexShrink={0} />
        {tile()}
        <box height={10} flexShrink={0} />
      </scrollbox>
    ),
  },
  {
    event: "the terminal resizes",
    view: (_: () => boolean, tile: () => JSX.Element) => (
      <box>
        <box height={26} flexShrink={0} />
        {tile()}
      </box>
    ),
  },
])("a tile shows and opens a player when $event", async (row) => {
  const [grown, setGrown] = createSignal(false)
  let tile: BoxRenderable | undefined
  await using host = await renderMedia(() =>
    row.view(grown, () => <box ref={(element: BoxRenderable) => (tile = element)} height={2} flexShrink={0} />),
  )
  const media = host.media()
  const state = async () => {
    await host.app.renderOnce()
    return { shown: media.posterShown("tile"), open: media.posterOpen("tile") }
  }
  host.app.resize(80, 16)
  await host.app.renderOnce()
  media.trackPoster("tile", tile!)
  expect(await state()).toEqual({ shown: false, open: false })
  if (row.event === "the terminal resizes") host.app.resize(80, 30)
  else setGrown(true)
  expect(await state()).toEqual({ shown: true, open: true })
})
