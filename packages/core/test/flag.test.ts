import { describe, expect, test } from "bun:test"
import { App } from "@opencode/core/app"
import { Config } from "@opencode/core/config"
import { Flag } from "@opencode/core/flag"
import { Document, Info } from "@opencode/schema/config"
import { ConfigExperimental } from "@opencode/schema/config/experimental"
import { Effect, Layer } from "effect"
import { testEffect } from "./lib/effect"

const document = (experimental?: ConstructorParameters<typeof ConfigExperimental.Info>[0]) =>
  new Document({
    type: "document",
    info: new Info(experimental === undefined ? {} : { experimental: new ConfigExperimental.Info(experimental) }),
  })

describe("Flag.resolve", () => {
  test("turns flags on by default only in local and dev builds", () => {
    const table = ["local", "dev", "beta", "latest", "my-branch", "unknown"].map((channel) => [
      channel,
      Flag.resolve({ entries: [], channel }).todo.enabled,
    ])
    expect(Object.fromEntries(table)).toEqual({
      local: true,
      dev: true,
      beta: false,
      latest: false,
      "my-branch": false,
      unknown: false,
    })
  })

  test("config overrides the default and OPENCODE_FLAGS overrides config", () => {
    const entries = [document({ todo: true, schedules: false })]
    const flags = Flag.resolve({ entries, channel: "dev", overrides: " media_blob , -todo,unknown_flag" })
    expect(
      [flags.todo, flags.schedules, flags.media_blob, flags.artifacts].map((flag) => [flag.enabled, flag.source]),
    ).toEqual([
      [false, "env"],
      [false, "config"],
      [true, "env"],
      [true, "default"],
    ])
  })

  test("reads experimental from the highest-priority document that sets it, as before", () => {
    const flags = Flag.resolve({
      entries: [document({ todo: true }), document({ subagent_depth: 2 }), document()],
      channel: "latest",
    })
    expect([flags.todo.enabled, flags.todo.source]).toEqual([false, "default"])
  })
})

const it = testEffect(
  Layer.mergeAll(
    Config.testLayer([document({ artifacts: true })]),
    App.layer({ channel: "latest" }),
    Layer.succeed(Flag.Overrides, "schedules"),
  ),
)

describe("Flag.enabled", () => {
  it.effect("reads the Config, channel and OPENCODE_FLAGS in scope", () =>
    Effect.gen(function* () {
      expect(yield* Flag.enabled("artifacts")).toBe(true)
      expect(yield* Flag.enabled("schedules")).toBe(true)
      expect(yield* Flag.enabled("todo")).toBe(false)
      expect((yield* Flag.all).schedules).toEqual({ enabled: true, source: "env" })
    }),
  )
})
