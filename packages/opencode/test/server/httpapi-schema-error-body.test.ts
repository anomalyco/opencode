import { afterEach, describe, expect } from "bun:test"
import { Effect } from "effect"
import { Server } from "../../src/server/server"
import { SyncPaths } from "../../src/server/routes/instance/httpapi/groups/sync"
import { resetDatabase } from "../fixture/db"
import { disposeAllInstances, tmpdir } from "../fixture/fixture"
import { it } from "../lib/effect"

afterEach(async () => {
  await disposeAllInstances()
  await resetDatabase()
})

describe("schema-rejection wire shape", () => {
  it.live(
    "Body schema rejection returns NamedError-shaped JSON, not empty",
    Effect.acquireRelease(
      Effect.promise(() => tmpdir({ git: true, config: { formatter: false, lsp: false } })),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((tmp) =>
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
    ),
  )
})
