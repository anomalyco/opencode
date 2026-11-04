/** @jsxImportSource @opentui/solid */
import { BoxRenderable, ImageRenderable, TextareaRenderable, VideoRenderable, type Renderable } from "@opentui/core"
import { testRender } from "@opentui/solid"
import { expect, test } from "bun:test"
import path from "node:path"
import "../../src/component/media/viewer"
import type { MediaItem } from "../../src/component/media/model"
import { ConfigProvider } from "../../src/config"
import { Keymap } from "../../src/context/keymap"
import { MediaHost, MediaProvider, useMedia, type MediaContext } from "../../src/context/media"
import { ThemeProvider } from "../../src/context/theme"
import { DialogProvider, useDialog, type DialogContext } from "../../src/ui/dialog"
import { Toast, ToastProvider, useToast } from "../../src/ui/toast"
import { emptyThemeSource, tmpdir } from "../fixture/fixture"
import { imageFixture, videoFixture } from "../fixture/media"
import { TestTuiContexts } from "../fixture/tui-environment"
import { createTuiResolvedConfig } from "../fixture/tui-runtime"

const WIDTH = 80
const HEIGHT = 30
const image: MediaItem = {
  id: "image",
  kind: "image",
  mime: "image/png",
  uri: "",
  name: "image.png",
  path: imageFixture,
}
const video: MediaItem = {
  id: "video",
  kind: "video",
  mime: "video/mp4",
  uri: "",
  name: "clip.mp4",
  path: videoFixture,
}
const other: MediaItem = { ...video, id: "other", name: "other.mp4" }

async function renderViewer() {
  const temporary = await tmpdir()
  let media: MediaContext | undefined
  let dialog: DialogContext | undefined
  let keymap: Keymap | undefined
  let toast: ReturnType<typeof useToast> | undefined
  let composer: TextareaRenderable | undefined
  let submits = 0
  function Probe() {
    media = useMedia()
    dialog = useDialog()
    keymap = Keymap.use()
    toast = useToast()
    return null
  }
  const app = await testRender(
    () => (
      <TestTuiContexts directory={temporary.path} paths={{ state: temporary.path }}>
        <ConfigProvider config={createTuiResolvedConfig()}>
          <ThemeProvider mode="dark" source={emptyThemeSource}>
            <Keymap.Provider>
              <ToastProvider>
                <DialogProvider>
                  <MediaProvider directory={path.join(temporary.path, "media")}>
                    <Probe />
                    <box width={WIDTH} height={HEIGHT}>
                      <textarea
                        ref={(element: TextareaRenderable) => (composer = element)}
                        width={20}
                        height={2}
                        keyBindings={[{ name: "return", action: "submit" }]}
                        onSubmit={() => submits++}
                      />
                      <MediaHost />
                      <Toast />
                    </box>
                  </MediaProvider>
                </DialogProvider>
              </ToastProvider>
            </Keymap.Provider>
          </ThemeProvider>
        </ConfigProvider>
      </TestTuiContexts>
    ),
    { width: WIDTH, height: HEIGHT, kittyKeyboard: true },
  )
  const fixture = {
    app,
    media: () => media!,
    dialog: () => dialog!,
    keymap: () => keymap!,
    toast: () => toast!,
    /** A focusable editor behind the viewer, like the session prompt. */
    composer: () => composer!,
    submits: () => submits,
    frame: () => app.captureCharFrame(),
    find: (id: string) => descendants(app.renderer.root).find((node) => node.id === id),
    /** The viewer's own player, not the filmstrip's or the hover preview's. */
    player: () => videosIn(fixture.find("media-viewer-stage"))[0],
    pipPlayer: () => videosIn(fixture.find("media-pip"))[0],
    // Playback and file resolution follow the wall clock, so poll with short sleeps between frames.
    async until(condition: () => boolean) {
      const deadline = Date.now() + 5_000
      while (!condition() && Date.now() < deadline) {
        await Bun.sleep(5)
        await app.renderOnce()
      }
      if (!condition()) console.log(app.captureCharFrame())
      expect(condition()).toBe(true)
    },
    async press(key: string, modifiers?: { shift?: boolean }) {
      if (key === "left" || key === "right" || key === "up" || key === "down") app.mockInput.pressArrow(key, modifiers)
      else app.mockInput.pressKey(key === "home" ? "HOME" : key, modifiers)
      await app.renderOnce()
    },
    async [Symbol.asyncDispose]() {
      app.renderer.destroy()
      await temporary[Symbol.asyncDispose]()
    },
  }
  await fixture.until(() => media !== undefined)
  return fixture
}

