import { describe, expect } from "bun:test"
import { Duration, Effect, Exit, Layer, Scope } from "effect"
import * as TestClock from "effect/testing/TestClock"
import { Connector } from "@opencode-ai/core/connector"
import { Credential } from "@opencode-ai/core/credential"
import { EventV2 } from "@opencode-ai/core/event"
import { it } from "./lib/effect"

const layer = Connector.locationLayer.pipe(
  Layer.provide(EventV2.defaultLayer),
  Layer.provide(
    Layer.mock(Credential.Service)({
      create: () => Effect.die("unexpected credential creation"),
    }),
  ),
)

function connectionLayer(
  created: Array<{
    connectorID: Connector.ID
    methodID: Connector.MethodID
    label?: string
    value: Credential.Value
  }>,
) {
  return Connector.locationLayer.pipe(
    Layer.provide(EventV2.defaultLayer),
    Layer.provide(
      Layer.mock(Credential.Service)({
        create: (input) =>
          Effect.sync(() => {
            created.push(input)
            return new Credential.Info({ id: Credential.ID.create(), ...input, label: input.label ?? "default" })
          }),
      }),
    ),
  )
}

describe("Connector", () => {
  it.effect("registers connectors through the editor", () =>
    Effect.gen(function* () {
      const connectors = yield* Connector.Service
      const scope = yield* Scope.fork(yield* Scope.Scope)
      const openai = Connector.ID.make("openai")

      yield* connectors
        .update((editor) => editor.update(openai, (connector) => (connector.name = "OpenAI")))
        .pipe(Scope.provide(scope))
      expect(yield* connectors.get(openai)).toEqual(new Connector.Info({ id: openai, name: "OpenAI", methods: [] }))

      yield* Scope.close(scope, Exit.void)
      expect(yield* connectors.get(openai)).toBeUndefined()
    }).pipe(Effect.provide(layer)),
  )

  it.effect("reveals the previous registration when an override closes", () =>
    Effect.gen(function* () {
      const connectors = yield* Connector.Service
      const id = Connector.ID.make("openai")
      const first = yield* Scope.fork(yield* Scope.Scope)
      const second = yield* Scope.fork(yield* Scope.Scope)

      yield* connectors
        .update((editor) => editor.update(id, (connector) => (connector.name = "OpenAI")))
        .pipe(Scope.provide(first))
      yield* connectors
        .update((editor) => editor.update(id, (connector) => (connector.name = "OpenAI Override")))
        .pipe(Scope.provide(second))
      expect((yield* connectors.get(id))?.name).toBe("OpenAI Override")

      yield* Scope.close(second, Exit.void)
      expect((yield* connectors.get(id))?.name).toBe("OpenAI")
      expect((yield* connectors.list()).map((connector) => connector.id)).toEqual([id])
    }).pipe(Effect.provide(layer)),
  )

  it.effect("registers and overrides methods independently", () =>
    Effect.gen(function* () {
      const connectors = yield* Connector.Service
      const connectorID = Connector.ID.make("openai")
      const methodID = Connector.MethodID.make("chatgpt")
      const first = yield* Scope.fork(yield* Scope.Scope)
      const second = yield* Scope.fork(yield* Scope.Scope)
      const authorize = () =>
        Effect.succeed({
          mode: "auto" as const,
          url: "https://example.com/authorize",
          instructions: "Sign in",
          callback: Effect.never,
        })

      yield* connectors
        .update((editor) =>
          editor.method.update({
            connectorID,
            method: new Connector.OAuthMethod({ id: methodID, type: "oauth", label: "ChatGPT" }),
            authorize,
          }),
        )
        .pipe(Scope.provide(first))
      yield* connectors
        .update((editor) =>
          editor.method.update({
            connectorID,
            method: new Connector.OAuthMethod({ id: methodID, type: "oauth", label: "ChatGPT Override" }),
            authorize,
          }),
        )
        .pipe(Scope.provide(second))

      expect((yield* connectors.get(connectorID))?.name).toBe("openai")
      expect((yield* connectors.get(connectorID))?.methods[0]?.label).toBe("ChatGPT Override")

      yield* Scope.close(second, Exit.void)
      expect((yield* connectors.get(connectorID))?.methods[0]?.label).toBe("ChatGPT")
      expect((yield* connectors.get(connectorID))?.methods.map((method) => method.id)).toEqual([methodID])
    }).pipe(Effect.provide(layer)),
  )

  it.effect("connects with a key and stores the credential", () => {
    const created: Array<{
      connectorID: Connector.ID
      methodID: Connector.MethodID
      label?: string
      value: Credential.Value
    }> = []
    return Effect.gen(function* () {
      const connectors = yield* Connector.Service
      const connectorID = Connector.ID.make("openai")
      const methodID = Connector.MethodID.make("api-key")
      yield* connectors.update((editor) =>
        editor.method.update({
          connectorID,
          method: new Connector.KeyMethod({ id: methodID, type: "key", label: "API key" }),
          authorize: (key, inputs) =>
            Effect.succeed(
              new Credential.Key({ type: "key", key, metadata: { organization: inputs.organization ?? "" } }),
            ),
        }),
      )

      yield* connectors.connect.key({
        connectorID,
        methodID,
        key: "secret",
        inputs: { organization: "acme" },
        label: "Work",
      })

      expect(created).toEqual([
        {
          connectorID,
          methodID,
          label: "Work",
          value: new Credential.Key({ type: "key", key: "secret", metadata: { organization: "acme" } }),
        },
      ])
    }).pipe(Effect.provide(connectionLayer(created)))
  })

  it.effect("refreshes OAuth with the originating method", () => {
    const connectorID = Connector.ID.make("openai")
    const methodID = Connector.MethodID.make("chatgpt")
    const credentialID = Credential.ID.create()
    const current = new Credential.OAuth({
      type: "oauth",
      access: "old-access",
      refresh: "old-refresh",
      expires: 1,
      metadata: { accountID: "account" },
    })
    const updated: Array<{ id: Credential.ID; value: Credential.Value }> = []
    const refreshLayer = Connector.locationLayer.pipe(
      Layer.provide(EventV2.defaultLayer),
      Layer.provide(
        Layer.mock(Credential.Service)({
          get: () =>
            Effect.succeed(
              new Credential.Info({
                id: credentialID,
                connectorID,
                methodID,
                label: "Personal",
                value: current,
              }),
            ),
          update: (id, input) =>
            Effect.sync(() => {
              if (input.value) updated.push({ id, value: input.value })
            }),
        }),
      ),
    )

    return Effect.gen(function* () {
      const connectors = yield* Connector.Service
      yield* connectors.update((editor) =>
        editor.method.update({
          connectorID,
          method: new Connector.OAuthMethod({ id: methodID, type: "oauth", label: "ChatGPT" }),
          authorize: () => Effect.die("unexpected authorization"),
          refresh: (value) =>
            Effect.succeed(
              new Credential.OAuth({
                type: "oauth",
                access: "new-access",
                refresh: "new-refresh",
                expires: 2,
                metadata: value.metadata,
              }),
            ),
        }),
      )

      yield* connectors.refresh(credentialID)
      expect(updated).toEqual([
        {
          id: credentialID,
          value: new Credential.OAuth({
            type: "oauth",
            access: "new-access",
            refresh: "new-refresh",
            expires: 2,
            metadata: { accountID: "account" },
          }),
        },
      ])
    }).pipe(Effect.provide(refreshLayer))
  })

  it.effect("completes code OAuth once and stores the credential", () => {
    const created: Array<{
      connectorID: Connector.ID
      methodID: Connector.MethodID
      label?: string
      value: Credential.Value
    }> = []
    return Effect.gen(function* () {
      const connectors = yield* Connector.Service
      const connectorID = Connector.ID.make("openai")
      const methodID = Connector.MethodID.make("chatgpt")
      yield* connectors.update((editor) =>
        editor.method.update({
          connectorID,
          method: new Connector.OAuthMethod({ id: methodID, type: "oauth", label: "ChatGPT" }),
          authorize: () =>
            Effect.succeed({
              mode: "code" as const,
              url: "https://example.com/authorize",
              instructions: "Paste the code",
              callback: (code: string) =>
                Effect.succeed(
                  new Credential.OAuth({
                    type: "oauth",
                    access: "access",
                    refresh: "refresh",
                    expires: 1,
                    metadata: { code },
                  }),
                ),
            }),
        }),
      )

      const attempt = yield* connectors.connect.oauth.begin({ connectorID, methodID, inputs: {}, label: "Personal" })
      expect(attempt.mode).toBe("code")
      yield* connectors.connect.oauth.complete({ attemptID: attempt.attemptID, code: "1234" })

      expect(created[0]).toEqual({
        connectorID,
        methodID,
        label: "Personal",
        value: new Credential.OAuth({
          type: "oauth",
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
      connectorID: Connector.ID
      methodID: Connector.MethodID
      label?: string
      value: Credential.Value
    }> = []
    return Effect.gen(function* () {
      const connectors = yield* Connector.Service
      const connectorID = Connector.ID.make("openai")
      const methodID = Connector.MethodID.make("chatgpt")
      let closed = false
      yield* connectors.update((editor) =>
        editor.method.update({
          connectorID,
          method: new Connector.OAuthMethod({ id: methodID, type: "oauth", label: "ChatGPT" }),
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

      const attempt = yield* connectors.connect.oauth.begin({ connectorID, methodID, inputs: {} })
      expect(
        yield* connectors.connect.oauth.complete({ attemptID: attempt.attemptID }).pipe(Effect.flip),
      ).toBeInstanceOf(Connector.CodeRequiredError)
      expect(closed).toBe(false)
      yield* connectors.connect.oauth.cancel(attempt.attemptID)
      expect(closed).toBe(true)
      expect(created).toEqual([])
    }).pipe(Effect.provide(connectionLayer(created)))
  })

  it.effect("completes auto OAuth in the background", () => {
    const created: Array<{
      connectorID: Connector.ID
      methodID: Connector.MethodID
      label?: string
      value: Credential.Value
    }> = []
    return Effect.gen(function* () {
      const connectors = yield* Connector.Service
      const connectorID = Connector.ID.make("openai")
      const methodID = Connector.MethodID.make("browser")
      yield* connectors.update((editor) =>
        editor.method.update({
          connectorID,
          method: new Connector.OAuthMethod({ id: methodID, type: "oauth", label: "Browser" }),
          authorize: () =>
            Effect.succeed({
              mode: "auto" as const,
              url: "https://example.com/authorize",
              instructions: "Sign in",
              callback: Effect.succeed(
                new Credential.OAuth({ type: "oauth", access: "access", refresh: "refresh", expires: 1 }),
              ),
            }),
        }),
      )

      const attempt = yield* connectors.connect.oauth.begin({ connectorID, methodID, inputs: {} })
      yield* Effect.yieldNow
      expect(yield* connectors.connect.oauth.status(attempt.attemptID)).toEqual({
        status: "complete",
        time: attempt.time,
      })
      expect(created).toHaveLength(1)
    }).pipe(Effect.provide(connectionLayer(created)))
  })

  it.effect("expires abandoned OAuth attempts", () => {
    const created: Array<{
      connectorID: Connector.ID
      methodID: Connector.MethodID
      label?: string
      value: Credential.Value
    }> = []
    return Effect.gen(function* () {
      const connectors = yield* Connector.Service
      const connectorID = Connector.ID.make("openai")
      const methodID = Connector.MethodID.make("browser")
      let closed = false
      yield* connectors.update((editor) =>
        editor.method.update({
          connectorID,
          method: new Connector.OAuthMethod({ id: methodID, type: "oauth", label: "Browser" }),
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

      const attempt = yield* connectors.connect.oauth.begin({ connectorID, methodID, inputs: {} })
      expect(attempt.time.expires - attempt.time.created).toBe(Duration.toMillis(Duration.minutes(10)))
      yield* TestClock.adjust(Duration.minutes(10))
      yield* Effect.yieldNow
      expect(yield* connectors.connect.oauth.status(attempt.attemptID)).toEqual({
        status: "expired",
        time: attempt.time,
      })
      expect(closed).toBe(true)
      expect(created).toEqual([])
    }).pipe(Effect.provide(connectionLayer(created)))
  })
})
