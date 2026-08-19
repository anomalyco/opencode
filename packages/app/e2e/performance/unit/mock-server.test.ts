import { expect, test } from "bun:test"
import type { Page, Route } from "@playwright/test"
import { mockOpenCodeServer } from "../../utils/mock-server"

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
    request: () => ({ url: () => "http://127.0.0.1:4096/session/session/message" }),
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

test("serves current message list and lookup response contracts", async () => {
  let handler: ((route: Route) => Promise<void>) | undefined
  const responses: unknown[] = []
  const message = {
    info: { id: "message", role: "user" as const, time: { created: 1 } },
    parts: [{ type: "text", text: "hello" }],
  }
  const page = {
    route: (_url: string, callback: (route: Route) => Promise<void>) => {
      handler = callback
      return Promise.resolve()
    },
  } as unknown as Page
  await mockOpenCodeServer(page, {
    protocol: "v2",
    provider: {},
    directory: "C:/OpenCode",
    project: {},
    sessions: [{ id: "session" }],
    pageMessages: () => ({ items: [message] }),
    message: () => message,
  })

  const route = (url: string) =>
    ({
      request: () => ({ url: () => url, method: () => "GET" }),
      fulfill: (input: { body?: string }) => {
        responses.push(JSON.parse(input.body ?? "null"))
        return Promise.resolve()
      },
      fallback: () => Promise.resolve(),
    }) as unknown as Route

  await handler!(route("http://127.0.0.1:4096/api/session/session/message"))
  await handler!(route("http://127.0.0.1:4096/api/session/session/message/message"))

  expect(responses).toEqual([
    {
      data: [{ id: "message", type: "user", time: { created: 1 }, text: "hello" }],
      context: [],
      cursor: {},
    },
    { data: { id: "message", type: "user", time: { created: 1 }, text: "hello" } },
  ])
})
