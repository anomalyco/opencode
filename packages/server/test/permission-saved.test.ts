import { expect } from "bun:test"
import { PermissionSaved } from "@opencode/schema/permission-saved"
import { Session } from "@opencode/schema/session"
import { Effect, Schema } from "effect"
import { it } from "../../core/test/lib/effect"
import { ServerFetch } from "../src/fetch"

const SessionResponse = Schema.Struct({ data: Schema.toEncoded(Session.Info) })
const AskResponse = Schema.Struct({ data: Schema.Struct({ id: Schema.String, effect: Schema.String }) })
const SavedList = Schema.Struct({ data: Schema.Array(Schema.toEncoded(PermissionSaved.Info)) })
const SavedResponse = Schema.Struct({ data: Schema.toEncoded(PermissionSaved.Info) })

it.live("edits saved permissions through PATCH", () =>
  Effect.gen(function* () {
    const handler = yield* ServerFetch.make({
      app: { version: "test" },
      database: { path: ":memory:" },
      fs: { filewatcher: false },
      models: { fetch: false },
    })
    const request = (path: string, method: string, body?: unknown) =>
      Effect.promise(async () => {
        const response = await handler(
          new Request(`http://opencode.local${path}`, {
            method,
            headers: { "content-type": "application/json" },
            body: body === undefined ? undefined : JSON.stringify(body),
          }),
        )
        return { status: response.status, body: response.status === 204 ? undefined : await response.json() }
      })

    const session = Schema.decodeUnknownSync(SessionResponse)(
      (yield* request("/api/session", "POST", {
        permissions: [{ action: "deploy", resource: "*", effect: "ask" }],
      })).body,
    )
    // Saved permissions are only created by answering "always", so save two through the real request flow.
    for (const resource of ["src/*", "docs/*"]) {
      const asked = Schema.decodeUnknownSync(AskResponse)(
        (yield* request(`/api/session/${session.data.id}/permission`, "POST", {
          action: "deploy",
          resources: [resource],
          save: [resource],
        })).body,
      )
      expect(asked.data.effect).toBe("ask")
      expect(
        (yield* request(`/api/session/${session.data.id}/permission/${asked.data.id}/reply`, "POST", {
          decision: "always",
        })).status,
      ).toBe(204)
    }
    const saved = Schema.decodeUnknownSync(SavedList)((yield* request("/api/permission/saved", "GET")).body)
    const src = saved.data.find((item) => item.resource === "src/*")!

    const updated = yield* request(`/api/permission/saved/${src.id}`, "PATCH", { resource: "src/allowed.ts" })
    expect(updated.status).toBe(200)
    expect(Schema.decodeUnknownSync(SavedResponse)(updated.body).data).toMatchObject({
      id: src.id,
      action: "deploy",
      resource: "src/allowed.ts",
    })
    expect(
      Schema.decodeUnknownSync(SavedList)((yield* request("/api/permission/saved", "GET")).body)
        .data.map((item) => item.resource)
        .toSorted(),
    ).toEqual(["docs/*", "src/allowed.ts"])

    expect((yield* request(`/api/permission/saved/${src.id}`, "PATCH", { resource: "docs/*" })).status).toBe(409)
    expect((yield* request("/api/permission/saved/psv_missing", "PATCH", { resource: "x" })).status).toBe(404)
  }).pipe(Effect.scoped),
)
