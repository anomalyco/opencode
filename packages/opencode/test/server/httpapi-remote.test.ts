import { afterEach, describe, expect } from "bun:test"
import { Effect, Queue, Schema, Stream } from "effect"
import { RemoteAccess } from "@/remote/access"
import { SessionID } from "@/session/schema"
import { disposeAllInstances, TestInstance } from "../fixture/fixture"
import { resetDatabase } from "../fixture/db"
import { testEffect } from "../lib/effect"
import { httpApiLayer, request, requestInDirectory } from "./httpapi-layer"

const SessionResponse = Schema.Struct({
  id: SessionID,
  title: Schema.String,
})

const PairingResponse = Schema.Struct({
  ticket: Schema.String,
  expires_in: Schema.Number,
})

const GrantResponse = Schema.Struct({
  token: Schema.String,
  sessionID: SessionID,
  expires_in: Schema.Number,
})

const EventData = Schema.Struct({
  id: Schema.optional(Schema.String),
  type: Schema.String,
  properties: Schema.Record(Schema.String, Schema.Any),
})

function bearer(token: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers)
  headers.set("authorization", `Bearer ${token}`)
  return { ...init, headers }
}

function jsonBody(body: unknown, init: RequestInit = {}) {
  const headers = new Headers(init.headers)
  headers.set("content-type", "application/json")
  return { ...init, headers, body: JSON.stringify(body) }
}

const readEvent = (reader: Queue.Dequeue<Uint8Array>) =>
  Effect.gen(function* () {
    const value = yield* Queue.take(reader).pipe(
      Effect.timeoutOrElse({
        duration: "5 seconds",
        orElse: () => Effect.fail(new Error("timed out waiting for remote event")),
      }),
    )
    return Schema.decodeUnknownSync(EventData)(JSON.parse(new TextDecoder().decode(value).replace(/^data: /, "")))
  })

const openRemoteEventStream = (sessionID: string, token: string) =>
  Effect.gen(function* () {
    const response = yield* request(`/remote/session/${sessionID}/events`, bearer(token))
    const reader = yield* Queue.unbounded<Uint8Array>()
    yield* response.stream.pipe(
      Stream.runForEach((value) => Queue.offer(reader, value)),
      Effect.forkScoped,
    )
    return { response, reader }
  })

afterEach(async () => {
  RemoteAccess.resetForTest()
  await disposeAllInstances()
  await resetDatabase()
})

const it = testEffect(httpApiLayer)

