import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { Credential } from "@opencode-ai/core/credential"
import { Database } from "@opencode-ai/core/database/database"
import { LayerNode } from "@opencode-ai/util/effect/layer-node"
import { Integration } from "@opencode-ai/core/integration"
import { testEffect } from "./lib/effect"
import { tmpdir } from "./fixture/tmpdir"
import path from "path"

const it = testEffect(Layer.empty)
const credentialLayer = LayerNode.compile(Credential.node)

describe("Credential", () => {
  it.effect("stores, updates, lists, and removes credentials", () =>
    Effect.gen(function* () {
      const credentials = yield* Credential.Service
      const integrationID = Integration.ID.make("openai")
      const created = yield* credentials.create({
        integrationID,
        label: "Work",
        value: Credential.Key.make({ type: "key", key: "secret" }),
      })

      expect(yield* credentials.list(integrationID)).toEqual([created])
      yield* credentials.update(created.id, { label: "Personal" })
      expect((yield* credentials.list(integrationID))[0]?.label).toBe("Personal")

      const replacement = yield* credentials.create({
        integrationID,
        label: "Replacement",
        value: Credential.Key.make({ type: "key", key: "replacement" }),
      })
      expect(yield* credentials.list(integrationID)).toEqual([replacement])

      yield* credentials.remove(replacement.id)
      expect(yield* credentials.list(integrationID)).toEqual([])
    }).pipe(Effect.provide(credentialLayer)),
  )

  it.effect("imports a read-only credential snapshot", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir("opencode-credential-snapshot-")),
      (directory) => Effect.promise(() => directory[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((directory) => {
        const filename = path.join(directory.path, "source.sqlite")
        const source = LayerNode.compile(Credential.node, [[Database.node, Database.configured({ path: filename })]])
        const keyIntegration = Integration.ID.make("openai")
        const oauthIntegration = Integration.ID.make("github-copilot")
        return Effect.gen(function* () {
          yield* Effect.gen(function* () {
            const credentials = yield* Credential.Service
            yield* credentials.create({
              integrationID: keyIntegration,
              value: Credential.Key.make({ type: "key", key: "secret" }),
            })
            yield* credentials.create({
              integrationID: oauthIntegration,
              value: Credential.OAuth.make({
                type: "oauth",
                methodID: Integration.MethodID.make("oauth"),
                access: "access",
                refresh: "refresh",
                expires: 1,
              }),
            })
          }).pipe(Effect.provide(source), Effect.scoped)

          yield* Effect.gen(function* () {
            yield* Credential.importFromDatabase({ path: filename })
            const credentials = yield* Credential.Service
            expect((yield* credentials.list(keyIntegration))[0]?.value).toEqual(
              Credential.Key.make({ type: "key", key: "secret" }),
            )
            expect((yield* credentials.list(oauthIntegration))[0]?.value).toEqual(
              Credential.OAuth.make({
                type: "oauth",
                methodID: Integration.MethodID.make("oauth"),
                access: "access",
                refresh: "",
                expires: 8640000000000000,
              }),
            )
          }).pipe(Effect.provide(LayerNode.compile(LayerNode.group([Credential.node, Database.node]))), Effect.scoped)
        })
      }),
    ),
  )
})
