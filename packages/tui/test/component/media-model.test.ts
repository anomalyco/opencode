import type { SessionMessageInfo, SessionMessageToolStateCompleted } from "@opencode/client"
import { expect, test } from "bun:test"
import { collectSessionMedia, isPlayableVideo, mediaKind, mentionedVideos } from "../../src/component/media/model"
import { formatDuration, posterTime } from "../../src/component/media/tile"
import {
  actualZoom,
  fillZoom,
  initialView,
  layoutView,
  panBy,
  sourcePoint,
  zoomAt,
} from "../../src/component/media/zoom"

const time = { created: 1 }

test.each([
  ["IMAGE/JPEG", undefined, "image", false],
  ["video/x-m4v", undefined, "video", true],
  ["video/webm", "clip.webm", "video", false],
  ["application/pdf", "clip.mp4", "other", false],
  ["application/octet-stream", "clip.MOV", "video", true],
  ["video/x-matroska", "clip.mkv", "video", false],
  ["", "photo.webp", "image", false],
  ["", "notes.txt", "other", false],
  ["", undefined, "other", false],
] as const)("%p named %p is %p media, playable: %p", (mime, name, kind, playable) => {
  expect(mediaKind(mime, name)).toBe(kind)
  expect(isPlayableVideo({ kind, mime, name })).toBe(playable)
})

test.each([
  [0, 0],
  [2.9, 0],
  [4, 0.4],
  [300, 30],
  [3600, 30],
])("a %p s clip poses its poster at %p s", (duration, poster) => {
  expect(posterTime(duration)).toBe(poster)
})

test.each([
  [0, "0:00"],
  [59.6, "1:00"],
  [600, "10:00"],
  [3725, "1:02:05"],
])("formats %p s as %p", (seconds, label) => {
  expect(formatDuration(seconds)).toBe(label)
})

test("collects session media in transcript order with stable ids", () => {
  const image = { data: "AAAA", mime: "image/png", source: { type: "inline" as const } }
  const mention = { ...image, mention: { start: 0, end: 9, text: "[Image 1]" } }
  const files = [{ ...image, mime: "text/plain" }, mention, mention, { ...image, mime: "video/mp4", name: "clip.mp4" }]
  const content: SessionMessageToolStateCompleted["content"] = [
    { type: "file", uri: `media:${"a".repeat(64)}`, mime: "video/mp4", name: "out.mp4" },
    { type: "file", uri: "https://example.com/x.png", mime: "image/png" },
    { type: "file", uri: "data:image/gif;base64,AAAA", mime: "image/gif" },
  ]
  const state = { status: "completed" as const, input: {}, content }
  const tool = { type: "tool" as const, id: "read", name: "read", time, state }
  const generated = (id: string, file: string, state: "completed" | "error" = "completed"): SessionMessageInfo => ({
    id,
    type: "synthetic",
    time,
    text: `Image request finished. Saved image: ${file} (provider/model).\nUse the read tool on this path.`,
    metadata: { source: "experimental_image_generate", state, path: "/stem" },
  })
  const messages: SessionMessageInfo[] = [
    { id: "user", type: "user", time, text: "[Image 1]", files },
    { id: "assistant", type: "assistant", time, agent: "build", model: { id: "m", providerID: "p" }, content: [tool] },
    generated("posix", "/work/out/a\\cat (1).webp"),
    generated("windows", "C:\\work\\out\\100%.png"),
    generated("failed", "/work/out/dog.png", "error"),
  ]
  const items = collectSessionMedia(messages, { directory: "/work" })
  expect(items.map((item) => [item.id, item.kind, item.uri.slice(0, 40), item.name])).toEqual([
    ["user:file:1", "image", "data:image/png;base64,AAAA", undefined],
    ["user:file:3", "video", "data:video/mp4;base64,AAAA", "clip.mp4"],
    ["assistant:tool:read:0", "video", `media:${"a".repeat(34)}`, "out.mp4"],
    ["assistant:tool:read:2", "image", "data:image/gif;base64,AAAA", undefined],
    ["posix:generated", "image", "file:///work/out/a%5Ccat%20(1).webp", "a\\cat (1).webp"],
    ["windows:generated", "image", "file:///C:/work/out/100%25.png", "100%.png"],
  ])
  expect(items.at(-1)).toMatchObject({ mime: "image/png", location: { directory: "/work" } })
  expect(
    collectSessionMedia([...messages, { id: "next", type: "user", time, text: "more" }], { directory: "/work" }),
  ).toEqual(items)
})

