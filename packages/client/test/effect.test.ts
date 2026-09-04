import { expect, test } from "bun:test"
import { DateTime, Effect, Stream } from "effect"
import { HttpClient, HttpClientResponse } from "effect/unstable/http"
import {
  AbsolutePath,
  Agent,
  Event,
  Location,
  Model,
  OpenCode,
  Prompt,
  Session,
  SessionMessage,
} from "../src/effect/index"

const synced = { type: "log.synced" as const, aggregateID: "ses_test", seq: Event.Seq.make(1) }

test("health.get decodes the readiness response", async () => {
  const httpClient = HttpClient.make((request) =>
    Effect.succeed(HttpClientResponse.fromWeb(request, Response.json({ healthy: true, version: "old", pid: 123 }))),
  )
  const result = await Effect.gen(function* () {
    const client = yield* OpenCode.make({ baseUrl: "http://localhost:3000" })
    return yield* client.health.get()
  }).pipe(Effect.provideService(HttpClient.HttpClient, httpClient), Effect.runPromise)

  expect(result).toEqual({ healthy: true, version: "old", pid: 123 })
})

test("vcs.base decodes nullable review-base metadata", async () => {
  const location = { directory: "/repo", project: { id: "global", directory: "/repo", canonical: "/repo" } }
  const base = {
    name: "release",
    ref: "refs/remotes/origin/release",
    source: "reflog",
  }
  for (const data of [base, null]) {
    const httpClient = HttpClient.make((request) =>
      Effect.succeed(HttpClientResponse.fromWeb(request, Response.json({ location, data }))),
    )
    const result = await Effect.gen(function* () {
      const client = yield* OpenCode.make({ baseUrl: "http://localhost:3000" })
      return yield* client.vcs.base({ location: { directory: AbsolutePath.make("/repo") } })
    }).pipe(Effect.provideService(HttpClient.HttpClient, httpClient), Effect.runPromise)
    expect(result.data).toEqual(data)
    expect(result.location.directory).toBe("/repo")
  }
})

test("session.get returns the decoded Effect projection", async () => {
  const httpClient = HttpClient.make((request) =>
    Effect.succeed(HttpClientResponse.fromWeb(request, Response.json(session))),
  )
  const result = await Effect.gen(function* () {
    const client = yield* OpenCode.make({ baseUrl: "http://localhost:3000" })
    return yield* client.session.get({ sessionID: Session.ID.make("ses_test") })
  }).pipe(Effect.provideService(HttpClient.HttpClient, httpClient), Effect.runPromise)

  expect(DateTime.toEpochMillis(result.time.created)).toBe(1_717_171_717_000)
})

test("session instructions methods use the public HTTP contract", async () => {
  const requests: Array<{ method: string; url: string; body?: unknown }> = []
  const instructions = [{ key: "review-notes", value: { text: "Check the diff", priority: 1 } }]
  const httpClient = HttpClient.make((request) => {
    requests.push({
      method: request.method,
      url: request.url,
      body: request.body._tag === "Uint8Array" ? JSON.parse(new TextDecoder().decode(request.body.body)) : undefined,
    })
    return Effect.succeed(
      HttpClientResponse.fromWeb(
        request,
        request.method === "GET" ? Response.json({ data: instructions }) : new Response(null, { status: 204 }),
      ),
    )
  })
  const result = await Effect.gen(function* () {
    const client = yield* OpenCode.make({ baseUrl: "http://localhost:3000" })
    const listed = yield* client.session.instructions.entry.list({ sessionID: Session.ID.make("ses_test") })
    yield* client.session.instructions.entry.put({
      sessionID: Session.ID.make("ses_test"),
      key: "review-notes",
      value: instructions[0].value,
    })
    yield* client.session.instructions.entry.remove({
      sessionID: Session.ID.make("ses_test"),
      key: "review-notes",
    })
    return listed
  }).pipe(Effect.provideService(HttpClient.HttpClient, httpClient), Effect.runPromise)

  expect(result).toEqual(instructions)
  expect(requests).toEqual([
    {
      method: "GET",
      url: "http://localhost:3000/api/session/ses_test/instructions/entries",
      body: undefined,
    },
    {
      method: "PUT",
      url: "http://localhost:3000/api/session/ses_test/instructions/entries/review-notes",
      body: { value: { text: "Check the diff", priority: 1 } },
    },
    {
      method: "DELETE",
      url: "http://localhost:3000/api/session/ses_test/instructions/entries/review-notes",
      body: undefined,
    },
  ])
})

