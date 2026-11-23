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

// The reason lives in the query string next to resume: `?reason=inactivity`. A body is no
// longer decoded, so a stale body reason is ignored (see "ignores a stale body reason").
const interrupt = (
  handler: (request: Request) => Promise<Response>,
  sessionID: string,
  query?: string,
  body?: unknown,
) =>
  Effect.promise(() =>
    handler(
      new Request(
        `http://opencode.local/api/session/${sessionID}/interrupt${query === undefined ? "" : `?${query}`}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        },
      ),
    ),
  )

it.live("rejects an unknown interrupt reason with 400", () =>
  Effect.gen(function* () {
    const handler = yield* makeHandler()
    const session = yield* createSession(handler)
    for (const reason of ["banana", "INACTIVITY", "null", 123]) {
      const response = yield* interrupt(handler, session.id, `reason=${reason}`)
      expect(response.status).toBe(400)
    }
  }).pipe(Effect.scoped),
)

it.live("rejects an empty interrupt reason with 400", () =>
  Effect.gen(function* () {
    const handler = yield* makeHandler()
    const session = yield* createSession(handler)
    const response = yield* interrupt(handler, session.id, "reason=")
    expect(response.status).toBe(400)
  }).pipe(Effect.scoped),
)

it.live("accepts each known interrupt reason on an idle session", () =>
  Effect.gen(function* () {
    const handler = yield* makeHandler()
    const session = yield* createSession(handler)
    // "shutdown" is not a caller-supplied reason: it is only published when the process
    // owner interrupts the execution fiber on teardown (see session-execution.test.ts).
    for (const reason of ["user", "superseded", "inactivity"]) {
      const response = yield* interrupt(handler, session.id, `reason=${reason}`)
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
    const response = yield* interrupt(handler, session.id, "reason=shutdown")
    expect(response.status).toBe(400)
  }).pipe(Effect.scoped),
)

it.live("defaults an omitted interrupt reason to the idle no-op", () =>
  Effect.gen(function* () {
    const handler = yield* makeHandler()
    const session = yield* createSession(handler)
    const response = yield* interrupt(handler, session.id, undefined, {})
    expect(response.status).toBe(200)
    expect(Schema.decodeUnknownSync(InterruptResponse)(yield* Effect.promise(() => response.json()))).toEqual({
      interrupted: false,
    })
  }).pipe(Effect.scoped),
)

it.live("accepts an interrupt with no reason and no body", () =>
  Effect.gen(function* () {
    const handler = yield* makeHandler()
    const session = yield* createSession(handler)
    // No payload is declared on the endpoint anymore, so a plain POST needs no
    // body-supplying middleware and an omitted reason defaults to "user".
    const response = yield* interrupt(handler, session.id)
    expect(response.status).toBe(200)
    expect(Schema.decodeUnknownSync(InterruptResponse)(yield* Effect.promise(() => response.json()))).toEqual({
      interrupted: false,
    })
  }).pipe(Effect.scoped),
)

it.live("ignores a stale body reason", () =>
  Effect.gen(function* () {
    const handler = yield* makeHandler()
    const session = yield* createSession(handler)
    // Callers that sent the reason in the body before it moved to the query string get
    // the default "user" instead of an error: no payload is decoded anymore.
    const response = yield* interrupt(handler, session.id, undefined, { reason: "shutdown" })
    expect(response.status).toBe(200)
    expect(Schema.decodeUnknownSync(InterruptResponse)(yield* Effect.promise(() => response.json()))).toEqual({
      interrupted: false,
    })
  }).pipe(Effect.scoped),
)

it.live("returns not found for an unknown session", () =>
  Effect.gen(function* () {
    const handler = yield* makeHandler()
    const sessionID = Session.ID.create()
    const response = yield* interrupt(handler, sessionID, "reason=inactivity")
    expect(response.status).toBe(404)
    expect(yield* Effect.promise(() => response.json())).toMatchObject({
      _tag: "SessionNotFoundError",
      sessionID,
    })
  }).pipe(Effect.scoped),
)
