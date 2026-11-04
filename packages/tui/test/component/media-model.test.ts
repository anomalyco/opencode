import type { SessionMessageInfo } from "@opencode/client"
import { expect, test } from "bun:test"
import { collectSessionMedia, isPlayableVideo, mediaKind } from "../../src/component/media/model"

const hash = "a".repeat(64)
const time = { created: 1 }
const model = { id: "model", providerID: "provider" }

test.each([
  ["image/png", undefined, "image"],
  ["IMAGE/JPEG", undefined, "image"],
  ["video/mp4", undefined, "video"],
  ["video/webm", undefined, "video"],
  ["application/pdf", "clip.mp4", "other"],
  ["application/octet-stream", "clip.MOV", "video"],
  ["", "clip.m4v", "video"],
  ["", "photo.webp", "image"],
  ["", "photo.jpeg", "image"],
  ["", "notes.txt", "other"],
  ["", undefined, "other"],
] as const)("mediaKind(%p, %p) is %p", (mime, name, kind) => {
  expect(mediaKind(mime, name)).toBe(kind)
})

test.each([
  [{ kind: "video", mime: "video/mp4" }, true],
  [{ kind: "video", mime: "video/quicktime" }, true],
  [{ kind: "video", mime: "video/x-m4v" }, true],
  [{ kind: "video", mime: "video/webm" }, false],
  [{ kind: "video", mime: "application/octet-stream", name: "clip.mov" }, true],
  [{ kind: "video", mime: "application/octet-stream", path: "/tmp/clip.mkv" }, false],
  [{ kind: "image", mime: "video/mp4" }, false],
] as const)("isPlayableVideo(%p) is %p", (item, playable) => {
  expect(isPlayableVideo(item)).toBe(playable)
})

test("collects session media in transcript order with stable ids", () => {
  const location = { directory: "/work" }
  const messages: SessionMessageInfo[] = [
    {
      id: "msg_user",
      type: "user",
      time,
      text: "look",
      files: [
        { data: "aGVsbG8=", mime: "text/plain", source: { type: "inline" }, name: "notes.txt" },
        { data: "AAAA", mime: "image/png", source: { type: "inline" }, name: "shot.png" },
        { data: "AAAA", mime: "video/mp4", source: { type: "uri", uri: "file:///work/clip.mp4" }, name: "clip.mp4" },
      ],
    },
    {
      id: "msg_assistant",
      type: "assistant",
      time,
      agent: "build",
      model,
      content: [
        { type: "text", text: "done" },
        {
          type: "tool",
          id: "call_read",
          name: "read",
          time,
          state: {
            status: "completed",
            input: {},
            content: [
              { type: "text", text: "read" },
              { type: "file", uri: `media:${hash}`, mime: "video/mp4", name: "out.mp4" },
              { type: "file", uri: "https://example.com/x.png", mime: "image/png" },
              { type: "file", uri: "data:image/gif;base64,AAAA", mime: "image/gif" },
            ],
          },
        },
        { type: "tool", id: "call_running", name: "read", time, state: { status: "running", input: {}, metadata: {} } },
      ],
    },
    {
      id: "msg_generated",
      type: "synthetic",
      time,
      description: "Image generation",
      text: '<image id="image_1" state="completed">\nImage request finished. Saved image: /work/out/cat.webp (provider/model).\n</image>',
      metadata: { source: "experimental_image_generate", state: "completed", path: "/work/out/cat" },
    },
    {
      id: "msg_failed",
      type: "synthetic",
      time,
      text: '<image id="image_2" state="error">\nImage request failed\n</image>',
      metadata: { source: "experimental_image_generate", state: "error", path: "/work/out/dog" },
    },
  ]

  const items = collectSessionMedia(messages, location)
  expect(items).toEqual([
    { id: "msg_user:file:1", kind: "image", mime: "image/png", uri: "data:image/png;base64,AAAA", name: "shot.png" },
    { id: "msg_user:file:2", kind: "video", mime: "video/mp4", uri: "data:video/mp4;base64,AAAA", name: "clip.mp4" },
    {
      id: "msg_assistant:tool:call_read:1",
      kind: "video",
      mime: "video/mp4",
      uri: `media:${hash}`,
      name: "out.mp4",
    },
    { id: "msg_assistant:tool:call_read:3", kind: "image", mime: "image/gif", uri: "data:image/gif;base64,AAAA" },
    {
      id: "msg_generated:generated",
      kind: "image",
      mime: "image/webp",
      uri: "file:///work/out/cat.webp",
      name: "cat.webp",
      location,
    },
  ])
  // Recollecting a grown session keeps earlier ids, so a clicked item is found again.
  expect(collectSessionMedia([...messages, { id: "msg_next", type: "user", time, text: "more" }], location)).toEqual(
    items,
  )
})

test("drops a repeated inline image mention like the transcript does", () => {
  const image = {
    data: "AAAA",
    mime: "image/png",
    source: { type: "inline" as const },
    mention: { start: 0, end: 9, text: "[Image 1]" },
  }
  const items = collectSessionMedia([{ id: "msg", type: "user", time, text: "[Image 1]", files: [image, image] }])
  expect(items.map((item) => item.id)).toEqual(["msg:file:0"])
})

test.each([
  ["/work/out/cat (1).png", "file:///work/out/cat%20(1).png", "cat (1).png"],
  ["C:\\work\\out\\100%.png", "file:///C:/work/out/100%25.png", "100%.png"],
])("names a generated image saved at %p on any server OS", (file, uri, name) => {
  const items = collectSessionMedia([
    {
      id: "msg",
      type: "synthetic",
      time,
      text: `Image request finished. Saved image: ${file} (provider/model).\nUse the read tool on this path to view the image.`,
      metadata: { source: "experimental_image_generate", state: "completed", path: "/stem" },
    },
  ])
  expect(items).toEqual([{ id: "msg:generated", kind: "image", mime: "image/png", uri, name }])
})
