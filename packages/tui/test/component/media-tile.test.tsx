/** @jsxImportSource @opentui/solid */
import { ImageRenderable, VideoRenderable, type Renderable } from "@opentui/core"
import { testRender } from "@opentui/solid"
import { expect, test } from "bun:test"
import { createSignal, Index, type Accessor, type JSX } from "solid-js"
import path from "node:path"
import { MediaStrip } from "../../src/component/media/strip"
import { MediaTile, posterTime } from "../../src/component/media/tile"
import type { MediaItem } from "../../src/component/media/model"
import { ConfigProvider } from "../../src/config"
import { MediaProvider, useMedia, type MediaContext } from "../../src/context/media"
import { ThemeProvider } from "../../src/context/theme"
import { emptyThemeSource, tmpdir } from "../fixture/fixture"
import { imageFixture, longVideoFixture, videoFixture } from "../fixture/media"
import { TestTuiContexts } from "../fixture/tui-environment"
import { createTuiResolvedConfig } from "../fixture/tui-runtime"

const clip = (id: string): MediaItem => ({
  id,
  kind: "video",
  mime: "video/mp4",
  uri: "",
  name: `${id}.mp4`,
  path: videoFixture,
})

async function renderTiles(
  items: readonly MediaItem[] | Accessor<readonly MediaItem[]>,
  onOpen: (item: MediaItem) => void = () => {},
  view: (items: Accessor<readonly MediaItem[]>) => JSX.Element = (items) => (
    <box flexDirection="row" gap={2}>
      <Index each={items()}>
        {(item) => <MediaTile item={item()} width={16} height={6} onOpen={() => onOpen(item())} />}
      </Index>
    </box>
  ),
) {
  const list = typeof items === "function" ? items : () => items
  const temporary = await tmpdir()
  const directory = path.join(temporary.path, "media")
  let media: MediaContext | undefined
  function Probe() {
    media = useMedia()
    return null
  }
  const app = await testRender(
    () => (
      <TestTuiContexts directory={temporary.path} paths={{ state: temporary.path }}>
        <ConfigProvider config={createTuiResolvedConfig()}>
          <ThemeProvider mode="dark" source={emptyThemeSource}>
            <MediaProvider directory={directory}>
              <Probe />
              {view(list)}
              <text>selectable words</text>
            </MediaProvider>
          </ThemeProvider>
        </ConfigProvider>
      </TestTuiContexts>
    ),
    { width: 60, height: 10, kittyKeyboard: true },
  )
  return {
    app,
    directory,
    media: () => media!,
    videos: () => descendants(app.renderer.root).filter((node) => node instanceof VideoRenderable),
    // Playback follows the wall clock, so poll with short sleeps between frames.
    async until(condition: () => boolean) {
      const deadline = Date.now() + 5_000
      while (!condition() && Date.now() < deadline) {
        await Bun.sleep(5)
        await app.renderOnce()
      }
      expect(condition()).toBe(true)
    },
    async [Symbol.asyncDispose]() {
      app.renderer.destroy()
      await temporary[Symbol.asyncDispose]()
    },
  }
}

function descendants(node: Renderable): Renderable[] {
  return node.getChildren().flatMap((child) => [child, ...descendants(child as Renderable)])
}

test("shows a paused poster with its duration and plays only the hovered tile", async () => {
  // The second tile's bytes are a data URI, which plays from a file written into the media directory.
  const data = `data:video/mp4;base64,${Buffer.from(await Bun.file(videoFixture).arrayBuffer()).toString("base64")}`
  await using tiles = await renderTiles([clip("a"), { ...clip("b"), uri: data, path: undefined }])
  await tiles.until(() => tiles.videos().length === 2 && tiles.app.captureCharFrame().includes("▶ 0:02"))
  const [first, second] = tiles.videos() as VideoRenderable[]
  expect(path.dirname(second!.source!)).toBe(tiles.directory)
  const frame = tiles.app.captureCharFrame()
  expect(frame.split("\n").slice(0, 5).join("").trim().length).toBeGreaterThan(0)
  expect(first!.paused).toBe(true)
  expect(first!.audio).toBe(false)
  expect(first!.loop).toBe(true)
  expect(first!.maxFps).toBe(tiles.media().capabilities().thumbnailFps)

  await tiles.app.mockMouse.moveTo(4, 2)
  await tiles.until(() => first!.playing && first!.currentTime > 0.1)
  expect(second!.paused).toBe(true)
  // Moving over the badge stays within the tile.
  await tiles.app.mockMouse.moveTo(1, 5)
  await tiles.app.renderOnce()
  await Bun.sleep(0)
  expect(first!.playing).toBe(true)
  expect(first!.currentTime).toBeGreaterThan(0.1)

  await tiles.app.mockMouse.moveTo(22, 2)
  await tiles.until(() => second!.playing)
  expect(first!.paused).toBe(true)
  expect(first!.currentTime).toBe(0)

  await tiles.app.mockMouse.moveTo(50, 8)
  await tiles.until(() => second!.paused && tiles.media().activeTile() === undefined)
  expect(second!.currentTime).toBe(0)
})

