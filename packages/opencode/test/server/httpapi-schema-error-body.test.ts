import { afterEach, describe, expect } from "bun:test"
import { Effect } from "effect"
import { eq } from "drizzle-orm"
import * as Database from "@/storage/db"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { Server } from "../../src/server/server"
import { Session } from "@/session/session"
import { SessionPaths } from "../../src/server/routes/instance/httpapi/groups/session"
import { SyncPaths } from "../../src/server/routes/instance/httpapi/groups/sync"
import { MessageID, PartID } from "../../src/session/schema"
import { PartTable } from "@/session/session.sql"
import { resetDatabase } from "../fixture/db"
import { disposeAllInstances, TestInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(Session.defaultLayer)

afterEach(async () => {
  await disposeAllInstances()
  await resetDatabase()
})

const seedCorruptStepFinishPart = Effect.gen(function* () {
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
  // Schema.Finite still rejects NaN at encode: exact mirror of the corrupt row
  // that broke the user's session in the OMO/Windows bug.
  yield* Effect.sync(() =>
    Database.use((db) =>
      db
        .update(PartTable)
        .set({
          data: {
            type: "step-finish",
            reason: "stop",
            cost: 0,
            tokens: { input: 0, output: NaN, reasoning: 0, cache: { read: 0, write: 0 } },
          } as never, // drizzle's .set() can't narrow the discriminated union
        })
        .where(eq(PartTable.id, partID))
        .run(),
    ),
  )
  return info.id
})

describe("schema-rejection wire shape", () => {
  it.instance(
    "Payload schema rejection returns NamedError-shaped JSON, not empty",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const res = yield* Effect.promise(async () =>
          Server.Default().app.request(SyncPaths.history, {
            method: "POST",
            headers: { "x-opencode-directory": test.directory, "content-type": "application/json" },
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
    { git: true, config: { formatter: false, lsp: false } },
  )

  it.instance(
    "Query schema rejection returns NamedError-shaped JSON",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        // /find/file?limit=999999 violates the limit constraint check.
        const url = `/find/file?query=foo&limit=999999&directory=${encodeURIComponent(test.directory)}`
        const res = yield* Effect.promise(async () => Server.Default().app.request(url))
        const body = yield* Effect.promise(async () => res.text())
        expect(res.status).toBe(400)
        const parsed = JSON.parse(body)
        expect(parsed).toMatchObject({ name: "BadRequest", data: { kind: "Query" } })
      }),
    { git: true, config: { formatter: false, lsp: false } },
  )

  it.instance(
    "rejected request body never echoes back unbounded — message is capped",
    // Defense against DoS-amplification + secret-echo: Effect's Issue formatter
    // dumps the rejected `actual` verbatim. A multi-MB invalid array would
    // become a multi-MB 400 response and log line. Cap kicks in around 1KB.
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const huge = "X".repeat(50_000)
        const res = yield* Effect.promise(async () =>
          Server.Default().app.request(SyncPaths.history, {
            method: "POST",
            headers: { "x-opencode-directory": test.directory, "content-type": "application/json" },
            body: JSON.stringify({ aggregate: huge }),
          }),
        )
        const body = yield* Effect.promise(async () => res.text())
        expect(res.status).toBe(400)
        // 1 KB cap + small JSON envelope ≈ <2 KB — never tens of KB.
        expect(body.length).toBeLessThan(2 * 1024)
        const parsed = JSON.parse(body)
        expect(parsed.data.message).not.toContain(huge)
      }),
    { git: true, config: { formatter: false, lsp: false } },
  )

  it.instance(
    "response-encode failure: corrupted stored row returns NamedError-shaped JSON with field path",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const sessionID = yield* seedCorruptStepFinishPart
        const url = `${SessionPaths.messages.replace(":sessionID", sessionID)}?limit=80&directory=${encodeURIComponent(test.directory)}`
        const res = yield* Effect.promise(async () => Server.Default().app.request(url))
        const body = yield* Effect.promise(async () => res.text())
        expect(res.status).toBe(400)
        expect(res.headers.get("content-type") ?? "").toContain("application/json")
        const parsed = JSON.parse(body)
        expect(parsed).toMatchObject({ name: "BadRequest", data: { kind: "Body" } })
        // Field path in data.message — what made this PR worth shipping.
        expect(parsed.data.message).toMatch(/output/)
      }),
    { config: { formatter: false, lsp: false } },
  )
})
