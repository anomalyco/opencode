/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { TextRenderable, type VideoRenderable } from "@opentui/core"
import { ManualClock } from "@opentui/core/testing"
import { descendants, image, longVideoFixture, renderMedia, video } from "../fixture/media"

type Host = Awaited<ReturnType<typeof renderMedia>>

test("the viewer hands a video to picture-in-picture and takes it back with its time, sound and loop", async () => {
  await using host = await renderMedia(() => null, false, new ManualClock())
  host.media().openViewer([video("clip", { path: longVideoFixture })], 0)
  await host.until(() => host.videos("media-viewer-stage")[0]?.playing === true)
  // "5" seeks to 2 s at once, so "shift+right" waits out the interval; the time it is headed to goes along.
  for (const key of [" ", "5", "m", "down", "down", "l", "shift+right"]) await host.press(key)

  await host.press("p")
  expect(host.media().viewer()).toBeUndefined()
  expect(host.media().pip()).toMatchObject({ item: { id: "clip" }, time: 3, playing: false })
  const pip = await readyPip(host)
  expect(pip.paused).toBe(true)
  expectCarried(pip)
  expect(host.keymap().mode.current()).toBe("base")

  const expand = host.find("media-pip-expand")!
  await host.app.mockMouse.click(expand.x, expand.y)
  await host.until(() => host.videos("media-viewer-stage")[0]?.ready === true)
  expect(host.media().pip()).toBeUndefined()
  expect(host.media().viewer()).toMatchObject({ items: [{ id: "clip" }], index: 0, playing: false })
  expectCarried(host.videos("media-viewer-stage")[0]!)
})

test("drags by its title and plays from its controls", async () => {
  await using host = await renderMedia(() => null)
  host.media().openPip(video("clip"), { playing: false })
  const pip = await readyPip(host)
  const box = host.find("media-pip")!
  const title = host.find("media-pip-title")!
  const before = { x: box.x, y: box.y }
  await host.app.mockMouse.drag(title.x + 4, title.y, title.x - 6, title.y - 5)
  await host.app.renderOnce()
  expect(box.x).toBe(before.x - 10)
  expect(box.y).toBe(before.y - 5)
  expect(box.x + box.width).toBeLessThanOrEqual(80)

  const play = host.find("media-play")!
  await host.app.mockMouse.click(play.x, play.y)
  expect(pip.playing).toBe(true)
  host.keymap().dispatch("media.pip.toggle")
  expect(pip.paused).toBe(true)
})

test("pauses under the viewer, even when it becomes ready there, and plays again once the viewer closes", async () => {
  await using host = await renderMedia(() => null)
  host.media().openPip(video("clip"))
  const playing = await readyPip(host)
  expect(playing.playing).toBe(true)
  host.media().openViewer([image("image")], 0)
  await host.app.renderOnce()
  expect(playing.paused).toBe(true)
  host.media().closeViewer()
  await host.app.renderOnce()
  expect(playing.playing).toBe(true)

  host.media().closePip()
  host.media().openViewer([image("image")], 0)
  host.media().openPip(video("clip"), { time: 0.5, playing: true })
  const covered = await readyPip(host)
  expect(covered.currentTime).toBeCloseTo(0.5, 1)
  expect(covered.paused).toBe(true)
  host.media().closeViewer()
  await host.app.renderOnce()
  expect(covered.playing).toBe(true)
})

// The media strip test covers a selection released on a control.
test("a seek or move released on its controls does not click them", async () => {
  await using host = await renderMedia(() => null)
  host.media().openPip(video("clip"), { playing: false })
  const pip = await readyPip(host)
  const controls = ["media-play", "media-pip-expand", "media-pip-close"].map((id) => host.find(id)!)
  const seekBar = () =>
    descendants(host.find("media-pip")!).find((node) => node instanceof TextRenderable && node.plainText.includes("●"))
  await host.until(() => seekBar() !== undefined)
  const bar = seekBar()!
  for (const control of controls) await host.app.mockMouse.drag(bar.x, bar.y, control.x, control.y)
  // Dragged down past the screen's edge, it stops at the bottom with the pointer over its controls.
  const title = host.find("media-pip-title")!
  await host.app.mockMouse.drag(title.x + 1, title.y, title.x + 1, 29)
  await host.app.renderOnce()
  expect(host.find("media-pip")!.y + host.find("media-pip")!.height).toBe(30)
  expect(pip.paused).toBe(true)
  expect(host.media().pip()).toBeDefined()
  expect(host.media().viewer()).toBeUndefined()
})

test("a form taking the keys moves a playing video to picture-in-picture and closes the viewer otherwise", async () => {
  await using host = await renderMedia(() => null)
  host.media().openViewer([video("clip")], 0)
  await host.until(() => host.videos("media-viewer-stage")[0]?.playing === true)
  host.videos("media-viewer-stage")[0]!.seek(0.5)
  const popForm = host.keymap().mode.push("form")
  await host.app.renderOnce()
  expect(host.media().viewer()).toBeUndefined()
  expect(host.keymap().mode.current()).toBe("form")
  expect(host.media().pip()).toMatchObject({ item: { id: "clip" }, playing: true })
  expect(host.media().pip()!.time).toBeCloseTo(0.5, 1)
  popForm()

  host.keymap().dispatch("media.pip.close")
  host.media().openViewer([image("image")], 0)
  await host.app.renderOnce()
  host.keymap().mode.push("form")
  await host.app.renderOnce()
  expect(host.media().viewer()).toBeUndefined()
  expect(host.media().pip()).toBeUndefined()
})

test("expanded before it is ready, it opens the viewer at its time and playing", async () => {
  await using host = await renderMedia(() => null)
  host.media().openPip(video("clip"), { time: 0.5 })
  host.keymap().dispatch("media.pip.expand")
  expect(host.media().pip()).toBeUndefined()
  expect(host.media().viewer()).toMatchObject({ items: [{ id: "clip" }], time: 0.5, playing: true })
})

/** The time, mute, volume and loop the first test sets go along between the viewer and picture-in-picture. */
function expectCarried(player: VideoRenderable) {
  expect(player.currentTime).toBeCloseTo(3, 1)
  expect(player.muted).toBe(true)
  expect(player.volume).toBeCloseTo(0.8)
  expect(player.loop).toBe(true)
}

async function readyPip(host: Host) {
  await host.until(() => host.videos("media-pip")[0]?.ready === true)
  return host.videos("media-pip")[0]!
}
