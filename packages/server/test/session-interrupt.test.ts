import { expect } from "bun:test"
import { Session } from "@opencode/schema/session"
import { Effect, Schema } from "effect"
import { it } from "../../core/test/lib/effect"
import { ServerFetch } from "../src/fetch"

const SessionResponse = Schema.Struct({ data: Schema.toEncoded(Session.Info) })
const InterruptResponse = Schema.Struct({ interrupted: Schema.Boolean })

const makeHandler = () =>
  ServerFetch.make({
    app: { version: "test" },
    database: { path: ":memory:" },
    fs: { filewatcher: false },
  })

const createSession = (handler: (request: Request) => Promise<Response>) =>
  Effect.promise(async () => {
    const response = await handler(
      new Request("http://opencode.local/api/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "Interrupt" }),
      }),
    )
    expect(response.status).toBe(200)
    return Schema.decodeUnknownSync(SessionResponse)(await response.json()).data
  })

const interrupt = (handler: (request: Request) => Promise<Response>, sessionID: string, body?: unknown) =>
  Effect.promise(() =>
    handler(
      new Request(`http://opencode.local/api/session/${sessionID}/interrupt`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
    ),
  )

it.live("rejects an unknown interrupt reason with 400", () =>
  Effect.gen(function* () {
    const handler = yield* makeHandler()
    const session = yield* createSession(handler)
    for (const reason of ["banana", "INACTIVITY", 123]) {
      const response = yield* interrupt(handler, session.id, { reason })
      expect(response.status).toBe(400)
    }
  }).pipe(Effect.scoped),
)

it.live("treats an explicit null reason like an omitted one", () =>
  Effect.gen(function* () {
    const handler = yield* makeHandler()
    const session = yield* createSession(handler)
    // Schema.optional fields accept explicit null as absent: session.create answers the same 200
    // for {"title": null}. A null reason therefore defaults to "user" instead of failing validation.
    const response = yield* interrupt(handler, session.id, { reason: null })
    expect(response.status).toBe(200)
    expect(Schema.decodeUnknownSync(InterruptResponse)(yield* Effect.promise(() => response.json()))).toEqual({
      interrupted: false,
    })
  }).pipe(Effect.scoped),
)

it.live("accepts each known interrupt reason on an idle session", () =>
  Effect.gen(function* () {
    const handler = yield* makeHandler()
    const session = yield* createSession(handler)
    // "shutdown" is not a caller-supplied reason: it is only published when the process
    // owner interrupts the execution fiber on teardown (see session-execution.test.ts).
    for (const reason of ["user", "superseded", "inactivity"]) {
      const response = yield* interrupt(handler, session.id, { reason })
      expect(response.status).toBe(200)
      expect(Schema.decodeUnknownSync(InterruptResponse)(yield* Effect.promise(() => response.json()))).toEqual({
        interrupted: false,
      })
    }
  }).pipe(Effect.scoped),
)

it.live("rejects shutdown as a caller-supplied interrupt reason with 400", () =>
  Effect.gen(function* () {
    const handler = yield* makeHandler()
    const session = yield* createSession(handler)
    const response = yield* interrupt(handler, session.id, { reason: "shutdown" })
    expect(response.status).toBe(400)
  }).pipe(Effect.scoped),
)

it.live("defaults an omitted interrupt reason to the idle no-op", () =>
  Effect.gen(function* () {
    const handler = yield* makeHandler()
    const session = yield* createSession(handler)
    const emptyBody = yield* interrupt(handler, session.id, {})
    expect(emptyBody.status).toBe(200)
    expect(Schema.decodeUnknownSync(InterruptResponse)(yield* Effect.promise(() => emptyBody.json()))).toEqual({
      interrupted: false,
    })
  }).pipe(Effect.scoped),
)

it.live("accepts a body-less interrupt as the pre-reason call shape", () =>
  Effect.gen(function* () {
    const handler = yield* makeHandler()
    const session = yield* createSession(handler)
    // Callers that sent no body before this endpoint gained a reason must still get 200:
    // the server supplies "{}" for an empty body before payload decoding, and an omitted
    // reason defaults to "user" in session execution.
    const noBody = yield* interrupt(handler, session.id)
    expect(noBody.status).toBe(200)
    expect(Schema.decodeUnknownSync(InterruptResponse)(yield* Effect.promise(() => noBody.json()))).toEqual({
      interrupted: false,
    })
  }).pipe(Effect.scoped),
)

it.live("returns not found for an unknown session", () =>
  Effect.gen(function* () {
    const handler = yield* makeHandler()
    const sessionID = Session.ID.create()
    const response = yield* interrupt(handler, sessionID, { reason: "inactivity" })
    expect(response.status).toBe(404)
    expect(yield* Effect.promise(() => response.json())).toMatchObject({
      _tag: "SessionNotFoundError",
      sessionID,
    })
  }).pipe(Effect.scoped),
)
