import { describe, expect, test } from "bun:test"
import { Cause, Clock, Deferred, Duration, Effect, Exit, Fiber, Layer, Schema, Scope, Stream } from "effect"
import { TestClock } from "effect/testing"
import { Credential } from "@opencode/core/credential"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Bus } from "@opencode/core/bus"
import { Integration } from "@opencode/core/integration"
import { State } from "@opencode/core/state"
import { testEffect } from "./lib/effect"

const it = testEffect(AppNodeBuilder.build(LayerNode.group([Integration.node, Credential.node, Bus.node])))
const failingCredentialNode = makeGlobalNode({
  service: Credential.Service,
  layer: Layer.succeed(
    Credential.Service,
    Credential.Service.of({
      all: () => Effect.succeed([]),
      list: () => Effect.succeed([]),
      get: () => Effect.undefined,
      create: () => Effect.die(new Error("credential persistence failed")),
      activate: () => Effect.void,
      update: () => Effect.void,
      remove: () => Effect.void,
    }),
  ),
  deps: [],
})
const failingIt = testEffect(
  AppNodeBuilder.build(LayerNode.group([Integration.node, Bus.node]), [Credential.node.replace(failingCredentialNode)]),
)

function eventually<A, E, R>(
  effect: Effect.Effect<A, E, R>,
  predicate: (value: A) => boolean,
  remaining = 1000,
): Effect.Effect<A, E | Error, R> {
  return Effect.gen(function* () {
    const value = yield* effect
    if (predicate(value)) return value
    if (remaining === 0) return yield* Effect.fail(new Error("Timed out waiting for value"))
    yield* Effect.promise(() => Bun.sleep(1))
    return yield* eventually(effect, predicate, remaining - 1)
  })
}