test("event.subscribe exposes and decodes the native Effect event stream", async () => {
  const httpClient = HttpClient.make((request) =>
    Effect.succeed(
      HttpClientResponse.fromWeb(
        request,
        new Response(
          `data: ${JSON.stringify({ id: "evt_connected", created: 0, type: "server.connected", data: {} })}\n\n` +
            `data: ${JSON.stringify(modelSwitchedEvent)}\n\n`,
          { headers: { "content-type": "text/event-stream" } },
        ),
      ),
    ),
  )
  const events = await Effect.gen(function* () {
    const client = yield* OpenCode.make({ baseUrl: "http://localhost:3000" })
    return yield* client.event.subscribe().pipe(Stream.runCollect)
  }).pipe(Effect.provideService(HttpClient.HttpClient, httpClient), Effect.runPromise)

  expect(Array.from(events).map((event) => event.type)).toEqual(["server.connected", "session.model.selected"])
  const durable = events[1]
  if (durable?.type !== "session.model.selected") throw new Error("Expected model event")
  expect(durable.created).toBe(1_717_171_717_000)
  expect(durable.durable).toEqual({ aggregateID: "ses_test", seq: 1, version: 1 })
})

test("event.subscribe terminates on Effect protocol decode failures", async () => {
  const httpClient = HttpClient.make((request) =>
    Effect.succeed(
      HttpClientResponse.fromWeb(
        request,
        new Response(`data: {"type":"server.connected"}\n\n`, {
          headers: { "content-type": "text/event-stream" },
        }),
      ),
    ),
  )
  const error = await Effect.gen(function* () {
    const client = yield* OpenCode.make({ baseUrl: "http://localhost:3000" })
    return yield* client.event.subscribe().pipe(Stream.runCollect, Effect.flip)
  }).pipe(Effect.provideService(HttpClient.HttpClient, httpClient), Effect.runPromise)

  expect(error._tag).toBe("ClientError")
})

test("session methods retain decoded Effect inputs and outputs", async () => {
  const logQueries: Array<Record<string, string>> = []
  const requests: Array<{ method: string; url: string }> = []
  const httpClient = HttpClient.make((request) => {
    const url = request.url
    requests.push({ method: request.method, url })
    if (url.includes("/log")) {
      logQueries.push(Object.fromEntries(request.urlParams.params))
      return Effect.succeed(
        HttpClientResponse.fromWeb(
          request,
          new Response(`data: ${JSON.stringify(modelSwitchedEvent)}\n\ndata: ${JSON.stringify(synced)}\n\n`, {
            headers: { "content-type": "text/event-stream" },
          }),
        ),
      )
    }
    if (url.includes("/prompt")) {
      return Effect.succeed(HttpClientResponse.fromWeb(request, Response.json(admission)))
    }
    if (url.endsWith("/compact")) {
      return Effect.succeed(HttpClientResponse.fromWeb(request, Response.json(compactionAdmission)))
    }
    if (url.includes("/context")) {
      return Effect.succeed(HttpClientResponse.fromWeb(request, Response.json({ data: [] })))
    }
    if (url.includes("/message/")) {
      return Effect.succeed(HttpClientResponse.fromWeb(request, Response.json({ data: modelSwitchedMessage })))
    }
    if (url.endsWith("/api/session/active")) {
      return Effect.succeed(
        HttpClientResponse.fromWeb(request, Response.json({ data: { ses_test: { type: "running" } } })),
      )
    }
    if (request.method === "POST" && url.endsWith("/api/session")) {
      return Effect.succeed(HttpClientResponse.fromWeb(request, Response.json(session)))
    }
    if (request.method === "POST") {
      return Effect.succeed(
        HttpClientResponse.fromWeb(
          request,
          request.url.includes("/interrupt")
            ? Response.json({ interrupted: true })
            : new Response(null, { status: 204 }),
        ),
      )
    }
    return Effect.succeed(
      HttpClientResponse.fromWeb(request, Response.json({ data: [session.data], cursor: { next: "next" } })),
    )
  })
  const result = await Effect.gen(function* () {
    const client = yield* OpenCode.make({ baseUrl: "http://localhost:3000" })
    const page = yield* client.session.list({ limit: 10 })
    const active = yield* client.session.active()
    const created = yield* client.session.create({
      location: Location.Ref.make({ directory: AbsolutePath.make("/tmp/project") }),
    })
    yield* client.session.view({ sessionID: Session.ID.make("ses_test"), idle: session.data.time.idle })
    yield* client.session.switchAgent({ sessionID: Session.ID.make("ses_test"), agent: Agent.ID.make("build") })
    yield* client.session.switchModel({
      sessionID: Session.ID.make("ses_test"),
      model: Model.Ref.make({ id: "claude", providerID: "anthropic" }),
    })
    const admitted = yield* client.session.prompt({
      sessionID: Session.ID.make("ses_test"),
      text: "Hello",
      resume: false,
    })
    yield* client.session.compact({ sessionID: Session.ID.make("ses_test") })
    yield* client.session.wait({ sessionID: Session.ID.make("ses_test") })
    const context = yield* client.session.context({ sessionID: Session.ID.make("ses_test") })
    const log = yield* client.session
      .log({ sessionID: Session.ID.make("ses_test"), after: Event.Seq.make(0) })
      .pipe(Stream.runCollect)
    const interrupted = yield* client.session.interrupt({ sessionID: Session.ID.make("ses_test") })
    const message = yield* client.session.message({
      sessionID: Session.ID.make("ses_test"),
      messageID: SessionMessage.ID.make("msg_model"),
    })
    return { page, active, created, admitted, context, log, interrupted, message }
  }).pipe(Effect.provideService(HttpClient.HttpClient, httpClient), Effect.runPromise)

  const listed = result.page.data[0]
  if (!listed?.time.idle || !listed.time.viewed) throw new Error("Expected attention times")
  expect(DateTime.toEpochMillis(listed.time.created)).toBe(1_717_171_717_000)
  expect(DateTime.toEpochMillis(listed.time.idle)).toBe(1_717_171_717_002)
  expect(DateTime.toEpochMillis(listed.time.viewed)).toBe(1_717_171_717_001)
  expect(result.active).toEqual({ ses_test: { type: "running" } })
  expect(result.interrupted).toEqual({ interrupted: true })
  expect(Object.getPrototypeOf(result.page.data[0])).toBe(Object.prototype)
  expect(Object.getPrototypeOf(result.created)).toBe(Object.prototype)
  expect(result.created.id).toBe("ses_test")
  expect(Object.getPrototypeOf(result.admitted)).toBe(Object.prototype)
  expect(Object.getPrototypeOf(result.admitted.payload)).toBe(Object.prototype)
  expect(DateTime.toEpochMillis(result.admitted.timeCreated)).toBe(1_717_171_717_000)
  expect(result.context).toEqual([])
  expect(logQueries[0]).toEqual({ after: "0" })
  expect(requests).toContainEqual({ method: "POST", url: "http://localhost:3000/api/session/ses_test/view" })
  const logged = Array.from(result.log)
  expect(logged.map((item) => item.type)).toEqual(["session.model.selected", "log.synced"])
  expect(logged[0]?.type === "session.model.selected" && logged[0].created).toBe(1_717_171_717_000)
  expect(logged.at(-1)).toEqual(synced)
  expect(result.message).toEqual(expect.objectContaining({ id: "msg_model", type: "model-switched" }))
})

