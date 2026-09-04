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
import { Session } from "@/session/session"
import { TestInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { AccountTest } from "../fake/account"
import { AuthTest } from "../fake/auth"
import { NpmTest } from "../fake/npm"

const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([Session.node, Plugin.node, CrossSpawnSpawner.node]),
    [
      [Auth.node, AuthTest.empty],
      [Account.node, AccountTest.empty],
      [Npm.node, NpmTest.noop],
      [RuntimeFlags.node, RuntimeFlags.layer({ disableDefaultPlugins: true })],
    ],
  ),
)

const recordingPlugin = [
  "const bus = globalThis.__lifecycleBus ?? (globalThis.__lifecycleBus = { starts: [], ends: [], stops: [] })",
  "export default async () => ({",
  '  "session.start": async (input, output) => {',
  "    bus.starts.push({ sessionID: input.sessionID, cwd: input.cwd, agent: input.agent, timestamp: input.timestamp })",
  "  },",
  '  "session.end": async (input, output) => {',
  "    bus.ends.push({ sessionID: input.sessionID, reason: input.reason, duration_ms: input.duration_ms })",
  "  },",
  "})",
  "",
].join("\n")

const readBus = () => (globalThis as any).__lifecycleBus ?? { starts: [], ends: [], stops: [] }

const clearBus = () => {
  ;(globalThis as any).__lifecycleBus = { starts: [], ends: [], stops: [] }
}

const installPlugin = Effect.gen(function* () {
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

describe("session lifecycle hooks (E2E via Session.create)", () => {
  it.instance("Session.create fires session.start with correct input", () =>
    Effect.gen(function* () {
      clearBus()
      yield* installPlugin
      const sessions = yield* Session.Service
      const session = yield* sessions.create({ title: "Hook Test" })

      const bus = readBus()
      expect(bus.starts.length).toBe(1)
      expect(bus.starts[0].sessionID).toBe(session.id)
      expect(typeof bus.starts[0].cwd).toBe("string")
      expect(bus.starts[0].cwd.length).toBeGreaterThan(0)
      expect(typeof bus.starts[0].timestamp).toBe("number")
    }),
  )
})