describe("Integration", () => {
  it.effect("registers integrations through the editor", () =>
    Effect.gen(function* () {
      const integrations = yield* Integration.Service
      const scope = yield* Scope.fork(yield* Scope.Scope)
      const openai = Integration.ID.make("openai")

      yield* integrations
        .transform((editor) =>
          editor.update(openai, (integration) => {
            integration.name = "OpenAI"
            integration.metadata = { source: "plugin", featured: true }
          }),
        )
        .pipe(Scope.provide(scope))
      expect(yield* integrations.get(openai)).toEqual(
        Integration.Info.make({
          id: openai,
          name: "OpenAI",
          metadata: { source: "plugin", featured: true },
          methods: [],
          connections: [],
        }),
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
      const bus = yield* Bus.Service
      const integrationID = Integration.ID.make("openai")
      yield* integrations.transform((editor) =>
        editor.method.update({
          integrationID,
          method: {
            type: "key",
            label: "API key",
            form: [{ type: "string", key: "accountId", title: "Account ID", required: true }],
          },
        }),
      )
      const created = yield* bus
        .subscribe([Credential.Event.Updated, Credential.Event.Switched])
        .pipe(Stream.take(2), Stream.runCollect, Effect.forkScoped)
      yield* Effect.yieldNow

      expect(
        yield* integrations.connection.key({ integrationID, key: "secret" }).pipe(
          Effect.flip,
          Effect.map((error) => error.cause),
        ),
      ).toEqual(expect.objectContaining({ message: "Missing required form field: accountId" }))

      yield* integrations.connection.key({
        integrationID,
        key: "secret",
        answer: { accountId: "account" },
        label: "Work",
      })

      const stored = yield* credentials.list(integrationID)
      expect(stored).toEqual([
        expect.objectContaining({
          integrationID,
          label: "Work",
          value: Credential.Key.make({ type: "key", key: "secret", configuration: { accountId: "account" } }),
        }),
      ])
      expect((yield* Fiber.join(created)).map((event) => ({ type: event.type, data: event.data }))).toEqual([
        { type: Credential.Event.Updated.type, data: {} },
        { type: Credential.Event.Switched.type, data: { credentialID: stored[0]?.id, integrationID } },
      ])
    }),
  )

  it.effect("names unlabeled credentials after the integration", () =>
    Effect.gen(function* () {
      const integrations = yield* Integration.Service
      const credentials = yield* Credential.Service
      const integrationID = Integration.ID.make("openai")
      yield* integrations.transform((editor) => {
        editor.update(integrationID, (integration) => (integration.name = "OpenAI"))
        editor.method.update({ integrationID, method: { type: "key", label: "API key" } })
      })

      yield* integrations.connection.key({ integrationID, key: "first" })
      yield* integrations.connection.key({ integrationID, key: "second" })
      yield* integrations.connection.key({ integrationID, key: "work", label: "Work" })
      yield* integrations.connection.key({ integrationID, key: "third" })

      expect((yield* credentials.list(integrationID)).map((credential) => credential.label)).toEqual([
        "OpenAI",
        "OpenAI 2",
        "Work",
        "OpenAI 3",
      ])
    }),
  )

  it.live("runs command authentication and stores the final output line", () =>
    Effect.gen(function* () {
      const integrations = yield* Integration.Service
      const credentials = yield* Credential.Service
      const integrationID = Integration.ID.make("company")
      const methodID = Integration.MethodID.make("login")
      yield* integrations.transform((editor) =>
        editor.method.update({
          integrationID,
          method: {
            id: methodID,
            type: "command",
            label: "Log in",
            command: [
              process.execPath,
              "-e",
              'console.error("https://example.com/login"); await Bun.sleep(50); console.log("secret")',
            ],
          },
        }),
      )

      const attempt = yield* integrations.command.connect({ integrationID, methodID, label: "Work" })
      const pending = yield* eventually(
        integrations.command.status({ integrationID, attemptID: attempt.attemptID }),
        (status) => status.status === "pending" && status.message?.includes("https://example.com/login") === true,
      )
      expect(pending).toMatchObject({ status: "pending", message: "https://example.com/login\n" })

      expect(
        yield* eventually(
          integrations.command.status({ integrationID, attemptID: attempt.attemptID }),
          (status) => status.status === "complete",
        ),
      ).toEqual({ status: "complete", time: attempt.time })
      expect(yield* credentials.list(integrationID)).toEqual([
        expect.objectContaining({
          integrationID,
          label: "Work",
          value: Credential.Key.make({ type: "key", key: "secret" }),
        }),
      ])
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

      const attempt = yield* integrations.oauth.connect({
        integrationID,
        methodID,
        label: "Personal",
      })
      expect(attempt.mode).toBe("code")
      yield* integrations.oauth.complete({ integrationID, attemptID: attempt.attemptID, code: "1234" })

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

      const attempt = yield* integrations.oauth.connect({ integrationID, methodID })
      expect(
        yield* integrations.oauth.complete({ integrationID, attemptID: attempt.attemptID }).pipe(Effect.flip),
      ).toBeInstanceOf(Integration.CodeRequiredError)
      expect(closed).toBe(false)
      yield* integrations.oauth.cancel({
        integrationID: Integration.ID.make("other"),
        attemptID: attempt.attemptID,
      })
      expect(closed).toBe(false)
      yield* integrations.oauth.cancel({ integrationID, attemptID: attempt.attemptID })
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

      const attempt = yield* integrations.oauth.connect({ integrationID, methodID })
      yield* Effect.yieldNow
      expect(yield* integrations.oauth.status({ integrationID, attemptID: attempt.attemptID })).toEqual({
        status: "complete",
        time: attempt.time,
      })
      expect(yield* credentials.list(integrationID)).toHaveLength(1)
    }),
  )

  failingIt.effect("fails the attempt when credential persistence fails", () =>
    Effect.gen(function* () {
      const integrations = yield* Integration.Service
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
              callback: () =>
                Effect.succeed(
                  Credential.OAuth.make({
                    type: "oauth",
                    methodID,
                    access: "access",
                    refresh: "refresh",
                    expires: 1,
                  }),
                ),
            }),
        }),
      )

      const attempt = yield* integrations.oauth.connect({ integrationID, methodID })
      const exit = yield* integrations.oauth
        .complete({ integrationID, attemptID: attempt.attemptID, code: "1234" })
        .pipe(Effect.exit)
      expect(Exit.isFailure(exit) && Cause.hasDies(exit.cause)).toBe(true)
      expect(yield* integrations.oauth.status({ integrationID, attemptID: attempt.attemptID })).toEqual({
        status: "failed",
        message: "credential persistence failed",
        time: attempt.time,
      })
    }),
  )

  it.effect("fails and closes OAuth attempts when a pending transform throws during persistence", () =>
    Effect.gen(function* () {
      const integrations = yield* Integration.Service
      const credentials = yield* Credential.Service
      const integrationID = Integration.ID.make("replay-fixture")
      const methodID = Integration.MethodID.make("code")
      let closed = false
      yield* integrations.transform((editor) =>
        editor.method.update({
          integrationID,
          method: { id: methodID, type: "oauth", label: "Fixture" },
          authorize: () =>
            Effect.addFinalizer(() => Effect.sync(() => (closed = true))).pipe(
              Effect.as({
                mode: "code" as const,
                url: "https://example.com/authorize",
                instructions: "Enter the fixture code",
                callback: () =>
                  Effect.succeed(
                    Credential.OAuth.make({
                      type: "oauth",
                      methodID,
                      access: "fixture-access",
                      refresh: "fixture-refresh",
                      expires: 1,
                    }),
                  ),
              }),
            ),
        }),
      )
      const attempt = yield* integrations.oauth.connect({ integrationID, methodID })

      yield* State.batch(
        Effect.gen(function* () {
          const failure = new Error("integration transform failed")
          yield* integrations.transform(() => {
            throw failure
          })
          const exit = yield* integrations.oauth
            .complete({ integrationID, attemptID: attempt.attemptID, code: "fixture-code" })
            .pipe(Effect.exit)

          expect(Exit.isFailure(exit) && Cause.squash(exit.cause)).toBe(failure)
          expect(yield* integrations.oauth.status({ integrationID, attemptID: attempt.attemptID })).toEqual({
            status: "failed",
            message: failure.message,
            time: attempt.time,
          })
          expect(closed).toBe(true)
          expect(yield* credentials.list(integrationID)).toEqual([])
        }).pipe(Effect.scoped),
      )
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

      const attempt = yield* integrations.oauth.connect({ integrationID, methodID })
      expect(attempt.time.expires - attempt.time.created).toBe(Duration.toMillis(Duration.minutes(10)))
      yield* TestClock.adjust(Duration.minutes(10))
      yield* Effect.yieldNow
      expect(yield* integrations.oauth.status({ integrationID, attemptID: attempt.attemptID })).toEqual({
        status: "expired",
        time: attempt.time,
      })
      expect(closed).toBe(true)
      expect(yield* credentials.list(integrationID)).toEqual([])
    }),
  )

  it.effect("uses provider-defined OAuth attempt expirations", () =>
    Effect.gen(function* () {
      const integrations = yield* Integration.Service
      const integrationID = Integration.ID.make("openai")
      const created = yield* Clock.currentTimeMillis
      const expirations = [
        created + Duration.toMillis(Duration.minutes(5)),
        created + Duration.toMillis(Duration.minutes(20)),
      ]

      yield* Effect.forEach(expirations, (expiresAt, index) => {
        const methodID = Integration.MethodID.make(`browser-${index}`)
        return Effect.gen(function* () {
          yield* integrations.transform((editor) =>
            editor.method.update({
              integrationID,
              method: { id: methodID, type: "oauth", label: "Browser" },
              authorize: () =>
                Effect.succeed({
                  mode: "auto" as const,
                  url: "https://example.com/authorize",
                  instructions: "Sign in",
                  expiresAt,
                  callback: Effect.never,
                }),
            }),
          )

          const attempt = yield* integrations.oauth.connect({ integrationID, methodID })
          expect(attempt.time).toEqual({ created, expires: expiresAt })
        })
      })
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
          const archived = yield* credentials.create({
            integrationID,
            label: "Archived",
            value: Credential.Key.make({ type: "key", key: "c" }),
          })
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
              method: "key",
              id: personal.id,
              label: "Personal",
            },
            {
              type: "credential",
              method: "key",
              id: work.id,
              label: "Work",
            },
            {
              type: "credential",
              method: "key",
              id: archived.id,
              label: "Archived",
            },
            { type: "env", name: "INTEGRATION_TEST_ACME_KEY" },
          ])
          expect(yield* integrations.connection.active(integrationID)).toEqual({
            type: "credential",
            method: "key",
            id: personal.id,
            label: "Personal",
          })

          const bus = yield* Bus.Service
          const events = new Array<{ type: string; data: unknown }>()
          yield* bus.listen((event) => Effect.sync(() => events.push({ type: event.type, data: event.data })))
          yield* integrations.connection.activate(work.id)

          expect(yield* integrations.connection.active(integrationID)).toEqual({
            type: "credential",
            method: "key",
            id: work.id,
            label: "Work",
          })
          expect((yield* integrations.get(integrationID))?.connections.map((connection) => connection.type)).toEqual([
            "credential",
            "credential",
            "credential",
            "env",
          ])
          expect(events).toEqual([
            { type: Credential.Event.Switched.type, data: { credentialID: work.id, integrationID } },
          ])

          yield* integrations.connection.remove(archived.id)
          expect(events).toEqual([
            { type: Credential.Event.Switched.type, data: { credentialID: work.id, integrationID } },
            { type: Credential.Event.Updated.type, data: {} },
          ])

          yield* integrations.connection.remove(work.id)
          expect(yield* integrations.connection.active(integrationID)).toEqual({
            type: "credential",
            method: "key",
            id: personal.id,
            label: "Personal",
          })
          yield* integrations.connection.remove(personal.id)
          expect(yield* integrations.connection.active(integrationID)).toEqual({
            type: "env",
            name: "INTEGRATION_TEST_ACME_KEY",
          })
          expect(events).toEqual([
            { type: Credential.Event.Switched.type, data: { credentialID: work.id, integrationID } },
            { type: Credential.Event.Updated.type, data: {} },
            { type: Credential.Event.Updated.type, data: {} },
            { type: Credential.Event.Switched.type, data: { credentialID: personal.id, integrationID } },
            { type: Credential.Event.Updated.type, data: {} },
            { type: Credential.Event.Switched.type, data: { credentialID: null, integrationID } },
          ])
        }),
      (previous) =>
        Effect.sync(() => {
          if (previous === undefined) delete process.env.INTEGRATION_TEST_ACME_KEY
          else process.env.INTEGRATION_TEST_ACME_KEY = previous
        }),
    )
  })
})

