import { describe, expect, test } from "bun:test"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Bus } from "@opencode/core/bus"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { drain } from "./lib/clock"
import { App } from "@opencode/core/app"
import { Config } from "@opencode/core/config"
import { Flag } from "@opencode/core/flag"
import { Document, Event, Info } from "@opencode/schema/config"
import { ConfigExperimental } from "@opencode/schema/config/experimental"
import { ConfigFlag } from "@opencode/schema/config/flag"
import { makeLocationNode } from "@opencode/util/effect/app-node"
import { Effect, Layer, Record, Stream } from "effect"
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

// todo and opencode_api are opt-in only, so the build defaults and both wildcards leave them off.
const every = (state: Flag.State): Record<Flag.Key, Flag.State> => ({
  ...Record.map(ConfigFlag.registry, () => state),
  todo: { enabled: false, source: "default" },
  opencode_api: { enabled: false, source: "default" },
})

describe("Flag.resolve", () => {
  test.each([
    ["local", true],
    ["dev", true],
    ["latest", false],
    ["unknown", false],
  ] as const)("applies %s build defaults", (channel, enabled) => {
    expect(Flag.resolve({ entries: [], channel })).toEqual(every({ enabled, source: "default" }))
  })

  test.each(["todo"] as const)("%s is opt-in only: on only when named in OPENCODE_FLAGS or experimental.%s", (key) => {
    expect(Flag.resolve({ entries: [], channel: "dev", overrides: "all" })[key]).toEqual({
      enabled: false,
      source: "default",
    })
    expect(Flag.resolve({ entries: [], channel: "latest", overrides: key })[key]).toEqual({
      enabled: true,
      source: "env",
    })
    expect(Flag.resolve({ entries: [document({ [key]: true })], channel: "latest" })[key]).toEqual({
      enabled: true,
      source: "config",
    })
  })

  test("opencode_api turns on only by name, and only in local and dev builds", () => {
    const resolve = (channel: string, overrides?: string, experimental?: { opencode_api?: boolean }) =>
      Flag.resolve({ entries: experimental ? [document(experimental)] : [], channel, overrides }).opencode_api
    expect(resolve("dev", "all")).toEqual({ enabled: false, source: "default" })
    expect(resolve("local", "opencode_api")).toEqual({ enabled: true, source: "env" })
    expect(resolve("dev", undefined, { opencode_api: true })).toEqual({ enabled: true, source: "config" })
    for (const channel of ["beta", "latest", "my-branch", "unknown"])
      expect([resolve(channel, "opencode_api"), resolve(channel, undefined, { opencode_api: true })]).toEqual([
        { enabled: false, source: "default" },
        { enabled: false, source: "default" },
      ])
  })

  test.each(["full_codemode", "sqlite_fts"] as const)(
    "%s defaults to on in local and dev builds, off in releases, and follows overrides and wildcards",
    (key) => {
      expect(Flag.resolve({ entries: [], channel: "local" })[key]).toEqual({
        enabled: true,
        source: "default",
      })
      expect(Flag.resolve({ entries: [], channel: "dev" })[key]).toEqual({
        enabled: true,
        source: "default",
      })
      expect(Flag.resolve({ entries: [], channel: "latest" })[key]).toEqual({
        enabled: false,
        source: "default",
      })
      expect(Flag.resolve({ entries: [], channel: "latest", overrides: key })[key]).toEqual({
        enabled: true,
        source: "env",
      })
      expect(Flag.resolve({ entries: [document({ [key]: true })], channel: "latest" })[key]).toEqual({
        enabled: true,
        source: "config",
      })
      expect(Flag.resolve({ entries: [document({ [key]: false })], channel: "dev" })[key]).toEqual({
        enabled: false,
        source: "config",
      })
      expect(Flag.resolve({ entries: [], channel: "dev", overrides: `-${key}` })[key]).toEqual({
        enabled: false,
        source: "env",
      })
      expect(Flag.resolve({ entries: [document({ [key]: false })], channel: "latest", overrides: "all" })[key]).toEqual(
        { enabled: true, source: "env" },
      )
      expect(Flag.resolve({ entries: [document({ all_flags: true })], channel: "latest" })[key]).toEqual({
        enabled: true,
        source: "config",
      })
    },
  )

  test("config overrides the default and OPENCODE_FLAGS overrides config", () => {
    const entries = [document({ full_codemode: true, machines: false })]
    const flags = Flag.resolve({ entries, channel: "dev", overrides: " media_blob , -full_codemode,unknown_flag" })
    expect(
      [flags.full_codemode, flags.machines, flags.media_blob, flags.artifacts].map((flag) => [
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

const configLayer = Config.testLayer([document({ artifacts: true })])
const it = testEffect(
  AppNodeBuilder.build(LayerNode.group([Flag.node, Bus.node]), [
    Config.node.replace(configLayer),
    App.node.replace(App.layer({ channel: "latest" })),
  ]).pipe(Layer.provideMerge(configLayer), Layer.provide(Layer.succeed(Flag.Overrides, "media_blob"))),
)

describe("Flag.enabled", () => {
  it.effect("publishes only enabled-state flips, batching keys and refreshing sources on no-op edits", () =>
    Effect.gen(function* () {
      const config = yield* Config.Test
      const bus = yield* Bus.Service
      const flags = yield* Flag.Service
      const changes: ReadonlySet<Flag.Key>[] = []
      yield* flags.changes().pipe(
        Stream.runForEach((keys) => Effect.sync(() => changes.push(keys))),
        Effect.forkScoped({ startImmediately: true }),
      )
      expect(flags.current().artifacts.enabled).toBe(true)
      yield* config.setEntries([document({ artifacts: true, full_codemode: false, subagent_depth: 2 })])
      yield* bus.publish(Event.Updated, {})
      yield* drain
      expect(changes).toEqual([])
      expect(flags.current().full_codemode).toEqual({ enabled: false, source: "config" })

      yield* config.setEntries([document({ artifacts: false, full_codemode: true })])
      yield* bus.publish(Event.Updated, {})
      yield* drain
      expect(changes).toEqual([new Set(["artifacts", "full_codemode"])])
      expect(flags.current().full_codemode.enabled).toBe(true)
      yield* bus.publish(Event.Updated, {})
      yield* drain
      expect(changes).toHaveLength(1)
    }),
  )

  it.effect("reads the Config, channel and OPENCODE_FLAGS in scope and follows config updates", () =>
    Effect.gen(function* () {
      const config = yield* Config.Test
      const bus = yield* Bus.Service
      expect(yield* Flag.enabled("artifacts")).toBe(true)
      expect(yield* Flag.enabled("media_blob")).toBe(true)
      expect(yield* Flag.enabled("full_codemode")).toBe(false)
      expect((yield* Flag.all).media_blob).toEqual({ enabled: true, source: "env" })

      yield* config.setEntries([document({ artifacts: false, full_codemode: true })])
      yield* bus.publish(Event.Updated, {})
      yield* drain
      expect(yield* Flag.enabled("artifacts")).toBe(false)
      expect(yield* Flag.enabled("full_codemode")).toBe(true)
    }),
  )
})
