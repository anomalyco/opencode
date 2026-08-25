import fs from "fs/promises"
import path from "path"
import { describe, expect } from "bun:test"
import { DateTime, Deferred, Effect, Fiber, Layer, Option, PubSub, Schema, Stream } from "effect"
import { advance, drain } from "../lib/clock"
import { Directory, Document, Event, Info } from "@opencode-ai/schema/config"
import { Session } from "@opencode-ai/schema/session"
import { SessionInbox } from "@opencode-ai/schema/session-inbox"
import { SessionMessage } from "@opencode-ai/schema/session-message"
import { Command } from "@opencode-ai/core/command"
import { Config } from "@opencode-ai/core/config"
import { ConfigCommandPlugin } from "@opencode-ai/core/config/plugin/command"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/util/effect/layer-node"
import { FSUtil } from "@opencode-ai/util/fs-util"
import { Bus } from "@opencode-ai/core/bus"
import { Credential } from "@opencode-ai/core/credential"
import { WellKnown } from "@opencode-ai/core/wellknown"
import { Global } from "@opencode-ai/util/global"
import { AppProcess } from "@opencode-ai/util/process"
import { Location } from "@opencode-ai/core/location"
import { MCP } from "@opencode-ai/core/mcp/index"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { ShellSelect } from "@opencode-ai/core/shell/select"
import { Watcher } from "@opencode-ai/core/filesystem/watcher"
import { emptyCredentialNode, emptyWellknownNode } from "../fixture/config-nodes"
import { emptyConfigLayer, emptyMcpLayer, testLocationLayer } from "../fixture/mcp"
import { location } from "../fixture/location"
import { tmpdir } from "../fixture/tmpdir"
import { testEffect } from "../lib/effect"
import { host } from "../plugin/host"

const shellLayer = Layer.succeed(
  ShellSelect.Service,
  ShellSelect.Service.of({
    resolve: () => Effect.succeed("sh"),
    transform: () => Effect.die("unused shell.transform"),
    reload: () => Effect.die("unused shell.reload"),
  }),
)

