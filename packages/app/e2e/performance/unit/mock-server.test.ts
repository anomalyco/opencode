import { expect, test } from "bun:test"
import type { SessionMessageInfo } from "@opencode-ai/client/promise"
import type { Page, Route } from "@playwright/test"
import { currentMessage, mockOpenCodeServer } from "../../utils/mock-server"

test("preserves current messages", () => {
  const message = {
    id: "msg_current",
    type: "user",
    time: { created: 1 },
    text: "current",
    files: [{ data: "e30=", mime: "application/json", source: { type: "inline" } }],
  } satisfies SessionMessageInfo

  expect(currentMessage(message)).toBe(message)
})

test("converts rich legacy messages to current message types", () => {
  expect(
    currentMessage({
      info: { id: "msg_user", role: "user", time: { created: 1 } },
      parts: [
        { type: "text", text: "Use @src/a.ts with @explore" },
        {
          type: "file",
          mime: "application/json",
          filename: "data.json",
          url: "data:application/json;base64,e30=",
        },
        {
          type: "file",
          mime: "text/plain",
          filename: "a.ts",
          url: "src/a.ts",
          source: { type: "file", text: { value: "@src/a.ts", start: 4, end: 13 } },
        },
        { type: "agent", name: "explore", source: { value: "@explore", start: 19, end: 27 } },
      ],
    }),
  ).toEqual({
    id: "msg_user",
    type: "user",
    time: { created: 1 },
    text: "Use @src/a.ts with @explore",
    files: [
      { data: "e30=", mime: "application/json", name: "data.json", source: { type: "inline" } },
      {
        data: "",
        mime: "text/plain",
        name: "a.ts",
        source: { type: "uri", uri: "src/a.ts" },
        mention: { text: "@src/a.ts", start: 4, end: 13 },
      },
    ],
    agents: [{ name: "explore", mention: { text: "@explore", start: 19, end: 27 } }],
  })

  expect(
    currentMessage({
      info: {
        id: "msg_assistant",
        role: "assistant",
        time: { created: 2, completed: 5 },
        agent: "explore",
        modelID: "model",
        providerID: "provider",
        variant: "high",
        cost: 0.5,
        tokens: { input: 1, output: 2, reasoning: 3, cache: { read: 4, write: 5 } },
        finish: "tool-calls",
        error: { name: "MessageAbortedError", data: { message: "Stopped" } },
      },
      parts: [
        { type: "text", text: "Answer" },
        { type: "reasoning", text: "Thinking", time: { start: 2, end: 3 } },
        {
          id: "prt_tool",
          callID: "call_tool",
          type: "tool",
          tool: "read",
          state: {
            status: "completed",
            input: { filePath: "src/a.ts" },
            output: "contents",
            metadata: { title: "a.ts" },
            time: { start: 3, end: 4 },
          },
        },
      ],
    }),
  ).toEqual({
    id: "msg_assistant",
    type: "assistant",
    time: { created: 2, completed: 5 },
    agent: "explore",
    model: { id: "model", providerID: "provider", variant: "high" },
    cost: 0.5,
    tokens: { input: 1, output: 2, reasoning: 3, cache: { read: 4, write: 5 } },
    finish: "tool-calls",
    error: { type: "MessageAbortedError", message: "Stopped" },
    content: [
      { type: "text", text: "Answer" },
      { type: "reasoning", text: "Thinking", time: { created: 2, completed: 3 } },
      {
        type: "tool",
        id: "call_tool",
        name: "read",
        time: { created: 3, ran: 3, completed: 4 },
        state: {
          status: "completed",
          input: { filePath: "src/a.ts" },
          content: [{ type: "text", text: "contents" }],
          metadata: { title: "a.ts" },
        },
      },
    ],
  })
})

test("applies message latency after a list response gate is released", async () => {
  const events: string[] = []
  const gate = Promise.withResolvers<void>()
  let handler: ((route: Route) => Promise<void>) | undefined
  const page = {
    route: (_url: string, callback: (route: Route) => Promise<void>) => {
      handler = callback
      return Promise.resolve()
    },
  } as unknown as Page
  await mockOpenCodeServer(page, {
    provider: {},
    directory: "C:/OpenCode",
    project: {},
    sessions: [{ id: "session" }],
    messageDelay: 25,
    beforeMessagesResponse: () => {
      events.push("before")
      return gate.promise
    },
    onMessages: (request) => events.push(request.phase),
    pageMessages: () => {
      events.push("page")
      return { items: [] }
    },
  })

  const response = handler!({
    request: () => ({ url: () => "http://127.0.0.1:4096/api/session/session/message" }),
    fulfill: () => {
      events.push("fulfill")
      return Promise.resolve()
    },
  } as unknown as Route)
  expect(events).toEqual(["start", "before"])

  const released = performance.now()
  gate.resolve()
  await response
  expect(performance.now() - released).toBeGreaterThanOrEqual(20)
  expect(events).toEqual(["start", "before", "page", "end", "fulfill"])
})
