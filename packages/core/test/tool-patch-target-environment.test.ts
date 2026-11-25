import fs from "fs/promises"
import path from "path"
import { describe, expect } from "bun:test"
import { Deferred, Effect, Fiber, Layer } from "effect"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { makeLocationNode } from "@opencode/util/effect/app-node"
import { Config } from "@opencode/core/config"
import { Environment } from "@opencode/core/environment/index"
import { FileAccess } from "@opencode/core/file-access"
import { FileMutation } from "@opencode/core/file-mutation"
import { FileWrite } from "@opencode/core/file-write"
import { Flag } from "@opencode/core/flag"
import { Formatter } from "@opencode/core/formatter"
import { Location } from "@opencode/core/location"
import { Permission } from "@opencode/core/permission"
import { AbsolutePath } from "@opencode/core/schema"
import { Session } from "@opencode/core/session"
import { Tool } from "@opencode/core/tool"
import { PatchTool } from "@opencode/core/tool/plugin/patch"
import { elsewhere } from "./fixture/target-environment"
import { withTempDir } from "./fixture/tmpdir"
import { testEffect } from "./lib/effect"
import { executeTool, registerToolPlugin, toolIdentity } from "./lib/tool"

const patchToolNode = makeLocationNode({
  name: "test/patch-target-environment-plugin",
  layer: Layer.effectDiscard(registerToolPlugin(PatchTool.Plugin)),
  deps: [
    Tool.node,
    FileAccess.node,
    FileMutation.node,
    FileWrite.node,
    Environment.node,
    Formatter.node,
    Location.node,
    Permission.node,
    Config.node,
    Flag.node,
  ],
})

/**
 * A session with two environments: a path under `there/` is the same path without that prefix in the other
 * environment, and every other path stays in the session's own.
 */
const twoEnvironments = (directory: string) => {
  const other = elsewhere(directory)
  const access = Layer.effect(
    FileAccess.Service,
    Effect.gen(function* () {
      const placed = yield* FileAccess.Service
      const session = yield* Environment.Service
      return FileAccess.Service.of({
        ...placed,
        resolve: (input) =>
          input.path.startsWith("there/")
            ? placed.resolve({ ...input, path: input.path.slice("there/".length) })
            : placed.resolve(input).pipe(Effect.map((target) => ({ ...target, environment: session }))),
      })
    }),
  ).pipe(
    Layer.provide(
      LayerNode.compile(LayerNode.group([FileAccess.node, Environment.node]), { replacements: other.replacements }),
    ),
  )
  return {
    other: other.environment,
    provide: Effect.provide(
      AppNodeBuilder.build(LayerNode.group([Tool.node, FileAccess.node, FileMutation.node, patchToolNode]), [
        ...other.replacements,
        FileAccess.node.replace(access),
        Formatter.node.replace(Layer.mock(Formatter.Service, { file: () => Effect.succeed(false) })),
        Config.node.replace(Config.testLayer()),
      ]),
    ),
  }
}

const patch = (registry: Tool.Interface, lines: ReadonlyArray<string>) =>
  executeTool(registry, {
    sessionID: Session.ID.make("ses_patch_target_environment_test"),
    ...toolIdentity,
    call: {
      type: "tool-call",
      id: "call-patch",
      name: "patch",
      input: { patchText: ["*** Begin Patch", ...lines, "*** End Patch"].join("\n") },
    },
  })

const text = (files: Environment.Files, file: string) =>
  files.read(file).pipe(Effect.map((result) => new TextDecoder().decode(result.bytes)))

const it = testEffect(Layer.succeed(Flag.Overrides, undefined))

