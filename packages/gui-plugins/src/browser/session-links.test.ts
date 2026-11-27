import { describe, expect, test } from "bun:test"
import type { JsonValue, SessionMessageInfo } from "@opencode/client/promise"
import { uuid } from "@opencode/util/uuid"
import { createSessionLinks } from "./session-links"

type Assistant = Extract<SessionMessageInfo, { type: "assistant" }>

type Part = Assistant["content"][number]

// A reply as the server sends it, finished unless `streaming`.
function reply(content: Part[], streaming = false): Assistant {
  return {
    id: `msg_${uuid()}`,
    type: "assistant",
    agent: "build",
    model: { providerID: "test", id: "test" },
    time: streaming ? { created: 1 } : { created: 1, completed: 2 },
    content,
  }
}

const text = (value: string): Part => ({ type: "text", text: value })

const tool = (
  name: string,
  input: Record<string, string>,
  metadata: Record<string, JsonValue> = {},
  result = "",
): Part => ({
  type: "tool",
  id: `call_${uuid()}`,
  name,
  state: { status: "completed", input, content: [{ type: "text", text: result }], metadata },
  time: { created: 1, completed: 2 },
})

const server = "http://127.0.0.1:3084"

// What a session lists, by the key that tells its pages apart.
const listed = (messages: SessionMessageInfo[], limit = 5) => createSessionLinks()(messages, limit, server).map((link) => link.key)

describe("session links", () => {
  test("lists what the agent read, opened and linked, newest first and without repeats", () => {
    const messages: SessionMessageInfo[] = [
      reply([tool("webfetch", { url: "https://docs.github.com/guide" })]),
      reply([
        text("See [the guide](https://docs.github.com/guide) and https://bun.com/docs."),
        tool("execute", { code: "..." }, {
          toolCalls: [
            { tool: "browser.tabs.open", status: "completed", input: { url: "http://localhost:4399" } },
            { tool: "fetch", status: "completed", input: { method: "GET", url: "https://api.github.com/repos" } },
            { tool: "browser.tabs.list", status: "completed" },
          ],
        }),
      ]),
    ]

    expect(listed(messages)).toEqual([
      "https://api.github.com/repos",
      "http://localhost:4399/",
      "https://bun.com/docs",
      "https://docs.github.com/guide",
    ])
  })

  test("lists artifacts by their own address, the files the agent showed, and the local servers its commands printed", () => {
    const messages: SessionMessageInfo[] = [
      reply([tool("artifact_create", { title: "Report" }, {}, "Published Report (art_1a via local): /api/experimental/artifacts/art_1a/view/")]),
      reply([
        tool("shell", { command: "bun dev" }, {}, "Fetching https://registry.npmjs.org/vite\n  Local: http://localhost:5173/"),
        tool("execute", { code: "..." }, { toolCalls: [{ tool: "browser.tabs.open", status: "completed", input: { path: "report.html" } }] }),
        text("Open [the report](/api/experimental/artifacts/art_2b/view/index.html)."),
      ]),
    ]

    expect(listed(messages)).toEqual([
      "artifact://art_2b/index.html",
      "file:report.html",
      "http://localhost:5173/",
      "artifact://art_1a/",
    ])
  })

  test("lists a page opened with other parameters once, at its newest address", () => {
    const links = createSessionLinks()

    const messages: SessionMessageInfo[] = [
      reply([text("http://127.0.0.1:6017/?id=story&scenario=Polling")]),
      reply([text("http://127.0.0.1:6017/?id=story&scenario=Failures and http://127.0.0.1:6017/docs")]),
    ]

    expect(links(messages, 5, server).map((link) => (link.type === "page" ? link.url : link.path))).toEqual([
      "http://127.0.0.1:6017/docs",
      "http://127.0.0.1:6017/?id=story&scenario=Failures",
    ])
  })

  test("stops at the limit, and never reads older replies to get there", () => {
    const older = reply([text("https://older.dev/")])

    // An older reply that fails when read: only the newest are enough for the limit.
    Object.defineProperty(older, "content", {
      get: () => {
        throw new Error("read")
      },
    })

    const newest = reply([text("https://a.dev/ https://b.dev/")])

    expect(listed([older, newest], 2)).toEqual(["https://b.dev/", "https://a.dev/"])
  })

  test("reads no more than the session's last 50 replies, however few pages they name", () => {
    const quiet = Array.from({ length: 50 }, () => reply([text("Done.")]))

    expect(listed([reply([text("https://older.dev/")]), ...quiet])).toEqual([])
    expect(listed([reply([text("https://older.dev/")]), ...quiet.slice(1)])).toEqual(["https://older.dev/"])
  })

  test("reads each finished reply once, however often the list is read again", () => {
    const links = createSessionLinks()
    const first = reply([text("https://a.dev/")])
    const content = first.content
    let reads = 0

    Object.defineProperty(first, "content", {
      get: () => {
        reads++

        return content
      },
    })

    links([first], 5, server)
    links([first, reply([text("https://b.dev/")])], 5, server)

    expect(reads).toBe(1)
  })

  test("leaves out replies still streaming, the person's messages, example addresses and addresses that are not web pages", () => {
    const messages: SessionMessageInfo[] = [
      { id: "msg_user", type: "user", time: { created: 0 }, text: "https://mine.dev/" },
      reply([text("file:///tmp/a.html and ftp://files.dev/x")]),
      // Addresses written as examples, such as in an explanation.
      reply([text("Call https://api.example.com/items or https://docs.example/start.")]),
      reply([text("https://later.dev/")], true),
    ]

    expect(listed(messages)).toEqual([])
  })
})
