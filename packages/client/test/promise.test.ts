import { expect, test } from "bun:test"
import { isSessionNotFoundError, isUnauthorizedError, OpenCode } from "../src/promise/index"

test("exposes every standard HTTP API group", () => {
  const client = OpenCode.make({ baseUrl: "http://localhost:3000" })

  expect(Object.keys(client)).toEqual([
    "health",
    "location",
    "agent",
    "plugin",
    "session",
    "message",
    "model",
    "generate",
    "provider",
    "integration",
    "server.mcp",
    "credential",
    "project",
    "form",
    "permission",
    "file",
    "command",
    "skill",
    "event",
    "pty",
    "shell",
    "question",
    "reference",
    "projectCopy",
    "vcs",
    "debug",
  ])
  expect(Object.keys(client.debug)).toEqual(["location"])
  expect(Object.keys(client.message)).toEqual(["list"])
  expect(Object.keys(client.integration)).toEqual([
    "list",
    "get",
    "connectKey",
    "connectOauth",
    "attemptStatus",
    "attemptComplete",
    "attemptCancel",
  ])
  expect(Object.keys(client.file)).toEqual(["read", "list", "find"])
  expect(Object.keys(client.vcs)).toEqual(["status", "diff"])
  expect(Object.keys(client.pty)).toEqual(["list", "create", "get", "update", "remove"])
  expect(Object.keys(client.shell)).toEqual(["list", "create", "get", "output", "remove"])
  expect(Object.keys(client.project)).toEqual(["current", "directories"])
})

test("file.read returns binary content from the public HTTP contract", async () => {
  let request: Request | undefined
  const client = OpenCode.make({
    baseUrl: "http://localhost:3000",
    fetch: async (input) => {
      request = input instanceof Request ? input : new Request(input)
      return new Response(new Uint8Array([104, 105]))
    },
  })

  const content = await client.file.read({
    path: "src/a b#c.ts",
    location: { directory: "/tmp/project" },
  })

  expect(Array.from(content)).toEqual([104, 105])
  expect(request?.url).toBe(
    "http://localhost:3000/api/fs/read/src/a%20b%23c.ts?location%5Bdirectory%5D=%2Ftmp%2Fproject",
  )
})

test("project methods use the public HTTP contract", async () => {
  const requests: string[] = []
  const client = OpenCode.make({
    baseUrl: "http://localhost:3000",
    fetch: async (input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
      requests.push(url)
      if (url.includes("/directories")) return Response.json([])
      return Response.json({ id: "proj_test", directory: "/tmp/project" })
    },
  })

  const current = await client.project.current({ location: { workspace: "wrk_test" } })
  const directories = await client.project.directories({
    projectID: current.id,
    location: { directory: current.directory },
  })

  expect(current).toEqual({ id: "proj_test", directory: "/tmp/project" })
  expect(directories).toEqual([])
  expect(requests).toEqual([
    "http://localhost:3000/api/project/current?location%5Bworkspace%5D=wrk_test",
    "http://localhost:3000/api/project/proj_test/directories?location%5Bdirectory%5D=%2Ftmp%2Fproject",
  ])
})

test("shell list and remove use the public HTTP contract", async () => {
  const requests: Array<{ method: string; url: string }> = []
  const shell = {
    id: "sh_test",
    status: "running",
    command: "pwd",
    cwd: "/tmp/project",
    shell: "/bin/zsh",
    file: "/tmp/opencode-shell",
    metadata: { sessionID: "ses_test" },
    time: { started: 1_717_171_717_000 },
  }
  const client = OpenCode.make({
    baseUrl: "http://localhost:3000",
    fetch: async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init)
      requests.push({ method: request.method, url: request.url })
      if (request.method === "DELETE") return new Response(null, { status: 204 })
      return Response.json({
        location: { directory: "/tmp/project", project: { id: "proj_test", directory: "/tmp/project" } },
        data: [shell],
      })
    },
  })

  const result = await client.shell.list({ location: { directory: "/tmp/project" } })
  await client.shell.remove({ id: shell.id })

  expect(result.data).toEqual([shell])
  expect(requests).toEqual([
    { method: "GET", url: "http://localhost:3000/api/shell?location%5Bdirectory%5D=%2Ftmp%2Fproject" },
    { method: "DELETE", url: "http://localhost:3000/api/shell/sh_test" },
  ])
})