function descendants(node: Renderable): Renderable[] {
  return node.getChildren().flatMap((child) => [child, ...descendants(child as Renderable)])
}

function videosIn(node: Renderable | undefined) {
  return node ? descendants(node).filter((child): child is VideoRenderable => child instanceof VideoRenderable) : []
}

async function openVideo(viewer: Awaited<ReturnType<typeof renderViewer>>, items = [image, video, other], index = 1) {
  viewer.media().openViewer(items, index)
  await viewer.until(() => viewer.player()?.playing === true)
  return viewer.player()!
}

test("opens fullscreen in a modal layer under toasts and closes back to the previous mode", async () => {
  await using viewer = await renderViewer()
  expect(viewer.keymap().mode.current()).toBe("base")
  viewer.media().openViewer([image, video, other], 0)
  await viewer.until(() => viewer.frame().includes("96×48") && viewer.frame().includes("esc close"))
  const frame = viewer.frame()
  expect(frame).toContain("image.png")
  expect(frame).toContain("1 / 3")
  expect(frame).toContain("esc close")
  expect(viewer.find("media-viewer-filmstrip")).toBeDefined()
  expect(viewer.keymap().mode.current()).toBe("modal")
  const root = viewer.find("media-viewer") as BoxRenderable
  expect(root.width).toBe(WIDTH)
  expect(root.height).toBe(HEIGHT)
  viewer.toast().show({ message: "Copied to clipboard", variant: "info" })
  await viewer.app.renderOnce()
  expect(viewer.frame()).toContain("Copied to clipboard")

  // A dialog opened over the viewer takes the keys until it closes.
  viewer.dialog().replace(() => <text>over the viewer</text>)
  await viewer.app.renderOnce()
  await viewer.press("]")
  expect(viewer.frame()).toContain("1 / 3")
  viewer.app.mockInput.pressEscape()
  await viewer.until(() => viewer.dialog().stack.length === 0)
  expect(viewer.media().viewer()).toBeDefined()

  viewer.app.mockInput.pressEscape()
  await viewer.until(() => viewer.media().viewer() === undefined)
  expect(viewer.keymap().mode.current()).toBe("base")
  expect(viewer.find("media-viewer")).toBeUndefined()
})

test("navigates with brackets everywhere and arrows on images", async () => {
  await using viewer = await renderViewer()
  viewer.media().openViewer([image, video, other], 0)
  await viewer.until(() => viewer.frame().includes("1 / 3"))
  await viewer.press("right")
  await viewer.until(() => viewer.frame().includes("2 / 3") && viewer.frame().includes("clip.mp4"))
  // On a video the arrows seek, so only the brackets move on.
  await viewer.press("right")
  expect(viewer.frame()).toContain("2 / 3")
  await viewer.press("]")
  await viewer.until(() => viewer.frame().includes("3 / 3"))
  await viewer.press("]")
  await viewer.until(() => viewer.frame().includes("1 / 3"))
  await viewer.press("[")
  await viewer.until(() => viewer.frame().includes("3 / 3"))
})

test("plays with sound requested and controls playback from the keyboard", async () => {
  await using viewer = await renderViewer()
  const player = await openVideo(viewer)
  expect(player.audio).toBe(true)
  await viewer.until(() => viewer.frame().includes("160×90 · 0:02 · 10 fps"))

  await viewer.press(" ")
  expect(player.paused).toBe(true)
  await viewer.press("5")
  expect(player.currentTime).toBeCloseTo(1, 1)
  await viewer.press(".")
  expect(player.currentTime).toBeCloseTo(1.1, 1)
  await viewer.press(",")
  expect(player.currentTime).toBeCloseTo(1, 1)
  await viewer.press("left", { shift: true })
  expect(player.currentTime).toBeCloseTo(0, 1)
  await viewer.press("right")
  expect(player.currentTime).toBeCloseTo(2, 1)
  await viewer.press("home")
  expect(player.currentTime).toBe(0)
  await viewer.press("m")
  expect(player.muted).toBe(true)
  await viewer.press("l")
  expect(player.loop).toBe(true)
  await viewer.press("down")
  expect(player.volume).toBeCloseTo(0.9)
  await viewer.press(" ")
  await viewer.until(() => player.playing && player.currentTime > 0)
})

test("honors the requested time and paused state", async () => {
  await using viewer = await renderViewer()
  viewer.media().openViewer([video], 0, { time: 1.5, playing: false })
  await viewer.until(() => viewer.player()?.ready === true && viewer.frame().includes("0:01 / 0:02"))
  expect(viewer.player()!.paused).toBe(true)
  expect(viewer.player()!.currentTime).toBeCloseTo(1.5, 1)
  // A single item has no filmstrip.
  expect(viewer.find("media-viewer-filmstrip")).toBeUndefined()
})

