import { describe, expect, test } from "bun:test"
import { App } from "@opencode/core/app"
import { Config } from "@opencode/core/config"
import { Flag } from "@opencode/core/flag"
import { Document, Info } from "@opencode/schema/config"
import { ConfigExperimental } from "@opencode/schema/config/experimental"
import { ConfigFlag } from "@opencode/schema/config/flag"
import { Effect, Layer, Record } from "effect"
import { testEffect } from "./lib/effect"

const document = (experimental?: ConstructorParameters<typeof ConfigExperimental.Info>[0]) =>
  new Document({
    type: "document",
    info: new Info(experimental === undefined ? {} : { experimental: new ConfigExperimental.Info(experimental) }),
  })

const every = (state: Flag.State) => Record.map(ConfigFlag.registry, () => state)

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

  test("every registered flag, including codemode_vm, is off in a latest release build", () => {
    expect(Flag.resolve({ entries: [], channel: "latest" })).toEqual(every({ enabled: false, source: "default" }))
    expect(Flag.resolve({ entries: [], channel: "latest" }).codemode_vm.enabled).toBe(false)
    expect(Flag.resolve({ entries: [], channel: "dev" }).codemode_vm.enabled).toBe(true)
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

  test("OPENCODE_FLAGS=all turns every flag on, and a -key in the same list still wins", () => {
    const entries = [document({ media_blob: false })]
    expect(Flag.resolve({ entries, channel: "latest", overrides: "all" })).toEqual(
      every({ enabled: true, source: "env" }),
    )
    expect(Flag.resolve({ entries: [], channel: "latest", overrides: " -media_blob , all, " })).toEqual({
      ...every({ enabled: true, source: "env" }),
      media_blob: { enabled: false, source: "env" },
    })
    expect(Flag.resolve({ entries, channel: "latest", overrides: "-all" })).toEqual(
      Flag.resolve({ entries, channel: "latest" }),
    )
  })

  test("experimental.all_flags turns every flag on below OPENCODE_FLAGS and below a per-flag setting", () => {
    const entries = [document({ all_flags: true, media_blob: false })]
    expect(Flag.resolve({ entries, channel: "latest", overrides: "-artifacts" })).toEqual({
      ...every({ enabled: true, source: "config" }),
      media_blob: { enabled: false, source: "config" },
      artifacts: { enabled: false, source: "env" },
    })
  })

  test("experimental.all_flags: false is not a kill switch, and all_flags in OPENCODE_FLAGS does nothing", () => {
    expect(Flag.resolve({ entries: [document({ all_flags: false })], channel: "dev" })).toEqual(
      every({ enabled: true, source: "default" }),
    )
    expect(Flag.resolve({ entries: [], channel: "latest", overrides: "all_flags" })).toEqual(
      Flag.resolve({ entries: [], channel: "latest" }),
    )
  })

  test("a global all_flags survives a project experimental block, and a project all_flags: false stops it", () => {
    const global = document({ all_flags: true })
    expect(
      Flag.resolve({ entries: [global, document({ subagent_depth: 2, todo: false })], channel: "latest" }),
    ).toEqual({ ...every({ enabled: true, source: "config" }), todo: { enabled: false, source: "config" } })
    expect(Flag.resolve({ entries: [global, document({ all_flags: false })], channel: "latest" })).toEqual(
      every({ enabled: false, source: "default" }),
    )
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
