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

  test("OPENCODE_FLAGS=all turns every flag on at env priority without becoming a key", () => {
    const flags = Flag.resolve({
      entries: [document({ media_blob: false })],
      channel: "latest",
      overrides: ConfigFlag.wildcard,
    })
    expect(Object.keys(flags)).toEqual(Object.keys(ConfigFlag.registry))
    expect(Object.keys(flags)).not.toContain(ConfigFlag.wildcard)
    expect(Object.values(flags).map((flag) => [flag.enabled, flag.source])).toEqual(
      Object.keys(ConfigFlag.registry).map(() => [true, "env"]),
    )
  })

  test("OPENCODE_FLAGS=all,-media_blob lets the explicit opt-out win", () => {
    const flags = Flag.resolve({ entries: [], channel: "latest", overrides: "all,-media_blob" })
    expect([flags.media_blob.enabled, flags.media_blob.source]).toEqual([false, "env"])
    expect([flags.todo.enabled, flags.todo.source]).toEqual([true, "env"])
    expect([flags.artifacts.enabled, flags.artifacts.source]).toEqual([true, "env"])
  })

  test("the wildcard ignores padding, empty entries and order", () => {
    const pairs = (overrides: string) =>
      Object.values(Flag.resolve({ entries: [], channel: "latest", overrides })).map((flag) => [
        flag.enabled,
        flag.source,
      ])
    const expected = pairs("all,-media_blob")
    expect(pairs(" all , -media_blob , ")).toEqual(expected)
    expect(pairs("-media_blob,all")).toEqual(expected)
  })

  test("only a truthy all enables everything, and duplicates are last-wins", () => {
    const entries = [document({ todo: true })]
    const off = Flag.resolve({ entries, channel: "latest", overrides: "-all" })
    expect(off).toEqual(Flag.resolve({ entries, channel: "latest" }))
    expect([off.todo.enabled, off.todo.source]).toEqual([true, "config"])
    expect(Flag.resolve({ entries, channel: "latest", overrides: "all,-all" })).toEqual(off)
    expect(
      Object.values(Flag.resolve({ entries, channel: "latest", overrides: "-all,all" })).map((flag) => flag.source),
    ).toEqual(Object.keys(ConfigFlag.registry).map(() => "env"))
  })

  test("reads experimental from the highest-priority document that sets it, as before", () => {
    const flags = Flag.resolve({
      entries: [document({ todo: true }), document({ subagent_depth: 2 }), document()],
      channel: "latest",
    })
    expect([flags.todo.enabled, flags.todo.source]).toEqual([false, "default"])
  })

  describe("experimental.all_flags", () => {
    const pairs = (flags: ReturnType<typeof Flag.resolve>) =>
      Object.values(flags).map((flag): [string, boolean, string] => [flag.key, flag.enabled, flag.source])

    test("turns every flag on at config priority without becoming a key", () => {
      const flags = Flag.resolve({ entries: [document({ all_flags: true })], channel: "latest" })
      expect(Object.keys(flags)).toEqual(Object.keys(ConfigFlag.registry))
      expect(Object.keys(flags)).not.toContain("all_flags")
      expect(Object.keys(flags)).not.toContain(ConfigFlag.wildcard)
      expect(pairs(flags)).toEqual(Object.keys(ConfigFlag.registry).map((key) => [key, true, "config"]))
    })

    test("a specific false still wins", () => {
      const flags = Flag.resolve({
        entries: [document({ all_flags: true, media_blob: false })],
        channel: "latest",
      })
      expect([flags.media_blob.enabled, flags.media_blob.source]).toEqual([false, "config"])
      expect([flags.todo.enabled, flags.todo.source]).toEqual([true, "config"])
      expect([flags.artifacts.enabled, flags.artifacts.source]).toEqual([true, "config"])
    })

    test("a specific true keeps the config source", () => {
      const flags = Flag.resolve({ entries: [document({ all_flags: true, todo: true })], channel: "latest" })
      expect([flags.todo.enabled, flags.todo.source]).toEqual([true, "config"])
    })

    test("all_flags: false is not a kill switch", () => {
      const entries = [document({ all_flags: false })]
      expect(pairs(Flag.resolve({ entries, channel: "dev" }))).toEqual(
        Object.keys(ConfigFlag.registry).map((key) => [key, true, "default"]),
      )
      expect(pairs(Flag.resolve({ entries, channel: "latest" }))).toEqual(
        Object.keys(ConfigFlag.registry).map((key) => [key, false, "default"]),
      )
    })

    test("OPENCODE_FLAGS still wins over the config switch", () => {
      const entries = [document({ all_flags: true })]
      const optOut = Flag.resolve({ entries, channel: "latest", overrides: "-artifacts" })
      expect([optOut.artifacts.enabled, optOut.artifacts.source]).toEqual([false, "env"])
      expect([optOut.todo.enabled, optOut.todo.source]).toEqual([true, "config"])
      const envWildcardOff = Flag.resolve({ entries, channel: "latest", overrides: "-all" })
      expect(pairs(envWildcardOff)).toEqual(Object.keys(ConfigFlag.registry).map((key) => [key, true, "config"]))
    })

    test("reads the switch from the same document as the per-key settings", () => {
      const lowerIgnored = Flag.resolve({
        entries: [document({ all_flags: true }), document({ subagent_depth: 2 })],
        channel: "latest",
      })
      expect(pairs(lowerIgnored)).toEqual(Object.keys(ConfigFlag.registry).map((key) => [key, false, "default"]))
      const lowerKeyIgnored = Flag.resolve({
        entries: [document({ media_blob: false }), document({ all_flags: true })],
        channel: "latest",
      })
      expect([lowerKeyIgnored.media_blob.enabled, lowerKeyIgnored.media_blob.source]).toEqual([true, "config"])
    })

    test("is inert in the OPENCODE_FLAGS layer", () => {
      const plain = Flag.resolve({ entries: [], channel: "latest" })
      expect(Flag.resolve({ entries: [], channel: "latest", overrides: "all_flags" })).toEqual(plain)
      expect(Flag.resolve({ entries: [], channel: "latest", overrides: "-all_flags" })).toEqual(plain)
    })
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

const withAll = testEffect(
  Layer.mergeAll(Config.testLayer([]), App.layer({ channel: "latest" }), Layer.succeed(Flag.Overrides, "all,-todo")),
)

describe("Flag.all with OPENCODE_FLAGS=all", () => {
  withAll.effect("turns every flag on at env priority except an explicit opt-out", () =>
    Effect.gen(function* () {
      const flags = yield* Flag.all
      expect(Object.keys(flags)).toEqual(Object.keys(ConfigFlag.registry))
      expect(
        Object.values(flags).map((flag): [string, boolean, string] => [flag.key, flag.enabled, flag.source]),
      ).toEqual(Object.keys(ConfigFlag.registry).map((key) => [key, key !== "todo", "env"]))
    }),
  )
})

const withAllFlags = testEffect(
  Layer.mergeAll(
    Config.testLayer([document({ all_flags: true, media_blob: false })]),
    App.layer({ channel: "latest" }),
    Layer.succeed(Flag.Overrides, ""),
  ),
)

describe("Flag.all with experimental.all_flags", () => {
  withAllFlags.effect("turns every flag on at config priority except a specific opt-out", () =>
    Effect.gen(function* () {
      expect(yield* Flag.enabled("todo")).toBe(true)
      expect(yield* Flag.enabled("media_blob")).toBe(false)
      expect((yield* Flag.all).todo).toEqual({
        key: "todo",
        description: ConfigFlag.registry.todo,
        enabled: true,
        source: "config",
      })
    }),
  )
})
