import { expect, test } from "bun:test"
import { isSessionNotFoundError, isUnauthorizedError, Bolt } from "../src"

test("exposes every standard HTTP API group", () => {
  const client = Bolt.make({ baseUrl: "http://localhost:3000" })

  expect(Object.keys(client)).toEqual([
    "server",
    "location",
    "agent",
    "plugin",
    "session",
    "message",
    "model",
    "generate",
    "voice",
    "provider",
    "integration",
    "mcp",
    "credential",
    "project",
    "form",
    "permission",
    "file",
    "command",
    "skill",
    "rpc",
    "event",
    "pty",
    "experimental",
    "shell",
    "reference",
    "worktree",
    "vcs",
    "debug",
    "migration",
    "websearch",
    "usage",
    "config",
  ])
  expect(Object.keys(client.debug)).toEqual(["heapDump", "location"])
  expect(Object.keys(client.debug.location)).toEqual(["list", "evict"])
  expect(Object.keys(client.message)).toEqual(["list"])
  expect(Object.keys(client.integration)).toEqual(["list", "get", "wellknown", "connect", "oauth", "command"])
  expect(Object.keys(client.integration.wellknown)).toEqual(["add"])
  expect(Object.keys(client.integration.connect)).toEqual(["key", "external"])
  expect(Object.keys(client.integration.oauth)).toEqual(["connect", "status", "complete", "cancel"])
  expect(Object.keys(client.integration.command)).toEqual(["connect", "status", "cancel"])
  expect(Object.keys(client.websearch)).toEqual(["providers", "query"])
  expect(Object.keys(client.voice)).toEqual(["models", "session"])
  expect(Object.keys(client.usage)).toEqual(["limits"])
  expect(Object.keys(client.file)).toEqual(["read", "list", "find", "write"])
  expect(Object.keys(client.vcs)).toEqual(["init", "get", "base", "status", "branch", "diff"])
  expect(Object.keys(client.pty)).toEqual(["list", "create", "get", "update", "remove", "connect"])
  expect(Object.keys(client.pty.connect)).toEqual(["token"])
  expect(Object.keys(client.experimental)).toEqual(["persistentPty"])
  expect(client.experimental.persistentPty.read).toBeFunction()
  expect(Object.keys(client.shell)).toEqual(["list", "create", "get", "output", "remove"])
  expect(Object.keys(client.project)).toEqual(["list", "update"])
  expect(Object.keys(client.worktree)).toEqual(["list", "create", "remove", "refresh"])
})

test("sessions.get returns the wire projection", async () => {
  const client = Bolt.make({
    baseUrl: "http://localhost:3000",
    fetch: async (input) => {
      expect(typeof input === "string" ? input : input instanceof URL ? input.href : input.url).toBe(
        "http://localhost:3000/api/session/ses_test",
      )
      return Response.json(session)
    },
  })

  const result = await client.session.get({ sessionID: "ses_test" })

  expect(result.time.created).toBe(1_717_171_717_000)
})

test("events.subscribe exposes the Promise event stream wire projection", async () => {
  const client = Bolt.make({
    baseUrl: "http://localhost:3000",
    fetch: async () =>
      new Response(
        `: heartbeat\n\ndata: ${JSON.stringify({ id: "evt_connected", created: 0, type: "server.connected", data: {} })}\n\n` +
          `data: ${JSON.stringify(modelSwitchedEvent)}\n\n`,
        { headers: { "content-type": "text/event-stream" } },
      ),
  })
  const events = []
  for await (const event of client.event.subscribe()) events.push(event)

  expect(events).toEqual([{ id: "evt_connected", created: 0, type: "server.connected", data: {} }, modelSwitchedEvent])
  expect(events[1]?.type === "session.model.selected" && events[1].created).toBe(1_717_171_717_000)
})

