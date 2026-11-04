/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { TextRenderable } from "@opentui/core"
import { descendants, image, renderMedia, video } from "../fixture/media"

type Host = Awaited<ReturnType<typeof renderMedia>>

test("the viewer hands a video to picture-in-picture and takes it back at the same time", async () => {
  await using host = await renderMedia(() => null)
  host.media().openViewer([video("clip")], 0)
  await host.until(() => host.videos("media-viewer-stage")[0]?.playing === true)
  await host.press(" ")
  await host.press("5")

  await host.press("p")
  expect(host.media().viewer()).toBeUndefined()
  expect(host.media().pip()).toMatchObject({ item: { id: "clip" }, playing: false })
  const pip = await readyPip(host)
  expect(pip.paused).toBe(true)
  expect(pip.currentTime).toBeCloseTo(1, 1)
  expect(host.keymap().mode.current()).toBe("base")

  const expand = host.find("media-pip-expand")!
  await host.app.mockMouse.click(expand.x, expand.y)
  await host.until(() => host.videos("media-viewer-stage")[0]?.ready === true)
  expect(host.media().pip()).toBeUndefined()
  expect(host.media().viewer()).toMatchObject({ items: [{ id: "clip" }], index: 0, playing: false })
  expect(host.videos("media-viewer-stage")[0]!.currentTime).toBeCloseTo(1, 1)
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
  await host.until(() => pip.playing)
  host.keymap().dispatch("media.pip.toggle")
  expect(pip.paused).toBe(true)
})

test("pauses under the viewer and plays again once it closes", async () => {
  await using host = await renderMedia(() => null)
  host.media().openPip(video("clip"))
  const pip = await readyPip(host)
  expect(pip.playing).toBe(true)
  host.media().openViewer([image("image")], 0)
  await host.app.renderOnce()
  expect(pip.paused).toBe(true)
  host.media().closeViewer()
  await host.app.renderOnce()
  expect(pip.playing).toBe(true)
})

test("waits for the viewer to close when it becomes ready under it", async () => {
  await using host = await renderMedia(() => null)
  host.media().openViewer([image("image")], 0)
  host.media().openPip(video("clip"), { time: 0.5, playing: true })
  const pip = await readyPip(host)
  expect(pip.currentTime).toBeCloseTo(0.5, 1)
  expect(pip.paused).toBe(true)
  host.media().closeViewer()
  await host.app.renderOnce()
  expect(pip.playing).toBe(true)
})

test("a selection released on its controls does not click them", async () => {
  await using host = await renderMedia(() => <text>selectable words</text>)
  host.media().openPip(video("clip"), { playing: false })
  const pip = await readyPip(host)
  const controls = ["media-play", "media-pip-expand", "media-pip-close"].map((id) => host.find(id)!)
  for (const control of controls) {
    await host.app.mockMouse.drag(1, 0, control.x, control.y)
    expect(host.app.renderer.getSelection()?.getSelectedText()).toBeTruthy()
    host.app.renderer.clearSelection()
  }
  expect(pip.paused).toBe(true)
  expect(host.media().pip()).toBeDefined()
  expect(host.media().viewer()).toBeUndefined()
})

test("a form taking the keys moves a playing video to picture-in-picture and closes the viewer otherwise", async () => {
  await using host = await renderMedia(() => null)
  host.media().openViewer([video("clip")], 0)
  // The time the transport last reported, which trails the player's by up to a frame, goes along.
  await host.until(() => (host.videos("media-viewer-stage")[0]?.currentTime ?? 0) > 0.3)
  const popForm = host.keymap().mode.push("form")
  await host.app.renderOnce()
  expect(host.media().viewer()).toBeUndefined()
  expect(host.keymap().mode.current()).toBe("form")
  expect(host.media().pip()).toMatchObject({ item: { id: "clip" }, playing: true })
  expect(host.media().pip()!.time).toBeGreaterThan(0.2)
  popForm()

  host.keymap().dispatch("media.pip.close")
  host.media().openViewer([image("image")], 0)
  await host.app.renderOnce()
  host.keymap().mode.push("form")
  await host.app.renderOnce()
  expect(host.media().viewer()).toBeUndefined()
  expect(host.media().pip()).toBeUndefined()
})

test("mute, volume and loop go along to picture-in-picture and back", async () => {
  await using host = await renderMedia(() => null)
  host.media().openViewer([video("clip")], 0)
  await host.until(() => host.videos("media-viewer-stage")[0]?.playing === true)
  for (const key of ["m", "down", "down", "l"]) await host.press(key)

  await host.press("p")
  const pip = await readyPip(host)
  expect({ muted: pip.muted, volume: pip.volume, loop: pip.loop }).toEqual({ muted: true, volume: 0.8, loop: true })

  host.keymap().dispatch("media.pip.expand")
  await host.until(() => host.videos("media-viewer-stage")[0]?.ready === true)
  const player = host.videos("media-viewer-stage")[0]!
  expect({ muted: player.muted, volume: player.volume, loop: player.loop }).toEqual({
    muted: true,
    volume: 0.8,
    loop: true,
  })
})

test("expanded before it is ready, it opens the viewer at its time and playing", async () => {
  await using host = await renderMedia(() => null)
  host.media().openPip(video("clip"), { time: 0.5 })
  host.keymap().dispatch("media.pip.expand")
  expect(host.media().pip()).toBeUndefined()
  expect(host.media().viewer()).toMatchObject({ items: [{ id: "clip" }], time: 0.5, playing: true })
})

test("a seek or a move released over its controls does not click them", async () => {
  await using host = await renderMedia(() => null)
  host.media().openPip(video("clip"), { playing: false })
  const pip = await readyPip(host)
  const seekBar = () =>
    descendants(host.find("media-pip")!).find(
      (node): node is TextRenderable => node instanceof TextRenderable && node.plainText.includes("●"),
    )
  await host.until(() => seekBar() !== undefined)
  const bar = seekBar()!
  for (const id of ["media-pip-close", "media-pip-expand"]) {
    const control = host.find(id)!
    await host.app.mockMouse.drag(bar.x, bar.y, control.x, control.y)
  }
  // Dragged down past the screen's edge, it stops at the bottom with the pointer over its controls.
  const title = host.find("media-pip-title")!
  await host.app.mockMouse.drag(title.x + 1, title.y, title.x + 1, 29)
  await host.app.renderOnce()
  expect(host.find("media-pip")!.y + host.find("media-pip")!.height).toBe(30)
  expect(pip.paused).toBe(true)
  expect(host.media().pip()).toBeDefined()
  expect(host.media().viewer()).toBeUndefined()
})

async function readyPip(host: Host) {
  await host.until(() => host.videos("media-pip")[0]?.ready === true)
  return host.videos("media-pip")[0]!
}
