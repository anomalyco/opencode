/** @jsxImportSource @opentui/solid */
import { ImageRenderable, type ScrollBoxRenderable } from "@opentui/core"
import { ManualClock } from "@opentui/core/testing"
import { expect, test } from "bun:test"
import path from "node:path"
import { createSignal, For, Index, Show } from "solid-js"
import type { MediaItem } from "../../src/component/media/model"
import { MediaStrip } from "../../src/component/media/strip"
import { MediaTile } from "../../src/component/media/tile"
import { descendants, image, imageFixture, longVideoFixture, renderMedia, video, videoFixture } from "../fixture/media"

const videoBytes = new Uint8Array(await Bun.file(videoFixture).arrayBuffer())
const videoData = `data:video/mp4;base64,${Buffer.from(videoBytes).toString("base64")}`

test("a strip shows paused silent posters, and plays only the tile the pointer rests on", async () => {
  const clock = new ManualClock()
  await using tiles = await renderMedia(
    () => (
      <MediaStrip
        items={[video("a", { path: longVideoFixture }), video("b", { uri: videoData, path: undefined })]}
        width={60}
        height={6}
        onOpen={() => {}}
      />
    ),
    false,
    clock,
  )
  await tiles.until(() => /▶ 0:04.*▶ 0:02/.test(tiles.frame()))
  const [first, second] = tiles.videos()
  // A data URI plays from a file written into the media directory; a clip of 3 s or more poses 10% in.
  expect(path.dirname(second!.source!)).toBe(tiles.directory)
  expect(first!.currentTime).toBe(0.4)
  expect(first!.paused).toBe(true)
  expect(first!.audio).toBe(false)
  expect(first!.loop).toBe(true)
  expect(first!.maxFps).toBe(tiles.media().thumbnailFps())

  // Each move, across the tiles and then within the first, starts the 300 ms wait again.
  for (const x of [26, 4, 5]) {
    await tiles.app.mockMouse.moveTo(x, 2)
    clock.advance(299)
  }
  expect(tiles.media().activeTile()).toBeUndefined()
  clock.advance(1)
  await tiles.app.renderOnce()
  expect(first!.playing).toBe(true)
  // Moving over the badge stays within the tile.
  await tiles.app.mockMouse.moveTo(1, 5)
  await tiles.app.renderOnce()
  expect(first!.playing).toBe(true)
  expect(second!.paused).toBe(true)

  await tiles.app.mockMouse.moveTo(26, 2)
  clock.advance(300)
  await tiles.app.renderOnce()
  expect(second!.playing).toBe(true)
  expect(first!.paused).toBe(true)
  expect(first!.currentTime).toBe(0.4)
  await tiles.app.mockMouse.moveTo(50, 8)
  await tiles.app.renderOnce()
  expect(tiles.media().activeTile()).toBeUndefined()
  expect(second!.paused).toBe(true)
  expect(second!.currentTime).toBe(0)

  // The viewer stops the playing tile.
  await tiles.app.mockMouse.moveTo(4, 2)
  clock.advance(300)
  expect(tiles.media().activeTile()).toBeDefined()
  tiles.media().openViewer([image("image")], 0)
  expect(tiles.media().activeTile()).toBeUndefined()
})

test("a strip opens on clicks, but a selection released over it copies instead", async () => {
  const opened: number[] = []
  let released = 0
  await using tiles = await renderMedia(() => (
    <box flexDirection="column" onMouseUp={() => released++}>
      <MediaStrip
        items={[video("a"), image("b"), image("c"), image("d")]}
        width={50}
        height={6}
        onOpen={(index) => opened.push(index)}
      />
      <text>selectable words</text>
    </box>
  ))
  await tiles.until(() => tiles.frame().includes("▶ 0:02") && tiles.frame().includes("+2 more"))
  const more = tiles
    .frame()
    .split("\n")
    .find((line) => line.includes("+2 more"))!
    .indexOf("+2 more")

  // Releasing a text selection over a tile or "+N more" bubbles to the page.
  for (const x of [4, more]) {
    await tiles.app.mockMouse.drag(2, 6, x, 2)
    expect(tiles.app.renderer.getSelection()?.getSelectedText()).toBeTruthy()
    tiles.app.renderer.clearSelection()
  }
  expect(opened).toEqual([])
  expect(released).toBe(2)

  // The badge is part of the tile.
  await tiles.app.mockMouse.click(1, 5)
  await tiles.app.mockMouse.click(26, 2)
  await tiles.app.mockMouse.click(more, 2)
  expect(opened).toEqual([0, 1, 2])
  expect(released).toBe(2)

  // A drag started on one tile, or elsewhere, and released over another opens neither.
  await tiles.app.mockMouse.drag(4, 2, 26, 2)
  await tiles.app.mockMouse.drag(70, 2, 26, 2)
  expect(opened).toEqual([0, 1, 2])
})