test("events.subscribe terminates on malformed Promise SSE data", async () => {
  const client = Bolt.make({
    baseUrl: "http://localhost:3000",
    fetch: async () => new Response("data: {not-json}\n\n", { headers: { "content-type": "text/event-stream" } }),
  })

  await expect(client.event.subscribe()[Symbol.asyncIterator]().next()).rejects.toMatchObject({
    name: "ClientError",
    reason: "MalformedResponse",
  })
})

test("native event signals cancel only their listener and close transport after the last listener", async () => {
  const opened = Promise.withResolvers<Request>()
  const client = OpenCode.make({
    baseUrl: "http://localhost:3000",
    headers: { authorization: "Bearer events" },
    fetch: async (input, init) => {
      const request = new Request(input, init)
      opened.resolve(request)
      return new Response(
        new ReadableStream({
          start(controller) {
            request.signal.addEventListener("abort", () => controller.error(request.signal.reason), { once: true })
          },
        }),
        { headers: { "content-type": "text/event-stream" } },
      )
    },
  })
  const first = new AbortController()
  const second = new AbortController()
  const one = client.event.subscribe({ signal: first.signal })[Symbol.asyncIterator]().next()
  const two = client.event.subscribe({ signal: second.signal })[Symbol.asyncIterator]().next()
  const request = await opened.promise
  expect(request.headers.get("authorization")).toBe("Bearer events")
  first.abort()
  expect((await one).done).toBe(true)
  expect(request.signal.aborted).toBe(false)
  second.abort()
  expect((await two).done).toBe(true)
  expect(request.signal.aborted).toBe(true)
})

test("native pre-aborted event signals do not open a transport", async () => {
  let requests = 0
  const client = OpenCode.make({
    baseUrl: "http://localhost:3000",
    fetch: async () => {
      requests++
      return new Response(null)
    },
  })
  expect((await client.event.subscribe({ signal: AbortSignal.abort() })[Symbol.asyncIterator]().next()).done).toBe(true)
  expect(requests).toBe(0)
})

