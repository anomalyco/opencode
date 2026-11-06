import { expect, test } from "bun:test"
import type {
  SessionMessageAssistant,
  SessionMessageAssistantTool,
  SessionMessageToolStateCompleted,
  SessionMessageUser,
  ToolContent,
} from "@opencode/client/promise"
import { sessionMedia, textLinks } from "./collect"

const user = (id: string, time: number, input: Partial<SessionMessageUser>): SessionMessageUser => ({
  id,
  type: "user",
  time: { created: time },
  text: "",
  ...input,
})

const assistant = (id: string, time: number, content: SessionMessageAssistant["content"]): SessionMessageAssistant => ({
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
  content: [ToolContent, ...ToolContent[]] = [{ type: "text", text: "" }],
  metadata?: SessionMessageToolStateCompleted["metadata"],
): SessionMessageAssistantTool => ({
  type: "tool",
  id,
  name,
  time: { created: 0 },
  state: { status: "completed", input, content, metadata },
})

test("sorts what the user and the agent shared into media, files and links, newest first", () => {
  const result = sessionMedia([
    user("msg_1", 1, {
      text: "Match https://example.com/design, and see [the spec](https://docs.example.com/spec).",
      files: [
        { mime: "image/png", data: "iVBORw==", source: { type: "inline" }, name: "mock.png" },
        { mime: "application/pdf", data: "JVBERg==", source: { type: "inline" }, name: "brief.pdf" },
        {
          mime: "text/plain",
          data: "",
          source: { type: "uri", uri: "file:///work/app/src/index.ts" },
          mention: { start: 0, end: 9, text: "@index.ts" },
        },
      ],
    }),
    assistant("msg_2", 2, [
      { type: "text", text: "Done. Compare with https://example.com/design/ and https://github.com/acme/app." },
      tool("call_read", "read", { path: "/work/app/shot.png" }, [
        { type: "file", uri: "data:image/png;base64,", mime: "image/png", name: "shot.png" },
      ]),
      tool("call_shot", "browser", {}, [{ type: "file", uri: "data:image/jpeg;base64,", mime: "image/jpeg" }]),
      tool("call_write", "write", { path: "src/logo.svg" }),
      tool("call_new", "write", { path: "src/new.ts" }),
      tool("call_patch", "patch", { patchText: "" }, undefined, {
        files: [
          { file: "src/added.ts", patch: "", additions: 1, deletions: 0, status: "added" },
          { file: "src/changed.ts", patch: "", additions: 1, deletions: 1, status: "modified" },
        ],
      }),
      tool("call_fetch", "webfetch", { url: "https://opencode.ai/docs" }),
      tool("call_search", "websearch", { query: "solid" }, [
        { type: "text", text: "## [SolidJS](https://www.solidjs.com/)\n## [Docs](https://docs.example.com/spec)" },
      ]),
    ]),
  ])

  expect(result.media.map((item) => [item.from, item.kind, item.source])).toEqual([
    ["agent", "image", { type: "path", path: "src/logo.svg" }],
    ["agent", "image", { type: "tool", messageID: "msg_2", toolID: "call_shot", index: 0 }],
    ["agent", "image", { type: "path", path: "/work/app/shot.png" }],
    ["user", "image", { type: "url", url: "data:image/png;base64,iVBORw==" }],
  ])

  expect(result.files.map((item) => [item.from, item.action, item.name, item.path])).toEqual([
    ["agent", "created", "added.ts", "src/added.ts"],
    ["agent", "created", "new.ts", "src/new.ts"],
    ["agent", "created", "logo.svg", "src/logo.svg"],
    ["user", "mentioned", "index.ts", "/work/app/src/index.ts"],
    ["user", "attached", "brief.pdf", undefined],
  ])

  // A link keeps its first mention and sender; a later search result gives an untitled one its title.
  expect(result.links.map((item) => [item.from, item.via, item.url, item.title])).toEqual([
    ["agent", "search", "https://www.solidjs.com/", "SolidJS"],
    ["agent", "fetch", "https://opencode.ai/docs", undefined],
    ["agent", "text", "https://github.com/acme/app", undefined],
    ["user", "text", "https://docs.example.com/spec", "the spec"],
    ["user", "text", "https://example.com/design", undefined],
  ])
})

test("lists a file the agent wrote or read again once, at its newest mention", () => {
  const result = sessionMedia([
    assistant("msg_1", 1, [tool("call_1", "write", { path: "a.ts" }), tool("call_2", "read", { path: "shot.png" })]),
    assistant("msg_2", 2, [tool("call_3", "write", { path: "b.ts" })]),
    assistant("msg_3", 3, [tool("call_4", "write", { path: "a.ts" }), tool("call_5", "read", { path: "shot.png" })]),
  ])

  expect(result.files.map((item) => [item.path, item.messageID])).toEqual([
    ["a.ts", "msg_3"],
    ["b.ts", "msg_2"],
  ])
  expect(result.media.map((item) => item.messageID)).toEqual(["msg_3"])
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