test("seeks where the seek bar is clicked and previews the hovered frame", async () => {
  await using viewer = await renderViewer()
  const player = await openVideo(viewer)
  await viewer.press(" ")
  await viewer.until(() => viewer.frame().includes("0:00 / 0:02") || viewer.frame().includes("0:01 / 0:02"))
  await viewer.press("home")
  const rows = viewer.frame().split("\n")
  const row = rows.findIndex((line) => line.includes(" / 0:02"))
  const start = rows[row]!.indexOf("●")
  const end = rows[row]!.lastIndexOf("─")
  expect(start).toBeGreaterThan(0)
  expect(end).toBeGreaterThan(start + 10)

  await viewer.app.mockMouse.moveTo(Math.round((start + end) / 2), row)
  await viewer.until(() => viewer.find("media-seek-preview") !== undefined)
  const preview = videosIn(viewer.find("media-seek-preview"))[0]!
  expect(preview.audio).toBe(false)
  await viewer.until(() => preview.ready && preview.currentTime > 0.5)
  expect(player.currentTime).toBe(0)

  await viewer.app.mockMouse.click(Math.round((start + end) / 2), row)
  await viewer.until(() => Math.abs(player.currentTime - 1) < 0.15)
  expect(player.paused).toBe(true)
  await viewer.app.mockMouse.moveTo(1, 2)
  await viewer.until(() => viewer.find("media-seek-preview") === undefined)
})

test("zooms with keys and the wheel, pans by dragging, and resets", async () => {
  await using viewer = await renderViewer()
  viewer.media().openViewer([image], 0)
  await viewer.until(() => viewer.frame().includes("96×48"))
  const picture = () =>
    descendants(viewer.find("media-viewer-stage")!).find(
      (node): node is ImageRenderable => node instanceof ImageRenderable,
    )!
  expect(picture().crop).toEqual({ left: 0, top: 0, width: 96, height: 48 })

  await viewer.press("+")
  await viewer.press("+")
  await viewer.press("+")
  const zoomed = picture().crop!
  expect(zoomed.width).toBeLessThan(96)
  expect(zoomed.height).toBeLessThan(48)
  expect(viewer.frame()).toContain("r reset")

  const stage = viewer.find("media-viewer-stage")!
  await viewer.app.mockMouse.drag(stage.x + 40, stage.y + 8, stage.x + 50, stage.y + 8)
  await viewer.app.renderOnce()
  expect(picture().crop!.left).toBeLessThan(zoomed.left)

  await viewer.press("r")
  expect(picture().crop).toEqual({ left: 0, top: 0, width: 96, height: 48 })
  await viewer.app.mockMouse.scroll(stage.x + 10, stage.y + 2, "up")
  await viewer.app.renderOnce()
  expect(picture().crop!.width).toBeLessThan(96)
  await viewer.press("f")
  await viewer.press("i")
  expect(viewer.frame()).toContain("protocol  blocks")
})

test("explains media it cannot show", async () => {
  await using temporary = await tmpdir()
  const broken = path.join(temporary.path, "broken.mp4")
  await Bun.write(broken, "not a video")
  await using viewer = await renderViewer()
  viewer.media().openViewer(
    [
      { ...video, id: "broken", name: "broken.mp4", path: broken },
      { id: "webm", kind: "video", mime: "video/webm", uri: "", name: "clip.webm" },
    ],
    0,
  )
  await viewer.until(() => viewer.frame().includes("Can't play this video"))
  expect(viewer.frame()).toContain("H.264")
  await viewer.press("]")
  await viewer.until(() => viewer.frame().includes("Can't play video/webm"))
  expect(viewer.frame()).not.toContain("space play")
})

test("hands a video to picture-in-picture and expands it back at the same time", async () => {
  await using viewer = await renderViewer()
  const player = await openVideo(viewer)
  await viewer.press(" ")
  await viewer.press("5")
  expect(player.currentTime).toBeCloseTo(1, 1)
  await viewer.press("p")
  expect(viewer.media().viewer()).toBeUndefined()
  expect(viewer.media().pip()).toMatchObject({ item: video, playing: false })
  expect(viewer.media().pip()!.time).toBeCloseTo(1, 1)
  await viewer.until(() => viewer.pipPlayer()?.ready === true)
  expect(viewer.pipPlayer()!.currentTime).toBeCloseTo(1, 1)
  expect(viewer.pipPlayer()!.paused).toBe(true)
  expect(viewer.keymap().mode.current()).toBe("base")

  const pip = viewer.find("media-pip")!
  expect(pip.x + pip.width).toBeLessThanOrEqual(WIDTH)
  const expand = viewer.find("media-pip-expand")!
  await viewer.app.mockMouse.click(expand.x, expand.y)
  await viewer.until(() => viewer.player()?.ready === true)
  expect(viewer.media().pip()).toBeUndefined()
  expect(viewer.media().viewer()).toMatchObject({ items: [video], index: 0, playing: false })
  expect(viewer.player()!.currentTime).toBeCloseTo(1, 1)
})

