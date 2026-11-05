/** @jsxImportSource @opentui/solid */
import {
  CliRenderEvents,
  ImageRenderable,
  TextRenderable,
  type Renderable,
  type TextareaRenderable,
} from "@opentui/core"
import { ManualClock, setRendererCapabilities } from "@opentui/core/testing"
import { expect, test } from "bun:test"
import { descendants, image, longVideoFixture, renderMedia, video } from "../fixture/media"

type Viewer = Awaited<ReturnType<typeof renderMedia>>

test("takes the keys from the editor, even when a closing dialog focuses it, and gives them back", async () => {
  let composer: TextareaRenderable | undefined
  let submits = 0
  await using viewer = await renderMedia(() => (
    <textarea
      ref={(element: TextareaRenderable) => (composer = element)}
      keyBindings={[{ name: "return", action: "submit" }]}
      onSubmit={() => submits++}
    />
  ))
  composer!.focus()
  // Opened from the palette, which focuses the editor again a moment after it is cleared.
  const refocused = Promise.withResolvers<void>()
  viewer.app.renderer.on(CliRenderEvents.FOCUSED_RENDERABLE, (node: Renderable | null) => {
    if (node === composer) refocused.resolve()
  })
  viewer.dialog().replace(() => <text>palette</text>)
  viewer.media().openViewer([image("image")], 0)
  viewer.dialog().clear()
  await refocused.promise
  await viewer.app.mockInput.typeText("hello")
  viewer.app.mockInput.pressEnter()
  await viewer.app.renderOnce()
  expect(composer!.plainText).toBe("")
  expect(submits).toBe(0)
  expect(viewer.media().viewer()).toBeDefined()
  expect(viewer.keymap().mode.current()).toBe("modal")

  viewer.app.mockInput.pressEscape()
  await viewer.until(() => viewer.media().viewer() === undefined && composer!.focused)
  expect(viewer.keymap().mode.current()).toBe("base")
})

test("fills the terminal under toasts, and a dialog over it takes its keys until it closes", async () => {
  await using viewer = await renderMedia(() => null)
  viewer.media().openViewer([image("a"), image("b")], 0)
  await viewer.until(() => viewer.frame().includes("1 / 2"))
  expect(viewer.find("media-viewer")).toMatchObject({ width: 80, height: 30 })
  viewer.toast().show({ message: "Copied to clipboard", variant: "info" })
  await viewer.app.renderOnce()
  expect(viewer.frame()).toContain("Copied to clipboard")

  viewer.dialog().replace(() => <text>over the viewer</text>)
  await viewer.press("]")
  expect(viewer.frame()).toContain("1 / 2")
  viewer.app.mockInput.pressEscape()
  await viewer.until(() => viewer.dialog().stack.length === 0)
  expect(viewer.media().viewer()).toBeDefined()
  await viewer.press("]")
  await viewer.until(() => viewer.frame().includes("2 / 2"))
})

test("zooms an image with keys and the wheel, pans it by dragging, resets, and closes from the header", async () => {
  await using viewer = await renderMedia(() => null)
  viewer.media().openViewer([image("image")], 0)
  await viewer.until(() => viewer.frame().includes("96×48"))
  const full = { left: 0, top: 0, width: 96, height: 48 }
  expect(picture(viewer).crop).toEqual(full)

  for (const key of ["+", "+", "+"]) await viewer.press(key)
  const zoomed = picture(viewer).crop!
  expect(zoomed.width).toBeLessThan(full.width)
  expect(zoomed.height).toBeLessThan(full.height)
  expect(viewer.frame()).toContain("r reset")
  const stage = viewer.find("media-viewer-stage")!
  const center = { x: stage.x + Math.floor(stage.width / 2), y: stage.y + Math.floor(stage.height / 2) }
  await viewer.app.mockMouse.drag(center.x, center.y, center.x + 10, center.y)
  expect(picture(viewer).crop!.left).toBeLessThan(zoomed.left)

  await viewer.press("r")
  expect(picture(viewer).crop).toEqual(full)
  await viewer.app.mockMouse.scroll(center.x, center.y, "up")
  await viewer.app.renderOnce()
  expect(picture(viewer).crop!.width).toBeLessThan(full.width)
  await viewer.press("i")
  expect(viewer.frame()).toContain("protocol  blocks")

  // esc in the header closes the viewer on a click, not when a drag is released over it.
  const esc = viewer.frame().split("\n")[0]!.lastIndexOf("esc")
  await viewer.app.mockMouse.drag(center.x, center.y, esc, 0)
  expect(viewer.media().viewer()).toBeDefined()
  await viewer.app.mockMouse.click(esc, 0)
  expect(viewer.media().viewer()).toBeUndefined()
})

