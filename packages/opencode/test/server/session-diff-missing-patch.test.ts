/**
 * Regression test for the same bug class as #26574 (sibling of #26566 and
 * #26553). The Desktop app calls GET /session/<id>/diff; before #26574
 * the response was Schema-encoded against `Snapshot.FileDiff` with
 * `patch: Schema.String` (required), so any session whose stored
 * `summary_diffs` had a row without `patch` returned HTTP 400 and the
 * session never loaded. Legacy session-level diffs are no longer surfaced,
 * but the endpoint remains compatible and must still return successfully.
 *
 * This test inserts a session row with a missing-patch diff entry and
 * asserts that GET /session/<id>/diff returns 200 with empty data.
 */
import { afterEach, describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { SessionPaths } from "@/server/routes/instance/httpapi/groups/session"
import { Session } from "@/session/session"
import { Storage } from "@/storage/storage"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { MessageID } from "@/session/schema"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import { resetDatabase } from "../fixture/db"
import { disposeAllInstances, TestInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import * as Log from "@opencode-ai/core/util/log"
import { httpApiLayer, requestInDirectory } from "./httpapi-layer"

void Log.init({ print: false })

const it = testEffect(Layer.mergeAll(Session.defaultLayer, Storage.defaultLayer, httpApiLayer))

afterEach(async () => {
  await disposeAllInstances()
  await resetDatabase()
})

function pathFor(template: string, params: Record<string, string>) {
  return Object.entries(params).reduce((result, [key, value]) => result.replace(`:${key}`, value), template)
}

const withSession = (input?: Parameters<Session.Interface["create"]>[0]) =>
  Effect.acquireRelease(Session.use.create(input), (created) => Session.use.remove(created.id).pipe(Effect.ignore))

describe("session diff with missing patch (#26574)", () => {
  it.instance(
    "GET /session/<id>/diff ignores legacy session-level diff storage",
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

        const response = yield* requestInDirectory(
          pathFor(SessionPaths.diff, { sessionID: session.id }),
          test.directory,
        )

        expect(response.status).toBe(200)
        expect(yield* response.json).toEqual([])
      }),
    { git: true, config: { formatter: false, lsp: false } },
  )

  it.instance(
    "GET /session/<id>/diff returns requested turn diffs",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const session = yield* withSession({ title: "turn-diff" })
        const messageID = MessageID.ascending()
        yield* Session.use.updateMessage({
          id: messageID,
          sessionID: session.id,
          role: "user",
          time: { created: Date.now() },
          agent: "build",
          model: { providerID: ProviderV2.ID.make("test"), modelID: ModelV2.ID.make("model") },
          summary: {
            diffs: [{ file: "turn.ts", additions: 1, deletions: 0, status: "modified" }],
          },
        } satisfies SessionV1.User)

        const response = yield* requestInDirectory(
          `${pathFor(SessionPaths.diff, { sessionID: session.id })}?messageID=${messageID}`,
          test.directory,
        )

        expect(response.status).toBe(200)
        expect(yield* response.json).toEqual([{ file: "turn.ts", additions: 1, deletions: 0, status: "modified" }])
      }),
    { git: true, config: { formatter: false, lsp: false } },
  )
})