describe("AuthorizationError", () => {
  test("reports the underlying cause message", () => {
    expect(new Integration.AuthorizationError({ cause: new Error("Request failed: 401") }).message).toBe(
      "Request failed: 401",
    )
  })

  test("falls back when the cause carries no message", () => {
    expect(new Integration.AuthorizationError({ cause: new Error() }).message).toBe("Authorization failed")
    expect(new Integration.AuthorizationError({ cause: undefined }).message).toBe("Authorization failed")
  })
})

describe("Integration.connection.recover", () => {
  ;[false, true].forEach((inFlight) =>
    it.effect(
      `does not recover another integration's credential${inFlight ? " during an existing recovery" : ""}`,
      () =>
        Effect.gen(function* () {
          const integrations = yield* Integration.Service
          const credentials = yield* Credential.Service
          const integrationID = Integration.ID.make("recovery-owner")
          const methodID = Integration.MethodID.make("oauth")
          const started = yield* Deferred.make<void>()
          const release = yield* Deferred.make<void>()
          let calls = 0
          yield* integrations.transform((editor) =>
            editor.method.update({
              integrationID,
              method: { id: methodID, type: "oauth", label: "OAuth" },
              authorize: () => Effect.never,
              recover: (value) =>
                Effect.gen(function* () {
                  calls++
                  yield* Deferred.succeed(started, undefined)
                  if (inFlight) yield* Deferred.await(release)
                  return Credential.OAuth.make({ ...value, access: "new" })
                }),
            }),
          )
          const credential = yield* credentials.create({
            integrationID,
            value: Credential.OAuth.make({
              type: "oauth",
              methodID,
              access: "old",
              refresh: "refresh",
              expires: Number.MAX_SAFE_INTEGER,
            }),
          })
          const connection = {
            type: "credential" as const,
            id: credential.id,
            label: "OAuth",
            method: "oauth" as const,
          }
          const owner = inFlight
            ? yield* integrations.connection.recover({ integrationID, connection, status: 401 }).pipe(Effect.forkChild)
            : undefined
          if (owner) yield* Deferred.await(started)
          const foreign = yield* integrations.connection
            .recover({ integrationID: Integration.ID.make("other-integration"), connection, status: 401 })
            .pipe(Effect.forkChild)
          yield* Effect.yieldNow
          yield* Effect.yieldNow
          yield* Deferred.succeed(release, undefined)
          expect(yield* Fiber.join(foreign)).toBeUndefined()
          expect(calls).toBe(inFlight ? 1 : 0)
          if (owner) expect(yield* Fiber.join(owner)).toHaveProperty("access", "new")
          expect((yield* credentials.get(credential.id))?.value).toHaveProperty("access", inFlight ? "new" : "old")
          expect((yield* integrations.connection.active(integrationID))?.status).toBeUndefined()
        }),
    ),
  )
  ;[
    { first: "resolve", second: "recover", custom: false },
    { first: "resolve", second: "recover", custom: true },
    { first: "recover", second: "resolve", custom: false },
    { first: "recover", second: "resolve", custom: true },
    { first: "resolve", second: "resolve", custom: false },
  ].forEach((fixture) =>
    it.effect(
      `serializes ${fixture.first} then ${fixture.second} with ${fixture.custom ? "custom recovery" : "refresh"}`,
      () =>
        Effect.gen(function* () {
          const integrations = yield* Integration.Service
          const credentials = yield* Credential.Service
          const integrationID = Integration.ID.make("serialized-refresh")
          const methodID = Integration.MethodID.make("oauth")
          const started = yield* Deferred.make<void>()
          const release = yield* Deferred.make<void>()
          const grants: string[] = []
          const refresh = (value: Credential.OAuth) =>
            Effect.gen(function* () {
              grants.push(value.refresh)
              const sequence = grants.length
              if (sequence === 1) {
                yield* Deferred.succeed(started, undefined)
                yield* Deferred.await(release)
              }
              return Credential.OAuth.make({
                ...value,
                access: `access-${sequence}`,
                refresh: `grant-${sequence}`,
                expires: Number.MAX_SAFE_INTEGER,
              })
            })
          yield* integrations.transform((editor) =>
            editor.method.update({
              integrationID,
              method: { id: methodID, type: "oauth", label: "OAuth" },
              authorize: () => Effect.never,
              refresh,
              ...(fixture.custom ? { recover: refresh } : {}),
            }),
          )
          const credential = yield* credentials.create({
            integrationID,
            value: Credential.OAuth.make({
              type: "oauth",
              methodID,
              access: "old",
              refresh: "grant-initial",
              expires: 0,
            }),
          })
          const connection = {
            type: "credential" as const,
            id: credential.id,
            label: "OAuth",
            method: "oauth" as const,
          }
          const run = (operation: string) =>
            operation === "resolve"
              ? integrations.connection.resolve(connection)
              : integrations.connection.recover({ integrationID, connection, status: 401 })
          const first = yield* run(fixture.first).pipe(Effect.forkChild)
          yield* Deferred.await(started)
          const second = yield* run(fixture.second).pipe(Effect.forkChild)
          yield* Effect.yieldNow
          yield* Effect.yieldNow
          expect(grants).toEqual(["grant-initial"])
          expect((yield* credentials.get(credential.id))?.value).toHaveProperty("refresh", "grant-initial")
          yield* Deferred.succeed(release, undefined)
          expect(yield* Fiber.join(first)).toHaveProperty("access", "access-1")
          const expected = fixture.second === "recover" ? 2 : 1
          expect(yield* Fiber.join(second)).toHaveProperty("access", `access-${expected}`)
          expect(grants).toEqual(expected === 2 ? ["grant-initial", "grant-1"] : ["grant-initial"])
          expect((yield* credentials.get(credential.id))?.value).toHaveProperty("refresh", `grant-${expected}`)
        }),
    ),
  )

  it.effect("a resolve waiting for declined recovery observes needs_auth without refreshing", () =>
    Effect.gen(function* () {
      const integrations = yield* Integration.Service
      const credentials = yield* Credential.Service
      const integrationID = Integration.ID.make("declined-before-resolve")
      const methodID = Integration.MethodID.make("oauth")
      const started = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      yield* integrations.transform((editor) =>
        editor.method.update({
          integrationID,
          method: { id: methodID, type: "oauth", label: "OAuth" },
          authorize: () => Effect.never,
          refresh: () => Effect.die("A rejected credential must not refresh"),
          recover: () =>
            Effect.gen(function* () {
              yield* Deferred.succeed(started, undefined)
              yield* Deferred.await(release)
              return undefined
            }),
        }),
      )
      const credential = yield* credentials.create({
        integrationID,
        value: Credential.OAuth.make({ type: "oauth", methodID, access: "old", refresh: "old", expires: 0 }),
      })
      const connection = { type: "credential" as const, id: credential.id, label: "OAuth", method: "oauth" as const }
      const recovery = yield* integrations.connection
        .recover({ integrationID, connection, status: 403 })
        .pipe(Effect.forkChild)
      yield* Deferred.await(started)
      const resolution = yield* integrations.connection.resolve(connection).pipe(Effect.forkChild)
      yield* Effect.yieldNow
      yield* Deferred.succeed(release, undefined)
      expect(yield* Fiber.join(recovery)).toBeUndefined()
      const result = yield* Fiber.await(resolution)
      expect(Exit.isFailure(result)).toBe(true)
      if (Exit.isFailure(result)) expect(Cause.squash(result.cause)).toBeInstanceOf(Integration.AuthorizationError)
      expect((yield* credentials.get(credential.id))?.value).toHaveProperty("access", "old")
    }),
  )

  it.effect("recovers 401 using standard refresh when recover is omitted", () =>
    Effect.gen(function* () {
      const integrations = yield* Integration.Service
      const credentials = yield* Credential.Service
      const integrationID = Integration.ID.make("test-oauth")
      const methodID = Integration.MethodID.make("oauth-refresh")
      let refreshCalls = 0

      yield* integrations.transform((editor) => {
        editor.update(integrationID, (integration) => {
          integration.name = "Test OAuth"
        })
        editor.method.update({
          integrationID,
          method: { id: methodID, type: "oauth", label: "OAuth Refresh" },
          authorize: () =>
            Effect.succeed({
              mode: "auto" as const,
              url: "https://example.com/oauth",
              instructions: "Login",
              callback: Effect.succeed(
                Credential.OAuth.make({
                  type: "oauth",
                  methodID,
                  access: "token-initial",
                  refresh: "refresh-initial",
                  expires: 0,
                }),
              ),
            }),
          refresh: (value) => {
            refreshCalls++
            return Effect.succeed(
              Credential.OAuth.make({
                type: "oauth",
                methodID,
                access: "token-refreshed",
                refresh: value.refresh,
                expires: 0,
              }),
            )
          },
        })
      })

      yield* integrations.oauth.connect({ integrationID, methodID })
      yield* Effect.yieldNow
      const cred = (yield* credentials.list(integrationID))[0]
      expect(cred).toBeDefined()
      expect(cred.value.type).toBe("oauth")
      if (cred.value.type === "oauth") {
        expect(cred.value.access).toBe("token-initial")
      }

      const recovered = yield* integrations.connection.recover({
        integrationID,
        connection: { type: "credential", id: cred.id, label: "OAuth", method: "oauth" },
        status: 401,
      })

      expect(refreshCalls).toBe(1)
      expect(recovered).toBeDefined()
      expect(recovered?.type).toBe("oauth")
      if (recovered?.type === "oauth") {
        expect(recovered.access).toBe("token-refreshed")
      }

      const updatedCred = yield* credentials.get(cred.id)
      expect(updatedCred).toBeDefined()
      expect(updatedCred?.id).toBe(cred.id)
      if (updatedCred?.value.type === "oauth") {
        expect(updatedCred.value.access).toBe("token-refreshed")
      }
      expect((yield* integrations.connection.active(integrationID))?.status).toBeUndefined()
    }),
  )

  it.effect("recovers using custom recover handler for 401 and 403", () =>
    Effect.gen(function* () {
      const integrations = yield* Integration.Service
      const credentials = yield* Credential.Service
      const integrationID = Integration.ID.make("test-custom-recover")
      const methodID = Integration.MethodID.make("custom")
      const recoveryStatuses: number[] = []

      yield* integrations.transform((editor) => {
        editor.update(integrationID, (integration) => {
          integration.name = "Test Custom Recover"
        })
        editor.method.update({
          integrationID,
          method: { id: methodID, type: "oauth", label: "Custom OAuth" },
          authorize: () =>
            Effect.succeed({
              mode: "auto" as const,
              url: "https://example.com/oauth",
              instructions: "Login",
              callback: Effect.succeed(
                Credential.OAuth.make({
                  type: "oauth",
                  methodID,
                  access: "initial",
                  refresh: "initial",
                  expires: 0,
                  metadata: { endpoint: "v1" },
                }),
              ),
            }),
          recover: (value, status) => {
            recoveryStatuses.push(status)
            if (status === 401) {
              return Effect.succeed(
                Credential.OAuth.make({
                  ...value,
                  access: "recovered-401",
                }),
              )
            }
            if (status === 403) {
              return Effect.succeed(
                Credential.OAuth.make({
                  ...value,
                  access: "recovered-403",
                  metadata: { endpoint: "v2" },
                }),
              )
            }
            return Effect.succeed(undefined)
          },
        })
      })

      yield* integrations.oauth.connect({ integrationID, methodID })
      yield* Effect.yieldNow
      const cred = (yield* credentials.list(integrationID))[0]

      const rec401 = yield* integrations.connection.recover({
        integrationID,
        connection: { type: "credential", id: cred.id, label: "OAuth", method: "oauth" },
        status: 401,
      })
      expect(rec401?.type).toBe("oauth")
      if (rec401?.type === "oauth") {
        expect(rec401.access).toBe("recovered-401")
      }

      const rec403 = yield* integrations.connection.recover({
        integrationID,
        connection: { type: "credential", id: cred.id, label: "OAuth", method: "oauth" },
        status: 403,
      })
      expect(rec403?.type).toBe("oauth")
      if (rec403?.type === "oauth") {
        expect(rec403.access).toBe("recovered-403")
        expect(rec403.metadata?.endpoint).toBe("v2")
      }
      expect(recoveryStatuses).toEqual([401, 403])
    }),
  )

  it.effect("treats 403 as permanent denial when recover is omitted and sets needs_auth", () =>
    Effect.gen(function* () {
      const integrations = yield* Integration.Service
      const credentials = yield* Credential.Service
      const integrationID = Integration.ID.make("test-no-403-recover")
      const methodID = Integration.MethodID.make("oauth")
      let refreshCalls = 0

      yield* integrations.transform((editor) => {
        editor.update(integrationID, (integration) => {
          integration.name = "Test No 403"
        })
        editor.method.update({
          integrationID,
          method: { id: methodID, type: "oauth", label: "OAuth" },
          authorize: () =>
            Effect.succeed({
              mode: "auto" as const,
              url: "https://example.com/oauth",
              instructions: "Login",
              callback: Effect.succeed(
                Credential.OAuth.make({
                  type: "oauth",
                  methodID,
                  access: "initial",
                  refresh: "initial",
                  expires: 0,
                }),
              ),
            }),
          refresh: () => {
            refreshCalls++
            return Effect.succeed(
              Credential.OAuth.make({
                type: "oauth",
                methodID,
                access: "refreshed",
                refresh: "refreshed",
                expires: 0,
              }),
            )
          },
        })
      })

      yield* integrations.oauth.connect({ integrationID, methodID })
      yield* Effect.yieldNow
      const cred = (yield* credentials.list(integrationID))[0]

      const recovered = yield* integrations.connection.recover({
        integrationID,
        connection: { type: "credential", id: cred.id, label: "OAuth", method: "oauth" },
        status: 403,
      })

      expect(refreshCalls).toBe(0)
      expect(recovered).toBeUndefined()

      const item = yield* integrations.get(integrationID)
      const connection = item?.connections.find((c) => c.type === "credential" && c.id === cred.id)
      expect(connection?.status?.status).toBe("needs_auth")
      const active = yield* integrations.connection.active(integrationID)
      expect(active?.status?.status).toBe("needs_auth")
      if (!active) return yield* Effect.die("Missing connection")
      expect(yield* integrations.connection.resolve(active).pipe(Effect.flip)).toBeInstanceOf(
        Integration.AuthorizationError,
      )
      expect(refreshCalls).toBe(0)
      yield* integrations.connection.status({ integrationID, connection: active, status: undefined })
      expect(yield* integrations.connection.resolve(active)).toHaveProperty("access", "refreshed")
      expect(refreshCalls).toBe(1)
    }),
  )
  ;[
    { name: "401 then 403", first: { status: 401 }, second: { status: 403 } },
    { name: "403 then 401", first: { status: 403 }, second: { status: 401 } },
    {
      name: "different response bodies",
      first: { status: 401, response: { body: "refresh" } },
      second: { status: 401, response: { body: "deny" } },
    },
    {
      name: "different response headers",
      first: { status: 401, response: { headers: { "x-recovery": "refresh" } } },
      second: { status: 401, response: { headers: { "x-recovery": "deny" } } },
    },
    {
      name: "recovery failure then a different response",
      first: { status: 401, response: { body: "fail" } },
      second: { status: 401, response: { body: "refresh" } },
    },
  ].forEach((fixture) =>
    it.effect(`evaluates concurrent ${fixture.name} independently using the latest credential`, () =>
      Effect.gen(function* () {
        const integrations = yield* Integration.Service
        const credentials = yield* Credential.Service
        const integrationID = Integration.ID.make("distinct-recoveries")
        const methodID = Integration.MethodID.make("oauth")
        const started = yield* Deferred.make<void>()
        const release = yield* Deferred.make<void>()
        const seen: {
          status: number
          response: Parameters<NonNullable<Integration.OAuthImplementation["recover"]>>[2]
          access: string
        }[] = []
        yield* integrations.transform((editor) =>
          editor.method.update({
            integrationID,
            method: { id: methodID, type: "oauth", label: "OAuth" },
            authorize: () => Effect.never,
            recover: (value, status, response) =>
              Effect.gen(function* () {
                seen.push({ status, response, access: value.access })
                yield* Deferred.succeed(started, undefined)
                yield* Deferred.await(release)
                if (response?.body === "fail") return yield* Effect.fail(new Error("Recovery failed"))
                if (status === 403 || response?.body === "deny" || response?.headers?.["x-recovery"] === "deny")
                  return undefined
                return Credential.OAuth.make({ ...value, access: "new", refresh: "rotated" })
              }),
          }),
        )
        const credential = yield* credentials.create({
          integrationID,
          value: Credential.OAuth.make({
            type: "oauth",
            methodID,
            access: "old",
            refresh: "refresh",
            expires: Number.MAX_SAFE_INTEGER,
          }),
        })
        const connection = { type: "credential" as const, id: credential.id, label: "OAuth", method: "oauth" as const }
        const first = yield* integrations.connection
          .recover({ integrationID, connection, ...fixture.first })
          .pipe(Effect.forkChild)
        yield* Deferred.await(started)
        const second = yield* integrations.connection
          .recover({ integrationID, connection, ...fixture.second })
          .pipe(Effect.forkChild)
        yield* Effect.yieldNow
        yield* Effect.yieldNow
        expect(seen).toHaveLength(1)
        yield* Deferred.succeed(release, undefined)
        const result = yield* Fiber.await(first)
        const recovered = yield* Fiber.join(second)
        expect(Exit.isFailure(result)).toBe(fixture.first.response?.body === "fail")
        expect(seen).toEqual([
          { ...fixture.first, response: fixture.first.response, access: "old" },
          {
            ...fixture.second,
            response: fixture.second.response,
            access: fixture.first.status === 401 && fixture.first.response?.body !== "fail" ? "new" : "old",
          },
        ])
        if (
          fixture.second.status === 403 ||
          fixture.second.response?.body === "deny" ||
          fixture.second.response?.headers?.["x-recovery"] === "deny"
        ) {
          expect(recovered).toBeUndefined()
          expect((yield* integrations.connection.active(integrationID))?.status?.status).toBe("needs_auth")
          return
        }
        expect(recovered).toHaveProperty("access", "new")
        expect((yield* integrations.connection.active(integrationID))?.status).toBeUndefined()
      }),
    ),
  )

  it.effect("coalesces equivalent responses regardless of header insertion order", () =>
    Effect.gen(function* () {
      const integrations = yield* Integration.Service
      const credentials = yield* Credential.Service
      const integrationID = Integration.ID.make("equivalent-recoveries")
      const methodID = Integration.MethodID.make("oauth")
      const started = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      const calls: Credential.OAuth[] = []
      yield* integrations.transform((editor) =>
        editor.method.update({
          integrationID,
          method: { id: methodID, type: "oauth", label: "OAuth" },
          authorize: () => Effect.never,
          recover: (value) =>
            Effect.gen(function* () {
              calls.push(value)
              yield* Deferred.succeed(started, undefined)
              yield* Deferred.await(release)
              return Credential.OAuth.make({ ...value, access: "new" })
            }),
        }),
      )
      const credential = yield* credentials.create({
        integrationID,
        value: Credential.OAuth.make({ type: "oauth", methodID, access: "old", refresh: "refresh", expires: 0 }),
      })
      const connection = { type: "credential" as const, id: credential.id, label: "OAuth", method: "oauth" as const }
      const first = yield* integrations.connection
        .recover({
          integrationID,
          connection,
          status: 401,
          response: { headers: { a: "1", b: "2" }, body: "same failure" },
        })
        .pipe(Effect.forkChild)
      yield* Deferred.await(started)
      const second = yield* integrations.connection
        .recover({
          integrationID,
          connection,
          status: 401,
          response: { headers: { b: "2", a: "1" }, body: "same failure" },
        })
        .pipe(Effect.forkChild)
      yield* Effect.yieldNow
      yield* Effect.yieldNow
      yield* Deferred.succeed(release, undefined)
      expect(yield* Fiber.join(first)).toHaveProperty("access", "new")
      expect(yield* Fiber.join(second)).toHaveProperty("access", "new")
      expect(calls).toHaveLength(1)
    }),
  )

  it.effect("coalesces concurrent recoveries for the same credential", () =>
    Effect.gen(function* () {
      const integrations = yield* Integration.Service
      const credentials = yield* Credential.Service
      const integrationID = Integration.ID.make("test-concurrent-recover")
      const methodID = Integration.MethodID.make("oauth")
      let refreshCalls = 0

      yield* integrations.transform((editor) => {
        editor.update(integrationID, (integration) => {
          integration.name = "Test Concurrent Recover"
        })
        editor.method.update({
          integrationID,
          method: { id: methodID, type: "oauth", label: "OAuth" },
          authorize: () =>
            Effect.succeed({
              mode: "auto" as const,
              url: "https://example.com/oauth",
              instructions: "Login",
              callback: Effect.succeed(
                Credential.OAuth.make({
                  type: "oauth",
                  methodID,
                  access: "initial",
                  refresh: "initial",
                  expires: 0,
                }),
              ),
            }),
          refresh: (value) =>
            Effect.gen(function* () {
              refreshCalls++
              yield* Effect.promise(() => Bun.sleep(50))
              return Credential.OAuth.make({
                type: "oauth",
                methodID,
                access: "concurrent-refreshed",
                refresh: value.refresh,
                expires: 0,
              })
            }),
        })
      })

      yield* integrations.oauth.connect({ integrationID, methodID })
      yield* Effect.yieldNow
      const cred = (yield* credentials.list(integrationID))[0]

      const [res1, res2, res3] = yield* Effect.all(
        [
          integrations.connection.recover({
            integrationID,
            connection: { type: "credential", id: cred.id, label: "OAuth", method: "oauth" },
            status: 401,
          }),
          integrations.connection.recover({
            integrationID,
            connection: { type: "credential", id: cred.id, label: "OAuth", method: "oauth" },
            status: 401,
          }),
          integrations.connection.recover({
            integrationID,
            connection: { type: "credential", id: cred.id, label: "OAuth", method: "oauth" },
            status: 401,
          }),
        ],
        { concurrency: "unbounded" },
      )

      expect(refreshCalls).toBe(1)
      expect(res1?.type === "oauth" && res1.access).toBe("concurrent-refreshed")
      expect(res2?.type === "oauth" && res2.access).toBe("concurrent-refreshed")
      expect(res3?.type === "oauth" && res3.access).toBe("concurrent-refreshed")
    }),
  )
  ;["unsupported", "refresh-fails", "recover-fails", "recover-declines"].forEach((fixture) => {
    it.effect(`marks OAuth authentication required when ${fixture}`, () =>
      Effect.gen(function* () {
        const integrations = yield* Integration.Service
        const credentials = yield* Credential.Service
        const integrationID = Integration.ID.make("failed-recovery")
        const methodID = Integration.MethodID.make("oauth")
        yield* integrations.transform((editor) =>
          editor.method.update({
            integrationID,
            method: { id: methodID, type: "oauth", label: "OAuth" },
            authorize: () => Effect.never,
            ...(fixture === "recover-declines"
              ? {
                  recover: () => Effect.succeed(undefined),
                  refresh: () => Effect.die("An explicit recovery decline must not invoke refresh"),
                }
              : {}),
            ...(fixture === "refresh-fails" ? { refresh: () => Effect.fail(new Error("Refresh token revoked")) } : {}),
            ...(fixture === "recover-fails" ? { recover: () => Effect.fail(new Error("Recovery denied")) } : {}),
          }),
        )
        const credential = yield* credentials.create({
          integrationID,
          value: Credential.OAuth.make({
            type: "oauth",
            methodID,
            access: "old",
            refresh: "refresh",
            expires: Number.MAX_SAFE_INTEGER,
          }),
        })
        const result = yield* integrations.connection
          .recover({
            integrationID,
            connection: { type: "credential", id: credential.id, label: "OAuth", method: "oauth" },
            status: 401,
          })
          .pipe(Effect.exit)
        expect(Exit.isFailure(result)).toBe(fixture === "refresh-fails" || fixture === "recover-fails")
        const connection = yield* integrations.connection.active(integrationID)
        expect(connection?.status?.status).toBe("needs_auth")
        expect(connection?.status?.message).toContain(
          fixture === "unsupported" || fixture === "recover-declines"
            ? "Reconnect"
            : fixture === "refresh-fails"
              ? "revoked"
              : "denied",
        )
        expect((yield* credentials.get(credential.id))?.value).toEqual(credential.value)
        const stale = { type: "credential" as const, id: credential.id, label: "OAuth", method: "oauth" as const }
        expect(yield* integrations.connection.resolve(stale).pipe(Effect.flip)).toBeInstanceOf(
          Integration.AuthorizationError,
        )
        const reconnected = yield* credentials.create({
          integrationID,
          value: Credential.OAuth.make({
            type: "oauth",
            methodID,
            access: "reconnected",
            refresh: "new-refresh",
            expires: Number.MAX_SAFE_INTEGER,
          }),
        })
        const active = yield* integrations.connection.active(integrationID)
        expect(active).toHaveProperty("id", reconnected.id)
        if (!active) return yield* Effect.die("Missing connection")
        expect(yield* integrations.connection.resolve(active)).toHaveProperty("access", "reconnected")
      }),
    )
  })
})
;["key", "oauth", "external"].forEach((type) =>
  it.effect(`keeps ${type} credentials usable while an SSO sign-in is required`, () =>
    Effect.gen(function* () {
      const integrations = yield* Integration.Service
      const credentials = yield* Credential.Service
      const integrationID = Integration.ID.make("sso-required")
      const credential = yield* credentials.create({
        integrationID,
        value:
          type === "key"
            ? Credential.Key.make({ type: "key", key: "secret" })
            : type === "external"
              ? Credential.External.make({ type: "external", methodID: Integration.MethodID.make("external") })
              : Credential.OAuth.make({
                  type: "oauth",
                  methodID: Integration.MethodID.make("oauth"),
                  access: "secret",
                  refresh: "refresh",
                  expires: Number.MAX_SAFE_INTEGER,
                }),
      })
      const connection = { type: "credential" as const, id: credential.id, label: "SSO", method: credential.value.type }
      yield* integrations.connection.status({
        integrationID,
        connection,
        status: { status: "needs_auth", message: "Sign in with SSO", url: "https://example.com/sso" },
      })
      expect(yield* integrations.connection.resolve(connection)).toEqual(credential.value)
      yield* integrations.connection.status({
        integrationID,
        connection,
        status: { status: "needs_auth", message: "Reconnect the integration" },
      })
      expect(yield* integrations.connection.resolve(connection).pipe(Effect.flip)).toBeInstanceOf(
        Integration.AuthorizationError,
      )
    }),
  ),
)

