import { describe, expect } from "bun:test"
import { Duration, Effect, Exit, Layer, Scope } from "effect"
import * as TestClock from "effect/testing/TestClock"
import { Integration } from "@opencode-ai/core/integration"
import { IntegrationConnection } from "@opencode-ai/core/integration/connection"
import { Credential } from "@opencode-ai/core/credential"
import { EventV2 } from "@opencode-ai/core/event"
import { it } from "./lib/effect"

const layer = Integration.locationLayer.pipe(
  Layer.provide(EventV2.defaultLayer),
  Layer.provide(
    Layer.mock(Credential.Service)({
      create: () => Effect.die("unexpected credential creation"),
      list: () => Effect.succeed([]),
    }),
  ),
)

function connectionLayer(
  created: Array<{
    integrationID: Integration.ID
    label?: string
    value: Credential.Info
  }>,
) {
  return Integration.locationLayer.pipe(
    Layer.provide(EventV2.defaultLayer),
    Layer.provide(
      Layer.mock(Credential.Service)({
        create: (input) =>
          Effect.sync(() => {
            created.push(input)
            return new Credential.Stored({
              id: Credential.ID.create(),
              integrationID: input.integrationID,
              label: input.label ?? "default",
              value: input.value,
            })
          }),
        list: () => Effect.succeed([]),
      }),
    ),
  )
}

