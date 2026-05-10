import { afterEach, describe, expect } from "bun:test"
import { Effect } from "effect"
import { eq } from "drizzle-orm"
import * as Database from "@/storage/db"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { WithInstance } from "../../src/project/with-instance"
import { Server } from "../../src/server/server"
import { Session } from "@/session/session"
import { SessionPaths } from "../../src/server/routes/instance/httpapi/groups/session"
import { SyncPaths } from "../../src/server/routes/instance/httpapi/groups/sync"
import { MessageID, PartID } from "../../src/session/schema"
import { PartTable } from "@/session/session.sql"
import { resetDatabase } from "../fixture/db"
import { disposeAllInstances, tmpdir } from "../fixture/fixture"
import { it } from "../lib/effect"

afterEach(async () => {
  await disposeAllInstances()
  await resetDatabase()
})

describe("schema-rejection wire shape", () => {
  it.live(
    "Payload schema rejection returns NamedError-shaped JSON, not empty",
    Effect.acquireRelease(
      Effect.promise(() => tmpdir({ git: true, config: { formatter: false, lsp: false } })),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((tmp) =>
        Effect.gen(function* () {
          // POST /sync/history with bad aggregate value: rejected at the
          // request body schema (kind: "Payload" or "Body" depending on
          // Effect HttpApi version).
          const res = yield* Effect.promise(async () =>
            Server.Default().app.request(SyncPaths.history, {
              method: "POST",
              headers: { "x-opencode-directory": tmp.path, "content-type": "application/json" },
              body: JSON.stringify({ aggregate: -1 }),
            }),
          )
          const body = yield* Effect.promise(async () => res.text())
          expect(res.status).toBe(400)
          expect(res.headers.get("content-type") ?? "").toContain("application/json")
          const parsed = JSON.parse(body)
          expect(parsed).toMatchObject({
            name: "BadRequest",
            data: { kind: expect.stringMatching(/^(Body|Payload)$/) },
          })
          expect(parsed.data.message).toEqual(expect.any(String))
          expect(parsed.data.message.length).toBeGreaterThan(0)
        }),
      ),
    ),
  )

  it.live(
    "response-encode failure: corrupted stored row returns NamedError-shaped JSON with field path",
    // This is the actual user-reported failure mode from the OMO/Windows bug
    // — a stored part has a value the response Schema rejects at encode time.
    // Pre-fix this returned 400 with empty body; now it returns the body shape
    // with the field path in `data.message`.
    Effect.acquireRelease(
      Effect.promise(() => tmpdir({ config: { formatter: false, lsp: false } })),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((tmp) =>
        Effect.gen(function* () {
          const sessionID = yield* Effect.promise(async () =>
            WithInstance.provide({
              directory: tmp.path,
              fn: () =>
                Effect.runPromise(
                  Effect.gen(function* () {
                    const session = yield* Session.Service
                    const info = yield* session.create({})
                    const message = yield* session.updateMessage({
                      id: MessageID.ascending(),
                      role: "user",
                      sessionID: info.id,
                      agent: "build",
                      model: { providerID: ProviderID.make("test"), modelID: ModelID.make("test") },
                      time: { created: Date.now() },
                    })
                    const partID = PartID.ascending()
                    yield* session.updatePart({
                      id: partID,
                      sessionID: info.id,
                      messageID: message.id,
                      type: "step-finish",
                      reason: "stop",
                      cost: 0,
                      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
                    })
                    // NaN slips past Schema.Finite at encode — exact mirror
                    // of the corrupt row that broke the user's session.
                    Database.use((db) =>
                      db
                        .update(PartTable)
                        .set({
                          data: {
                            type: "step-finish",
                            reason: "stop",
                            cost: 0,
                            tokens: { input: 0, output: NaN, reasoning: 0, cache: { read: 0, write: 0 } },
                          } as never,
                        })
                        .where(eq(PartTable.id, partID))
                        .run(),
                    )
                    return info.id
                  }).pipe(Effect.provide(Session.defaultLayer)),
                ),
            }),
          )

          const url = `${SessionPaths.messages.replace(":sessionID", sessionID)}?limit=80&directory=${encodeURIComponent(tmp.path)}`
          const res = yield* Effect.promise(async () => Server.Default().app.request(url))
          const body = yield* Effect.promise(async () => res.text())
          expect(res.status).toBe(400)
          expect(res.headers.get("content-type") ?? "").toContain("application/json")
          const parsed = JSON.parse(body)
          expect(parsed).toMatchObject({ name: "BadRequest", data: { kind: "Body" } })
          // The field path is what made this PR worth shipping — assert the
          // message points at the actual broken field.
          expect(parsed.data.message).toMatch(/output/)
        }),
      ),
    ),
  )
})
