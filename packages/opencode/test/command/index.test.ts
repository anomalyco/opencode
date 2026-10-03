import path from "node:path"
import { expect } from "bun:test"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { CommandEvent } from "@opencode-ai/schema/command-event"
import { Deferred, Effect, Layer } from "effect"
import { Command } from "../../src/command/index"
import { EventV2Bridge } from "../../src/event-v2-bridge"
import { InstanceBootstrap } from "../../src/project/bootstrap"
import { InstanceStore } from "../../src/project/instance-store"
import { awaitWithTimeout, testEffect } from "../lib/effect"

const noopBootstrap = Layer.succeed(InstanceBootstrap.Service, InstanceBootstrap.Service.of({ run: Effect.void }))
const env = AppNodeBuilder.build(
  LayerNode.group([Command.node, EventV2Bridge.node, CrossSpawnSpawner.node, InstanceStore.node]),
  [[InstanceStore.bootstrapNode, noopBootstrap]],
)
const it = testEffect(env)
const slowFixture = path.join(import.meta.dir, "../fixture/mcp-slow-prompts-stdio.ts")

// Must exceed the awaitWithTimeout budget below so the old synchronous
// behavior (command.list blocking on every MCP connection) fails the test.
const CONNECT_DELAY_MS = 1500

it.instance(
  "command.list returns file commands immediately and merges MCP prompts in the background",
  Effect.gen(function* () {
    const command = yield* Command.Service

    const events = yield* EventV2Bridge.Service
    const eventSeen = yield* Deferred.make<string>()
    const unsub = yield* events.listen((event) => {
      if (event.type === CommandEvent.Updated.type) Deferred.doneUnsafe(eventSeen, Effect.succeed(event.type))
      return Effect.void
    })
    yield* Effect.addFinalizer(() => unsub)

    // File-based commands (config + defaults) must be available without
    // waiting for the slow MCP server to connect.
    const initial = yield* awaitWithTimeout(
      command.list(),
      "command.list blocked on MCP connections",
      `${CONNECT_DELAY_MS - 500} millis`,
    )
    const initialNames = new Set(initial.map((item) => item.name))
    expect(initialNames.has("hello")).toBe(true)
    expect(initialNames.has(Command.Default.INIT)).toBe(true)
    expect(initialNames.has(Command.Default.REVIEW)).toBe(true)
    expect(initialNames.has("slow-server:slow_prompt")).toBe(false)

    // Once MCP settles, prompts are merged into the same state and the
    // command.updated event notifies clients to re-fetch.
    yield* command.ready()
    expect(yield* Deferred.await(eventSeen)).toBe("command.updated")

    const settled = yield* command.list()
    const settledNames = new Set(settled.map((item) => item.name))
    expect(settledNames.has("hello")).toBe(true)
    const prompt = settled.find((item) => item.name === "slow-server:slow_prompt")
    expect(prompt?.source).toBe("mcp")
    expect(prompt?.description).toBe("A prompt from a slow MCP server")
  }),
  {
    config: {
      command: {
        hello: { template: "hello from a file-based command" },
      },
      mcp: {
        "slow-server": {
          type: "local",
          command: [process.execPath, slowFixture, "--delay-ms", String(CONNECT_DELAY_MS)],
        },
      },
    },
  },
  30_000,
)

it.instance(
  "ready resolves even when no MCP servers are configured",
  Effect.gen(function* () {
    const command = yield* Command.Service

    const initial = yield* command.list()
    expect(initial.map((item) => item.name)).toContain(Command.Default.INIT)

    yield* awaitWithTimeout(command.ready(), "command.ready hung without MCP servers", "5 seconds")
    const settled = yield* command.list()
    expect(settled.map((item) => item.name)).toContain("hello")
  }),
  {
    config: {
      command: {
        hello: { template: "hello from a file-based command" },
      },
    },
  },
)
