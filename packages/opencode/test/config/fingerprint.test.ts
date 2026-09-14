import { expect } from "bun:test"
import { Effect } from "effect"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { FSUtil } from "@opencode-ai/core/fs-util"
import fs from "fs/promises"
import path from "path"
import { ConfigFingerprint } from "@/config/fingerprint"
import { tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(LayerNode.compile(LayerNode.group([CrossSpawnSpawner.node, FSUtil.node])))

const hash = (dir: string) => ConfigFingerprint.hashInstanceInputs(dir, dir)

const write = (file: string, text: string) => Effect.promise(() => fs.writeFile(file, text))

// Point Global.Path.home at the temp project so the home-level .opencode
// lookup stays hermetic.
const withHome = <A, E, R>(dir: string, effect: Effect.Effect<A, E, R>) =>
  Effect.acquireUseRelease(
    Effect.sync(() => {
      const previous = process.env.OPENCODE_TEST_HOME
      process.env.OPENCODE_TEST_HOME = dir
      return previous
    }),
    () => effect,
    (previous) =>
      Effect.sync(() => {
        if (previous === undefined) delete process.env.OPENCODE_TEST_HOME
        else process.env.OPENCODE_TEST_HOME = previous
      }),
  )

const inTmpProject = <A, E, R>(fn: (dir: string) => Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const dir = yield* tmpdirScoped()
    return yield* withHome(dir, fn(dir))
  })

it.effect("is stable across calls when nothing changed", () =>
  inTmpProject((dir) =>
    Effect.gen(function* () {
      expect(yield* hash(dir)).toBe(yield* hash(dir))
    }),
  ),
)

it.effect("ignores key reordering in the project config", () =>
  inTmpProject((dir) =>
    Effect.gen(function* () {
      const file = path.join(dir, "opencode.json")
      yield* write(file, JSON.stringify({ username: "alice", logLevel: "DEBUG" }))
      const before = yield* hash(dir)
      yield* write(file, JSON.stringify({ logLevel: "DEBUG", username: "alice" }))
      expect(yield* hash(dir)).toBe(before)
    }),
  ),
)

it.effect("detects project config edits", () =>
  inTmpProject((dir) =>
    Effect.gen(function* () {
      const file = path.join(dir, "opencode.json")
      yield* write(file, JSON.stringify({ username: "alice" }))
      const before = yield* hash(dir)
      yield* write(file, JSON.stringify({ username: "bob" }))
      expect(yield* hash(dir)).not.toBe(before)
    }),
  ),
)

it.effect("detects added agent files", () =>
  inTmpProject((dir) =>
    Effect.gen(function* () {
      const before = yield* hash(dir)
      yield* Effect.promise(() => fs.mkdir(path.join(dir, ".opencode", "agent"), { recursive: true }))
      yield* write(path.join(dir, ".opencode", "agent", "reviewer.md"), "review things")
      expect(yield* hash(dir)).not.toBe(before)
    }),
  ),
)

it.effect("ignores theme files, which are rendering-only", () =>
  inTmpProject((dir) =>
    Effect.gen(function* () {
      const before = yield* hash(dir)
      yield* Effect.promise(() => fs.mkdir(path.join(dir, ".opencode", "themes"), { recursive: true }))
      yield* write(path.join(dir, ".opencode", "themes", "night.json"), JSON.stringify({ theme: {} }))
      expect(yield* hash(dir)).toBe(before)
    }),
  ),
)

it.effect("detects plugin file changes", () =>
  inTmpProject((dir) =>
    Effect.gen(function* () {
      const plugin = path.join(dir, ".opencode", "plugin")
      yield* Effect.promise(() => fs.mkdir(plugin, { recursive: true }))
      const file = path.join(plugin, "x.ts")
      yield* write(file, "export const a = 1")
      const before = yield* hash(dir)
      yield* write(file, "export const a = 2")
      expect(yield* hash(dir)).not.toBe(before)
    }),
  ),
)

it.effect("treats a malformed config as a state and detects fixing it", () =>
  inTmpProject((dir) =>
    Effect.gen(function* () {
      const file = path.join(dir, "opencode.json")
      yield* write(file, "{ not json")
      const broken = yield* hash(dir)
      yield* write(file, JSON.stringify({ username: "alice" }))
      expect(yield* hash(dir)).not.toBe(broken)
    }),
  ),
)
