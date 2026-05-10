/**
 * Regression: a schema rejection used to come back as `400` with an empty
 * body, leaving the renderer / SDK / curl with no way to tell which field
 * failed. The schemaErrorLayer now returns a NamedError-shaped JSON body
 * (same shape as 404 NotFoundError) so callers see the actual reason.
 */
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
          // POST /sync/history with `aggregate: -1` is an invalid Body shape
          // (aggregate is a NamedString) and triggers the framework's
          // HttpApiSchemaError on the Body kind.
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
          const parsed = JSON.parse(body) as { name?: string; data?: { message?: string; kind?: string } }
          expect(parsed.name).toBe("BadRequest")
          expect(typeof parsed.data?.message).toBe("string")
          expect(parsed.data?.message?.length ?? 0).toBeGreaterThan(0)
          expect(parsed.data?.kind).toMatch(/^(Body|Payload)$/)
        }),
      ),
    ),
  )
})