test.each([
  // Forms of a path.
  ["/srv/out/demo.mp4", ["/srv/out/demo.mp4"]],
  ["out/demo.mp4 ./here.MOV ../up.m4v bare.mp4", ["/work/out/demo.mp4", "/work/here.MOV", "/up.m4v", "/work/bare.mp4"]],
  ["~/Videos/a.mp4", ["/home/me/Videos/a.mp4"]],
  ["file:///srv/my%20clip.mp4 file://localhost/srv/b.mp4", ["/srv/my clip.mp4", "/srv/b.mp4"]],
  // Delimiters and punctuation.
  ["Saved to out/demo.mp4.", ["/work/out/demo.mp4"]],
  ["(paren.mp4), <angle.mp4>; **bold.mp4**!", ["/work/paren.mp4", "/work/angle.mp4", "/work/bold.mp4"]],
  // `*` is emphasis, also across words, except where a glob's `*/` or `*.` starts.
  ["*it.mp4* **/tmp/a.mp4 `*.b.mp4`", ["/work/it.mp4"]],
  ["**Done: out/a.mp4** and **b.mp4 is ready**", ["/work/out/a.mp4", "/work/b.mp4"]],
  ["out/demo(1).mp4 (out/demo(2).mp4). (see z.mp4)", ["/work/out/demo(1).mp4", "/work/out/demo(2).mp4", "/work/z.mp4"]],
  ["保存しました out.mp4。 x.mp4…", ["/work/out.mp4", "/work/x.mp4"]],
  // A span with spaces is one path, and its words are paths too, but no link or escape in it counts.
  ["Saved to `out/my demo.mp4`.", ["/work/out/my demo.mp4", "/work/demo.mp4"]],
  ["`ffmpeg -i in.mov out.mp4`", ["/work/ffmpeg -i in.mov out.mp4", "/work/in.mov", "/work/out.mp4"]],
  ['`ffmpeg -i "in.mov" [x](a%20b.mp4)`', ["/work/in.mov", "/work/a%20b.mp4"]],
  [`"quoted clip.mp4" and 'single.mov'`, ["/work/quoted clip.mp4", "/work/clip.mp4", "/work/single.mov"]],
  [`it's 'my clip.mp4', or "use out.mp4, now"`, ["/work/my clip.mp4", "/work/clip.mp4", "/work/out.mp4"]],
  [`René's clip is './a b.mp4'`, ["/work/a b.mp4", "/work/b.mp4"]],
  ["unquoted my clip.mp4", ["/work/clip.mp4"]],
  // A markdown link names its target, one path which may be %-escaped and have a title, and not its label.
  ['[the clip](out/my%20clip.mp4 "Title") [x](<a.m4v>)', ["/work/out/my clip.mp4", "/work/a.m4v"]],
  ["[x]( file:///work/100%25.mp4 ) [y](https://host/a%20b.mp4) [z](mailto:me%20c.mp4)", ["/work/100%.mp4"]],
  ["[demo.mp4](out/demo.mp4) [100%.mp4](100%.mp4)", ["/work/out/demo.mp4", "/work/100%.mp4"]],
  // A flag or variable names its value.
  ["--output=out/demo.mp4 VIDEO=v.mp4", ["/work/out/demo.mp4", "/work/v.mp4"]],
  // Duplicates by resolved path, first mention first.
  ["b.mp4 a.mp4 ./b.mp4 /work/a.mp4 `b.mp4`", ["/work/b.mp4", "/work/a.mp4"]],
  // Not a playable video, or not one server file.
  ["the .mp4 format, mp4s, clip.mp4x, clip.mp4.txt, shot.png, clip.webm, *.mp4, **/*.mp4, clip?.mp4", []],
  ["https://example.com/a.mp4 data:video/mp4;base64,AAAA media:abc.mp4 ftp://host/b.mp4 https://x/a(1)b.mp4", []],
  ["file://host/share/a.mp4 file:///bad%E0.mp4 C:\\work\\a.mp4 C:/work/b.mp4", []],
  ["file:///work/README.md#.mp4 file:///work/x.md?v=.mp4 file:///work/sub%2F.mp4 file:///work/a.mp4#t=1", []],
  // Another host, which a check would contact.
  ["//cdn.example.com/a.mp4 \\\\host\\share\\b.mp4 file:////host/c.mp4", []],
] as const)("finds the videos %p names", (text, files) => {
  expect(mentionedVideos(text, "/work", "/home/me").map((video) => video.file)).toEqual([...files])
})