test("shows a poster 10% into a clip, at most 30 s, and returns there after hover", async () => {
  expect([0, 2.9, 4, 5, 300, 3600].map(posterTime)).toEqual([0, 0, 0.4, 0.5, 30, 30])
  await using tiles = await renderTiles([{ ...clip("a"), path: longVideoFixture }])
  await tiles.until(() => tiles.videos()[0]?.currentTime === 0.4)
  const player = tiles.videos()[0] as VideoRenderable
  expect(player.paused).toBe(true)

  await tiles.app.mockMouse.moveTo(4, 2)
  await tiles.until(() => player.playing && player.currentTime > 0.5)
  await tiles.app.mockMouse.moveTo(50, 8)
  await tiles.until(() => player.paused && tiles.media().activeTile() === undefined)
  expect(player.currentTime).toBe(0.4)
})

test("opens the viewer request and stops inline playback", async () => {
  const opened: string[] = []
  await using tiles = await renderTiles(
    [clip("a"), { ...clip("b"), kind: "image", mime: "image/png", path: imageFixture }],
    (item) => opened.push(item.id),
  )
  await tiles.until(() => tiles.videos().length === 1)
  await tiles.app.mockMouse.moveTo(4, 2)
  await tiles.until(() => tiles.videos()[0]!.playing)

  await tiles.app.mockMouse.click(4, 2)
  await tiles.app.mockMouse.click(22, 2)
  // The badge is part of the tile, not text to select.
  await tiles.app.mockMouse.click(1, 5)
  expect(opened).toEqual(["a", "b", "a"])
  // Releasing a text selection over a tile copies the text instead of opening the tile.
  await tiles.app.mockMouse.drag(2, 6, 4, 2)
  expect(tiles.app.renderer.getSelection()?.getSelectedText()).toBeTruthy()
  expect(opened).toEqual(["a", "b", "a"])

  tiles.media().openViewer([clip("a")], 0)
  await tiles.until(() => (tiles.videos()[0] as VideoRenderable).paused)
  expect(
    tiles
      .media()
      .viewer()
      ?.items.map((item) => item.id),
  ).toEqual(["a"])
})

test("a selection released on the +N more tile bubbles without opening it", async () => {
  const opened: number[] = []
  let released = 0
  const image = (id: string): MediaItem => ({ id, kind: "image", mime: "image/png", uri: "", path: imageFixture })
  await using tiles = await renderTiles([image("a"), image("b"), image("c")], undefined, (items) => (
    <box onMouseUp={() => released++}>
      <MediaStrip items={items()} width={30} height={6} onOpen={(index) => opened.push(index)} />
    </box>
  ))
  await tiles.until(() => tiles.app.captureCharFrame().includes("+2 more"))
  await tiles.app.mockMouse.drag(2, 6, 16, 2)
  expect(tiles.app.renderer.getSelection()?.getSelectedText()).toBeTruthy()
  expect(opened).toEqual([])
  expect(released).toBe(1)

  tiles.app.renderer.clearSelection()
  await tiles.app.mockMouse.click(16, 2)
  expect(opened).toEqual([1])
  expect(released).toBe(1)
})

test("falls back to the kind and name when media cannot be shown", async () => {
  await using temporary = await tmpdir()
  const broken = path.join(temporary.path, "x.mp4")
  await Bun.write(broken, "not a video")
  await using tiles = await renderTiles([
    { id: "remote", kind: "video", mime: "video/mp4", uri: "https://example.com/a.mp4", name: "r.mp4" },
    { ...clip("broken"), name: "x.mp4", path: broken },
    { id: "bad", kind: "image", mime: "image/png", uri: "data:image/png;base64,AAAA", name: "bad.png" },
  ])
  await tiles.until(() => {
    const frame = tiles.app.captureCharFrame()
    return frame.includes("video · r.mp4") && frame.includes("video · x.mp4") && frame.includes("image · bad.png")
  })
  expect(tiles.videos()).toHaveLength(0)
})

test("retries a failed source when the item's uri changes and skips a draft file that is gone", async () => {
  await using temporary = await tmpdir()
  const png = Buffer.from(await Bun.file(imageFixture).arrayBuffer()).toString("base64")
  const broken: MediaItem = {
    id: "image",
    kind: "image",
    mime: "image/png",
    uri: "data:image/png;base64,AAAA",
    name: "pic.png",
    path: path.join(temporary.path, "gone.png"),
  }
  const [items, setItems] = createSignal<readonly MediaItem[]>([broken])
  await using tiles = await renderTiles(items)
  await tiles.until(() => tiles.app.captureCharFrame().includes("image · pic.png"))

  setItems([{ ...broken, uri: `data:image/png;base64,${png}` }])
  const picture = () => descendants(tiles.app.renderer.root).find((node) => node instanceof ImageRenderable)
  await tiles.until(() => !tiles.app.captureCharFrame().includes("image · pic.png") && picture() !== undefined)
})
