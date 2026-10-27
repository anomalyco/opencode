import { expect } from "bun:test"
import { Deferred, Effect, Schedule } from "effect"
import { fromPromise } from "@opencode/plugin/promise/adapter"
import { Credential } from "@opencode/core/credential"
import { Integration } from "@opencode/core/integration"
import { Plugin } from "@opencode/core/plugin"
import { PluginHost } from "@opencode/core/plugin/host"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

const it = testEffect(PluginTestLayer)
const integrationID = Integration.ID.make("vercel")
const methodID = Integration.MethodID.make("promise-setup")

const fixture = Effect.fn(function* () {
  const interrupted = yield* Deferred.make<void>()
  const context = yield* Effect.context<never>()
  const plugin = yield* Plugin.Service
  const host = yield* PluginHost.make(plugin)
  yield* fromPromise({
    id: "test.promise-setup",
    async setup(ctx) {
      await ctx.integration.transform((editor) =>
        editor.method.update({
          integrationID,
          method: { id: methodID, type: "oauth", label: "Setup" },
          async authorize(_answer, prompt) {
            return {
              mode: "auto",
              url: "https://example.com/login",
              instructions: "Sign in",
              // Promise callbacks start eagerly, before authorize returns.
              callback: (async () => {
                const answer = await prompt({
                  title: "Confirm",
                  fields: [{ type: "boolean", key: "create", required: true }],
                }).catch(async (error) => {
                  await Effect.runPromiseWith(context)(Deferred.succeed(interrupted, undefined))
                  throw error
                })
                expect(answer.create).toBe(true)
                return Credential.Key.make({ type: "key", key: "promise-key" })
              })(),
            }
          },
        }),
      )
    },
  }).effect(host)
  const integrations = yield* Integration.Service
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

it.live("Promise authorizers can ask eager setup steps and return derived keys", () =>
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
