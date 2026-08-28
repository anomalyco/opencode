import { describe, expect } from "bun:test"
import { Cause, Effect, Exit, Fiber } from "effect"
import { TestClock } from "effect/testing"
import { Credential } from "@opencode-ai/core/credential"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { Integration } from "@opencode-ai/core/integration"
import { LayerNode } from "@opencode-ai/util/effect/layer-node"
import { testEffect } from "./lib/effect"

const it = testEffect(AppNodeBuilder.build(LayerNode.group([Integration.node, Credential.node])))

describe("Integration replay", () => {
  it.effect("fails and closes an OAuth attempt when fresh implementation replay throws", () =>
    Effect.gen(function* () {
      const integrations = yield* Integration.Service
      const credentials = yield* Credential.Service
      const integrationID = Integration.ID.make("replay-test")
      const methodID = Integration.MethodID.make("code")
      const source = { fail: false, closed: false }
      const failure = new Error("integration transform replay failed")
      yield* integrations.transform((editor) => {
        if (source.fail) throw failure
        editor.method.update({
          integrationID,
          method: { id: methodID, type: "oauth", label: "Fixture" },
          authorize: () =>
            Effect.addFinalizer(() => Effect.sync(() => (source.closed = true))).pipe(
              Effect.as({
                mode: "code" as const,
                url: "https://example.com/authorize",
                instructions: "Enter the fixture code",
                callback: () =>
                  Effect.succeed(
                    Credential.OAuth.make({
                      type: "oauth",
                      methodID,
                      access: "dummy-access",
                      refresh: "dummy-refresh",
                      expires: Number.MAX_SAFE_INTEGER,
                    }),
                  ),
              }),
            ),
        })
      })

      const attempt = yield* integrations.oauth.connect({ integrationID, methodID, label: "Fixture" })
      source.fail = true
      const reload = yield* integrations.reload().pipe(Effect.exit, Effect.forkChild({ startImmediately: true }))
      yield* Effect.addFinalizer(() =>
        Effect.gen(function* () {
          source.fail = false
          yield* TestClock.adjust("500 millis")
          yield* Fiber.join(reload)
        }),
      )

      const exit = yield* integrations.oauth
        .complete({ integrationID, attemptID: attempt.attemptID, code: "dummy-code" })
        .pipe(Effect.exit)

      expect(exit).toMatchObject(Exit.die(failure))
      expect(Exit.isFailure(exit) && Cause.squash(exit.cause)).toBe(failure)
      expect(yield* integrations.oauth.status({ integrationID, attemptID: attempt.attemptID })).toEqual({
        status: "failed",
        message: failure.message,
        time: attempt.time,
      })
      expect(source.closed).toBe(true)
      expect(yield* credentials.list(integrationID)).toEqual([])
    }),
  )
})
