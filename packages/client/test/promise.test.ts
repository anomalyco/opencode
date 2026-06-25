import { expect, test } from "bun:test"
import { isUnauthorizedError, OpenCode } from "../src"

test("sessions.get returns the wire projection", async () => {
  const client = OpenCode.make({
    baseUrl: "http://localhost:3000",
    fetch: async (input) => {
      expect(typeof input === "string" ? input : input instanceof URL ? input.href : input.url).toBe(
        "http://localhost:3000/api/session/ses_test",
      )
      return Response.json(session)
    },
  })

  const result = await client.sessions.get({ sessionID: "ses_test" })

  expect(result.time.created).toBe(1_717_171_717_000)
})

test("session methods use the public HTTP contract", async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = []
  const client = OpenCode.make({
    baseUrl: "http://localhost:3000",
    fetch: async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
      requests.push({ url, init })
      if (url.includes("/prompt")) return Response.json(admission)
      if (url.includes("/context")) return Response.json({ data: [] })
      if (init?.method === "POST" && url.endsWith("/api/session")) return Response.json(session)
      if (init?.method === "POST") return new Response(null, { status: 204 })
      return Response.json({ data: [session.data], cursor: { next: "next" } })
    },
  })

  const page = await client.sessions.list({ limit: "10", order: "desc" })
  const created = await client.sessions.create({ location: { directory: "/tmp/project" } })
  await client.sessions.switchAgent({ sessionID: "ses_test", agent: "build" })
  await client.sessions.switchModel({
    sessionID: "ses_test",
    model: { id: "claude", providerID: "anthropic" },
  })
  const admitted = await client.sessions.prompt({
    sessionID: "ses_test",
    prompt: { text: "Hello" },
    resume: false,
  })
  await client.sessions.compact({ sessionID: "ses_test" })
  await client.sessions.wait({ sessionID: "ses_test" })
  const context = await client.sessions.context({ sessionID: "ses_test" })

  expect(page.cursor.next).toBe("next")
  expect(created.id).toBe("ses_test")
  expect(admitted.id).toBe("msg_test")
  expect(context).toEqual([])
  expect(requests.map((request) => [request.init?.method, request.url])).toEqual([
    ["GET", "http://localhost:3000/api/session?limit=10&order=desc"],
    ["POST", "http://localhost:3000/api/session"],
    ["POST", "http://localhost:3000/api/session/ses_test/agent"],
    ["POST", "http://localhost:3000/api/session/ses_test/model"],
    ["POST", "http://localhost:3000/api/session/ses_test/prompt"],
    ["POST", "http://localhost:3000/api/session/ses_test/compact"],
    ["POST", "http://localhost:3000/api/session/ses_test/wait"],
    ["GET", "http://localhost:3000/api/session/ses_test/context"],
  ])
  const body = requests[4]?.init?.body
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
    await client.sessions.create({})
    throw new Error("Expected request to fail")
  } catch (error) {
    expect(isUnauthorizedError(error)).toBe(true)
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
