import { expect, test } from "bun:test"
import type { Page, Route } from "@playwright/test"
import { mockOpenCodeServer } from "../../utils/mock-server"

test("applies message latency after a list response gate is released", async () => {
  const events: string[] = []
  const gate = Promise.withResolvers<void>()
  const started = Promise.withResolvers<void>()
  let handler: ((route: Route) => Promise<void>) | undefined
  const page = {
    addInitScript: () => Promise.resolve(),
    on: () => page,
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
      started.resolve()
      return gate.promise
    },
    onMessages: (request) => events.push(request.phase),
    pageMessages: () => {
      events.push("page")
      return { items: [] }
    },
  })

  const response = handler!({
    request: () => ({
      url: () => "http://127.0.0.1:4096/api/session/session/message",
      method: () => "GET",
      headers: () => ({}),
      postDataBuffer: () => null,
    }),
    fulfill: () => {
      events.push("fulfill")
      return Promise.resolve()
    },
  } as unknown as Route)
  await started.promise
  expect(events).toEqual(["start", "before"])

  const released = performance.now()
  gate.resolve()
  await response
  expect(performance.now() - released).toBeGreaterThanOrEqual(20)
  expect(events).toEqual(["start", "before", "page", "end", "fulfill"])
})

test("routes requests through the HttpApi contract", async () => {
  const connected = Promise.withResolvers<{ integrationID: string; body: unknown }>()
  let handler: ((route: Route) => Promise<void>) | undefined
  const page = {
    addInitScript: () => Promise.resolve(),
    on: () => page,
    route: (_url: string, callback: (route: Route) => Promise<void>) => {
      handler = callback
      return Promise.resolve()
    },
  } as unknown as Page
  await mockOpenCodeServer(page, {
    provider: {},
    directory: "C:/OpenCode",
    project: {},
    sessions: [],
    pageMessages: () => ({ items: [] }),
    onConnectKey: connected.resolve,
  })

  const body = Buffer.from(JSON.stringify({ key: "secret" }))
  let status: number | undefined
  await handler!({
    request: () => ({
      url: () => "http://127.0.0.1:4096/api/integration/anthropic/connect/key",
      method: () => "POST",
      headers: () => ({ "content-type": "application/json" }),
      postDataBuffer: () => body,
    }),
    fulfill: (response: Parameters<Route["fulfill"]>[0]) => {
      status = response?.status
      return Promise.resolve()
    },
  } as unknown as Route)

  expect(status).toBe(204)
  expect(await connected.promise).toEqual({ integrationID: "anthropic", body: { key: "secret" } })
})