describe("patch across two environments", () => {
  it.live("keeps the same path in each environment apart within one patch", () =>
    withTempDir((tmp) => {
      const file = path.join(tmp.path, "notes.txt")
      const session = twoEnvironments(tmp.path)

      return Effect.gen(function* () {
        yield* Effect.promise(() => fs.writeFile(file, "here\n"))
        yield* session.other.files.write(file, new TextEncoder().encode("there\n"))

        expect(
          yield* patch(yield* Tool.Service, [
            "*** Update File: notes.txt",
            "@@",
            "-here",
            "+here changed",
            "*** Update File: there/notes.txt",
            "@@",
            "-there",
            "+there changed",
          ]),
        ).toMatchObject({
          status: "completed",
          metadata: {
            files: [
              { patch: expect.stringContaining("-here\n+here changed") },
              { patch: expect.stringContaining("-there\n+there changed") },
            ],
          },
        })
        expect(yield* Effect.promise(() => fs.readFile(file, "utf8"))).toBe("here changed\n")
        expect(yield* text(session.other.files, file)).toBe("there changed\n")
      }).pipe(session.provide)
    }),
  )

  it.live("moves a file to the same path in the other environment instead of renaming it", () =>
    withTempDir((tmp) => {
      const file = path.join(tmp.path, "notes.txt")
      const session = twoEnvironments(tmp.path)

      return Effect.gen(function* () {
        yield* Effect.promise(() => fs.writeFile(file, "here\n"))
        // A file already at the destination is what a rename that only changes case finds.
        yield* session.other.files.write(file, new TextEncoder().encode("old\n"))

        expect(
          yield* patch(yield* Tool.Service, [
            "*** Update File: notes.txt",
            "*** Move to: there/notes.txt",
            "@@",
            "-here",
            "+moved",
          ]),
        ).toMatchObject({ status: "completed" })
        expect(yield* text(session.other.files, file)).toBe("moved\n")
        expect(yield* Effect.promise(() => fs.readdir(tmp.path))).toEqual([])
      }).pipe(session.provide)
    }),
  )
})

describe("FileMutation across two environments", () => {
  it.live("locks the same path in each environment separately, and one environment's path once", () =>
    withTempDir((tmp) => {
      const session = twoEnvironments(tmp.path)

      return Effect.gen(function* () {
        const access = yield* FileAccess.Service
        const files = yield* FileMutation.Service
        const here = yield* access.resolve({ path: "notes.txt" })
        const there = yield* access.resolve({ path: "there/notes.txt" })
        expect(FileAccess.key(there)).not.toBe(FileAccess.key(here))
        expect(there.absolute).toBe(here.absolute)
        const firstStarted = yield* Deferred.make<void>()
        const releaseFirst = yield* Deferred.make<void>()
        const sameStarted = yield* Deferred.make<void>()

        const first = yield* files
          .withLock([here])(
            Deferred.succeed(firstStarted, undefined).pipe(Effect.andThen(Deferred.await(releaseFirst))),
          )
          .pipe(Effect.forkChild)
        yield* Deferred.await(firstStarted)
        // Never finishes if the two environments share the path's lock.
        yield* files.withLock([there])(Effect.void)
        // A path not resolved yet, as the patch and edit tools lock it, is the session's own file.
        const same = yield* files
          .withLock([here.absolute])(Deferred.succeed(sameStarted, undefined))
          .pipe(Effect.forkChild)
        yield* Effect.yieldNow
        expect(yield* Deferred.isDone(sameStarted)).toBe(false)

        yield* Deferred.succeed(releaseFirst, undefined)
        yield* Deferred.await(sameStarted)
        yield* Fiber.join(first)
        yield* Fiber.join(same)
      }).pipe(session.provide)
    }),
  )

  it.live("serializes writes to one environment's file, not to the same path in another", () =>
    withTempDir((tmp) =>
      Effect.gen(function* () {
        const files = yield* FileMutation.Service
        const firstStarted = yield* Deferred.make<void>()
        const releaseFirst = yield* Deferred.make<void>()
        const memory = Environment.make(Environment.ID.make("first"), Environment.makeMemoryDriver())
        let writes = 0
        const target = {
          absolute: AbsolutePath.make("/work/notes.txt"),
          resource: "notes.txt",
          environment: {
            ...memory,
            files: {
              ...memory.files,
              write: (file: string, bytes: Uint8Array) =>
                ++writes === 1
                  ? Deferred.succeed(firstStarted, undefined).pipe(
                      Effect.andThen(Deferred.await(releaseFirst)),
                      Effect.andThen(memory.files.write(file, bytes)),
                    )
                  : memory.files.write(file, bytes),
            },
          },
        }
        const second = Environment.make(Environment.ID.make("second"), Environment.makeMemoryDriver())

        const first = yield* files.write({ target, content: "one" }).pipe(Effect.forkChild)
        yield* Deferred.await(firstStarted)
        // Never finishes if the two environments share the path's lock.
        yield* files.write({ target: { ...target, environment: second }, content: "other" })
        const same = yield* files.write({ target, content: "two" }).pipe(Effect.forkChild)
        yield* Effect.yieldNow
        expect(writes).toBe(1)

        yield* Deferred.succeed(releaseFirst, undefined)
        yield* Fiber.join(first)
        yield* Fiber.join(same)
        expect(yield* text(memory.files, target.absolute)).toBe("two")
        expect(yield* text(second.files, target.absolute)).toBe("other")
      }).pipe(twoEnvironments(tmp.path).provide),
    ),
  )
})