test("clicking the current filmstrip tile keeps the image's size and zoom", async () => {
  await using viewer = await renderMedia(() => null)
  viewer.media().openViewer([image("a"), image("b")], 0)
  await viewer.until(() => viewer.frame().includes("1 / 2 · 96×48"))
  await viewer.press("+")
  const zoomed = picture(viewer).crop
  const tile = viewer.find("media-viewer-filmstrip")!.getChildren()[0]!
  await viewer.app.mockMouse.click(tile.x + 1, tile.y + 1)
  await viewer.app.renderOnce()
  expect(viewer.frame()).toContain("1 / 2 · 96×48")
  expect(picture(viewer).crop).toEqual(zoomed)
})

test("arrows move between images and seek in a video, where brackets move on", async () => {
  await using viewer = await renderMedia(() => null)
  viewer.media().openViewer([image("image"), video("clip"), image("last")], 0)
  await viewer.until(() => viewer.frame().includes("1 / 3"))
  await viewer.press("right")
  await viewer.until(() => viewer.frame().includes("2 / 3") && viewer.frame().includes("clip.mp4"))
  await viewer.press("right")
  expect(viewer.frame()).toContain("2 / 3")
  await viewer.press("]")
  await viewer.until(() => viewer.frame().includes("3 / 3"))
  await viewer.press("]")
  await viewer.until(() => viewer.frame().includes("1 / 3"))
  await viewer.press("[")
  await viewer.until(() => viewer.frame().includes("3 / 3"))
})

test("explains media it cannot show", async () => {
  await using viewer = await renderMedia(() => null)
  const webm = { id: "webm", kind: "video" as const, mime: "video/webm", uri: "", name: "clip.webm" }
  viewer.media().openViewer([video("broken", { path: import.meta.path }), webm], 0)
  await viewer.until(() => viewer.frame().includes("Can't play this video"))
  expect(viewer.frame()).toContain("H.264")
  await viewer.press("]")
  await viewer.until(() => viewer.frame().includes("Can't play video/webm"))
  expect(viewer.frame()).not.toContain("space play")
})

test("controls a video from the keyboard", async () => {
  const clock = new ManualClock()
  await using viewer = await renderMedia(() => null, false, clock)
  const player = await openVideo(viewer)
  expect(player.audio).toBe(true)
  await viewer.until(() => viewer.frame().includes("160×90 · 0:02 · 10 fps"))
  await viewer.press(" ")
  expect(player.paused).toBe(true)

  // Each key and the time in seconds it leaves the 2 s clip at, starting from where the previous one left it.
  const seeks = [
    ["5", 1],
    [".", 1.1],
    [",", 1],
    ["shift+left", 0],
    ["right", 2],
    ["0", 0],
  ] as const
  for (const [key, time] of seeks) {
    await viewer.press(key)
    clock.advance(120)
    expect(player.currentTime).toBeCloseTo(time, 1)
  }
  expect(player.paused).toBe(true)

  await viewer.press("m")
  expect(player.muted).toBe(true)
  await viewer.press("l")
  expect(player.loop).toBe(true)
  await viewer.press("down")
  expect(player.volume).toBeCloseTo(0.9)
  await viewer.press(" ")
  await viewer.until(() => player.playing)
})

