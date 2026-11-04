import { describe, expect, test } from "bun:test"
import { App } from "@opencode/core/app"
import { Config } from "@opencode/core/config"
import { Flag } from "@opencode/core/flag"
import { Document, Info } from "@opencode/schema/config"
import { ConfigExperimental } from "@opencode/schema/config/experimental"
import { ConfigFlag } from "@opencode/schema/config/flag"
import { Effect, Layer } from "effect"
import { testEffect } from "./lib/effect"

const document = (experimental?: ConstructorParameters<typeof ConfigExperimental.Info>[0]) =>
  new Document({
    type: "document",
    info: new Info(experimental === undefined ? {} : { experimental: new ConfigExperimental.Info(experimental) }),
  })

describe("Flag.resolve", () => {
  test("defaults each stage by channel, treating unknown channels as latest", () => {
    const table = ["local", "dev", "beta", "latest", "my-branch", "unknown"].map((channel) => [
      channel,
      ConfigFlag.Stage.literals.map((stage) => Flag.onByDefault(stage, channel)),
    ])
    expect(Object.fromEntries(table)).toEqual({
      local: [true, true, true],
      dev: [true, true, true],
      beta: [false, true, true],
      latest: [false, false, true],
      "my-branch": [false, false, true],
      unknown: [false, false, true],
    })
  })

  test("config overrides the stage default and OPENCODE_FLAGS overrides config", () => {
    const entries = [document({ todo: true, schedules: false })]
    const flags = Flag.resolve({ entries, channel: "dev", overrides: " media_blob , -todo,unknown_flag" })
    expect(
      [flags.todo, flags.schedules, flags.media_blob, flags.artifacts].map((flag) => [flag.enabled, flag.source]),
    ).toEqual([
      [false, "env"],
      [false, "config"],
      [true, "env"],
      [true, "stage"],
    ])
  })

  test("reads experimental from the highest-priority document that sets it, as before", () => {
    const flags = Flag.resolve({
      entries: [document({ todo: true }), document({ subagent_depth: 2 }), document()],
      channel: "latest",
    })
    expect([flags.todo.enabled, flags.todo.source]).toEqual([false, "stage"])
  })
})

const it = testEffect(
  Layer.mergeAll(
    Config.testLayer([document({ artifacts: true })]),
    App.layer({ channel: "beta" }),
    Layer.succeed(Flag.Overrides, "schedules"),
  ),
)

describe("Flag.enabled", () => {
  it.effect("reads the Config, channel and OPENCODE_FLAGS in scope", () =>
    Effect.gen(function* () {
      expect(yield* Flag.enabled("artifacts")).toBe(true)
      expect(yield* Flag.enabled("schedules")).toBe(true)
      expect(yield* Flag.enabled("todo")).toBe(false)
      expect((yield* Flag.all).schedules).toEqual({
        key: "schedules",
        description: ConfigFlag.registry.schedules.description,
        stage: "dev",
        enabled: true,
        source: "env",
      })
    }),
  )
})