test("drags picture-in-picture by its title and toggles it from the controls", async () => {
  await using viewer = await renderViewer()
  viewer.media().openPip(video, { time: 0.5, playing: false })
  await viewer.until(() => viewer.pipPlayer()?.ready === true)
  const pip = viewer.find("media-pip")!
  const title = viewer.find("media-pip-title")!
  const before = { x: pip.x, y: pip.y }
  await viewer.app.mockMouse.drag(title.x + 4, title.y, title.x - 6, title.y - 5)
  await viewer.app.renderOnce()
  expect(pip.x).toBe(before.x - 10)
  expect(pip.y).toBe(before.y - 5)

  const play = viewer.find("media-pip-play")!
  await viewer.app.mockMouse.click(play.x, play.y)
  await viewer.until(() => viewer.pipPlayer()!.playing)
  viewer.keymap().dispatch("media.pip.toggle")
  expect(viewer.pipPlayer()!.paused).toBe(true)

  // The viewer covers the PiP and pauses it; closing the viewer resumes it.
  viewer.keymap().dispatch("media.pip.toggle")
  expect(viewer.pipPlayer()!.playing).toBe(true)
  viewer.media().openViewer([image], 0)
  await viewer.app.renderOnce()
  expect(viewer.pipPlayer()!.paused).toBe(true)
  viewer.media().closeViewer()
  await viewer.app.renderOnce()
  expect(viewer.pipPlayer()!.playing).toBe(true)

  viewer.keymap().dispatch("media.pip.close")
  await viewer.until(() => viewer.find("media-pip") === undefined)
})

test("keeps the keys when a dialog closing behind it gives focus back to an editor", async () => {
  await using viewer = await renderViewer()
  const composer = viewer.composer()
  composer.focus()
  // Opening from the command palette: the palette remembers the editor's focus and gives it back once cleared.
  viewer.dialog().replace(() => <text>palette</text>)
  await viewer.app.renderOnce()
  viewer.media().openViewer([image], 0)
  viewer.dialog().clear()
  await Bun.sleep(30)
  await viewer.app.renderOnce()
  await viewer.app.mockInput.typeText("hello")
  viewer.app.mockInput.pressEnter()
  await viewer.app.renderOnce()
  expect(composer.plainText).toBe("")
  expect(viewer.submits()).toBe(0)
  expect(viewer.media().viewer()).toBeDefined()

  viewer.app.mockInput.pressEscape()
  await viewer.until(() => viewer.media().viewer() === undefined && composer.focused)
})

test("clicking the current filmstrip tile keeps the video and its controls", async () => {
  await using viewer = await renderViewer()
  const player = await openVideo(viewer)
  await viewer.until(() => viewer.frame().includes(" / 0:02"))
  const tile = viewer.find("media-viewer-filmstrip")!.getChildren()[1] as Renderable
  await viewer.app.mockMouse.click(tile.x + 2, tile.y + 1)
  await viewer.app.renderOnce()
  expect(viewer.player()).toBe(player)
  expect(viewer.frame()).toContain(" / 0:02")
  expect(viewer.frame()).toContain("space pause")
})

test("hands a playing video to picture-in-picture when a form takes the keys", async () => {
  await using viewer = await renderViewer()
  const player = await openVideo(viewer)
  await viewer.until(() => player.currentTime > 0.2)
  const popForm = viewer.keymap().mode.push("form")
  await viewer.app.renderOnce()
  expect(viewer.media().viewer()).toBeUndefined()
  expect(viewer.media().pip()).toMatchObject({ item: video, playing: true })
  expect(viewer.media().pip()!.time).toBeGreaterThan(0.2)
  expect(viewer.keymap().mode.current()).toBe("form")
  popForm()

  // Anything else simply closes.
  viewer.media().closePip()
  viewer.media().openViewer([image], 0)
  await viewer.app.renderOnce()
  const popAgain = viewer.keymap().mode.push("form")
  await viewer.app.renderOnce()
  expect(viewer.media().viewer()).toBeUndefined()
  expect(viewer.media().pip()).toBeUndefined()
  popAgain()
})
