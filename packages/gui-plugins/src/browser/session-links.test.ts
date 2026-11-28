import { describe, expect, test } from "bun:test"
import type { JsonValue, SessionMessageInfo } from "@opencode/client/promise"
import { uuid } from "@opencode/util/uuid"
import { createSessionLinks, linkKey } from "./session-links"

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

// A code-mode program that made these calls.
const program = (...calls: { tool: string; input?: Record<string, string> }[]) =>
  tool("execute", { code: "..." }, { toolCalls: calls.map((call) => ({ status: "completed", ...call })) })

const server = "http://127.0.0.1:3084"

// What a session lists, by the address or path each row opens.
const listed = (messages: SessionMessageInfo[], limit = 5) =>
  createSessionLinks()(messages, limit, server).map((link) => (link.type === "page" ? link.url : link.path))

describe("session links", () => {
  test("lists what the agent opened in the browser, published, and linked in its text, newest first", () => {
    const messages: SessionMessageInfo[] = [
      reply([tool("artifact_create", { title: "Report" }, {}, "Published Report (art_1a via local): /api/experimental/artifacts/art_1a/view/")]),
      reply([
        program({ tool: "browser.tabs.open", input: { url: "http://localhost:5173" } }, { tool: "browser.navigate", input: { path: "report.pdf" } }),
        text("The PR is https://github.com/anomalyco/opencode/pull/1 and the page is [here](/api/experimental/artifacts/art_2b/view/index.html)."),
      ]),
    ]

    expect(listed(messages)).toEqual([
      "artifact://art_2b/index.html",
      "https://github.com/anomalyco/opencode/pull/1",
      "report.pdf",
      "http://localhost:5173/",
      "artifact://art_1a/",
    ])
  })

  test("leaves out what the agent only read, and what it printed or wrote as code", () => {
    const messages: SessionMessageInfo[] = [
      reply([
        tool("webfetch", { url: "https://docs.github.com/rest" }),
        program({ tool: "fetch", input: { method: "GET", url: "https://api.github.com/repos" } }),
        tool("shell", { command: "bun dev" }, {}, "Local: http://localhost:5173/"),
        text("Run `curl https://api.github.com/user` or:\n```sh\nopen https://bun.com/docs\n```"),
      ]),
    ]

    expect(listed(messages)).toEqual([])
  })

  test("lists only the files the browser shows, and only artifact addresses that name an artifact", () => {
    const messages: SessionMessageInfo[] = [
      reply([
        program(
          { tool: "browser.tabs.open", input: { path: "README.md" } },
          { tool: "browser.tabs.open", input: { path: "shot.png" } },
          { tool: "browser.tabs.open", input: { path: "site/index.html" } },
        ),
        text("See artifact://not-an-artifact and artifact://art_3c/a.html."),
      ]),
    ]

    expect(listed(messages)).toEqual(["artifact://art_3c/a.html", "site/index.html"])
  })

  test("lists a page once, at its newest address, however it was written", () => {
    const messages: SessionMessageInfo[] = [
      reply([text("http://127.0.0.1:6017/?id=story&scenario=Polling and https://www.github.com/anomalyco/")]),
      reply([text("http://127.0.0.1:6017/?id=story&scenario=Failures, https://github.com/anomalyco and http://127.0.0.1:6017/docs")]),
    ]

    expect(listed(messages)).toEqual([
      "http://127.0.0.1:6017/docs",
      "https://github.com/anomalyco",
      "http://127.0.0.1:6017/?id=story&scenario=Failures",
    ])
    expect(linkKey("https://www.github.com/anomalyco/?tab=repos#top")).toBe(linkKey("https://github.com/anomalyco"))
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

  test("reads no more than the session's last 50 replies, however few pages they show", () => {
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