test("finds Windows paths for a Windows server, and `~/` paths only for a local one", () => {
  const text = "C:\\work\\a.mp4 D:/b.mp4 rel\\c.mp4 file:///E:/d%20e.mp4 ~/f.mp4 sub\\.mp4 //host/g.mp4 \\\\host\\h.mp4"
  expect(mentionedVideos(text, "C:\\work")).toEqual([
    { file: "C:\\work\\a.mp4", mime: "video/mp4" },
    { file: "D:\\b.mp4", mime: "video/mp4" },
    { file: "C:\\work\\rel\\c.mp4", mime: "video/mp4" },
    { file: "E:\\d e.mp4", mime: "video/mp4" },
  ])
  expect(mentionedVideos("~/f.mp4", "/work")).toEqual([])
  // A session in a UNC directory finds no relative path.
  expect(mentionedVideos("a.mp4 C:\\b.mov", "\\\\wsl.localhost\\work")).toEqual([
    { file: "C:\\b.mov", mime: "video/quicktime" },
  ])
})

test("collects the existing videos a finished reply names, in order with its tool files", () => {
  const content: SessionMessageToolStateCompleted["content"] = [
    { type: "file", uri: "data:video/mp4;base64,AAAA", mime: "video/mp4", name: "tool.mp4" },
  ]
  const tool = {
    type: "tool" as const,
    id: "call",
    name: "render",
    time,
    state: { status: "completed" as const, input: {}, content },
  }
  const reply = (id: string, completed?: number): SessionMessageInfo => ({
    id,
    type: "assistant",
    time: { created: 1, completed },
    agent: "build",
    model: { id: "m", providerID: "p" },
    content: [
      { type: "text", text: "" },
      { type: "text", text: "Rendered gone.mp4 and out/a.mp4" },
      tool,
      { type: "text", text: "Also /work/out/a.mp4 and C:\\b.mp4 b.mp4 c\\d.mp4, not file:///work/sub%2F.mp4" },
    ],
  })
  const asked: string[] = []
  const mentioned = {
    exists: (file: string) => {
      asked.push(file)
      return file !== "/work/gone.mp4"
    },
  }
  const location = { directory: "/work" }

  const items = collectSessionMedia([reply("done", 2), reply("streaming")], location, mentioned)
  expect(items.map((item) => [item.id, item.mime, item.uri, item.name])).toEqual([
    ["done:text:1:1", "video/mp4", "file:///work/out/a.mp4", "a.mp4"],
    ["done:tool:call:0", "video/mp4", "data:video/mp4;base64,AAAA", "tool.mp4"],
    ["done:text:2:1", "video/mp4", "file:///work/b.mp4", "b.mp4"],
    // On a POSIX server, a backslash is part of a name.
    ["done:text:2:2", "video/mp4", "file:///work/c%5Cd.mp4", "c\\d.mp4"],
    ["streaming:tool:call:0", "video/mp4", "data:video/mp4;base64,AAAA", "tool.mp4"],
  ])
  expect(items[0]?.location).toEqual(location)
  // A name that only looks like a video's, such as one with an escaped separator, is no item.
  expect(items.every(isPlayableVideo)).toBe(true)
  // A file named twice is asked about once; the streaming reply asks about none.
  expect(asked).toEqual(["/work/gone.mp4", "/work/out/a.mp4", "/work/b.mp4", "/work/c\\d.mp4"])
  // Without existence checks, text adds nothing.
  expect(collectSessionMedia([reply("done", 2)], location).map((item) => item.id)).toEqual(["done:tool:call:0"])
})