test("session.log decodes revert preparation and subsequent path deltas", async () => {
  const data = [
    { sessionID: "ses_test", snapshot: "original", paths: ["first.txt"] },
    { sessionID: "ses_test", paths: ["second.txt"] },
  ]
  const httpClient = HttpClient.make((request) =>
    Effect.succeed(
      HttpClientResponse.fromWeb(
        request,
        new Response(
          data
            .map(
              (data, seq) =>
                `data: ${JSON.stringify({
                  id: `evt_prepared_${seq}`,
                  created: 1,
                  type: "session.revert.prepared",
                  durable: { aggregateID: "ses_test", seq, version: 1 },
                  data,
                })}\n\n`,
            )
            .join(""),
          { headers: { "content-type": "text/event-stream" } },
        ),
      ),
    ),
  )
  const result = await Effect.gen(function* () {
    const client = yield* OpenCode.make({ baseUrl: "http://localhost:3000" })
    return yield* client.session.log({ sessionID: Session.ID.make("ses_test") }).pipe(Stream.runCollect)
  }).pipe(Effect.provideService(HttpClient.HttpClient, httpClient), Effect.runPromise)

  expect(
    result.map((event) => {
      if (event.type !== "session.revert.prepared") throw new Error("Expected revert preparation")
      return { snapshot: event.data.snapshot?.toString(), paths: event.data.paths.map(String) }
    }),
  ).toEqual([
    { snapshot: "original", paths: ["first.txt"] },
    { snapshot: undefined, paths: ["second.txt"] },
  ])
})

test("session.log retains the typed SessionNotFoundError", async () => {
  const httpClient = HttpClient.make((request) =>
    Effect.succeed(
      HttpClientResponse.fromWeb(
        request,
        Response.json(
          { _tag: "SessionNotFoundError", sessionID: "ses_missing", message: "Session not found" },
          { status: 404 },
        ),
      ),
    ),
  )
  const error = await Effect.gen(function* () {
    const client = yield* OpenCode.make({ baseUrl: "http://localhost:3000" })
    return yield* client.session.log({ sessionID: Session.ID.make("ses_missing") }).pipe(Stream.runCollect, Effect.flip)
  }).pipe(Effect.provideService(HttpClient.HttpClient, httpClient), Effect.runPromise)

  expect(error._tag).toBe("SessionNotFoundError")
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
    payload: { text: "Hello" },
    delivery: "steer",
    timeCreated: 1_717_171_717_000,
  },
}

const compactionAdmission = {
  data: {
    type: "compaction",
    payload: {},
    delivery: "queue",
    id: "msg_compaction",
    sessionID: "ses_test",
    timeCreated: 1_717_171_717_000,
  },
}

const modelSwitchedMessage = {
  id: "msg_model",
  type: "model-switched",
  time: { created: 1_717_171_717_000 },
  model: { id: "claude", providerID: "anthropic" },
}

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