test("a key seeks again to its last time once playback has moved the player", async () => {
  await using viewer = await renderMedia(() => null)
  const player = await openVideo(viewer)
  await viewer.press(" ")
  await viewer.press("0")
  await viewer.press(" ")
  await viewer.until(() => player.currentTime > 0.3)
  await viewer.press("0")
  await viewer.until(() => player.currentTime < 0.2)
})

test("keys held on a paused video add up into one throttled seek, which the seek bar shares", async () => {
  const clock = new ManualClock()
  await using viewer = await renderMedia(() => null, false, clock)
  const player = await openVideo(viewer)
  await viewer.press(" ")
  const bar = seekBar(viewer)!
  let seeks = 0
  player.onSeek = () => seeks++

  // The first key seeks at once; the next ones wait out the interval, each starting where the one before aims.
  await viewer.press("shift+right")
  expect(seeks).toBe(1)
  expect(player.currentTime).toBeCloseTo(1, 1)
  for (const key of [".", ".", "."]) await viewer.press(key)
  expect(seeks).toBe(1)
  // The playhead and time show where the seeks are headed.
  expect(bar.plainText.indexOf("●")).toBe(Math.round((1.3 / 2) * (bar.width - 1)))
  expect(viewer.frame()).toContain("0:01 / 0:02")
  clock.advance(120)
  expect(seeks).toBe(2)
  expect(player.currentTime).toBeCloseTo(1.3, 1)

  // A press on the bar right after a key replaces the key's pending seek and waits its turn.
  await viewer.press("0")
  await viewer.app.mockMouse.pressDown(bar.x + 10, bar.y)
  expect(seeks).toBe(2)
  clock.advance(120)
  expect(seeks).toBe(3)
  expect(player.currentTime).toBeCloseTo((10 / (bar.width - 1)) * 2, 1)
})

test("the info shows the Kitty transport's file state and reads it again every second", async () => {
  const clock = new ManualClock()
  await using viewer = await renderMedia(() => null, false, clock)
  const renderer = viewer.app.renderer
  renderer.emit(CliRenderEvents.CAPABILITIES, setRendererCapabilities(renderer, { kitty_graphics: true }))
  // The test terminal never answers a probe; report the states one would go through.
  let fileState = "probing"
  const status = renderer.kittyImageTransportStatus
  Object.defineProperty(renderer, "kittyImageTransportStatus", { get: () => ({ ...status, fileState }) })
  viewer.media().openViewer([image("image")], 0)
  await viewer.press("i")
  // Each state, the time after the previous step, and what the info shows then.
  const steps = [
    ["probing", 0, "probing"],
    ["ready", 999, "probing"],
    ["ready", 1, "file"],
    ["timeout", 1_000, "raw"],
  ] as const
  for (const [state, wait, shown] of steps) {
    fileState = state
    clock.advance(wait)
    await viewer.app.renderOnce()
    expect(viewer.frame()).toContain(`protocol  kitty · ${shown}`)
  }
})

test("the seek bar previews the hovered frame silently and seeks where it is clicked", async () => {
  await using viewer = await renderMedia(() => null)
  const player = await openVideo(viewer)
  await viewer.press(" ")
  await viewer.press("0")
  const bar = seekBar(viewer)!
  const middle = bar.x + Math.floor(bar.width / 2)

  await viewer.app.mockMouse.moveTo(middle, bar.y)
  await viewer.until(() => (viewer.videos("media-seek-preview")[0]?.currentTime ?? 0) > 0.5)
  expect(viewer.videos("media-seek-preview")[0]!.audio).toBe(false)
  expect(player.currentTime).toBe(0)
  // The bar draws a few colour runs, not a span per cell: fill, playhead, track and the hover marker between.
  expect(bar.textNode.getChildren().length).toBeLessThanOrEqual(5)

  await viewer.app.mockMouse.click(middle, bar.y)
  await viewer.until(() => Math.abs(player.currentTime - 1) < 0.15)
  expect(player.paused).toBe(true)
})