test.each([
  { source: { width: 160, height: 90 }, stage: { width: 80, height: 20 }, cellAspect: 2 },
  { source: { width: 1920, height: 1080 }, stage: { width: 200, height: 50 }, cellAspect: 2.1 },
  { source: { width: 90, height: 160 }, stage: { width: 120, height: 40 }, cellAspect: 2 },
  { source: { width: 7, height: 3 }, stage: { width: 33, height: 17 }, cellAspect: 1.8 },
])("zoom keeps whole crops inside the source and the pixel under the pointer in place (%#)", (geometry) => {
  const source = geometry.source
  for (const view of [initialView(source), { zoom: 0.1, x: -1e6, y: 0.3 }, { zoom: 1e6, x: 1e6, y: 1e6 }]) {
    const layout = layoutView(geometry, view)
    const crop = layout.crop
    // Whole pixels inside the source, at least one wide and tall.
    const gaps = [crop.left, crop.top, source.width - crop.left - crop.width, source.height - crop.top - crop.height]
    for (const gap of [...gaps, crop.width - 1, crop.height - 1]) {
      expect(Number.isInteger(gap)).toBe(true)
      expect(gap).toBeGreaterThanOrEqual(0)
    }
    expect(layout.rect.left + layout.rect.width).toBeLessThanOrEqual(geometry.stage.width)
    expect(layoutView(geometry, layout.view)).toEqual(layout)
  }
  // Zoomed in far enough that the image covers the stage, so the pointer never lands in the letterbox.
  const start = { ...initialView(source), zoom: fillZoom(geometry) * 2 }
  for (const at of [1 / 2, 1 / 3, 3 / 4])
    for (const factor of [1.25, 0.8]) {
      const pointer = { x: Math.floor(geometry.stage.width * at), y: Math.floor(geometry.stage.height * at) }
      const after = layoutView(geometry, zoomAt(geometry, start, factor, pointer))
      const edge = after.crop.left === 0 || after.crop.top === 0 || after.crop.left + after.crop.width === source.width
      if (edge || after.crop.top + after.crop.height === source.height) continue
      const anchor = sourcePoint(layoutView(geometry, start), pointer, source)
      const moved = sourcePoint(after, pointer, source)
      expect(Math.abs(moved.x - anchor.x)).toBeLessThanOrEqual(1 + 1 / after.scale)
      expect(Math.abs(moved.y - anchor.y)).toBeLessThanOrEqual(1 + geometry.cellAspect / after.scale)
    }
})

test("zoom fits, grows to fill the stage before cropping, pans to the edges and maps the actual size", () => {
  const small = { source: { width: 160, height: 90 }, stage: { width: 80, height: 20 }, cellAspect: 2 }
  const large = { source: { width: 1920, height: 1080 }, stage: { width: 200, height: 50 }, cellAspect: 2.1 }
  // 160x90 is 3.56 columns per row once cells are twice as tall as wide, so 20 rows take 71 columns.
  expect(layoutView(small, initialView(small.source)).rect).toEqual({ left: 4, top: 0, width: 71, height: 20 })
  const view = zoomAt(small, initialView(small.source), 1.1)
  expect(layoutView(small, view)).toMatchObject({ rect: { width: 78, height: 20 }, crop: { width: 160, height: 82 } })
  expect(layoutView(small, { ...view, zoom: fillZoom(small) }).rect).toEqual({ left: 0, top: 0, width: 80, height: 20 })
  expect(layoutView(small, zoomAt(small, view, 0.1)).crop).toEqual({ left: 0, top: 0, width: 160, height: 90 })
  const zoomed = { ...initialView(large.source), zoom: 4 }
  const center = layoutView(large, zoomed).crop
  const panned = layoutView(large, panBy(large, zoomed, 10, -5)).crop
  expect(panned.left).toBeLessThan(center.left)
  expect(panned.top).toBeGreaterThan(center.top)
  expect(layoutView(large, panBy(large, zoomed, 1e6, 1e6)).crop).toMatchObject({ left: 0, top: 0 })
  expect(panBy(large, initialView(large.source), 10, 10)).toEqual(initialView(large.source))
  // 200 columns of 10 pixels show 2000 pixels, so 1920 source pixels fit at nearly the actual size.
  expect(layoutView(large, { ...initialView(large.source), zoom: actualZoom(large, 10) }).scale).toBeCloseTo(0.1)
})
