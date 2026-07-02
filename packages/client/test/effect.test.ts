import { expect, test } from "bun:test"
import { DateTime, Effect, Stream } from "effect"
import { HttpClient, HttpClientResponse } from "effect/unstable/http"
import { AbsolutePath, Agent, Event, Location, Model, OpenCode, Prompt, Session, SessionMessage } from "../src/effect"

const synced = { type: "log.synced" as const, aggregateID: "ses_test", seq: Event.Seq.make(1) }

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

test("event.subscribe exposes and decodes the native Effect event stream", async () => {
  const httpClient = HttpClient.make((request) =>
    Effect.succeed(
      HttpClientResponse.fromWeb(
        request,
        new Response(
          `data: ${JSON.stringify({ id: "evt_connected", type: "server.connected", data: {} })}\n\n` +
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

  expect(Array.from(events).map((event) => event.type)).toEqual(["server.connected", "session.next.model.switched"])
  const durable = events[1]
  if (durable?.type !== "session.next.model.switched") throw new Error("Expected model event")
  expect(DateTime.toEpochMillis(durable.data.timestamp)).toBe(1_717_171_717_000)
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
  const httpClient = HttpClient.make((request) => {
    const url = request.url
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
    if (url.includes("/context")) {
      return Effect.succeed(HttpClientResponse.fromWeb(request, Response.json({ data: [] })))
    }
    if (url.includes("/message/")) {
      return Effect.succeed(HttpClientResponse.fromWeb(request, Response.json({ data: modelSwitchedMessage })))
    }
    if (url.endsWith("/api/session/active")) {
      return Effect.succeed(
        HttpClientResponse.fromWeb(
          request,
          Response.json({ data: { ses_test: { type: "running" } }, watermarks: { ses_test: 3 } }),
        ),
      )
    }
    if (request.method === "POST" && url.endsWith("/api/session")) {
      return Effect.succeed(HttpClientResponse.fromWeb(request, Response.json(session)))
    }
    if (request.method === "POST") {
      return Effect.succeed(HttpClientResponse.fromWeb(request, new Response(null, { status: 204 })))
    }
    return Effect.succeed(
      HttpClientResponse.fromWeb(
        request,
        Response.json({ data: [session.data], watermarks: { ses_test: 3 }, cursor: { next: "next" } }),
      ),
    )
  })
  const result = await Effect.gen(function* () {
    const client = yield* OpenCode.make({ baseUrl: "http://localhost:3000" })
    const page = yield* client.session.list({ limit: 10 })
    const active = yield* client.session.active()
    const created = yield* client.session.create({
      location: Location.Ref.make({ directory: AbsolutePath.make("/tmp/project") }),
    })
    yield* client.session.switchAgent({ sessionID: Session.ID.make("ses_test"), agent: Agent.ID.make("build") })
    yield* client.session.switchModel({
      sessionID: Session.ID.make("ses_test"),
      model: Model.Ref.make({ id: "claude", providerID: "anthropic" }),
    })
    const admitted = yield* client.session.prompt({
      sessionID: Session.ID.make("ses_test"),
      prompt: Prompt.make({ text: "Hello" }),
      resume: false,
    })
    yield* client.session.compact({ sessionID: Session.ID.make("ses_test") })
    yield* client.session.wait({ sessionID: Session.ID.make("ses_test") })
    const context = yield* client.session.context({ sessionID: Session.ID.make("ses_test") })
    const log = yield* client.session
      .log({ sessionID: Session.ID.make("ses_test"), after: Event.Seq.make(0) })
      .pipe(Stream.runCollect)
    yield* client.session.interrupt({ sessionID: Session.ID.make("ses_test") })
    const message = yield* client.session.message({
      sessionID: Session.ID.make("ses_test"),
      messageID: SessionMessage.ID.make("msg_model"),
    })
    return { page, active, created, admitted, context, log, message }
  }).pipe(Effect.provideService(HttpClient.HttpClient, httpClient), Effect.runPromise)

  expect(DateTime.toEpochMillis(result.page.data[0].time.created)).toBe(1_717_171_717_000)
  expect(result.active).toEqual({ data: { ses_test: { type: "running" } }, watermarks: { ses_test: 3 } })
  expect(result.page.watermarks).toEqual({ ses_test: 3 })
  expect(Object.getPrototypeOf(result.page.data[0])).toBe(Object.prototype)
  expect(Object.getPrototypeOf(result.created)).toBe(Object.prototype)
  expect(result.created.id).toBe("ses_test")
  expect(Object.getPrototypeOf(result.admitted)).toBe(Object.prototype)
  expect(Object.getPrototypeOf(result.admitted.prompt)).toBe(Object.prototype)
  expect(DateTime.toEpochMillis(result.admitted.timeCreated)).toBe(1_717_171_717_000)
  expect(result.context).toEqual([])
  expect(logQueries[0]).toEqual({ after: "0" })
  const logged = Array.from(result.log)
  expect(logged.map((item) => item.type)).toEqual(["session.next.model.switched", "log.synced"])
  expect(logged[0]?.type === "session.next.model.switched" && DateTime.toEpochMillis(logged[0].data.timestamp)).toBe(
    1_717_171_717_000,
  )
  expect(logged.at(-1)).toEqual(synced)
  expect(result.message).toEqual(expect.objectContaining({ id: "msg_model", type: "model-switched" }))
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

const modelSwitchedEvent = {
  id: "evt_model",
  type: "session.next.model.switched",
  durable: { aggregateID: "ses_test", seq: 1, version: 1 },
  data: {
    timestamp: 1_717_171_717_000,
    sessionID: "ses_test",
    messageID: "msg_model",
    model: { id: "claude", providerID: "anthropic" },
  },
}