const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([Command.node, Bus.node, FSUtil.node, AppProcess.node, Location.node, ShellSelect.node]),
    [
      [MCP.node, emptyMcpLayer],
      [Config.node, emptyConfigLayer],
      [Location.node, testLocationLayer],
      [ShellSelect.node, shellLayer],
    ],
  ),
)
const decode = Schema.decodeUnknownSync(Info)

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
          const update = yield* bus.publish(Event.Updated, {})
          const updates = yield* PubSub.unbounded<typeof update>()
          const prompts: { text: string; files?: readonly { readonly uri: string }[]; delivery?: string }[] = []
          yield* ConfigCommandPlugin.Plugin.effect(
            host({
              command: {
                list: () => Effect.die("unused command.list"),
                transform: command.transform,
                reload: command.reload,
              },
              event: { subscribe: () => Stream.fromPubSub(updates) },
              session: {
                prompt: (input) =>
                  Effect.sync(() => {
                    prompts.push({ text: input.text, files: input.files, delivery: input.delivery })
                    return SessionInbox.User.make({
                      id: SessionMessage.ID.make("msg_test"),
                      sessionID: input.sessionID,
                      timeCreated: DateTime.makeUnsafe(0),
                      type: "user",
                      payload: { text: input.text },
                      delivery: input.delivery ?? "steer",
                    })
                  }),
              },
            }),
          ).pipe(
            Effect.provide(
              Config.testLayer([
                new Document({
                  type: "document",
                  info: decode({ commands: { review: { template: "Inline review" } } }),
                }),
                new Directory({ type: "directory", path: AbsolutePath.make(tmp.path) }),
              ]),
            ),
          )

          expect(yield* command.list()).toEqual([
            Command.Info.make({
              name: "review",
              description: "File review",
            }),
            Command.Info.make({ name: "empty" }),
            Command.Info.make({ name: "nested/docs" }),
          ])
          yield* command.execute({
            name: "nested/docs",
            invocation: {
              sessionID: Session.ID.make("ses_test"),
              prompt: { text: "details", files: [{ uri: "file:///tmp/context.md" }] },
              delivery: "queue",
            },
          })
          expect(prompts).toEqual([
            {
              text: "Write docs\n\ndetails",
              files: [{ uri: "file:///tmp/context.md" }],
              delivery: "queue",
            },
          ])

          yield* Effect.promise(() =>
            fs.writeFile(path.join(tmp.path, "commands", "review.md"), markdown("Review again", "Review again")),
          )
          yield* Effect.sleep("10 millis")
          yield* PubSub.publish(updates, update)
          for (let attempt = 0; attempt < 100; attempt++) {
            if ((yield* command.get("review"))?.description === "Review again") break
            yield* Effect.sleep("10 millis")
          }
          expect((yield* command.get("review"))?.description).toBe("Review again")
          yield* command.execute({
            name: "review",
            invocation: {
              sessionID: Session.ID.make("ses_test"),
              prompt: { text: "latest" },
              delivery: "steer",
            },
          })
          expect(prompts.at(-1)?.text).toBe("Review again\n\nlatest")
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
          yield* Effect.yieldNow
          yield* Effect.promise(() => fs.writeFile(path.join(directory, "review.md"), "Review once"))
          yield* configTest.emitChange({ type: "create", path: path.join(directory, "review.md") })
          yield* configTest.emitChange({ type: "update", path: path.join(directory, "review.md") })
          yield* configTest.emitChange({ type: "update", path: path.join(directory, "review.md") })
          yield* advance(() => reloads >= 1)
          expect(reloads).toBe(1)

          yield* Effect.promise(() =>
            fs.writeFile(path.join(directory, "review.md"), markdown("Review twice", "Review twice")),
          )
          yield* configTest.emitChange({ type: "update", path: path.join(directory, "review.md") })
          yield* advance(() => reloads >= 2)
          expect(reloads).toBe(2)
          expect((yield* command.get("review"))?.description).toBe("Review twice")
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
          yield* Effect.promise(() =>
            fs.writeFile(path.join(directory, "review.md"), markdown("Review related", "Review related")),
          )
          yield* configTest.emitChange({ type: "create", path: path.join(directory, "review.md") })
          yield* advance(() => reloads >= 1)
          expect((yield* command.get("review"))?.description).toBe("Review related")
        }).pipe(Effect.provide(Config.testLayer([directoryEntry(tmp.path)]))),
      ),
    ),
  )
})

const describeNative = Watcher.hasNativeBinding() && !process.env.CI ? describe : describe.skip

// End-to-end proof for #37429: a real file edit reaches the command registry
// through the native watcher, Config's watch topology, the source filter, and
// the debounced reload — no mocked change feed.
describeNative("ConfigCommandPlugin native watcher", () => {
  it.live("reloads commands from real file edits", () =>
    Effect.gen(function* () {
      const fs = yield* FSUtil.Service
      // Watcher events report real paths, so resolve the tempdir symlink up front.
      const tmp = yield* fs.makeTempDirectoryScoped({ prefix: "opencode-core-test-" }).pipe(Effect.flatMap(fs.realPath))
      const global = path.join(tmp, "global")
      yield* fs.makeDirectory(path.join(global, "commands"), { recursive: true })
      yield* fs.makeDirectory(path.join(tmp, "project"))
      yield* Effect.gen(function* () {
        const command = yield* Command.Service
        const config = yield* Config.Service
        const bus = yield* Bus.Service
        yield* ConfigCommandPlugin.Plugin.effect(
          host({
            command: {
              list: () => Effect.die("unused command.list"),
              transform: command.transform,
              reload: command.reload,
            },
          }),
        )
        yield* watchReady(config, global)

        const created = yield* nextCommandUpdate(bus)
        yield* fs.writeFileString(
          path.join(global, "commands", "review.md"),
          markdown("Review native", "Review native"),
        )
        yield* Fiber.join(created).pipe(Effect.timeout("10 seconds"))
        expect((yield* command.get("review"))?.description).toBe("Review native")

        const updated = yield* nextCommandUpdate(bus)
        yield* fs.writeFileString(
          path.join(global, "commands", "review.md"),
          markdown("Review native again", "Review native again"),
        )
        yield* Fiber.join(updated).pipe(Effect.timeout("10 seconds"))
        expect((yield* command.get("review"))?.description).toBe("Review native again")
      }).pipe(
        Effect.provide(
          AppNodeBuilder.build(
            LayerNode.group([
              Command.node,
              Config.node,
              Bus.node,
              FSUtil.node,
              AppProcess.node,
              Global.node,
              Location.node,
              ShellSelect.node,
            ]),
            [
              [
                Location.node,
                Layer.succeed(
                  Location.Service,
                  Location.Service.of(location({ directory: AbsolutePath.make(path.join(tmp, "project")) })),
                ),
              ],
              [Global.node, Global.layerWith({ config: global, home: path.join(global, "home") })],
              [ShellSelect.node, shellLayer],
              [Credential.node, emptyCredentialNode],
              [WellKnown.node, emptyWellknownNode],
            ],
          ),
        ),
      )
    }),
  )
})

