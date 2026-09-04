import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import path from "path"
import { pathToFileURL } from "url"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Account } from "../../src/account/account"
import { Auth } from "../../src/auth"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Npm } from "@opencode-ai/core/npm"
import { Plugin } from "@/plugin"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { TestInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { AccountTest } from "../fake/account"
import { AuthTest } from "../fake/auth"
import { NpmTest } from "../fake/npm"

const it = testEffect(
  AppNodeBuilder.build(LayerNode.group([Plugin.node, CrossSpawnSpawner.node]), [
    [Auth.node, AuthTest.empty],
    [Account.node, AccountTest.empty],
    [Npm.node, NpmTest.noop],
    [RuntimeFlags.node, RuntimeFlags.layer({ disableDefaultPlugins: true })],
  ]),
)

const recordingPlugin = [
  "const bus = globalThis.__lifecycleBus ?? (globalThis.__lifecycleBus = { starts: [], ends: [], stops: [] })",
  "export default async () => ({",
  '  "session.start": async (input, output) => {',
  "    bus.starts.push({ sessionID: input.sessionID, cwd: input.cwd, agent: input.agent, timestamp: input.timestamp, metadataKeys: Object.keys(output.metadata) })",
  "  },",
  '  "session.end": async (input, output) => {',
  "    bus.ends.push({ sessionID: input.sessionID, reason: input.reason, duration_ms: input.duration_ms, cleanup: output.cleanup })",
  "  },",
  '  "stop": async (input, output) => {',
  "    bus.stops.push({ sessionID: input.sessionID, agent: input.agent, messageID: input.messageID, reason: input.reason, continue: output.continue })",
  "  },",
  "})",
  "",
].join("\n")

function installPlugin() {
  return Effect.gen(function* () {
    const test = yield* TestInstance
    const file = path.join(test.directory, "lifecycle-plugin.ts")
    yield* Effect.promise(() => Bun.write(file, recordingPlugin))
    yield* Effect.promise(() =>
      Bun.write(
        path.join(test.directory, "opencode.json"),
        JSON.stringify({
          $schema: "https://opencode.ai/config.json",
          plugin: [pathToFileURL(file).href],
        }),
      ),
    )
  })
}

const readBus = (): { starts: any[]; ends: any[]; stops: any[] } => {
  const bus = (globalThis as any).__lifecycleBus ?? { starts: [], ends: [], stops: [] }
  return { starts: [...bus.starts], ends: [...bus.ends], stops: [...bus.stops] }
}

const clearBus = () => {
  const bus = (globalThis as any).__lifecycleBus ?? { starts: [], ends: [], stops: [] }
  bus.starts.length = 0
  bus.ends.length = 0
  bus.stops.length = 0
  ;(globalThis as any).__lifecycleBus = bus
}

describe("plugin.trigger (lifecycle events E2E with real plugin file)", () => {
  it.instance("loaded plugin receives session.start with valid input", () =>
    Effect.gen(function* () {
      clearBus()
      yield* installPlugin()
      const plugin = yield* Plugin.Service
      const out = { metadata: {} as Record<string, unknown> }
      yield* plugin.trigger(
        "session.start",
        {
          sessionID: "sess_loaded_1",
          cwd: "/tmp/proj",
          agent: "build",
          timestamp: 1700000000000,
        },
        out,
      )
      const bus = readBus()
      expect(bus.starts.length).toBe(1)
      expect(bus.starts[0].sessionID).toBe("sess_loaded_1")
      expect(bus.starts[0].cwd).toBe("/tmp/proj")
      expect(bus.starts[0].agent).toBe("build")
      expect(bus.starts[0].timestamp).toBe(1700000000000)
    }),
  )

  it.instance("loaded plugin receives session.end with cleanup flag", () =>
    Effect.gen(function* () {
      clearBus()
      yield* installPlugin()
      const plugin = yield* Plugin.Service
      const out = { cleanup: true }
      yield* plugin.trigger(
        "session.end",
        {
          sessionID: "sess_loaded_2",
          duration_ms: 5000,
          turn_count: 3,
          reason: "user_exit",
        },
        out,
      )
      const bus = readBus()
      expect(bus.ends.length).toBe(1)
      expect(bus.ends[0].sessionID).toBe("sess_loaded_2")
      expect(bus.ends[0].reason).toBe("user_exit")
      expect(bus.ends[0].duration_ms).toBe(5000)
    }),
  )

  it.instance("loaded plugin receives stop with reason and messageID", () =>
    Effect.gen(function* () {
      clearBus()
      yield* installPlugin()
      const plugin = yield* Plugin.Service
      const out = { continue: false }
      yield* plugin.trigger(
        "stop",
        {
          sessionID: "sess_loaded_3",
          agent: "build",
          messageID: "msg_loaded_3",
          reason: "completed",
        },
        out,
      )
      const bus = readBus()
      expect(bus.stops.length).toBe(1)
      expect(bus.stops[0].sessionID).toBe("sess_loaded_3")
      expect(bus.stops[0].messageID).toBe("msg_loaded_3")
      expect(bus.stops[0].reason).toBe("completed")
    }),
  )

  it.instance("plugin can set stop output.continue = true", () =>
    Effect.gen(function* () {
      clearBus()
      const continuePlugin = [
        "const bus = globalThis.__lifecycleBus ?? (globalThis.__lifecycleBus = { stops: [] })",
        "export default async () => ({",
        '  "stop": async (_input, output) => {',
        "    output.continue = true",
        "  },",
        "})",
        "",
      ].join("\n")
      const test = yield* TestInstance
      const file = path.join(test.directory, "continue-plugin.ts")
      yield* Effect.promise(() => Bun.write(file, continuePlugin))
      yield* Effect.promise(() =>
        Bun.write(
          path.join(test.directory, "opencode.json"),
          JSON.stringify({
            $schema: "https://opencode.ai/config.json",
            plugin: [pathToFileURL(file).href],
          }),
        ),
      )
      const plugin = yield* Plugin.Service
      const out = { continue: false }
      yield* plugin.trigger(
        "stop",
        { sessionID: "s", agent: "a", messageID: "m", reason: "completed" },
        out,
      )
      expect(out.continue).toBe(true)
    }),
  )

  it.instance("stop output defaults to continue=false when plugin does not touch it", () =>
    Effect.gen(function* () {
      clearBus()
      const noopPlugin = [
        "export default async () => ({",
        '  "stop": async () => {',
        "    // no-op: do not touch output",
        "  },",
        "})",
        "",
      ].join("\n")
      const test = yield* TestInstance
      const file = path.join(test.directory, "noop-plugin.ts")
      yield* Effect.promise(() => Bun.write(file, noopPlugin))
      yield* Effect.promise(() =>
        Bun.write(
          path.join(test.directory, "opencode.json"),
          JSON.stringify({
            $schema: "https://opencode.ai/config.json",
            plugin: [pathToFileURL(file).href],
          }),
        ),
      )
      const plugin = yield* Plugin.Service
      const out = { continue: false }
      yield* plugin.trigger(
        "stop",
        { sessionID: "s", agent: "a", messageID: "m", reason: "completed" },
        out,
      )
      expect(out.continue).toBe(false)
    }),
  )
})