describe("remote HttpApi", () => {
  it.instance(
    "runs pairing, scoped access, live events, and revoke through the production route tree",
    () =>
      Effect.gen(function* () {
        const { directory } = yield* TestInstance

        const mobile = yield* request("/remote/mobile")
        expect(mobile.status).toBe(200)
        expect(mobile.headers["content-type"]).toContain("text/html")
        expect(yield* mobile.text).toContain("OpenCode Remote")

        const created = yield* requestInDirectory("/session", directory, { method: "POST" })
        expect(created.status).toBe(200)
        const session = Schema.decodeUnknownSync(SessionResponse)(yield* created.json)

        const createdOther = yield* requestInDirectory("/session", directory, { method: "POST" })
        expect(createdOther.status).toBe(200)
        const other = Schema.decodeUnknownSync(SessionResponse)(yield* createdOther.json)

        const seeded = yield* requestInDirectory(
          `/session/${session.id}/message`,
          directory,
          jsonBody(
            {
              agent: "build",
              model: { providerID: "test", modelID: "test" },
              noReply: true,
              parts: [
                { type: "text", text: "visible phone text" },
                { type: "text", text: "hidden synthetic file contents", synthetic: true },
                { type: "text", text: "hidden ignored text", ignored: true },
              ],
            },
            { method: "POST" },
          ),
        )
        expect(seeded.status).toBe(200)

        const paired = yield* requestInDirectory(`/session/${session.id}/remote`, directory, { method: "POST" })
        expect(paired.status).toBe(200)
        const pairing = Schema.decodeUnknownSync(PairingResponse)(yield* paired.json)
        expect(pairing.expires_in).toBeGreaterThan(0)

        const redeemed = yield* request(
          "/remote/pair",
          jsonBody({ ticket: pairing.ticket }, { method: "POST" }),
        )
        expect(redeemed.status).toBe(200)
        const grant = Schema.decodeUnknownSync(GrantResponse)(yield* redeemed.json)
        expect(grant.sessionID).toBe(session.id)
        expect(grant.expires_in).toBeGreaterThan(0)

        const reusedTicket = yield* request(
          "/remote/pair",
          jsonBody({ ticket: pairing.ticket }, { method: "POST" }),
        )
        expect(reusedTicket.status).toBe(403)

        const bootstrap = yield* request(`/remote/session/${session.id}`, bearer(grant.token))
        expect(bootstrap.status).toBe(200)
        const bootstrapBody = yield* bootstrap.json
        expect(bootstrapBody).toMatchObject({
          session: { title: session.title },
          messages: [
            {
              info: { role: "user" },
              parts: [{ type: "text", text: "visible phone text" }],
            },
          ],
          status: { type: "idle" },
          permissions: [],
          questions: [],
        })
        expect(JSON.stringify(bootstrapBody)).not.toContain("hidden synthetic file contents")
        expect(JSON.stringify(bootstrapBody)).not.toContain("hidden ignored text")

        const crossSession = yield* request(`/remote/session/${other.id}`, bearer(grant.token))
        expect(crossSession.status).toBe(401)

        const privilegedPrompt = yield* request(
          `/remote/session/${session.id}/message`,
          bearer(
            grant.token,
            jsonBody(
              { parts: [{ type: "file", mime: "text/plain", url: "file:///etc/passwd" }] },
              { method: "POST" },
            ),
          ),
        )
        expect(privilegedPrompt.status).toBe(400)

        const abort = yield* request(`/remote/session/${session.id}/abort`, bearer(grant.token, { method: "POST" }))
        expect(abort.status).toBe(200)
        expect(yield* abort.json).toBe(true)

        const { response: events, reader } = yield* openRemoteEventStream(session.id, grant.token)
        expect(events.status).toBe(200)
        expect(events.headers["content-type"]).toContain("text/event-stream")
        expect(events.headers["cache-control"]).toBe("no-cache, no-transform")
        expect(events.headers["x-accel-buffering"]).toBe("no")
        expect(events.headers["x-content-type-options"]).toBe("nosniff")
        expect(yield* readEvent(reader)).toMatchObject({
          type: "server.connected",
          properties: { sessionID: session.id },
        })

        const updateOther = yield* requestInDirectory(
          `/session/${other.id}`,
          directory,
          jsonBody({ title: "other updated" }, { method: "PATCH" }),
        )
        expect(updateOther.status).toBe(200)

        const quiet = yield* Queue.take(reader).pipe(
          Effect.as("event" as const),
          Effect.timeoutOrElse({ duration: "250 millis", orElse: () => Effect.succeed("open" as const) }),
        )
        expect(quiet).toBe("open")

        const updateTarget = yield* requestInDirectory(
          `/session/${session.id}`,
          directory,
          jsonBody({ title: "target updated" }, { method: "PATCH" }),
        )
        expect(updateTarget.status).toBe(200)
        expect(yield* readEvent(reader)).toMatchObject({ type: "session.updated", properties: {} })

        const revoked = yield* requestInDirectory(`/session/${session.id}/remote`, directory, { method: "DELETE" })
        expect(revoked.status).toBe(200)
        expect(yield* revoked.json).toBe(true)

        const expired = yield* request(`/remote/session/${session.id}`, bearer(grant.token))
        expect(expired.status).toBe(401)
      }),
    { git: true, config: { formatter: false, lsp: false } },
  )
})
