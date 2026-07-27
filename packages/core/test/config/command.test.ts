import fs from "fs/promises"
import path from "path"
import { describe, expect } from "bun:test"
import { Effect, Fiber, PubSub, Schema, Stream } from "effect"
import { advance, drain } from "../lib/clock"
import { Config as ConfigSchema } from "@opencode-ai/schema/config"
import { Command } from "@opencode-ai/core/command"
import { Agent } from "@opencode-ai/core/agent"
import { Config } from "@opencode-ai/core/config"
import { ConfigCommandPlugin } from "@opencode-ai/core/config/plugin/command"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/util/effect/layer-node"
import { FSUtil } from "@opencode-ai/util/fs-util"
import { Bus } from "@opencode-ai/core/bus"
import { Location } from "@opencode-ai/core/location"
import { MCP } from "@opencode-ai/core/mcp/index"
import { Model } from "@opencode-ai/core/model"
import { Provider } from "@opencode-ai/core/provider"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { emptyConfigLayer, emptyMcpLayer, testLocationLayer } from "../fixture/mcp"
import { tmpdir } from "../fixture/tmpdir"
import { testEffect } from "../lib/effect"
import { host } from "../plugin/host"

const it = testEffect(
  AppNodeBuilder.build(LayerNode.group([Command.node, Bus.node, FSUtil.node]), [
    [MCP.node, emptyMcpLayer],
    [Config.node, emptyConfigLayer],
    [Location.node, testLocationLayer],
  ]),
)
const decode = Schema.decodeUnknownSync(Config.Info)

describe("ConfigCommandPlugin.Plugin", () => {
  it.live("loads inline and file-based commands in config order", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((tmp) =>
        Effect.gen(function* () {
          yield* Effect.promise(async () => {
            await fs.mkdir(path.join(tmp.path, "commands", "nested"), { recursive: true })
            await fs.writeFile(
              path.join(tmp.path, "commands", "review.md"),
              `---
description: File review
agent: reviewer
model: anthropic/claude#high
subtask: true
---
Review files`,
            )
            await fs.writeFile(path.join(tmp.path, "commands", "nested", "docs.md"), "Write docs")
            await fs.writeFile(path.join(tmp.path, "commands", "empty.md"), "")
          })

          const command = yield* Command.Service
          const bus = yield* Bus.Service
          const update = yield* bus.publish(ConfigSchema.Event.Updated, {})
          const updates = yield* PubSub.unbounded<typeof update>()
          yield* ConfigCommandPlugin.Plugin.effect(
            host({
              command: {
                list: () => Effect.die("unused command.list"),
                transform: command.transform,
                reload: command.reload,
              },
              event: { subscribe: () => Stream.fromPubSub(updates) },
            }),
          ).pipe(
            Effect.provide(
              Config.testLayer([
                new Config.Document({
                  type: "document",
                  info: decode({ commands: { review: { template: "Inline review" } } }),
                }),
                new Config.Directory({ type: "directory", path: AbsolutePath.make(tmp.path) }),
              ]),
            ),
          )

          expect(yield* command.list()).toEqual([
            Command.Info.make({
              name: "review",
              template: "Review files",
              description: "File review",
              agent: Agent.ID.make("reviewer"),
              model: {
                providerID: Provider.ID.make("anthropic"),
                id: Model.ID.make("claude"),
                variant: Model.VariantID.make("high"),
              },
              subtask: true,
            }),
            Command.Info.make({ name: "empty", template: "" }),
            Command.Info.make({ name: "nested/docs", template: "Write docs" }),
          ])

          yield* Effect.promise(() => fs.writeFile(path.join(tmp.path, "commands", "review.md"), "Review again"))
          yield* Effect.sleep("10 millis")
          yield* PubSub.publish(updates, update)
          for (let attempt = 0; attempt < 100; attempt++) {
            if ((yield* command.get("review"))?.template === "Review again") break
            yield* Effect.sleep("10 millis")
          }
          expect((yield* command.get("review"))?.template).toBe("Review again")
        }),
      ),
    ),
  )

  for (const testCase of sourceCases()) {
    it.effect(`rebuilds commands when a source file is ${testCase.name}`, () =>
      Effect.acquireRelease(
        Effect.promise(() => tmpdir()),
        (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
      ).pipe(
        Effect.flatMap((tmp) =>
          Effect.gen(function* () {
            const directory = path.join(tmp.path, "commands")
            yield* Effect.promise(() => fs.mkdir(directory, { recursive: true }))
            yield* testCase.prepare(directory)

            const command = yield* Command.Service
            const bus = yield* Bus.Service
            const configTest = yield* Config.Test
            yield* ConfigCommandPlugin.Plugin.effect(
              host({
                command: {
                  list: () => Effect.die("unused command.list"),
                  transform: command.transform,
                  reload: command.reload,
                },
              }),
            )

            // Verify inside the subscription so the update event is a read barrier:
            // committed state must be visible at event delivery time.
            let received = 0
            const changed = yield* bus.subscribe(Command.Event.Updated).pipe(
              Stream.take(1),
              Stream.tap(() => Effect.sync(() => received++)),
              Stream.mapEffect(() => testCase.verify(command)),
              Stream.runDrain,
              Effect.forkScoped({ startImmediately: true }),
            )
            yield* Effect.yieldNow

            const updates = yield* testCase.mutate(directory)
            yield* Effect.forEach(updates, (update) => configTest.emitChange(update), { discard: true })
            yield* advance(() => received === 1)
            yield* Fiber.join(changed)
          }).pipe(Effect.provide(Config.testLayer([directoryEntry(tmp.path)]))),
        ),
      ),
    )
  }

  it.effect("coalesces updates inside the debounce window into one rebuild", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((tmp) =>
        Effect.gen(function* () {
          const directory = path.join(tmp.path, "commands")
          yield* Effect.promise(() => fs.mkdir(directory, { recursive: true }))

          const command = yield* Command.Service
          const configTest = yield* Config.Test
          let reloads = 0
          yield* ConfigCommandPlugin.Plugin.effect(
            host({
              command: {
                list: () => Effect.die("unused command.list"),
                transform: command.transform,
                reload: () => command.reload().pipe(Effect.tap(() => Effect.sync(() => reloads++))),
              },
            }),
          )
          yield* Effect.promise(() => fs.writeFile(path.join(directory, "review.md"), "Review once"))
          yield* configTest.emitChange({ type: "create", path: path.join(directory, "review.md") })
          yield* configTest.emitChange({ type: "update", path: path.join(directory, "review.md") })
          yield* configTest.emitChange({ type: "update", path: path.join(directory, "review.md") })
          yield* advance(() => reloads >= 1)
          expect(reloads).toBe(1)

          yield* Effect.promise(() => fs.writeFile(path.join(directory, "review.md"), "Review twice"))
          yield* configTest.emitChange({ type: "update", path: path.join(directory, "review.md") })
          yield* advance(() => reloads >= 2)
          expect(reloads).toBe(2)
          expect((yield* command.get("review"))?.template).toBe("Review twice")
        }).pipe(Effect.provide(Config.testLayer([directoryEntry(tmp.path)]))),
      ),
    ),
  )

  it.effect("ignores updates outside command source directories", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((tmp) =>
        Effect.gen(function* () {
          const directory = path.join(tmp.path, "commands")
          yield* Effect.promise(() => fs.mkdir(directory, { recursive: true }))

          const command = yield* Command.Service
          const configTest = yield* Config.Test
          let reloads = 0
          yield* ConfigCommandPlugin.Plugin.effect(
            host({
              command: {
                list: () => Effect.die("unused command.list"),
                transform: command.transform,
                reload: () => command.reload().pipe(Effect.tap(() => Effect.sync(() => reloads++))),
              },
            }),
          )

          yield* configTest.emitChange({ type: "create", path: path.join(tmp.path, "notes", "todo.md") })
          yield* configTest.emitChange({ type: "update", path: path.join(tmp.path, "opencode.json") })
          yield* drain
          expect(reloads).toBe(0)

          // The feed stays live after unrelated updates.
          yield* Effect.promise(() => fs.writeFile(path.join(directory, "review.md"), "Review related"))
          yield* configTest.emitChange({ type: "create", path: path.join(directory, "review.md") })
          yield* advance(() => reloads >= 1)
          expect((yield* command.get("review"))?.template).toBe("Review related")
        }).pipe(Effect.provide(Config.testLayer([directoryEntry(tmp.path)]))),
      ),
    ),
  )
})

