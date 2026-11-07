import { expect, test } from "bun:test"
import { Schema } from "effect"
import { collect, textLinks } from "@opencode/core/plugin/media/collect"
import { SessionMessage } from "@opencode/schema/session-message"

const decode = Schema.decodeUnknownSync(SessionMessage.MediaInfo)

const user = (id: string, time: number, input: Record<string, unknown>) =>
  decode({ id, type: "user", time: { created: time }, text: "", ...input })

const assistant = (id: string, time: number, content: unknown[]) =>
  decode({
    id,
    type: "assistant",
    time: { created: time },
    agent: "build",
    model: { id: "model", providerID: "provider" },
    content,
  })

const tool = (
  id: string,
  name: string,
  input: Record<string, string>,
  content: unknown[] = [{ type: "text", text: "" }],
) => ({
  type: "tool",
  id,
  name,
  time: { created: 0 },
  state: { status: "completed", input, content },
})

test("sorts what the user and the agent shared into media and links, newest first", () => {
  const result = collect([
    assistant("msg_2", 2, [
      { type: "text", text: "Done. Compare with https://example.com/design/ and https://github.com/acme/app." },
      tool("call_read", "read", { path: "/work/app/shot.png" }, [
        { type: "file", uri: "data:image/png;base64,iVBORw==", mime: "image/png", name: "shot.png" },
      ]),
      tool("call_shot", "browser", {}, [{ type: "file", uri: "data:image/jpeg;base64,/9j/", mime: "image/jpeg" }]),
      tool("call_blob", "browser", {}, [
        { type: "file", uri: `media:${"a".repeat(64)}`, mime: "image/png", name: "stored.png" },
      ]),
      tool("call_write", "write", { path: "src/logo.svg" }),
      tool("call_new", "write", { path: "src/new.ts" }),
      tool("call_fetch", "webfetch", { url: "https://opencode.ai/docs" }),
      tool("call_search", "websearch", { query: "solid" }, [
        { type: "text", text: "## [SolidJS](https://www.solidjs.com/)\n## [Docs](https://docs.example.com/spec)" },
      ]),
    ]),
    user("msg_1", 1, {
      text: "Match https://example.com/design, and see [the spec](https://docs.example.com/spec).",
      files: [
        {
          mime: "image/png",
          data: "iVBORw==",
          source: { type: "inline" },
          name: "mock.png",
          mention: { start: 0, end: 9, text: "[Image 1]" },
        },
        { mime: "application/pdf", data: "JVBERg==", source: { type: "inline" }, name: "brief.pdf" },
        { mime: "image/webp", uri: `media:${"b".repeat(64)}`, source: { type: "inline" }, name: "ref.webp" },
      ],
    }),
  ])

  // Inline bytes never leave the server in a page: the client reads them from the message when it shows the item.
  expect(result.media.map((item) => [item.from, item.kind, item.source])).toEqual([
    ["agent", "image", { type: "path", path: "src/logo.svg" }],
    ["agent", "image", { type: "media", uri: `media:${"a".repeat(64)}` }],
    ["agent", "image", { type: "tool", messageID: "msg_2", toolID: "call_shot", index: 0 }],
    ["agent", "image", { type: "path", path: "/work/app/shot.png" }],
    ["user", "image", { type: "media", uri: `media:${"b".repeat(64)}` }],
    ["user", "image", { type: "attachment", messageID: "msg_1", index: 0 }],
  ])

  // A link lists once at its newest mention, and takes the title an older one gave it.
  expect(result.links.map((item) => [item.from, item.via, item.url, item.title])).toEqual([
    ["agent", "search", "https://docs.example.com/spec", "Docs"],
    ["agent", "search", "https://www.solidjs.com/", "SolidJS"],
    ["agent", "fetch", "https://opencode.ai/docs", undefined],
    ["agent", "text", "https://github.com/acme/app", undefined],
    ["agent", "text", "https://example.com/design/", undefined],
  ])
})

test("lists an image the agent wrote or read again once, at its newest mention", () => {
  const result = collect([
    assistant("msg_3", 3, [tool("call_4", "read", { path: "shot.png" })]),
    assistant("msg_2", 2, [tool("call_3", "write", { path: "other.png" })]),
    assistant("msg_1", 1, [tool("call_1", "write", { path: "shot.png" })]),
  ])

  expect(result.media.map((item) => [item.name, item.messageID])).toEqual([
    ["shot.png", "msg_3"],
    ["other.png", "msg_2"],
  ])
})

test("reads links out of prose without its punctuation or an unopened bracket", () => {
  expect(
    textLinks(
      "See (https://en.wikipedia.org/wiki/Foo_(bar)), <https://a.example/x>, `https://b.example/y`. Then http://c.example/z!",
    ).map((item) => item.url),
  ).toEqual([
    "https://en.wikipedia.org/wiki/Foo_(bar)",
    "https://a.example/x",
    "https://b.example/y",
    "http://c.example/z",
  ])
})
