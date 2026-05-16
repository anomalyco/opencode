/**
 * Regression test for the same bug class as #26574 (sibling of #26566 and
 * #26553). The Desktop app calls GET /session/<id>/diff; before #26574
 * the response was Schema-encoded against `Snapshot.FileDiff` with
 * `patch: Schema.String` (required), so any session whose stored
 * `summary_diffs` had a row without `patch` returned HTTP 400 and the
 * session never loaded.
 *
 * This test inserts a session row with a missing-patch diff entry and
 * asserts that GET /session/<id>/diff returns 200 with the row intact.
 */
import { afterEach, describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { Server } from "@/server/server"
import { SessionPaths } from "@/server/routes/instance/httpapi/groups/session"
import { Session } from "@/session/session"
import { Storage } from "@/storage/storage"
import { resetDatabase } from "../fixture/db"
import { disposeAllInstances, TestInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import * as Log from "@opencode-ai/core/util/log"

void Log.init({ print: false })

const it = testEffect(Layer.mergeAll(Session.defaultLayer, Storage.defaultLayer))

afterEach(async () => {
  await disposeAllInstances()
  await resetDatabase()
})

function pathFor(template: string, params: Record<string, string>) {
  return Object.entries(params).reduce((result, [key, value]) => result.replace(`:${key}`, value), template)
}

const withSession = (input?: Parameters<Session.Interface["create"]>[0]) =>
  Effect.acquireRelease(
    Session.Service.use((session) => session.create(input)),
    (created) => Session.Service.use((session) => session.remove(created.id)).pipe(Effect.ignore),
  )

describe("session diff with missing patch (#26574)", () => {
  it.instance(
    "GET /session/<id>/diff returns 200 when summary_diffs row has no patch",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const session = yield* withSession({ title: "missing-patch" })

        // Mimic legacy/imported on-disk shape: a diff entry with no
        // `patch` text. Pre-fix the typed response encoder rejects
        // this and returns 400.
        yield* Storage.Service.use((storage) =>
          storage.write(["session_diff", session.id], [{ file: "legacy.txt", additions: 1, deletions: 0 }]),
        )

        const response = yield* Effect.promise(() =>
          Promise.resolve(
            Server.Default().app.request(pathFor(SessionPaths.diff, { sessionID: session.id }), {
              headers: { "x-opencode-directory": test.directory },
            }),
          ),
        )

        expect(response.status).toBe(200)
        const body = (yield* Effect.promise(() => response.json())) as Array<{
          file: string
          patch?: string
          additions: number
        }>
        expect(body).toHaveLength(1)
        expect(body[0]?.file).toBe("legacy.txt")
        expect(body[0]?.additions).toBe(1)
        expect(body[0]?.patch).toBeUndefined()
      }),
    { git: true, config: { formatter: false, lsp: false } },
  )
})
