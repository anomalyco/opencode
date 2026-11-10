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
import { createRoot, type JSX } from "solid-js"
import type { MediaItem } from "../../src/component/media/model"
import { createSeekThrottle } from "../../src/component/media/seek-bar"
import {
  descendants,
  header,
  image,
  imageFixture,
  longVideoFixture,
  renderMedia,
  showsHeader,
  video,
} from "../fixture/media"

type Viewer = Awaited<ReturnType<typeof renderViewer>>

test("takes the keys from the editor, even when a closing dialog focuses it, and gives them back", async () => {
  let composer: TextareaRenderable | undefined
  let submits = 0
  await using viewer = await renderViewer(() => (
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
  await using viewer = await renderViewer()
  viewer.media().openViewer([image("a"), image("b")], 0)
  await viewer.until(() => showsHeader(viewer.frame(), "a.png", "1 of 2"))
  expect(viewer.find("media-viewer")).toMatchObject({ width: 80, height: 30 })
  viewer.toast().show({ message: "Copied to clipboard", variant: "info" })
  await viewer.app.renderOnce()
  expect(viewer.frame()).toContain("Copied to clipboard")

  viewer.dialog().replace(() => <text>over the viewer</text>)
  await viewer.press("]")
  // The toast covers the header's right end; its name still shows the item.
  expect(header(viewer.frame())).toStartWith("a.png")
  viewer.app.mockInput.pressEscape()
  await viewer.until(() => viewer.dialog().stack.length === 0)
  expect(viewer.media().viewer()).toBeDefined()
  await viewer.press("]")
  await viewer.until(() => header(viewer.frame()).startsWith("b.png"))

  // The keys panel lists every group and closes on escape before the viewer does.
  await viewer.press("?")
  expect(viewer.find("media-viewer-keys")).toBeDefined()
  for (const group of ["Playback", "Navigate", "View"]) expect(viewer.frame()).toContain(group)
  viewer.app.mockInput.pressEscape()
  await viewer.app.renderOnce()
  expect(viewer.find("media-viewer-keys")).toBeUndefined()
  expect(viewer.media().viewer()).toBeDefined()
})

test("zooms an image with keys and the wheel, pans it by dragging, resets, and closes from the header", async () => {
  await using viewer = await renderViewer()
  viewer.media().openViewer([image("a"), image("b")], 0)
  await viewer.until(() => showsHeader(viewer.frame(), "a.png", "1 of 2") && picture(viewer).crop !== undefined)
  const full = { left: 0, top: 0, width: 96, height: 48 }
  expect(picture(viewer).crop).toEqual(full)

  for (const key of ["+", "+", "+"]) await viewer.press(key)
  const zoomed = picture(viewer).crop!
  expect(zoomed.width).toBeLessThan(full.width)
  expect(zoomed.height).toBeLessThan(full.height)
  // The zoom shows on the picture for a moment.
  expect(viewer.find("media-viewer-osd")).toBeDefined()
  expect(viewer.frame()).toMatch(/Zoom \d+%/)
  viewer.clock.advance(1_200)
  await viewer.app.renderOnce()
  expect(viewer.find("media-viewer-osd")).toBeUndefined()
  // Clicking the filmstrip tile of the image it shows keeps its size and zoom.
  const tile = viewer.find("media-viewer-filmstrip")!.getChildren()[0]!
  await viewer.app.mockMouse.click(tile.x + 1, tile.y + 1)
  await viewer.app.renderOnce()
  expect(showsHeader(viewer.frame(), "a.png", "1 of 2")).toBe(true)
  expect(picture(viewer).crop).toEqual(zoomed)

  const stage = viewer.find("media-viewer-stage")!
  const center = { x: stage.x + Math.floor(stage.width / 2), y: stage.y + Math.floor(stage.height / 2) }
  await viewer.app.mockMouse.drag(center.x, center.y, center.x + 10, center.y)
  expect(picture(viewer).crop!.left).toBeLessThan(zoomed.left)
  await viewer.press("r")
  expect(picture(viewer).crop).toEqual(full)
  expect(viewer.frame()).toContain("Fit")
  await viewer.app.mockMouse.scroll(center.x, center.y, "up")
  await viewer.app.renderOnce()
  expect(picture(viewer).crop!.width).toBeLessThan(full.width)
  await viewer.press("i")
  expect(viewer.frame()).toContain("Protocol    blocks")
  expect(viewer.frame()).toContain("Resolution  96×48")

  // esc in the header closes the viewer on a click, not when a drag is released over it.
  const lines = viewer.frame().split("\n")
  const row = lines.findIndex((line) => line.includes("1 of 2  esc"))
  const esc = { x: lines[row]!.lastIndexOf("esc"), y: row }
  await viewer.app.mockMouse.drag(center.x, center.y, esc.x, esc.y)
  expect(viewer.media().viewer()).toBeDefined()
  await viewer.app.mockMouse.click(esc.x, esc.y)
  expect(viewer.media().viewer()).toBeUndefined()
})

test("the header names the file without its path, and a long name gives way to the position and esc", async () => {
  await using viewer = await renderViewer()
  const name = `/home/me/pasted/${"long-name-".repeat(9)}end.png`
  viewer.media().openViewer([image("long", { name }), image("b")], 0)
  await viewer.until(() => header(viewer.frame()).endsWith("1 of 2  esc"))
  const line = header(viewer.frame())
  expect(line).not.toContain("/home/me")
  // Shortened in the middle, keeping its start and extension, with a gap before the position.
  expect(line).toMatch(/^long-name-\S*\.\.\.\S*-end\.png {2,}1 of 2  esc$/)
  // The filmstrip's labels leave the path out too.
  expect(viewer.frame()).not.toContain("/home/")
})

test("the header's name opens a menu to copy the file's path and open its folder, and c copies it, when there is a file", async () => {
  await using viewer = await renderViewer()
  const kept: MediaItem = { id: "kept", kind: "image", mime: "image/png", uri: "media:abc", name: "kept.png" }
  viewer.media().openViewer([image("a"), kept], 0)
  await viewer.until(() => showsHeader(viewer.frame(), "a.png", "1 of 2"))
  const row = () =>
    viewer
      .frame()
      .split("\n")
      .findIndex((line) => line.trim() !== "")
  await viewer.app.mockMouse.click(3, row())
  await viewer.until(() => viewer.frame().includes("Copy path"))
  expect(viewer.frame()).toContain("Open folder")
  viewer.app.mockInput.pressEnter()
  await viewer.until(() => viewer.copied.length === 1 && viewer.dialog().stack.length === 0)
  // c copies it without the menu.
  await viewer.press("c")
  await viewer.until(() => viewer.copied.length === 2)
  expect(viewer.copied).toEqual([imageFixture, imageFixture])

  // A file known only by its content has no path to copy.
  await viewer.press("]")
  // The copy's toast may still cover the header's right end.
  await viewer.until(() => header(viewer.frame()).startsWith("kept.png"))
  await viewer.app.mockMouse.click(3, row())
  await viewer.app.renderOnce()
  expect(viewer.dialog().stack.length).toBe(0)
  await viewer.press("c")
  expect(viewer.frame()).toContain("No file to copy")
  expect(viewer.copied).toHaveLength(2)
})

test("arrows move between images and seek in a video, brackets move on, and unplayable media is explained", async () => {
  await using viewer = await renderViewer()
  const webm = { id: "webm", kind: "video" as const, mime: "video/webm", uri: "", name: "clip.webm" }
  viewer.media().openViewer([image("image"), video("clip"), video("broken", { path: import.meta.path }), webm], 0)
  await viewer.until(() => showsHeader(viewer.frame(), "image.png", "1 of 4"))
  await viewer.press("right")
  await viewer.until(() => showsHeader(viewer.frame(), "clip.mp4", "2 of 4"))
  await viewer.press("right")
  expect(showsHeader(viewer.frame(), "clip.mp4", "2 of 4")).toBe(true)
  await viewer.press("]")
  await viewer.until(() => viewer.frame().includes("Can't play this video"))
  expect(viewer.frame()).toContain("H.264")
  await viewer.press("]")
  await viewer.until(() => viewer.frame().includes("Can't play video/webm"))
  await viewer.press("]")
  await viewer.until(() => showsHeader(viewer.frame(), "image.png", "1 of 4"))
  await viewer.press("[")
  await viewer.until(() => showsHeader(viewer.frame(), "clip.webm", "4 of 4"))
})

test("controls a video from the keyboard, adding up held keys into one throttled seek", async () => {
  await using viewer = await renderViewer()
  const player = await openVideo(viewer)
  expect(player.audio).toBe(true)
  await viewer.press("i")
  await viewer.until(() => viewer.frame().includes("Resolution  160×90"))
  expect(viewer.frame()).toContain("Frame rate  10 fps")
  expect(viewer.frame()).toContain("Duration    0:02")
  await viewer.press("i")
  await viewer.press(" ")
  expect(player.paused).toBe(true)

  // Each key and the time in seconds it leaves the 2 s clip at, starting from where the previous one left it.
  const steps = [
    ["5", 1],
    [".", 1.1],
    [",", 1],
    ["shift+left", 0],
    ["right", 2],
    ["0", 0],
  ] as const
  for (const [key, time] of steps) {
    await viewer.press(key)
    viewer.clock.advance(120)
    expect(player.currentTime).toBeCloseTo(time, 1)
  }

  // The first key seeks at once; the next ones wait out the interval, each starting where the one before aims, and
  // the seek bar shows where they are headed.
  let seeks = 0
  player.onSeek = () => seeks++
  await viewer.press("shift+right")
  expect(seeks).toBe(1)
  for (const key of [".", ".", "."]) await viewer.press(key)
  expect(seeks).toBe(1)
  const bar = seekBar(viewer)!
  expect(bar.plainText.indexOf("●")).toBe(Math.round((1.3 / 2) * (bar.width - 1)))
  expect(viewer.frame()).toMatch(/0:01 +━*●─* +0:02/)
  viewer.clock.advance(120)
  expect(seeks).toBe(2)
  expect(player.currentTime).toBeCloseTo(1.3, 1)
  // A press on the bar right after a key replaces the key's pending seek and waits its turn.
  await viewer.press("0")
  await viewer.app.mockMouse.pressDown(bar.x + 10, bar.y)
  expect(seeks).toBe(2)
  viewer.clock.advance(120)
  expect(seeks).toBe(3)
  expect(player.currentTime).toBeCloseTo((10 / (bar.width - 1)) * 2, 1)
  await viewer.app.mockMouse.release(bar.x + 10, bar.y)

  // Each key and what it shows on the picture.
  await viewer.press("m")
  expect(player.muted).toBe(true)
  expect(viewer.frame()).toContain("Muted")
  await viewer.press("l")
  expect(player.loop).toBe(true)
  expect(viewer.frame()).toContain("Loop on")
  await viewer.press("down")
  expect(player.volume).toBeCloseTo(0.9)
  expect(viewer.frame()).toContain("Volume 90%")
  await viewer.press(" ")
  expect(player.playing).toBe(true)
  // Playback moves the player away from the last seek, so the key that made it seeks there again.
  await viewer.press("0")
  viewer.clock.advance(120)
  player.seek(1)
  await viewer.press("0")
  viewer.clock.advance(120)
  expect(player.currentTime).toBeCloseTo(0, 1)
})

test("after a flush or a slow seek, the next waits 120 ms or twice as long as that seek took", () => {
  const clock = new ManualClock()
  const runs: number[] = []
  let cost = 0
  const throttle = createRoot(() =>
    createSeekThrottle(clock, (time) => {
      runs.push(time)
      clock.advance(cost)
    }),
  )
  // A flush, like the release that ends a drag, seeks at once and starts the interval.
  throttle.flush(1)
  throttle.push(2)
  clock.advance(119)
  expect(runs).toEqual([1])
  clock.advance(1)
  expect(runs).toEqual([1, 2])

  // A seek that takes 100 ms of the clock, like a slow 1080p decode, holds the next one 200 ms from its start.
  cost = 100
  throttle.flush(3)
  cost = 0
  throttle.push(4)
  clock.advance(99)
  expect(runs).toEqual([1, 2, 3])
  clock.advance(1)
  expect(runs).toEqual([1, 2, 3, 4])
})

test("the info shows the Kitty transport's file state and reads it again every second", async () => {
  await using viewer = await renderViewer()
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
    viewer.clock.advance(wait)
    await viewer.app.renderOnce()
    expect(viewer.frame()).toContain(`Protocol    kitty · ${shown}`)
  }
})

test("hovering the seek bar previews the resting pointer's frame silently, and a click seeks there once", async () => {
  await using viewer = await renderViewer()
  const player = await openVideo(viewer)
  await viewer.press(" ")
  await viewer.press("0")
  const bar = seekBar(viewer)!
  const timeAt = (column: number) => (column / (bar.width - 1)) * 2
  await viewer.app.mockMouse.moveTo(bar.x + 5, bar.y)
  await viewer.until(() => seekPreview(viewer)?.ready === true)
  const preview = seekPreview(viewer)!
  expect(preview.audio).toBe(false)
  let seeks = 0
  preview.onSeek = () => seeks++

  for (const column of [10, 20, 30]) {
    await viewer.app.mockMouse.moveTo(bar.x + column, bar.y)
    viewer.clock.advance(30)
  }
  expect(seeks).toBe(0)
  viewer.clock.advance(50)
  expect(seeks).toBe(1)
  expect(preview.currentTime).toBeCloseTo(timeAt(30), 1)
  expect(seekPreview(viewer)).toBe(preview)
  expect(player.currentTime).toBe(0)
  // The bar draws a few colour runs, not a span per cell: fill, playhead, track and the hover marker between. It
  // keeps its text while time passes within the playhead's column.
  await viewer.app.renderOnce()
  expect(bar.textNode.getChildren().length).toBeLessThanOrEqual(5)
  let rebuilds = 0
  bar.on("line-info-change", () => rebuilds++)
  player.seek(0.01)
  await viewer.app.renderOnce()
  expect(rebuilds).toBe(0)
  player.seek(1)
  await viewer.app.renderOnce()
  expect(rebuilds).toBe(1)

  // A new open shows the first frame, even of a file it showed before, so it seeks to the same time again.
  preview.source = longVideoFixture
  await viewer.until(() => preview.ready && preview.source === longVideoFixture)
  viewer.clock.advance(1_000)
  expect(preview.currentTime).toBeCloseTo(timeAt(30), 1)

  // Leaving the bar unmounts the preview with its pending seek.
  const idleTimers = viewer.clock.pendingTimerCount
  await viewer.app.mockMouse.moveTo(bar.x + 20, bar.y)
  expect(viewer.clock.pendingTimerCount).toBe(idleTimers + 1)
  await viewer.app.mockMouse.moveTo(bar.x + 20, bar.y - 2)
  expect(seekPreview(viewer)).toBeUndefined()
  expect(viewer.clock.pendingTimerCount).toBe(idleTimers)

  // The press seeks; the release at the same column has nothing new to decode.
  let playerSeeks = 0
  player.onSeek = () => playerSeeks++
  await viewer.app.mockMouse.click(bar.x + 25, bar.y)
  expect(playerSeeks).toBe(1)
  expect(player.currentTime).toBeCloseTo(timeAt(25), 1)
  expect(player.paused).toBe(true)
})

test("a scrub pauses the video, moves the playhead with the pointer, seeks throttled, and lands on release", async () => {
  await using viewer = await renderViewer()
  const player = await openVideo(viewer)
  const bar = seekBar(viewer)!
  const end = bar.width - 1
  const timeAt = (column: number) => (column / end) * 2
  await viewer.app.mockMouse.moveTo(bar.x + 5, bar.y)
  await viewer.until(() => seekPreview(viewer)?.ready === true)
  const preview = seekPreview(viewer)!
  let previewSeeks = 0
  let playerSeeks = 0
  preview.onSeek = () => previewSeeks++
  player.onSeek = () => playerSeeks++

  await viewer.app.mockMouse.pressDown(bar.x + 5, bar.y)
  expect(player.paused).toBe(true)
  expect(playerSeeks).toBe(1)
  for (const column of [10, 20, end]) await viewer.app.mockMouse.moveTo(bar.x + column, bar.y)
  await viewer.app.renderOnce()
  expect(playerSeeks).toBe(1)
  expect(bar.plainText.indexOf("●")).toBe(end)
  expect(viewer.frame()).toMatch(/0:02 +━*● +0:02/)
  viewer.clock.advance(120)
  expect(playerSeeks).toBe(2)
  expect(player.currentTime).toBeCloseTo(2, 1)
  await viewer.app.mockMouse.moveTo(bar.x + 25, bar.y)
  viewer.clock.advance(1_000)
  // The main player shows the frame, so the preview hides and keeps still.
  expect(viewer.find("media-seek-preview")!.visible).toBe(false)
  expect(previewSeeks).toBe(0)

  // The throttle already sought where the drag ends, so the release does not decode it again.
  await viewer.app.mockMouse.release(bar.x + 25, bar.y)
  expect(playerSeeks).toBe(3)
  expect(player.currentTime).toBeCloseTo(timeAt(25), 1)
  expect(player.playing).toBe(true)
  // Still over the bar, the preview shows again once it has caught up, not with the frame from before the scrub.
  viewer.clock.advance(79)
  expect(viewer.find("media-seek-preview")!.visible).toBe(false)
  viewer.clock.advance(1)
  expect(viewer.find("media-seek-preview")!.visible).toBe(true)
  expect(previewSeeks).toBe(1)

  // A scrub that ends where the preview already shows leaves it as it is.
  await viewer.app.mockMouse.pressDown(bar.x + 25, bar.y)
  await viewer.app.mockMouse.release(bar.x + 25, bar.y)
  expect(viewer.find("media-seek-preview")!.visible).toBe(true)
  viewer.clock.advance(1_000)
  expect(previewSeeks).toBe(1)
})

test("the filmstrip shows videos as cards instead of opening players, and its current card keeps the video playing", async () => {
  await using viewer = await renderViewer()
  viewer.media().openViewer([video("first"), video("second", { path: longVideoFixture }), image("image")], 0)
  await viewer.until(() => viewer.videos("media-viewer-stage")[0]?.playing === true)
  const player = viewer.videos("media-viewer-stage")[0]!
  expect(viewer.videos("media-viewer-filmstrip")).toHaveLength(0)
  // A card shows a duration once a player has read it: the first's now, the second's after it has been open.
  const cards = () =>
    descendants(viewer.find("media-viewer-filmstrip")!)
      .filter((node) => node instanceof TextRenderable)
      .map((node) => node.plainText)
  expect(cards()).toEqual(["▶", "0:02", "first.mp4", "▶", "second.mp4", "image.png"])
  const filmstrip = viewer.find("media-viewer-filmstrip")!
  expect(descendants(filmstrip).filter((node) => node instanceof ImageRenderable)).toHaveLength(1)

  // Resting on a named video does not make it the one inline tile allowed to play.
  const [current, next] = filmstrip.getChildren()
  for (const tile of [current!, next!]) {
    await viewer.app.mockMouse.moveTo(tile.x + 1, tile.y + 1)
    viewer.clock.advance(300)
    expect(viewer.media().activeTile()).toBeUndefined()
  }
  await viewer.app.mockMouse.click(current!.x + 1, current!.y + 1)
  await viewer.app.renderOnce()
  expect(viewer.videos("media-viewer-stage")[0]).toBe(player)
  expect(player.playing).toBe(true)
  await viewer.press("]")
  await viewer.until(() => cards().includes("0:04"))
})

/** The media host with a renderer on a clock that moves only when the test advances it. */
async function renderViewer(view: () => JSX.Element = () => null) {
  const clock = new ManualClock()
  return Object.assign(await renderMedia(view, false, clock), { clock })
}

/** Opens the viewer at a video after an image and waits for it to play. */
async function openVideo(viewer: Viewer) {
  viewer.media().openViewer([image("image"), video("clip")], 1)
  await viewer.until(() => viewer.videos("media-viewer-stage")[0]?.playing === true && seekBar(viewer) !== undefined)
  return viewer.videos("media-viewer-stage")[0]!
}

function picture(viewer: Viewer) {
  return descendants(viewer.find("media-viewer-stage")!).find((node) => node instanceof ImageRenderable)!
}

function seekPreview(viewer: Viewer) {
  return viewer.find("media-seek-preview") && viewer.videos("media-seek-preview")[0]
}

function seekBar(viewer: Viewer) {
  return descendants(viewer.find("media-viewer")!).find(
    (node): node is TextRenderable => node instanceof TextRenderable && node.plainText.includes("●"),
  )
}
