import { expect } from "bun:test"
import { Cause, Deferred, Effect, Exit, Schedule } from "effect"
import { fromPromise } from "@opencode/plugin/promise/adapter"
import type { IntegrationOAuthMethodRegistration } from "@opencode/plugin/promise/integration"
import { Credential } from "@opencode/core/credential"
import { Integration } from "@opencode/core/integration"
import { Plugin } from "@opencode/core/plugin"
import { PluginHost } from "@opencode/core/plugin/host"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

const it = testEffect(PluginTestLayer)
const integrationID = Integration.ID.make("vercel")
const methodID = Integration.MethodID.make("promise-setup")

const register = Effect.fn(function* (authorize: IntegrationOAuthMethodRegistration["authorize"]) {
  const plugin = yield* Plugin.Service
  const host = yield* PluginHost.make(plugin)
  yield* fromPromise({
    id: "test.promise-setup",
    async setup(ctx) {
      await ctx.integration.transform((editor) =>
        editor.method.update({
          integrationID,
          method: { id: methodID, type: "oauth", label: "Setup" },
          authorize,
        }),
      )
    },
  }).effect(host)
  return yield* Integration.Service
})

it.live("rejects Promise setup prompts awaited before authorize returns", () =>
  Effect.gen(function* () {
    const integrations = yield* register(async (_answer, prompt) => {
      await prompt({ title: "Confirm", fields: [{ type: "boolean", key: "create", required: true }] })
      return {
        mode: "auto",
        url: "https://example.com/login",
        instructions: "Sign in",
        callback: Promise.resolve(Credential.Key.make({ type: "key", key: "unused" })),
      }
    })
    const credentials = yield* Credential.Service
    const result = yield* integrations.oauth
      .connect({ integrationID, methodID })
      .pipe(Effect.timeout("5 seconds"), Effect.exit)
    if (Exit.isSuccess(result)) throw new Error("Expected early setup prompt to fail")
    expect(Cause.pretty(result.cause)).toContain("Setup prompts require automatic authorization")
    expect(yield* credentials.list(integrationID)).toEqual([])
  }),
)

const fixture = Effect.fn(function* () {
  const interrupted = yield* Deferred.make<void>()
  const context = yield* Effect.context<never>()
  const integrations = yield* register(async (_answer, prompt) => ({
    mode: "auto",
    url: "https://example.com/login",
    instructions: "Sign in",
    callback: async () => {
      const answer = await prompt({
        title: "Confirm",
        fields: [{ type: "boolean", key: "create", required: true }],
      }).catch(async (error) => {
        await Effect.runPromiseWith(context)(Deferred.succeed(interrupted, undefined))
        throw error
      })
      expect(answer.create).toBe(true)
      return Credential.Key.make({ type: "key", key: "promise-key" })
    },
  }))
  const attempt = yield* integrations.oauth.connect({ integrationID, methodID })
  const input = { integrationID, attemptID: attempt.attemptID }
  const status = (ready: (value: Integration.AttemptStatus) => boolean) =>
    integrations.oauth
      .status(input)
      .pipe(
        Effect.repeat({ while: (value) => !ready(value), schedule: Schedule.spaced("1 millis") }),
        Effect.timeout("5 seconds"),
      )
  const pending = yield* status((value) => value.status === "pending" && !!value.prompt)
  if (pending.status !== "pending" || !pending.prompt) throw new Error("Expected setup prompt")
  return { input, integrations, pending: pending.prompt, status, interrupted }
})

it.live("Promise authorizers can ask lazy setup steps and return derived keys", () =>
  Effect.gen(function* () {
    const setup = yield* fixture()
    const credentials = yield* Credential.Service
    yield* setup.integrations.oauth.complete({ ...setup.input, promptID: setup.pending.id, answer: { create: true } })
    expect(yield* setup.status((value) => value.status === "complete")).toMatchObject({ status: "complete" })
    expect((yield* credentials.list(integrationID))[0]?.value).toEqual({ type: "key", key: "promise-key" })
  }),
)

it.live("cancelling setup interrupts pending Promise prompts", () =>
  Effect.gen(function* () {
    const setup = yield* fixture()
    const credentials = yield* Credential.Service
    yield* setup.integrations.oauth.cancel(setup.input)
    yield* Deferred.await(setup.interrupted).pipe(Effect.timeout("5 seconds"))
    expect(yield* credentials.list(integrationID)).toEqual([])
  }),
)

it.live("existing automatic Promise callbacks still complete without setup prompts", () =>
  Effect.gen(function* () {
    const integrations = yield* register(async () => ({
      mode: "auto",
      url: "https://example.com/login",
      instructions: "Sign in",
      callback: Promise.resolve(Credential.Key.make({ type: "key", key: "legacy-key" })),
    }))
    const credentials = yield* Credential.Service
    const attempt = yield* integrations.oauth.connect({ integrationID, methodID })
    const status = yield* integrations.oauth
      .status({ integrationID, attemptID: attempt.attemptID })
      .pipe(
        Effect.repeat({ while: (value) => value.status === "pending", schedule: Schedule.spaced("1 millis") }),
        Effect.timeout("5 seconds"),
      )
    expect(status.status).toBe("complete")
    expect((yield* credentials.list(integrationID))[0]?.value).toEqual({ type: "key", key: "legacy-key" })
  }),
)

it.live("rejects Promise setup prompts in code-mode callbacks without blocking completion", () =>
  Effect.gen(function* () {
    const integrations = yield* register(async (_answer, prompt) => ({
      mode: "code",
      url: "https://example.com/login",
      instructions: "Paste the code",
      callback: async () => {
        await prompt({ title: "Confirm", fields: [{ type: "boolean", key: "create", required: true }] })
        return Credential.Key.make({ type: "key", key: "unused" })
      },
    }))
    const credentials = yield* Credential.Service
    const attempt = yield* integrations.oauth.connect({ integrationID, methodID })
    const input = { integrationID, attemptID: attempt.attemptID }
    const result = yield* integrations.oauth
      .complete({ ...input, code: "test-code" })
      .pipe(Effect.timeout("5 seconds"), Effect.exit)
    expect(Exit.isFailure(result)).toBe(true)
    expect(yield* integrations.oauth.status(input)).toMatchObject({
      status: "failed",
      message: expect.stringContaining("Setup prompts require automatic authorization"),
    })
    expect(yield* credentials.list(integrationID)).toEqual([])
  }),
)
