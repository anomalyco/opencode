/** @jsxImportSource @opentui/solid */
import {
  CliRenderEvents,
  ImageRenderable,
  TextRenderable,
  type Renderable,
  type TextareaRenderable,
} from "@opentui/core"
import { expect, test } from "bun:test"
import { descendants, image, renderMedia, video } from "../fixture/media"

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

test("zooms an image with keys and the wheel, pans it by dragging, and resets", async () => {
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
  await using viewer = await renderMedia(() => null)
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