test("a video tile stays empty while its file loads", async () => {
  const bytes = Promise.withResolvers<Uint8Array>()
  const [item, setItem] = createSignal<MediaItem>()
  await using tiles = await renderMedia(() => (
    <Show when={item()}>{(value) => <MediaTile item={value()} width={30} height={4} />}</Show>
  ))
  // The tile's write of the data URI joins this pending one for the same file.
  const sha256 = new Bun.CryptoHasher("sha256").update(videoBytes).digest("hex")
  const written = tiles.media().files.ensure(sha256, ".mp4", () => bytes.promise)
  setItem(video("clip", { uri: videoData, path: undefined }))
  await tiles.app.renderOnce()
  expect(tiles.frame()).not.toContain("clip.mp4")

  bytes.resolve(videoBytes)
  await written
  await tiles.until(() => tiles.frame().includes("▶ 0:02"))
  expect(tiles.frame()).not.toContain("clip.mp4")
})

test("a tile falls back to its kind and name when its media cannot be shown, and tries again when it changes", async () => {
  const png = Buffer.from(await Bun.file(imageFixture).arrayBuffer()).toString("base64")
  const [items, setItems] = createSignal<MediaItem[]>([
    video("remote", { uri: "https://example.com/a.mp4", path: undefined }),
    video("broken", { path: import.meta.path }),
    image("bad", { uri: "data:image/png;base64,AAAA", path: "/gone.png" }),
  ])
  await using tiles = await renderMedia(() => (
    <box flexDirection="row" gap={1}>
      <Index each={items()}>{(item) => <MediaTile item={item()} width={18} height={4} />}</Index>
    </box>
  ))
  await tiles.until(() => /video · remote\.mp4.*video · broken\.mp4.*image · bad\.png/.test(tiles.frame()))
  expect(tiles.videos()).toHaveLength(0)

  setItems(([remote, broken, bad]) => [
    remote!,
    { ...broken!, path: videoFixture },
    { ...bad!, uri: `data:image/png;base64,${png}` },
  ])
  await tiles.until(() => tiles.frame().includes("▶ 0:02") && !tiles.frame().includes("bad.png"))
  expect(tiles.frame()).toContain("video · remote.mp4")
  expect(tiles.videos()).toHaveLength(1)
  expect(descendants(tiles.app.renderer.root).some((node) => node instanceof ImageRenderable)).toBe(true)
})

test("at most four tiles in view keep a poster player, the rest name their video", async () => {
  let scroll: ScrollBoxRenderable | undefined
  const items = Array.from({ length: 8 }, (_, index) => video(`v${index}`))
  await using tiles = await renderMedia(() => (
    <scrollbox ref={(element: ScrollBoxRenderable) => (scroll = element)} height={12}>
      <For each={items}>{(item) => <MediaTile item={item} width={30} height={2} />}</For>
    </scrollbox>
  ))
  const labels = () => items.filter((item) => tiles.frame().includes(`▶ ${item.name}`)).map((item) => item.id)
  // Rows 0-11 show the first six tiles whole; the first four take players.
  await tiles.until(() => tiles.videos().length === 4 && labels().join() === "v4,v5")
  // Scrolled to the end, the tiles still in view keep their players and v4 and v5 take the players v0 and v1 leave.
  scroll!.scrollTo(4)
  await tiles.until(() => labels().join() === "v6,v7")
})
