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

const withTmp = <A, E, R>(
  options: Parameters<typeof tmpdir>[0],
  fn: (tmp: Awaited<ReturnType<typeof tmpdir>>) => Effect.Effect<A, E, R>,
) =>
  Effect.acquireRelease(
    Effect.promise(() => tmpdir(options)),
    (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
  ).pipe(Effect.flatMap(fn))

async function seedCorruptStepFinishPart(directory: string) {
  return WithInstance.provide({
    directory,
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
          // Schema.Finite still rejects NaN at encode — exact mirror of the
          // corrupt row that broke the user's session in the OMO/Windows bug.
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
          )
          return info.id
        }).pipe(Effect.provide(Session.defaultLayer)),
      ),
  })
}

describe("schema-rejection wire shape", () => {
  it.live(
    "Payload schema rejection returns NamedError-shaped JSON, not empty",
    withTmp({ git: true, config: { formatter: false, lsp: false } }, (tmp) =>
      Effect.gen(function* () {
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
  )

  it.live(
    "Query schema rejection returns NamedError-shaped JSON",
    withTmp({ git: true, config: { formatter: false, lsp: false } }, (tmp) =>
      Effect.gen(function* () {
        // /find/file?limit=999999 violates the limit constraint check.
        const url = `/find/file?query=foo&limit=999999&directory=${encodeURIComponent(tmp.path)}`
        const res = yield* Effect.promise(async () => Server.Default().app.request(url))
        const body = yield* Effect.promise(async () => res.text())
        expect(res.status).toBe(400)
        const parsed = JSON.parse(body)
        expect(parsed).toMatchObject({ name: "BadRequest", data: { kind: "Query" } })
      }),
    ),
  )

  it.live(
    "rejected request body never echoes back unbounded — message is capped",
    // Defense against DoS-amplification + secret-echo: Effect's Issue formatter
    // dumps the rejected `actual` verbatim. A multi-MB invalid array would
    // become a multi-MB 400 response and log line. Cap kicks in around 1KB.
    withTmp({ git: true, config: { formatter: false, lsp: false } }, (tmp) =>
      Effect.gen(function* () {
        const huge = "X".repeat(50_000)
        const res = yield* Effect.promise(async () =>
          Server.Default().app.request(SyncPaths.history, {
            method: "POST",
            headers: { "x-opencode-directory": tmp.path, "content-type": "application/json" },
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
    ),
  )

  it.live(
    "response-encode failure: corrupted stored row returns NamedError-shaped JSON with field path",
    withTmp({ config: { formatter: false, lsp: false } }, (tmp) =>
      Effect.gen(function* () {
        const sessionID = yield* Effect.promise(() => seedCorruptStepFinishPart(tmp.path))
        const url = `${SessionPaths.messages.replace(":sessionID", sessionID)}?limit=80&directory=${encodeURIComponent(tmp.path)}`
        const res = yield* Effect.promise(async () => Server.Default().app.request(url))
        const body = yield* Effect.promise(async () => res.text())
        expect(res.status).toBe(400)
        expect(res.headers.get("content-type") ?? "").toContain("application/json")
        const parsed = JSON.parse(body)
        expect(parsed).toMatchObject({ name: "BadRequest", data: { kind: "Body" } })
        // Field path in data.message — what made this PR worth shipping.
        expect(parsed.data.message).toMatch(/output/)
      }),
    ),
  )
})