test("session.get returns the wire projection", async () => {
  const client = OpenCode.make({
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

test("event.subscribe exposes the Promise event stream wire projection", async () => {
  const client = OpenCode.make({
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

test("event.subscribe terminates on malformed Promise SSE data", async () => {
  const client = OpenCode.make({
    baseUrl: "http://localhost:3000",
    fetch: async () => new Response("data: {not-json}\n\n", { headers: { "content-type": "text/event-stream" } }),
  })

  await expect(client.event.subscribe()[Symbol.asyncIterator]().next()).rejects.toMatchObject({
    name: "ClientError",
    reason: "MalformedResponse",
  })
})

test("session methods use the public HTTP contract", async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = []
  const client = OpenCode.make({
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
      if (url.includes("/context")) return Response.json({ data: [] })
      if (url.includes("/message/")) return Response.json({ data: modelSwitchedMessage })
      if (url.endsWith("/api/session/active"))
        return Response.json({ data: { ses_test: { type: "running" } }, watermarks: { ses_test: 3 } })
      if (init?.method === "POST" && url.endsWith("/api/session")) return Response.json(session)
      if (init?.method === "POST") return new Response(null, { status: 204 })
      return Response.json({ data: [session.data], cursor: { next: "next" } })
    },
  })

  const page = await client.session.list({ limit: 10, order: "desc", parentID: null })
  const active = await client.session.active()
  const created = await client.session.create({ location: { directory: "/tmp/project" } })
  await client.session.switchAgent({ sessionID: "ses_test", agent: "build" })
  await client.session.switchModel({
    sessionID: "ses_test",
    model: { id: "claude", providerID: "anthropic" },
  })
  const admitted = await client.session.prompt({
    sessionID: "ses_test",
    prompt: { text: "Hello" },
    resume: false,
  })
  await client.session.compact({ sessionID: "ses_test" })
  await client.session.wait({ sessionID: "ses_test" })
  const context = await client.session.context({ sessionID: "ses_test" })
  const log = []
  for await (const item of client.session.log({ sessionID: "ses_test", after: 0 })) log.push(item)
  await client.session.interrupt({ sessionID: "ses_test" })
  const message = await client.session.message({ sessionID: "ses_test", messageID: "msg_model" })

  expect(page.cursor.next).toBe("next")
  expect(active).toEqual({ data: { ses_test: { type: "running" } }, watermarks: { ses_test: 3 } })
  expect(created.id).toBe("ses_test")
  expect(admitted.id).toBe("msg_test")
  expect(context).toEqual([])
  expect(log).toEqual([modelSwitchedEvent, synced])
  expect(message).toEqual(modelSwitchedMessage)
  expect(requests.map((request) => [request.init?.method, request.url])).toEqual([
    ["GET", "http://localhost:3000/api/session?limit=10&order=desc&parentID=null"],
    ["GET", "http://localhost:3000/api/session/active"],
    ["POST", "http://localhost:3000/api/session"],
    ["POST", "http://localhost:3000/api/session/ses_test/agent"],
    ["POST", "http://localhost:3000/api/session/ses_test/model"],
    ["POST", "http://localhost:3000/api/session/ses_test/prompt"],
    ["POST", "http://localhost:3000/api/session/ses_test/compact"],
    ["POST", "http://localhost:3000/api/session/ses_test/wait"],
    ["GET", "http://localhost:3000/api/session/ses_test/context"],
    ["GET", "http://localhost:3000/api/session/ses_test/log?after=0"],
    ["POST", "http://localhost:3000/api/session/ses_test/interrupt"],
    ["GET", "http://localhost:3000/api/session/ses_test/message/msg_model"],
  ])
  const body = requests.find((request) => request.url.endsWith("/api/session/ses_test/prompt"))?.init?.body
  if (typeof body !== "string") throw new Error("Expected JSON request body")
  expect(JSON.parse(body)).toEqual({
    prompt: { text: "Hello" },
    resume: false,
  })
})

test("middleware errors remain declared client errors", async () => {
  const client = OpenCode.make({
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

test("session.log decodes SessionNotFoundError", async () => {
  const client = OpenCode.make({
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
    },
    title: "Test",
    location: { directory: "/tmp/project" },
  },
}

const admission = {
  data: {
    admittedSeq: 0,
    id: "msg_test",
    sessionID: "ses_test",
    prompt: { text: "Hello" },
    delivery: "steer",
    timeCreated: 1_717_171_717_000,
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