describe("Integration", () => {
  it.effect("registers integrations through the editor", () =>
    Effect.gen(function* () {
      const integrations = yield* Integration.Service
      const scope = yield* Scope.fork(yield* Scope.Scope)
      const openai = Integration.ID.make("openai")

      yield* integrations
        .update((editor) => editor.update(openai, (integration) => (integration.name = "OpenAI")))
        .pipe(Scope.provide(scope))
      expect(yield* integrations.get(openai)).toEqual(
        new Integration.Info({ id: openai, name: "OpenAI", methods: [], connections: [] }),
      )

      yield* Scope.close(scope, Exit.void)
      expect(yield* integrations.get(openai)).toBeUndefined()
    }).pipe(Effect.provide(layer)),
  )

  it.effect("reveals the previous registration when an override closes", () =>
    Effect.gen(function* () {
      const integrations = yield* Integration.Service
      const id = Integration.ID.make("openai")
      const first = yield* Scope.fork(yield* Scope.Scope)
      const second = yield* Scope.fork(yield* Scope.Scope)

      yield* integrations
        .update((editor) => editor.update(id, (integration) => (integration.name = "OpenAI")))
        .pipe(Scope.provide(first))
      yield* integrations
        .update((editor) => editor.update(id, (integration) => (integration.name = "OpenAI Override")))
        .pipe(Scope.provide(second))
      expect((yield* integrations.get(id))?.name).toBe("OpenAI Override")

      yield* Scope.close(second, Exit.void)
      expect((yield* integrations.get(id))?.name).toBe("OpenAI")
      expect((yield* integrations.list()).map((integration) => integration.id)).toEqual([id])
    }).pipe(Effect.provide(layer)),
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
        .update((editor) =>
          editor.method.update({
            integrationID,
            method: new Integration.OAuthMethod({ id: methodID, type: "oauth", label: "ChatGPT" }),
            authorize,
          }),
        )
        .pipe(Scope.provide(first))
      yield* integrations
        .update((editor) => {
          expect(editor.get(integrationID)).toEqual({ id: integrationID, name: "openai" })
          expect(editor.list()).toEqual([{ id: integrationID, name: "openai" }])
          expect(editor.method.list(integrationID)).toEqual([
            expect.objectContaining({ id: methodID, label: "ChatGPT" }),
          ])
          editor.method.update({
            integrationID,
            method: new Integration.OAuthMethod({ id: methodID, type: "oauth", label: "ChatGPT Override" }),
            authorize,
          })
        })
        .pipe(Scope.provide(second))

      expect((yield* integrations.get(integrationID))?.name).toBe("openai")
      expect((yield* integrations.get(integrationID))?.methods[0]).toMatchObject({ label: "ChatGPT Override" })

      yield* Scope.close(second, Exit.void)
      expect((yield* integrations.get(integrationID))?.methods[0]).toMatchObject({ label: "ChatGPT" })
      expect((yield* integrations.get(integrationID))?.methods).toEqual([expect.objectContaining({ id: methodID })])
    }).pipe(Effect.provide(layer)),
  )

  it.effect("connects with a key and stores the credential", () => {
    const created: Array<{
      integrationID: Integration.ID
      label?: string
      value: Credential.Info
    }> = []
    return Effect.gen(function* () {
      const integrations = yield* Integration.Service
      const integrationID = Integration.ID.make("openai")
      yield* integrations.update((editor) =>
        editor.method.update({
          integrationID,
          method: new Integration.KeyMethod({ type: "key", label: "API key" }),
        }),
      )

      yield* integrations.connect.key({
        integrationID,
        key: "secret",
        label: "Work",
      })

      expect(created).toEqual([
        {
          integrationID,
          label: "Work",
          value: new Credential.Key({ type: "key", key: "secret" }),
        },
      ])
    }).pipe(Effect.provide(connectionLayer(created)))
  })

  it.effect("completes code OAuth once and stores the credential", () => {
    const created: Array<{
      integrationID: Integration.ID
      label?: string
      value: Credential.Info
    }> = []
    return Effect.gen(function* () {
      const integrations = yield* Integration.Service
      const integrationID = Integration.ID.make("openai")
      const methodID = Integration.MethodID.make("chatgpt")
      yield* integrations.update((editor) =>
        editor.method.update({
          integrationID,
          method: new Integration.OAuthMethod({ id: methodID, type: "oauth", label: "ChatGPT" }),
          authorize: () =>
            Effect.succeed({
              mode: "code" as const,
              url: "https://example.com/authorize",
              instructions: "Paste the code",
              callback: (code: string) =>
                Effect.succeed(
                  new Credential.OAuth({
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

      const attempt = yield* integrations.connect.oauth({
        integrationID,
        methodID,
        inputs: {},
        label: "Personal",
      })
      expect(attempt.mode).toBe("code")
      yield* integrations.attempt.complete({ attemptID: attempt.attemptID, code: "1234" })

      expect(created[0]).toEqual({
        integrationID,
        label: "Personal",
        value: new Credential.OAuth({
          type: "oauth",
          methodID,
          access: "access",
          refresh: "refresh",
          expires: 1,
          metadata: { code: "1234" },
        }),
      })
    }).pipe(Effect.provide(connectionLayer(created)))
  })

  it.effect("keeps code attempts open when the code is missing and closes them on cancel", () => {
    const created: Array<{
      integrationID: Integration.ID
      label?: string
      value: Credential.Info
    }> = []
    return Effect.gen(function* () {
      const integrations = yield* Integration.Service
      const integrationID = Integration.ID.make("openai")
      const methodID = Integration.MethodID.make("chatgpt")
      let closed = false
      yield* integrations.update((editor) =>
        editor.method.update({
          integrationID,
          method: new Integration.OAuthMethod({ id: methodID, type: "oauth", label: "ChatGPT" }),
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

      const attempt = yield* integrations.connect.oauth({ integrationID, methodID, inputs: {} })
      expect(yield* integrations.attempt.complete({ attemptID: attempt.attemptID }).pipe(Effect.flip)).toBeInstanceOf(
        Integration.CodeRequiredError,
      )
      expect(closed).toBe(false)
      yield* integrations.attempt.cancel(attempt.attemptID)
      expect(closed).toBe(true)
      expect(created).toEqual([])
    }).pipe(Effect.provide(connectionLayer(created)))
  })

  it.effect("completes auto OAuth in the background", () => {
    const created: Array<{
      integrationID: Integration.ID
      label?: string
      value: Credential.Info
    }> = []
    return Effect.gen(function* () {
      const integrations = yield* Integration.Service
      const integrationID = Integration.ID.make("openai")
      const methodID = Integration.MethodID.make("browser")
      yield* integrations.update((editor) =>
        editor.method.update({
          integrationID,
          method: new Integration.OAuthMethod({ id: methodID, type: "oauth", label: "Browser" }),
          authorize: () =>
            Effect.succeed({
              mode: "auto" as const,
              url: "https://example.com/authorize",
              instructions: "Sign in",
              callback: Effect.succeed(
                new Credential.OAuth({ type: "oauth", methodID, access: "access", refresh: "refresh", expires: 1 }),
              ),
            }),
        }),
      )

      const attempt = yield* integrations.connect.oauth({ integrationID, methodID, inputs: {} })
      yield* Effect.yieldNow
      expect(yield* integrations.attempt.status(attempt.attemptID)).toEqual({
        status: "complete",
        time: attempt.time,
      })
      expect(created).toHaveLength(1)
    }).pipe(Effect.provide(connectionLayer(created)))
  })

  it.effect("expires abandoned OAuth attempts", () => {
    const created: Array<{
      integrationID: Integration.ID
      label?: string
      value: Credential.Info
    }> = []
    return Effect.gen(function* () {
      const integrations = yield* Integration.Service
      const integrationID = Integration.ID.make("openai")
      const methodID = Integration.MethodID.make("browser")
      let closed = false
      yield* integrations.update((editor) =>
        editor.method.update({
          integrationID,
          method: new Integration.OAuthMethod({ id: methodID, type: "oauth", label: "Browser" }),
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

      const attempt = yield* integrations.connect.oauth({ integrationID, methodID, inputs: {} })
      expect(attempt.time.expires - attempt.time.created).toBe(Duration.toMillis(Duration.minutes(10)))
      yield* TestClock.adjust(Duration.minutes(10))
      yield* Effect.yieldNow
      expect(yield* integrations.attempt.status(attempt.attemptID)).toEqual({
        status: "expired",
        time: attempt.time,
      })
      expect(closed).toBe(true)
      expect(created).toEqual([])
    }).pipe(Effect.provide(connectionLayer(created)))
  })

  it.effect("projects credential and env connections", () => {
    const integrationID = Integration.ID.make("acme")
    const rows = [
      {
        id: Credential.ID.create(),
        integrationID,
        label: "Work",
        value: new Credential.Key({ type: "key", key: "a" }),
      },
      {
        id: Credential.ID.create(),
        integrationID,
        label: "Personal",
        value: new Credential.Key({ type: "key", key: "b" }),
      },
    ]
    const projectionLayer = Integration.locationLayer.pipe(
      Layer.provide(EventV2.defaultLayer),
      Layer.provide(
        Layer.mock(Credential.Service)({
          list: () => Effect.succeed(rows.map((row) => new Credential.Stored(row))),
        }),
      ),
    )
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
          yield* integrations.update((editor) =>
            editor.method.update({
              integrationID,
              method: new Integration.EnvMethod({
                type: "env",
                names: ["INTEGRATION_TEST_ACME_KEY", "INTEGRATION_TEST_ACME_MISSING"],
              }),
            }),
          )

          // Stored credentials and detected env vars appear as connections.
          expect((yield* integrations.get(integrationID))?.connections).toEqual([
            new IntegrationConnection.CredentialInfo({ type: "credential", id: rows[0]!.id, label: "Work" }),
            new IntegrationConnection.CredentialInfo({
              type: "credential",
              id: rows[1]!.id,
              label: "Personal",
            }),
            new IntegrationConnection.EnvInfo({ type: "env", name: "INTEGRATION_TEST_ACME_KEY" }),
          ])
        }).pipe(Effect.provide(projectionLayer)),
      (previous) =>
        Effect.sync(() => {
          if (previous === undefined) delete process.env.INTEGRATION_TEST_ACME_KEY
          else process.env.INTEGRATION_TEST_ACME_KEY = previous
        }),
    )
  })
})