test("event.subscribe accepts a fragmented SSE event below the size limit", async () => {
  const event = { id: "evt_large", type: "test.large", data: { output: "x".repeat(12 * 1024 * 1024) } }
  const encoded = new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`)
  const client = OpenCode.make({
    baseUrl: "http://localhost:3000",
    fetch: async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            for (let offset = 0; offset < encoded.length; offset += 64 * 1024) {
              controller.enqueue(encoded.slice(offset, offset + 64 * 1024))
            }
            controller.close()
          },
        }),
        { headers: { "content-type": "text/event-stream" } },
      ),
  })

  await expect(client.event.subscribe()[Symbol.asyncIterator]().next()).resolves.toEqual({ done: false, value: event })
})

test("event.subscribe rejects an SSE event above the size limit", async () => {
  const client = OpenCode.make({
    baseUrl: "http://localhost:3000",
    fetch: async () =>
      new Response(`data: ${JSON.stringify({ output: "x".repeat(16 * 1024 * 1024) })}`, {
        headers: { "content-type": "text/event-stream" },
      }),
  })

  await expect(client.event.subscribe()[Symbol.asyncIterator]().next()).rejects.toMatchObject({
    name: "ClientError",
    reason: "SseEventTooLarge",
  })
})

test("session methods use the public HTTP contract", async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = []
  let historyPage = 0
  const client = Bolt.make({
    baseUrl: "http://localhost:3000",
    fetch: async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
      requests.push({ url, init })
      if (url.includes("/event")) {
        return new Response(`data: ${JSON.stringify(modelSwitchedEvent)}\n\n`, {
          headers: { "content-type": "text/event-stream" },
        })
      }
      if (url.includes("/log")) {
        return new Response(`data: ${JSON.stringify(modelSwitchedEvent)}\n\ndata: ${JSON.stringify(synced)}\n\n`, {
          headers: { "content-type": "text/event-stream" },
        })
      }
      if (url.includes("/prompt")) return Response.json(admission)
      if (url.includes("/generate")) return Response.json({ data: { text: "A transient answer" } })
      if (url.includes("/synthetic")) return Response.json(syntheticAdmission)
      if (url.endsWith("/compact")) return Response.json(compactionAdmission)
      if (url.includes("/context")) return Response.json({ data: [] })
      if (url.includes("/message/")) return Response.json({ data: modelSwitchedMessage })
      if (url.endsWith("/api/session/active")) return Response.json({ data: { ses_test: { type: "running" } } })
      if (init?.method === "POST" && url.endsWith("/api/session")) return Response.json(session)
      if (url.includes("/interrupt")) return Response.json({ interrupted: true })
      if (init?.method === "POST") return new Response(null, { status: 204 })
      return Response.json({ data: [session.data], cursor: { next: "next" } })
    },
  })

  const page = await client.session.list({ limit: 10, order: "desc", parentID: null })
  const active = await client.session.active()
  const created = await client.session.create({ location: { directory: "/tmp/project" } })
  await client.session.view({ sessionID: "ses_test", idle: session.data.time.idle })
  await client.session.switchAgent({ sessionID: "ses_test", agent: "build" })
  await client.session.switchModel({
    sessionID: "ses_test",
    model: { id: "claude", providerID: "anthropic" },
  })
  const admitted = await client.session.prompt({
    sessionID: "ses_test",
    text: "Hello",
    resume: false,
  })
  const generated = await client.session.generate({ sessionID: "ses_test", prompt: "Summarize this session" })
  const synthetic = await client.session.synthetic({
    sessionID: "ses_test",
    text: "Completed",
    delivery: "queue",
    resume: false,
  })
  await client.session.compact({ sessionID: "ses_test" })
  await client.session.wait({ sessionID: "ses_test" })
  const context = await client.session.context({ sessionID: "ses_test" })
  const log = []
  for await (const item of client.session.log({ sessionID: "ses_test", after: 0 })) log.push(item)
  const interrupted = await client.session.interrupt({ sessionID: "ses_test", resume: true })
  const message = await client.session.message.get({ sessionID: "ses_test", messageID: "msg_model" })

  expect(page.cursor.next).toBe("next")
  expect(page.data[0].time).toMatchObject({ idle: 1_717_171_717_002, viewed: 1_717_171_717_001 })
  expect(active).toEqual({ ses_test: { type: "running" } })
  expect(created.id).toBe("ses_test")
  expect(admitted.id).toBe("msg_test")
  expect(generated.text).toBe("A transient answer")
  expect(interrupted).toEqual({ interrupted: true })
  expect(synthetic).toMatchObject({ type: "synthetic", data: { text: "Completed" }, delivery: "queue" })
  expect(context).toEqual([])
  expect(log).toEqual([modelSwitchedEvent, synced])
  expect(message).toEqual(modelSwitchedMessage)
  expect(requests.map((request) => [request.init?.method, request.url])).toEqual([
    ["GET", "http://localhost:3000/api/session?limit=10&order=desc&parentID=null"],
    ["GET", "http://localhost:3000/api/session/active"],
    ["POST", "http://localhost:3000/api/session"],
    ["POST", "http://localhost:3000/api/session/ses_test/view"],
    ["POST", "http://localhost:3000/api/session/ses_test/agent"],
    ["POST", "http://localhost:3000/api/session/ses_test/model"],
    ["POST", "http://localhost:3000/api/session/ses_test/prompt"],
    ["POST", "http://localhost:3000/api/session/ses_test/generate"],
    ["POST", "http://localhost:3000/api/session/ses_test/synthetic"],
    ["POST", "http://localhost:3000/api/session/ses_test/compact"],
    ["POST", "http://localhost:3000/api/experimental/session/ses_test/wait"],
    ["GET", "http://localhost:3000/api/session/ses_test/context"],
    ["GET", "http://localhost:3000/api/experimental/session/ses_test/log?after=0"],
    ["POST", "http://localhost:3000/api/session/ses_test/interrupt?resume=true"],
    ["GET", "http://localhost:3000/api/session/ses_test/message/msg_model"],
  ])
  const viewBody = requests.find((request) => request.url.endsWith("/api/session/ses_test/view"))?.init?.body
  if (typeof viewBody !== "string") throw new Error("Expected JSON view request body")
  expect(JSON.parse(viewBody)).toEqual({ idle: session.data.time.idle })
  const body = requests.find((request) => request.url.endsWith("/api/session/ses_test/prompt"))?.init?.body
  if (typeof body !== "string") throw new Error("Expected JSON request body")
  expect(JSON.parse(body)).toEqual({
    text: "Hello",
    resume: false,
  })
  const syntheticBody = requests.find((request) => request.url.endsWith("/synthetic"))?.init?.body
  if (typeof syntheticBody !== "string") throw new Error("Expected JSON synthetic request body")
  expect(JSON.parse(syntheticBody)).toEqual({
    text: "Completed",
    delivery: "queue",
    resume: false,
  })
})

test("middleware errors remain declared client errors", async () => {
  const client = Bolt.make({
    baseUrl: "http://localhost:3000",
    fetch: async () =>
      Response.json({ _tag: "UnauthorizedError", message: "Authentication required" }, { status: 401 }),
  })

  try {
    await client.session.create({})
    throw new Error("Expected request to fail")
  } catch (error) {
    expect(isUnauthorizedError(error)).toBe(true)
  }
})

test("sessions.history decodes SessionNotFoundError", async () => {
  const client = Bolt.make({
    baseUrl: "http://localhost:3000",
    fetch: async () =>
      Response.json(
        { _tag: "SessionNotFoundError", sessionID: "ses_missing", message: "Session not found" },
        { status: 404 },
      ),
  })

  try {
    await client.session.log({ sessionID: "ses_missing" })[Symbol.asyncIterator]().next()
    throw new Error("Expected request to fail")
  } catch (error) {
    expect(isSessionNotFoundError(error)).toBe(true)
  }
})

const session = {
  data: {
    id: "ses_test",
    projectID: "project",
    cost: 0,
    tokens: {
      input: 1,
      output: 2,
      reasoning: 3,
      cache: { read: 4, write: 5 },
    },
    time: {
      created: 1_717_171_717_000,
      updated: 1_717_171_717_000,
      idle: 1_717_171_717_002,
      viewed: 1_717_171_717_001,
    },
    title: "Test",
    location: { directory: "/tmp/project" },
  },
}

const admission = {
  data: {
    id: "msg_test",
    sessionID: "ses_test",
    type: "user",
    data: { text: "Hello" },
    delivery: "steer",
    time: { created: 1_717_171_717_000 },
  },
}

const syntheticAdmission = {
  data: {
    id: "msg_synthetic",
    sessionID: "ses_test",
    type: "synthetic",
    data: { text: "Completed" },
    delivery: "queue",
    time: { created: 1_717_171_717_000 },
  },
}

const compactionAdmission = {
  data: {
    type: "compaction",
    id: "msg_compaction",
    sessionID: "ses_test",
    time: { created: 1_717_171_717_000 },
  },
}

const modelSwitchedMessage = {
  id: "msg_model",
  type: "model-switched",
  time: { created: 1_717_171_717_000 },
  model: { id: "claude", providerID: "anthropic" },
}

const synced = { type: "log.synced", aggregateID: "ses_test", seq: 1 }

const modelSwitchedEvent = {
  id: "evt_model",
  created: 1_717_171_717_000,
  type: "session.model.selected",
  durable: { aggregateID: "ses_test", seq: 1, version: 1 },
  data: {
    sessionID: "ses_test",
    model: { id: "claude", providerID: "anthropic" },
  },
}