test("the seek preview seeks once the pointer rests, at most every 120 ms, and stays mounted across the bar", async () => {
  const clock = new ManualClock()
  await using viewer = await renderMedia(() => null, false, clock)
  await openVideo(viewer)
  await viewer.press(" ")
  const bar = seekBar(viewer)!
  await viewer.app.mockMouse.moveTo(bar.x + 5, bar.y)
  await viewer.until(() => viewer.videos("media-seek-preview")[0]?.ready === true)
  const preview = viewer.videos("media-seek-preview")[0]!
  let seeks = 0
  preview.onSeek = () => seeks++

  // A sweep that never rests 80 ms seeks nothing until it stops, then seeks once, to where it stopped.
  for (let column = 6; column <= 30; column++) {
    await viewer.app.mockMouse.moveTo(bar.x + column, bar.y)
    clock.advance(30)
  }
  expect(seeks).toBe(0)
  clock.advance(80)
  expect(seeks).toBe(1)
  expect(preview.currentTime).toBeCloseTo((30 / (bar.width - 1)) * 2, 1)
  expect(viewer.videos("media-seek-preview")[0]).toBe(preview)

  // A rest right after a seek waits out the rest of the interval.
  await viewer.app.mockMouse.moveTo(bar.x + 31, bar.y)
  clock.advance(80)
  expect(seeks).toBe(1)
  clock.advance(40)
  expect(seeks).toBe(2)

  // A new open shows the first frame, even of a file it showed before, so it seeks to the same time again.
  preview.source = longVideoFixture
  await viewer.until(() => preview.ready && preview.source === longVideoFixture)
  clock.advance(1_000)
  expect(preview.currentTime).toBeCloseTo((31 / (bar.width - 1)) * 2, 1)
})

test("scrubbing seeks the main player at most every 120 ms, lands on release, and never seeks the preview", async () => {
  const clock = new ManualClock()
  await using viewer = await renderMedia(() => null, false, clock)
  const player = await openVideo(viewer)
  await viewer.press(" ")
  const bar = seekBar(viewer)!
  await viewer.app.mockMouse.moveTo(bar.x + 5, bar.y)
  await viewer.until(() => viewer.videos("media-seek-preview")[0]?.ready === true)
  const preview = viewer.videos("media-seek-preview")[0]!
  let previewSeeks = 0
  let playerSeeks = 0
  preview.onSeek = () => previewSeeks++
  player.onSeek = () => playerSeeks++

  await viewer.app.mockMouse.pressDown(bar.x + 5, bar.y)
  expect(playerSeeks).toBe(1)
  for (const column of [10, 15, 20]) await viewer.app.mockMouse.moveTo(bar.x + column, bar.y)
  expect(playerSeeks).toBe(1)
  clock.advance(120)
  expect(playerSeeks).toBe(2)
  expect(player.currentTime).toBeCloseTo((20 / (bar.width - 1)) * 2, 1)
  await viewer.app.mockMouse.moveTo(bar.x + 25, bar.y)
  clock.advance(1_000)
  // The main player shows the frame, so the preview hides and keeps still.
  expect(viewer.find("media-seek-preview")!.visible).toBe(false)
  expect(previewSeeks).toBe(0)

  // The throttle already sought where the drag ends, so the release does not decode it again.
  await viewer.app.mockMouse.release(bar.x + 25, bar.y)
  expect(playerSeeks).toBe(3)
  expect(player.currentTime).toBeCloseTo((25 / (bar.width - 1)) * 2, 1)
  // Still over the bar, the preview shows again once it has caught up, not with the frame from before the scrub.
  clock.advance(79)
  expect(viewer.find("media-seek-preview")!.visible).toBe(false)
  clock.advance(1)
  expect(viewer.find("media-seek-preview")!.visible).toBe(true)
  expect(previewSeeks).toBe(1)
  clock.advance(1_000)
  expect(previewSeeks).toBe(1)
  expect(playerSeeks).toBe(3)

  // A scrub that ends where the preview already shows leaves it as it is.
  await viewer.app.mockMouse.pressDown(bar.x + 25, bar.y)
  await viewer.app.mockMouse.release(bar.x + 25, bar.y)
  expect(viewer.find("media-seek-preview")!.visible).toBe(true)
  clock.advance(1_000)
  expect(previewSeeks).toBe(1)
})

