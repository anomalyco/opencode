import { afterEach, describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { Permission } from "../../src/permission"
import { PermissionID } from "../../src/permission/schema"
import { SessionID } from "../../src/session/schema"
import { disposeAllInstances, TestInstance } from "../fixture/fixture"
import { resetDatabase } from "../fixture/db"
import { pollWithTimeout, testEffectShared } from "../lib/effect"
import { httpApiLayer, requestInDirectory } from "./httpapi-layer"

const it = testEffectShared(Layer.mergeAll(Permission.defaultLayer, httpApiLayer))

afterEach(async () => {
  await disposeAllInstances()
  await resetDatabase()
})

describe("permission HttpApi", () => {
  it.instance(
    "lists pending apply_patch file metadata without response-body schema rejection",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const permission = yield* Permission.Service
        const requestID = PermissionID.ascending()
        const sessionID = SessionID.make("ses_httpapi_permission_patch")
        const shared = { source: "shared" }
        const metadata = {
          filepath: "example.txt",
          diff: "--- example.txt\n+++ example.txt\n@@\n+hello\n",
          timeout: "not-a-number",
          line: "not-a-line",
          score: Number.POSITIVE_INFINITY,
          first: shared,
          second: shared,
          input: { count: Number.POSITIVE_INFINITY, shared },
          files: [
            {
              filePath: `${test.directory}/example.txt`,
              relativePath: "example.txt",
              type: "add",
              patch: "--- example.txt\n+++ example.txt\n@@\n+hello\n",
              additions: 1,
              deletions: 0,
              movePath: undefined,
            },
          ],
        }
        const expectedMetadata = {
          filepath: "example.txt",
          diff: "--- example.txt\n+++ example.txt\n@@\n+hello\n",
          input: { count: null, shared },
          files: [
            {
              filePath: `${test.directory}/example.txt`,
              relativePath: "example.txt",
              type: "add",
              patch: "--- example.txt\n+++ example.txt\n@@\n+hello\n",
              additions: 1,
              deletions: 0,
            },
          ],
        }

        yield* permission
          .ask({
            id: requestID,
            sessionID,
            permission: "edit",
            patterns: ["example.txt"],
            metadata,
            always: ["*"],
            ruleset: [],
          })
          .pipe(Effect.forkScoped)

        yield* pollWithTimeout(
          permission.list().pipe(Effect.map((pending) => (pending.length === 1 ? pending : undefined))),
          "timed out waiting for pending permission",
        )

        const res = yield* requestInDirectory(
          `/permission?directory=${encodeURIComponent(test.directory)}`,
          test.directory,
        )
        const body = JSON.parse(yield* res.text)

        expect(res.status).toBe(200)
        expect(body).toEqual([
          {
            id: requestID,
            sessionID,
            permission: "edit",
            patterns: ["example.txt"],
            metadata: expectedMetadata,
            always: ["*"],
            tool: null,
          },
        ])
        expect(body[0].metadata.files[0]).not.toHaveProperty("movePath")
        expect(body[0].metadata).not.toHaveProperty("score")
        expect(body[0].metadata).not.toHaveProperty("first")
        expect(body[0].metadata).not.toHaveProperty("second")
        expect(body[0].metadata).not.toHaveProperty("timeout")
        expect(body[0].metadata).not.toHaveProperty("line")

        yield* permission.reply({ requestID, reply: "reject" })
      }),
    { git: true, config: { formatter: false, lsp: false } },
  )
})
