import { expect, test } from "bun:test"
import { Duration, Effect, Result } from "effect"
import { Plugin } from "@opencode/core/plugin"
import { activationBudget, awaitPlugins } from "../src/location"

function pluginService(settle: Effect.Effect<void>): Plugin.Interface {
  return {
    activate: () => Effect.void,
    list: () => Effect.succeed([]),
    close: () => Effect.void,
    awaitActivation: settle,
    hold: () => Effect.succeed(Effect.void),
  }
}

function run(settle: Effect.Effect<void>) {
  return Effect.runPromise(
    awaitPlugins.pipe(
      Effect.provideService(Plugin.Service, pluginService(settle)),
      Effect.result,
    ),
  )
}

function withBudget(value: string | undefined, body: () => Promise<void>) {
  const before = process.env.OPENCODE_PLUGIN_ACTIVATION_TIMEOUT
  if (value === undefined) delete process.env.OPENCODE_PLUGIN_ACTIVATION_TIMEOUT
  else process.env.OPENCODE_PLUGIN_ACTIVATION_TIMEOUT = value
  return body().finally(() => {
    if (before === undefined) delete process.env.OPENCODE_PLUGIN_ACTIVATION_TIMEOUT
    else process.env.OPENCODE_PLUGIN_ACTIVATION_TIMEOUT = before
  })
}

test("the activation budget defaults to five seconds", () => {
  expect(Duration.toMillis(activationBudget())).toBe(5_000)
})

test("the activation budget reads the environment", () => {
  withBudget("30 seconds", async () => {
    expect(Duration.toMillis(activationBudget())).toBe(30_000)
  })
})

test("an unreadable activation budget keeps the default", () => {
  withBudget("not a duration", async () => {
    expect(Duration.toMillis(activationBudget())).toBe(5_000)
  })
})

test("a location whose plugins outlive the budget is unavailable", async () => {
  await withBudget("50 millis", async () => {
    const result = await run(Effect.sleep("500 millis"))
    expect(Result.isFailure(result)).toBeTrue()
  })
})

test("a location whose plugins fit the budget is served", async () => {
  await withBudget("10 seconds", async () => {
    const result = await run(Effect.sleep("1 second"))
    expect(Result.isSuccess(result)).toBeTrue()
  })
})