test("a click seeks once, a release lands at once, and the next press waits out the interval", async () => {
  const clock = new ManualClock()
  await using viewer = await renderMedia(() => null, false, clock)
  const player = await openVideo(viewer)
  await viewer.press(" ")
  const bar = seekBar(viewer)!
  const timeAt = (column: number) => (column / (bar.width - 1)) * 2
  let seeks = 0
  player.onSeek = () => seeks++

  // The press seeks; the release at the same column has nothing new to decode.
  await viewer.app.mockMouse.click(bar.x + 5, bar.y)
  expect(seeks).toBe(1)

  clock.advance(120)
  await viewer.app.mockMouse.pressDown(bar.x + 10, bar.y)
  expect(seeks).toBe(2)
  await viewer.app.mockMouse.moveTo(bar.x + 30, bar.y)
  expect(seeks).toBe(2)
  // Released before the throttle's timer fires, the drag still lands where it ends.
  await viewer.app.mockMouse.release(bar.x + 30, bar.y)
  expect(seeks).toBe(3)
  expect(player.currentTime).toBeCloseTo(timeAt(30), 1)

  // That seek counts toward the interval, so a press right after it waits.
  await viewer.app.mockMouse.pressDown(bar.x + 40, bar.y)
  expect(seeks).toBe(3)
  clock.advance(119)
  expect(seeks).toBe(3)
  clock.advance(1)
  expect(seeks).toBe(4)
  expect(player.currentTime).toBeCloseTo(timeAt(40), 1)
  await viewer.app.mockMouse.release(bar.x + 40, bar.y)
  expect(seeks).toBe(4)
})

test("a slow seek makes the next one wait twice as long as it took", async () => {
  const clock = new ManualClock()
  await using viewer = await renderMedia(() => null, false, clock)
  const player = await openVideo(viewer)
  await viewer.press(" ")
  const bar = seekBar(viewer)!
  let seeks = 0
  let decodeMs = 100
  // The first seek takes 100 ms of the renderer's clock, like a slow 1080p decode.
  player.onSeek = () => {
    seeks++
    clock.advance(decodeMs)
    decodeMs = 0
  }

  await viewer.app.mockMouse.pressDown(bar.x + 5, bar.y)
  expect(seeks).toBe(1)
  await viewer.app.mockMouse.moveTo(bar.x + 20, bar.y)
  // 120 ms after the slow seek started would be 20 ms from now; twice its 100 ms is another 100.
  clock.advance(99)
  expect(seeks).toBe(1)
  clock.advance(1)
  expect(seeks).toBe(2)
  await viewer.app.mockMouse.release(bar.x + 20, bar.y)
})

test("while dragged, the playhead and time follow the pointer ahead of the throttled seeks", async () => {
  const clock = new ManualClock()
  await using viewer = await renderMedia(() => null, false, clock)
  const player = await openVideo(viewer)
  await viewer.press(" ")
  await viewer.press("0")
  const bar = seekBar(viewer)!
  const end = bar.width - 1

  await viewer.app.mockMouse.pressDown(bar.x + 2, bar.y)
  await viewer.app.mockMouse.moveTo(bar.x + end, bar.y)
  await viewer.app.renderOnce()
  expect(player.currentTime).toBeLessThan(0.5)
  expect(bar.plainText.indexOf("●")).toBe(end)
  expect(viewer.frame()).toContain("0:02 / 0:02")

  await viewer.app.mockMouse.release(bar.x + end, bar.y)
  await viewer.app.renderOnce()
  expect(player.currentTime).toBeCloseTo(2, 0)
})

