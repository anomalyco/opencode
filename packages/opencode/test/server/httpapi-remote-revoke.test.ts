import { afterEach, describe, expect } from "bun:test"
import { Effect, Schema } from "effect"
import { RemoteAccess } from "@/remote/access"
import { SessionID } from "@/session/schema"
import { disposeAllInstances, TestInstance } from "../fixture/fixture"
import { resetDatabase } from "../fixture/db"
import { testEffect } from "../lib/effect"
import { httpApiLayer, request, requestInDirectory } from "./httpapi-layer"

const SessionResponse = Schema.Struct({ id: SessionID })
const PairingResponse = Schema.Struct({ ticket: Schema.String })
const GrantResponse = Schema.Struct({ token: Schema.String, sessionID: SessionID })

function jsonBody(body: unknown, init: RequestInit = {}) {
  const headers = new Headers(init.headers)
  headers.set("content-type", "application/json")
  return { ...init, headers, body: JSON.stringify(body) }
}

function bearer(token: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers)
  headers.set("authorization", `Bearer ${token}`)
  return { ...init, headers }
}

afterEach(async () => {
  RemoteAccess.resetForTest()
  await disposeAllInstances()
  await resetDatabase()
})

const it = testEffect(httpApiLayer)

describe("remote revoke lifecycle", () => {
  it.instance(
    "revokes access when the paired session is deleted and keeps admin revoke idempotent",
    () =>
      Effect.gen(function* () {
        const { directory } = yield* TestInstance
        const created = yield* requestInDirectory("/session", directory, { method: "POST" })
        expect(created.status).toBe(200)
        const session = Schema.decodeUnknownSync(SessionResponse)(yield* created.json)

        const paired = yield* requestInDirectory(`/session/${session.id}/remote`, directory, { method: "POST" })
        expect(paired.status).toBe(200)
        const pairing = Schema.decodeUnknownSync(PairingResponse)(yield* paired.json)

        const redeemed = yield* request("/remote/pair", jsonBody({ ticket: pairing.ticket }, { method: "POST" }))
        expect(redeemed.status).toBe(200)
        const grant = Schema.decodeUnknownSync(GrantResponse)(yield* redeemed.json)

        const removed = yield* requestInDirectory(`/session/${session.id}`, directory, { method: "DELETE" })
        expect(removed.status).toBe(200)

        const expiredAfterDelete = yield* request(`/remote/session/${session.id}`, bearer(grant.token))
        expect(expiredAfterDelete.status).toBe(401)

        const revoked = yield* requestInDirectory(`/session/${session.id}/remote`, directory, { method: "DELETE" })
        expect(revoked.status).toBe(200)
        expect(yield* revoked.json).toBe(true)

        const stillExpired = yield* request(`/remote/session/${session.id}`, bearer(grant.token))
        expect(stillExpired.status).toBe(401)
      }),
    { git: true, config: { formatter: false, lsp: false } },
  )
})
