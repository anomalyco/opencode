import type { SessionMessageInfo, SessionMessageToolStateCompleted } from "@opencode/client"
import { expect, test } from "bun:test"
import { collectSessionMedia, isPlayableVideo, mediaKind } from "../../src/component/media/model"
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

test("classifies media by mime type, then by extension", () => {
  const rows = [
    ["IMAGE/JPEG", undefined, "image", false],
    ["video/x-m4v", undefined, "video", true],
    ["video/webm", "clip.webm", "video", false],
    ["application/pdf", "clip.mp4", "other", false],
    ["application/octet-stream", "clip.MOV", "video", true],
    ["video/x-matroska", "clip.mkv", "video", false],
    ["", "photo.webp", "image", false],
    ["", "notes.txt", "other", false],
    ["", undefined, "other", false],
  ] as const
  for (const [mime, name, kind, playable] of rows)
    expect([mime, mediaKind(mime, name), isPlayableVideo({ kind, mime, name })]).toEqual([mime, kind, playable])
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
    generated("posix", "/work/out/cat (1).webp"),
    generated("windows", "C:\\work\\out\\100%.png"),
    generated("failed", "/work/out/dog.png", "error"),
  ]
  const items = collectSessionMedia(messages, { directory: "/work" })
  expect(items.map((item) => [item.id, item.kind, item.uri.slice(0, 40), item.name])).toEqual([
    ["user:file:1", "image", "data:image/png;base64,AAAA", undefined],
    ["user:file:3", "video", "data:video/mp4;base64,AAAA", "clip.mp4"],
    ["assistant:tool:read:0", "video", `media:${"a".repeat(34)}`, "out.mp4"],
    ["assistant:tool:read:2", "image", "data:image/gif;base64,AAAA", undefined],
    ["posix:generated", "image", "file:///work/out/cat%20(1).webp", "cat (1).webp"],
    ["windows:generated", "image", "file:///C:/work/out/100%25.png", "100%.png"],
  ])
  expect(items.at(-1)).toMatchObject({ mime: "image/png", location: { directory: "/work" } })
  expect(
    collectSessionMedia([...messages, { id: "next", type: "user", time, text: "more" }], { directory: "/work" }),
  ).toEqual(items)
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
    expect([...gaps, crop.width - 1, crop.height - 1].every((gap) => Number.isInteger(gap) && gap >= 0)).toBe(true)
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
  expect([panned.left < center.left, panned.top > center.top]).toEqual([true, true])
  expect(layoutView(large, panBy(large, zoomed, 1e6, 1e6)).crop).toMatchObject({ left: 0, top: 0 })
  expect(panBy(large, initialView(large.source), 10, 10)).toEqual(initialView(large.source))
  // 200 columns of 10 pixels show 2000 pixels, so 1920 source pixels fit at nearly the actual size.
  expect(layoutView(large, { ...initialView(large.source), zoom: actualZoom(large, 10) }).scale).toBeCloseTo(0.1)
})
