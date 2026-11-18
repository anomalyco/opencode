import { describe, expect, test } from "bun:test"
import { App } from "@opencode/core/app"
import { Config } from "@opencode/core/config"
import { Flag } from "@opencode/core/flag"
import { Document, Info } from "@opencode/schema/config"
import { ConfigExperimental } from "@opencode/schema/config/experimental"
import { ConfigFlag } from "@opencode/schema/config/flag"
import { makeLocationNode } from "@opencode/util/effect/app-node"
import { Effect, Layer, Record } from "effect"
import { testEffect } from "./lib/effect"

const typeGuards = () => {
  // @ts-expect-error Flag.enabled requires Flag.Service in context
  Flag.enabled("full_codemode") satisfies Effect.Effect<boolean, never, never>
  // @ts-expect-error Flag.all requires Flag.Service in context
  Flag.all satisfies Effect.Effect<Record<Flag.Key, Flag.State>, never, never>
  // @ts-expect-error A location node using App.Service must declare App.node in deps
  makeLocationNode({ service: App.Service, layer: Layer.effect(App.Service, App.Service), deps: [] })
  makeLocationNode({ service: App.Service, layer: Layer.effect(App.Service, App.Service), deps: [App.node] })
}
void typeGuards

const document = (experimental?: ConstructorParameters<typeof ConfigExperimental.Info>[0]) =>
  new Document({
    type: "document",
    info: new Info(experimental === undefined ? {} : { experimental: new ConfigExperimental.Info(experimental) }),
  })

const every = (state: Flag.State) => Record.map(ConfigFlag.registry, () => state)

describe("Flag.resolve", () => {
  test.each([
    ["local", true],
    ["dev", true],
    ["beta", false],
    ["latest", false],
    ["my-branch", false],
    ["unknown", false],
  ] as const)("applies %s build defaults", (channel, enabled) => {
    expect(Flag.resolve({ entries: [], channel })).toEqual(every({ enabled, source: "default" }))
  })

  test("full_codemode defaults to on in local and dev builds, off in releases, and follows overrides and wildcards", () => {
    expect(Flag.resolve({ entries: [], channel: "local" }).full_codemode).toEqual({
      enabled: true,
      source: "default",
    })
    expect(Flag.resolve({ entries: [], channel: "dev" }).full_codemode).toEqual({
      enabled: true,
      source: "default",
    })
    expect(Flag.resolve({ entries: [], channel: "latest" }).full_codemode).toEqual({
      enabled: false,
      source: "default",
    })
    expect(Flag.resolve({ entries: [], channel: "latest", overrides: "full_codemode" }).full_codemode).toEqual({
      enabled: true,
      source: "env",
    })
    expect(Flag.resolve({ entries: [document({ full_codemode: true })], channel: "latest" }).full_codemode).toEqual({
      enabled: true,
      source: "config",
    })
    expect(Flag.resolve({ entries: [document({ full_codemode: false })], channel: "dev" }).full_codemode).toEqual({
      enabled: false,
      source: "config",
    })
    expect(Flag.resolve({ entries: [], channel: "dev", overrides: "-full_codemode" }).full_codemode).toEqual({
      enabled: false,
      source: "env",
    })
    expect(
      Flag.resolve({ entries: [document({ full_codemode: false })], channel: "latest", overrides: "all" })
        .full_codemode,
    ).toEqual({ enabled: true, source: "env" })
    expect(Flag.resolve({ entries: [document({ all_flags: true })], channel: "latest" }).full_codemode).toEqual({
      enabled: true,
      source: "config",
    })
  })

  test("config overrides the default and OPENCODE_FLAGS overrides config", () => {
    const entries = [document({ full_codemode: true, automations: false })]
    const flags = Flag.resolve({ entries, channel: "dev", overrides: " media_blob , -full_codemode,unknown_flag" })
    expect(
      [flags.full_codemode, flags.automations, flags.media_blob, flags.artifacts].map((flag) => [
        flag.enabled,
        flag.source,
      ]),
    ).toEqual([
      [false, "env"],
      [false, "config"],
      [true, "env"],
      [true, "default"],
    ])
  })

  test("reads the old schedules key for automations, below the new key", () => {
    expect(Flag.resolve({ entries: [document({ schedules: true })], channel: "latest" }).automations).toEqual({
      enabled: true,
      source: "config",
    })
    expect(
      Flag.resolve({ entries: [document({ schedules: true, automations: false })], channel: "latest" }).automations,
    ).toEqual({ enabled: false, source: "config" })
    expect(Flag.resolve({ entries: [], channel: "latest", overrides: "schedules" }).automations).toEqual({
      enabled: true,
      source: "env",
    })
  })

  test("reads experimental from the highest-priority document that sets it, as before", () => {
    const flags = Flag.resolve({
      entries: [document({ full_codemode: true }), document({ subagent_depth: 2 }), document()],
      channel: "latest",
    })
    expect([flags.full_codemode.enabled, flags.full_codemode.source]).toEqual([false, "default"])
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
      Flag.resolve({ entries: [global, document({ subagent_depth: 2, full_codemode: false })], channel: "latest" }),
    ).toEqual({ ...every({ enabled: true, source: "config" }), full_codemode: { enabled: false, source: "config" } })
    expect(Flag.resolve({ entries: [global, document({ all_flags: false })], channel: "latest" })).toEqual(
      every({ enabled: false, source: "default" }),
    )
  })
})

const it = testEffect(
  Flag.testLayer([document({ artifacts: true })], {
    app: { channel: "latest" },
    overrides: "automations",
  }),
)

describe("Flag.enabled", () => {
  it.effect("reads the Config, channel and OPENCODE_FLAGS in scope and follows config updates", () =>
    Effect.gen(function* () {
      const config = yield* Config.Test
      expect(yield* Flag.enabled("artifacts")).toBe(true)
      expect(yield* Flag.enabled("automations")).toBe(true)
      expect(yield* Flag.enabled("full_codemode")).toBe(false)
      expect((yield* Flag.all).automations).toEqual({ enabled: true, source: "env" })

      yield* config.setEntries([document({ artifacts: false, full_codemode: true })])
      expect(yield* Flag.enabled("artifacts")).toBe(false)
      expect(yield* Flag.enabled("full_codemode")).toBe(true)
    }),
  )
})
