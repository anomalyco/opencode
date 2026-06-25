import { describe, expect } from "bun:test"
import { Duration, Effect, Exit, Fiber, Layer, Scope, Stream } from "effect"
import * as TestClock from "effect/testing/TestClock"
import { Integration } from "@opencode-ai/core/integration"
import { Credential } from "@opencode-ai/core/credential"
import { EventV2 } from "@opencode-ai/core/event"
import { testEffect } from "./lib/effect"

const it = testEffect(
  Integration.locationLayer.pipe(Layer.provideMerge(Credential.defaultLayer), Layer.provideMerge(EventV2.defaultLayer)),
)

describe("Integration", () => {
  it.effect("registers integrations through the editor", () =>
    Effect.gen(function* () {
      const integrations = yield* Integration.Service
      const scope = yield* Scope.fork(yield* Scope.Scope)
      const openai = Integration.ID.make("openai")

      yield* integrations
        .transform((editor) => editor.update(openai, (integration) => (integration.name = "OpenAI")))
        .pipe(Scope.provide(scope))
      expect(yield* integrations.get(openai)).toEqual(
        new Integration.Info({ id: openai, name: "OpenAI", methods: [], connections: [] }),
      )

      yield* Scope.close(scope, Exit.void)
      expect(yield* integrations.get(openai)).toBeUndefined()
    }),
  )

  it.effect("reveals the previous registration when an override closes", () =>
    Effect.gen(function* () {
      const integrations = yield* Integration.Service
      const id = Integration.ID.make("openai")
      const first = yield* Scope.fork(yield* Scope.Scope)
      const second = yield* Scope.fork(yield* Scope.Scope)

      yield* integrations
        .transform((editor) => editor.update(id, (integration) => (integration.name = "OpenAI")))
        .pipe(Scope.provide(first))
      yield* integrations
        .transform((editor) => editor.update(id, (integration) => (integration.name = "OpenAI Override")))
        .pipe(Scope.provide(second))
      expect((yield* integrations.get(id))?.name).toBe("OpenAI Override")

      yield* Scope.close(second, Exit.void)
      expect((yield* integrations.get(id))?.name).toBe("OpenAI")
      expect((yield* integrations.list()).map((integration) => integration.id)).toEqual([id])
    }),
  )

  it.effect("registers and overrides methods independently", () =>
    Effect.gen(function* () {
      const integrations = yield* Integration.Service
      const integrationID = Integration.ID.make("openai")
      const methodID = Integration.MethodID.make("chatgpt")
      const first = yield* Scope.fork(yield* Scope.Scope)
      const second = yield* Scope.fork(yield* Scope.Scope)
      const authorize = () =>
        Effect.succeed({
          mode: "auto" as const,
          url: "https://example.com/authorize",
          instructions: "Sign in",
          callback: Effect.never,
        })

      yield* integrations
        .transform((editor) =>
          editor.method.update({
            integrationID,
            method: { id: methodID, type: "oauth", label: "ChatGPT" },
            authorize,
          }),
        )
        .pipe(Scope.provide(first))
      yield* integrations
        .transform((editor) => {
          expect(editor.get(integrationID)).toEqual({ id: integrationID, name: "openai" })
          expect(editor.list()).toEqual([{ id: integrationID, name: "openai" }])
          expect(editor.method.list(integrationID)).toEqual([
            expect.objectContaining({ id: methodID, label: "ChatGPT" }),
          ])
          editor.method.update({
            integrationID,
            method: { id: methodID, type: "oauth", label: "ChatGPT Override" },
            authorize,
          })
        })
        .pipe(Scope.provide(second))

      expect((yield* integrations.get(integrationID))?.name).toBe("openai")
      expect((yield* integrations.get(integrationID))?.methods[0]).toMatchObject({ label: "ChatGPT Override" })

      yield* Scope.close(second, Exit.void)
      expect((yield* integrations.get(integrationID))?.methods[0]).toMatchObject({ label: "ChatGPT" })
      expect((yield* integrations.get(integrationID))?.methods).toEqual([expect.objectContaining({ id: methodID })])
    }),
  )

  it.effect("connects with a key and stores the credential", () =>
    Effect.gen(function* () {
      const integrations = yield* Integration.Service
      const credentials = yield* Credential.Service
      const events = yield* EventV2.Service
      const integrationID = Integration.ID.make("openai")
      yield* integrations.transform((editor) =>
        editor.method.update({
          integrationID,
          method: { type: "key", label: "API key" },
        }),
      )
      const updated = yield* events
        .subscribe(Integration.Event.Updated)
        .pipe(Stream.take(1), Stream.runCollect, Effect.forkScoped)
      yield* Effect.yieldNow

      yield* integrations.connection.key({
        integrationID,
        key: "secret",
        label: "Work",
      })

      expect(yield* credentials.list(integrationID)).toEqual([
        expect.objectContaining({
          integrationID,
          label: "Work",
          value: Credential.Key.make({ type: "key", key: "secret" }),
        }),
      ])
      expect((yield* Fiber.join(updated)).length).toBe(1)
    }),
  )

  it.effect("completes code OAuth once and stores the credential", () =>
    Effect.gen(function* () {
      const integrations = yield* Integration.Service
      const credentials = yield* Credential.Service
      const integrationID = Integration.ID.make("openai")
      const methodID = Integration.MethodID.make("chatgpt")
      yield* integrations.transform((editor) =>
        editor.method.update({
          integrationID,
          method: { id: methodID, type: "oauth", label: "ChatGPT" },
          authorize: () =>
            Effect.succeed({
              mode: "code" as const,
              url: "https://example.com/authorize",
              instructions: "Paste the code",
              callback: (code: string) =>
                Effect.succeed(
                  Credential.OAuth.make({
                    type: "oauth",
                    methodID,
                    access: "access",
                    refresh: "refresh",
                    expires: 1,
                    metadata: { code },
                  }),
                ),
            }),
        }),
      )

      const attempt = yield* integrations.connection.oauth({
        integrationID,
        methodID,
        inputs: {},
        label: "Personal",
      })
      expect(attempt.mode).toBe("code")
      yield* integrations.attempt.complete({ attemptID: attempt.attemptID, code: "1234" })

      expect((yield* credentials.list(integrationID))[0]).toEqual(
        expect.objectContaining({
          integrationID,
          label: "Personal",
          value: Credential.OAuth.make({
            type: "oauth",
            methodID,
            access: "access",
            refresh: "refresh",
            expires: 1,
            metadata: { code: "1234" },
          }),
        }),
      )
    }),
  )

  it.effect("keeps code attempts open when the code is missing and closes them on cancel", () =>
    Effect.gen(function* () {
      const integrations = yield* Integration.Service
      const credentials = yield* Credential.Service
      const integrationID = Integration.ID.make("openai")
      const methodID = Integration.MethodID.make("chatgpt")
      let closed = false
      yield* integrations.transform((editor) =>
        editor.method.update({
          integrationID,
          method: { id: methodID, type: "oauth", label: "ChatGPT" },
          authorize: () =>
            Effect.addFinalizer(() => Effect.sync(() => (closed = true))).pipe(
              Effect.as({
                mode: "code" as const,
                url: "https://example.com/authorize",
                instructions: "Paste the code",
                callback: () => Effect.die("unexpected callback"),
              }),
            ),
        }),
      )

      const attempt = yield* integrations.connection.oauth({ integrationID, methodID, inputs: {} })
      expect(yield* integrations.attempt.complete({ attemptID: attempt.attemptID }).pipe(Effect.flip)).toBeInstanceOf(
        Integration.CodeRequiredError,
      )
      expect(closed).toBe(false)
      yield* integrations.attempt.cancel(attempt.attemptID)
      expect(closed).toBe(true)
      expect(yield* credentials.list(integrationID)).toEqual([])
    }),
  )

  it.effect("completes auto OAuth in the background", () =>
    Effect.gen(function* () {
      const integrations = yield* Integration.Service
      const credentials = yield* Credential.Service
      const integrationID = Integration.ID.make("openai")
      const methodID = Integration.MethodID.make("browser")
      yield* integrations.transform((editor) =>
        editor.method.update({
          integrationID,
          method: { id: methodID, type: "oauth", label: "Browser" },
          authorize: () =>
            Effect.succeed({
              mode: "auto" as const,
              url: "https://example.com/authorize",
              instructions: "Sign in",
              callback: Effect.succeed(
                Credential.OAuth.make({ type: "oauth", methodID, access: "access", refresh: "refresh", expires: 1 }),
              ),
            }),
        }),
      )

      const attempt = yield* integrations.connection.oauth({ integrationID, methodID, inputs: {} })
      yield* Effect.yieldNow
      expect(yield* integrations.attempt.status(attempt.attemptID)).toEqual({
        status: "complete",
        time: attempt.time,
      })
      expect(yield* credentials.list(integrationID)).toHaveLength(1)
    }),
  )

  it.effect("expires abandoned OAuth attempts", () =>
    Effect.gen(function* () {
      const integrations = yield* Integration.Service
      const credentials = yield* Credential.Service
      const integrationID = Integration.ID.make("openai")
      const methodID = Integration.MethodID.make("browser")
      let closed = false
      yield* integrations.transform((editor) =>
        editor.method.update({
          integrationID,
          method: { id: methodID, type: "oauth", label: "Browser" },
          authorize: () =>
            Effect.addFinalizer(() => Effect.sync(() => (closed = true))).pipe(
              Effect.as({
                mode: "auto" as const,
                url: "https://example.com/authorize",
                instructions: "Sign in",
                callback: Effect.never,
              }),
            ),
        }),
      )

      const attempt = yield* integrations.connection.oauth({ integrationID, methodID, inputs: {} })
      expect(attempt.time.expires - attempt.time.created).toBe(Duration.toMillis(Duration.minutes(10)))
      yield* TestClock.adjust(Duration.minutes(10))
      yield* Effect.yieldNow
      expect(yield* integrations.attempt.status(attempt.attemptID)).toEqual({
        status: "expired",
        time: attempt.time,
      })
      expect(closed).toBe(true)
      expect(yield* credentials.list(integrationID)).toEqual([])
    }),
  )

  it.effect("projects credential and env connections", () => {
    const integrationID = Integration.ID.make("acme")
    return Effect.acquireUseRelease(
      Effect.sync(() => {
        const previous = process.env.INTEGRATION_TEST_ACME_KEY
        process.env.INTEGRATION_TEST_ACME_KEY = "secret"
        delete process.env.INTEGRATION_TEST_ACME_MISSING
        return previous
      }),
      () =>
        Effect.gen(function* () {
          const integrations = yield* Integration.Service
          const credentials = yield* Credential.Service
          yield* integrations.transform((editor) =>
            editor.method.update({
              integrationID,
              method: {
                type: "env",
                names: ["INTEGRATION_TEST_ACME_KEY", "INTEGRATION_TEST_ACME_MISSING"],
              },
            }),
          )
          const work = yield* credentials.create({
            integrationID,
            label: "Work",
            value: Credential.Key.make({ type: "key", key: "a" }),
          })
          const personal = yield* credentials.create({
            integrationID,
            label: "Personal",
            value: Credential.Key.make({ type: "key", key: "b" }),
          })

          // Stored credentials and detected env vars appear as connections.
          expect((yield* integrations.get(integrationID))?.connections).toEqual([
            {
              type: "credential",
              id: personal.id,
              label: "Personal",
            },
            { type: "env", name: "INTEGRATION_TEST_ACME_KEY" },
          ])
          expect(yield* integrations.connection.active(integrationID)).toEqual({
            type: "credential",
            id: personal.id,
            label: "Personal",
          })
          expect(work.id).not.toBe(personal.id)
        }),
      (previous) =>
        Effect.sync(() => {
          if (previous === undefined) delete process.env.INTEGRATION_TEST_ACME_KEY
          else process.env.INTEGRATION_TEST_ACME_KEY = previous
        }),
    )
  })
})
