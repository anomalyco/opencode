import type { SessionMessageAssistant, SessionMessageAssistantTool, SessionMessageInfo } from "@opencode/client/promise"
import { describe, expect, test } from "bun:test"
import { turnMessages, turnSources } from "./sources"

const model = { id: "claude-sonnet-4", providerID: "anthropic" }

// The text content the websearch tool writes for its results (packages/core/src/tool/plugin/websearch.ts).
const searchText = (results: { url: string; title?: string; content?: string }[]) =>
  results.length
    ? results
        .map(
          (result) =>
            `## [${result.title ?? result.url}](${result.url})${result.content ? `\n\n${result.content}` : ""}`,
        )
        .join("\n\n")
    : "No search results found. Please try a different query."

const search = (id: string, query: string, results: { url: string; title?: string; content?: string }[]) =>
  ({
    type: "tool",
    id,
    name: "websearch",
    state: {
      status: "completed",
      input: { query },
      content: [{ type: "text", text: searchText(results) }],
      metadata: { provider: "exa" },
    },
    time: { created: 1, ran: 2, completed: 3 },
  }) satisfies SessionMessageAssistantTool

const fetch = (id: string, url: string, error?: string) =>
  ({
    type: "tool",
    id,
    name: "webfetch",
    state: error
      ? { status: "error", input: { url, format: "markdown" }, error: { type: "ToolExecutionError", message: error } }
      : { status: "completed", input: { url, format: "markdown" }, content: [{ type: "text", text: "# Page" }] },
    time: { created: 1, ran: 2, completed: 3 },
  }) satisfies SessionMessageAssistantTool

const assistant = (id: string, content: SessionMessageAssistant["content"]): SessionMessageAssistant => ({
  id,
  type: "assistant",
  agent: "build",
  model,
  content,
  time: { created: 1, completed: 4 },
})

describe("turnSources", () => {
  test("lists searches and fetches across the turn's messages in the order they ran", () => {
    const value = turnSources([
      assistant("msg_1", [
        { type: "text", text: "Looking." },
        search("call_1", "one million checkboxes", [
          { url: "https://eieio.games/blog/one-million-checkboxes", title: "One Million Checkboxes" },
        ]),
        {
          type: "tool",
          id: "call_read",
          name: "read",
          state: { status: "completed", input: {}, content: [{ type: "text", text: "x" }] },
          time: { created: 1 },
        },
      ]),
      assistant("msg_2", [fetch("call_2", "https://www.nytimes.com/2024/07/03/technology/checkboxes.html")]),
    ])

    expect(value.steps.map((step) => [step.type, step.id])).toEqual([
      ["search", "call_1"],
      ["fetch", "call_2"],
    ])
    expect(value.steps[0]).toMatchObject({
      query: "one million checkboxes",
      status: "completed",
      results: [{ title: "One Million Checkboxes", site: "eieio.games" }],
    })
    expect(value.steps[1]).toMatchObject({
      site: "nytimes.com",
      host: "www.nytimes.com",
      path: "/2024/07/03/technology/checkboxes.html",
    })
  })

  test("counts each page once, however its URL was written", () => {
    const value = turnSources([
      assistant("msg_1", [
        search("call_1", "a", [
          { url: "https://eieio.games/", title: "eieio" },
          { url: "https://example.com/post?id=1" },
        ]),
        search("call_2", "b", [
          { url: "https://www.eieio.games", title: "eieio again" },
          { url: "http://example.com/post?id=1#top" },
          { url: "https://example.com/post?id=2" },
        ]),
        fetch("call_3", "https://eieio.games/"),
      ]),
    ])

    expect(value.sources.map((source) => source.url)).toEqual([
      "https://eieio.games/",
      "https://example.com/post?id=1",
      "https://example.com/post?id=2",
    ])
  })

  test("keeps a title only when the tool had one, and skips headings that aren't web links", () => {
    const [step] = turnSources([
      assistant("msg_1", [
        search("call_1", "titles", [
          { url: "https://example.com/a" },
          { url: "https://example.com/b", title: "Notes [draft](v2)", content: "## [Not a result](file:///etc/hosts)" },
        ]),
      ]),
    ]).steps

    expect(step?.type === "search" ? step.results.map((result) => [result.url, result.title]) : []).toEqual([
      ["https://example.com/a", undefined],
      ["https://example.com/b", "Notes [draft](v2)"],
    ])
  })

  test("reads empty and failed searches and failed fetches without inventing sources", () => {
    const failed: SessionMessageAssistantTool = {
      type: "tool",
      id: "call_2",
      name: "websearch",
      state: {
        status: "error",
        input: { query: "rate limited" },
        error: { type: "ToolExecutionError", message: "Web search rate limited (HTTP 429)" },
      },
      time: { created: 1, completed: 3 },
    }

    const value = turnSources([
      assistant("msg_1", [
        search("call_1", "nothing here", []),
        failed,
        fetch("call_3", "https://down.example.com/page", "Request failed with status code: 503"),
      ]),
    ])

    expect(value.steps).toMatchObject([
      { type: "search", status: "completed", results: [] },
      { type: "search", status: "error", results: [], error: "Web search rate limited (HTTP 429)" },
      { type: "fetch", status: "error", error: "Request failed with status code: 503" },
    ])
    expect(value.sources).toEqual([])
  })
})

describe("turnMessages", () => {
  test("takes the assistant messages after the prompt, up to the next prompt", () => {
    const user = (id: string): SessionMessageInfo => ({ id, type: "user", text: id, time: { created: 1 } })

    const messages = [
      user("msg_u1"),
      assistant("msg_a1", []),
      assistant("msg_a2", []),
      user("msg_u2"),
      assistant("msg_a3", []),
    ]

    expect(turnMessages(messages, "msg_u1").map((message) => message.id)).toEqual(["msg_a1", "msg_a2"])
    expect(turnMessages(messages, "msg_u2").map((message) => message.id)).toEqual(["msg_a3"])
    expect(turnMessages(messages, "msg_missing")).toEqual([])
  })
})