it.live(
  "cancelling a recovery caller preserves another caller and persists the refreshed credential",
  () =>
    Effect.gen(function* () {
      const integrations = yield* Integration.Service
      const credentials = yield* Credential.Service
      const integrationID = Integration.ID.make("independent-recovery")
      const methodID = Integration.MethodID.make("oauth")
      const started = Promise.withResolvers<void>()
      const release = Promise.withResolvers<void>()
      let calls = 0
      const server = yield* Effect.acquireRelease(
        Effect.sync(() =>
          Bun.serve({
            port: 0,
            async fetch() {
              calls++
              started.resolve()
              await release.promise
              return Response.json({ access: "new" })
            },
          }),
        ),
        (server) => Effect.sync(() => server.stop(true)),
      )
      yield* integrations.transform((editor) =>
        editor.method.update({
          integrationID,
          method: { id: methodID, type: "oauth", label: "Local OAuth fixture" },
          authorize: () => Effect.never,
          recover: (value) =>
            Effect.tryPromise({
              try: async (signal) => {
                const response = await fetch(server.url, { signal })
                const body = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Struct({ access: Schema.String })))(
                  await response.text(),
                )
                return Credential.OAuth.make({ ...value, access: body.access })
              },
              catch: (cause) => cause,
            }),
        }),
      )
      const credential = yield* credentials.create({
        integrationID,
        value: Credential.OAuth.make({
          type: "oauth",
          methodID,
          access: "old",
          refresh: "refresh",
          expires: Number.MAX_SAFE_INTEGER,
        }),
      })
      const recovery = integrations.connection.recover({
        integrationID,
        connection: { type: "credential", id: credential.id, label: "OAuth", method: "oauth" },
        status: 401,
      })
      const creator = yield* recovery.pipe(Effect.forkChild)
      yield* Effect.promise(() => started.promise)
      const waiter = yield* recovery.pipe(Effect.forkChild)
      yield* Effect.yieldNow
      yield* Effect.yieldNow
      yield* Fiber.interrupt(creator)
      release.resolve()
      const result = yield* Fiber.await(waiter).pipe(Effect.timeout("1 second"))
      expect(calls).toBe(1)
      expect(Exit.isSuccess(result)).toBe(true)
      expect((yield* credentials.get(credential.id))?.value).toHaveProperty("access", "new")
      expect(Exit.hasInterrupts(result)).toBe(false)
      expect(yield* recovery).toHaveProperty("access", "new")
      expect(calls).toBe(2)
    }),
  10000,
)