function directoryEntry(directory: string) {
  return new Config.Directory({ type: "directory", path: AbsolutePath.make(directory) })
}

function sourceCases() {
  return [
    {
      name: "created",
      prepare: () => Effect.void,
      mutate: (directory: string) =>
        Effect.promise(async () => {
          const file = path.join(directory, "review.md")
          await fs.writeFile(file, "Review created")
          return [{ type: "create" as const, path: file }]
        }),
      verify: (command: Command.Interface) =>
        Effect.gen(function* () {
          expect((yield* command.get("review"))?.template).toBe("Review created")
        }),
    },
    {
      name: "updated",
      prepare: (directory: string) =>
        Effect.promise(() => fs.writeFile(path.join(directory, "review.md"), "Review first")),
      mutate: (directory: string) =>
        Effect.promise(async () => {
          const file = path.join(directory, "review.md")
          await fs.writeFile(file, "Review updated")
          return [{ type: "update" as const, path: file }]
        }),
      verify: (command: Command.Interface) =>
        Effect.gen(function* () {
          expect((yield* command.get("review"))?.template).toBe("Review updated")
        }),
    },
    {
      name: "renamed",
      prepare: (directory: string) =>
        Effect.promise(() => fs.writeFile(path.join(directory, "review.md"), "Review renamed")),
      mutate: (directory: string) =>
        Effect.promise(async () => {
          const previous = path.join(directory, "review.md")
          const next = path.join(directory, "release.md")
          await fs.rename(previous, next)
          return [
            { type: "delete" as const, path: previous },
            { type: "create" as const, path: next },
          ]
        }),
      verify: (command: Command.Interface) =>
        Effect.gen(function* () {
          expect(yield* command.get("review")).toBeUndefined()
          expect((yield* command.get("release"))?.template).toBe("Review renamed")
        }),
    },
    {
      name: "deleted",
      prepare: (directory: string) =>
        Effect.promise(() => fs.writeFile(path.join(directory, "review.md"), "Review deleted")),
      mutate: (directory: string) =>
        Effect.promise(async () => {
          const file = path.join(directory, "review.md")
          await fs.unlink(file)
          return [{ type: "delete" as const, path: file }]
        }),
      verify: (command: Command.Interface) =>
        Effect.gen(function* () {
          expect(yield* command.get("review")).toBeUndefined()
        }),
    },
  ] as const
}