function nextCommandUpdate(bus: Bus.Interface) {
  return bus
    .subscribe(Command.Event.Updated)
    .pipe(Stream.take(1), Stream.runDrain, Effect.forkScoped({ startImmediately: true }))
}

// Native directory watches start asynchronously; probe with unrelated files
// until the change feed delivers so command edits afterwards cannot be missed.
function watchReady(config: Config.Interface, directory: string) {
  return Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    const seen = yield* Deferred.make<void>()
    const listener = yield* config.changes().pipe(
      Stream.runForEach(() => Deferred.succeed(seen, undefined).pipe(Effect.asVoid)),
      Effect.forkScoped({ startImmediately: true }),
    )
    yield* Effect.yieldNow
    const probe = path.join(directory, ".watch-probe")
    while (true) {
      yield* fs.writeFileString(probe, `ready-${Math.random()}`)
      const result = yield* Deferred.await(seen).pipe(Effect.timeoutOption("250 millis"))
      if (Option.isSome(result)) break
    }
    yield* Fiber.interrupt(listener)
    yield* fs.remove(probe, { force: true })
  }).pipe(
    Effect.timeoutOrElse({
      duration: "10 seconds",
      orElse: () => Effect.fail(new Error("timed out waiting for the config watch to become ready")),
    }),
  )
}

function directoryEntry(directory: string) {
  return new Directory({ type: "directory", path: AbsolutePath.make(directory) })
}

function markdown(description: string, template: string) {
  return `---\ndescription: ${description}\n---\n${template}`
}

function sourceCases() {
  return [
    {
      name: "created",
      prepare: () => Effect.void,
      mutate: (directory: string) =>
        Effect.promise(async () => {
          const file = path.join(directory, "review.md")
          await fs.writeFile(file, markdown("Review created", "Review created"))
          return [{ type: "create" as const, path: file }]
        }),
      verify: (command: Command.Interface) =>
        Effect.gen(function* () {
          expect((yield* command.get("review"))?.description).toBe("Review created")
        }),
    },
    {
      name: "updated",
      prepare: (directory: string) =>
        Effect.promise(() =>
          fs.writeFile(path.join(directory, "review.md"), markdown("Review first", "Review first")),
        ),
      mutate: (directory: string) =>
        Effect.promise(async () => {
          const file = path.join(directory, "review.md")
          await fs.writeFile(file, markdown("Review updated", "Review updated"))
          return [{ type: "update" as const, path: file }]
        }),
      verify: (command: Command.Interface) =>
        Effect.gen(function* () {
          expect((yield* command.get("review"))?.description).toBe("Review updated")
        }),
    },
    {
      name: "renamed",
      prepare: (directory: string) =>
        Effect.promise(() =>
          fs.writeFile(path.join(directory, "review.md"), markdown("Review renamed", "Review renamed")),
        ),
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
          expect((yield* command.get("release"))?.description).toBe("Review renamed")
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