test("leaving the bar drops the preview's pending seek", async () => {
  const clock = new ManualClock()
  await using viewer = await renderMedia(() => null, false, clock)
  await openVideo(viewer)
  await viewer.press(" ")
  const bar = seekBar(viewer)!
  await viewer.app.mockMouse.moveTo(bar.x + 5, bar.y)
  await viewer.until(() => viewer.videos("media-seek-preview")[0]?.ready === true)
  clock.advance(1_000)
  const idleTimers = clock.pendingTimerCount

  await viewer.app.mockMouse.moveTo(bar.x + 20, bar.y)
  expect(clock.pendingTimerCount).toBe(idleTimers + 1)
  await viewer.app.mockMouse.moveTo(bar.x + 20, bar.y - 2)
  expect(viewer.find("media-seek-preview")).toBeUndefined()
  expect(clock.pendingTimerCount).toBe(idleTimers)
})

test("the seek bar keeps its text while time passes within the playhead's column", async () => {
  await using viewer = await renderMedia(() => null)
  const player = await openVideo(viewer)
  await viewer.press(" ")
  await viewer.press("0")
  const bar = seekBar(viewer)!
  let rebuilds = 0
  bar.on("line-info-change", () => rebuilds++)
  player.seek(0.01)
  await viewer.app.renderOnce()
  expect(rebuilds).toBe(0)
  player.seek(1)
  await viewer.app.renderOnce()
  expect(rebuilds).toBe(1)
})

test("scrubbing pauses a playing video and plays it again on release", async () => {
  await using viewer = await renderMedia(() => null)
  const player = await openVideo(viewer)
  const bar = seekBar(viewer)!
  await viewer.app.mockMouse.pressDown(bar.x, bar.y)
  await viewer.app.mockMouse.moveTo(bar.x + Math.floor(bar.width / 2), bar.y)
  await viewer.app.renderOnce()
  expect(player.paused).toBe(true)

  await viewer.app.mockMouse.release(bar.x + Math.floor(bar.width / 2), bar.y)
  expect(player.playing).toBe(true)
  expect(player.currentTime).toBeCloseTo(1, 0)
})

test("the filmstrip names videos instead of opening players for them", async () => {
  await using viewer = await renderMedia(() => null)
  viewer.media().openViewer([video("first"), video("second"), image("image")], 0)
  await viewer.until(() => viewer.videos("media-viewer-stage")[0]?.playing === true)
  expect(viewer.videos("media-viewer-filmstrip")).toHaveLength(0)
  expect(viewer.frame()).toContain("▶ second.mp4")
  const tiles = viewer.find("media-viewer-filmstrip")!
  expect(descendants(tiles).filter((node) => node instanceof ImageRenderable)).toHaveLength(1)

  // Hovering a named video does not make it the one inline tile allowed to play.
  for (const tile of tiles.getChildren().slice(0, 2)) {
    await viewer.app.mockMouse.moveTo(tile.x + 1, tile.y + 1)
    await viewer.app.renderOnce()
    expect(viewer.media().activeTile()).toBeUndefined()
  }
})

test("clicking the current filmstrip tile keeps the video playing", async () => {
  await using viewer = await renderMedia(() => null)
  const player = await openVideo(viewer)
  const tile = viewer.find("media-viewer-filmstrip")!.getChildren()[1]!
  await viewer.app.mockMouse.click(tile.x + 1, tile.y + 1)
  await viewer.app.renderOnce()
  expect(viewer.videos("media-viewer-stage")[0]).toBe(player)
  expect(player.playing).toBe(true)
  expect(viewer.frame()).toContain("space pause")
})

/** Opens the viewer at a video after an image and waits for it to play. */
async function openVideo(viewer: Viewer) {
  viewer.media().openViewer([image("image"), video("clip")], 1)
  await viewer.until(() => viewer.videos("media-viewer-stage")[0]?.playing === true && seekBar(viewer) !== undefined)
  return viewer.videos("media-viewer-stage")[0]!
}

function picture(viewer: Viewer) {
  return descendants(viewer.find("media-viewer-stage")!).find((node) => node instanceof ImageRenderable)!
}

function seekBar(viewer: Viewer) {
  return descendants(viewer.find("media-viewer")!).find(
    (node): node is TextRenderable => node instanceof TextRenderable && node.plainText.includes("●"),
  )
}
