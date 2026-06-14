import fs from "fs/promises"
import os from "os"
import path from "path"
import { beforeEach, describe, expect, test } from "bun:test"
import { Effect, Exit, Layer } from "effect"
import { Config } from "@opencode-ai/core/config"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Global } from "@opencode-ai/core/global"
import { Image } from "@opencode-ai/core/image"
import { Location } from "@opencode-ai/core/location"
import { LocationMutation } from "@opencode-ai/core/location-mutation"
import { PermissionV2 } from "@opencode-ai/core/permission"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { SessionV2 } from "@opencode-ai/core/session"
import { FileSystem } from "@opencode-ai/core/filesystem"
import { ReadTool } from "@opencode-ai/core/tool/read"
import { ReadToolFileSystem } from "@opencode-ai/core/tool/read-filesystem"
import { ToolRegistry } from "@opencode-ai/core/tool/registry"
import { location } from "./fixture/location"
import { tmpdir } from "./fixture/tmpdir"
import { it as effectIt, testEffect } from "./lib/effect"
import { executeTool, toolIdentity } from "./lib/tool"

const home = os.homedir()

// ---------------------------------------------------------------------------
// Pure helper: only `~` and `~/` (and `~\` on Windows) expand; `~user` is literal.
// ---------------------------------------------------------------------------
describe("FSUtil.expandHome", () => {
  test('expands a bare "~" to the home directory', () => {
    expect(FSUtil.expandHome("~")).toBe(home)
  })

  test('expands a "~/" prefix onto the home directory', () => {
    expect(FSUtil.expandHome("~/.bashrc")).toBe(path.join(home, ".bashrc"))
    expect(FSUtil.expandHome("~/nested/file.txt")).toBe(path.join(home, "nested", "file.txt"))
  })

  test("keeps duplicate separators after ~/ inside the home directory", () => {
    expect(FSUtil.expandHome("~//nested/file.txt")).toBe(path.join(home, "nested", "file.txt"))
  })

  test('leaves "~user" forms literal (named-user homes are out of scope)', () => {
    expect(FSUtil.expandHome("~root")).toBe("~root")
    expect(FSUtil.expandHome("~alice/file")).toBe("~alice/file")
  })

  test("leaves ordinary relative and absolute paths untouched", () => {
    expect(FSUtil.expandHome("src/main.ts")).toBe("src/main.ts")
    expect(FSUtil.expandHome("./a/../b")).toBe("./a/../b")
    expect(FSUtil.expandHome("/etc/hosts")).toBe("/etc/hosts")
    expect(FSUtil.expandHome("file~with~tilde.txt")).toBe("file~with~tilde.txt")
  })
})

// ---------------------------------------------------------------------------
// write/edit resolution flows through LocationMutation.resolve.
// ---------------------------------------------------------------------------
function provideMutation(directory: string) {
  return Effect.provide(
    LocationMutation.layer.pipe(
      Layer.provide(
        Layer.mergeAll(
          FSUtil.defaultLayer,
          Layer.succeed(Location.Service, Location.Service.of(location({ directory: AbsolutePath.make(directory) }))),
        ),
      ),
    ),
  )
}

function withTmp<A, E, R>(f: (directory: string) => Effect.Effect<A, E, R>) {
  return Effect.acquireRelease(
    Effect.promise(() => tmpdir()),
    (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
  ).pipe(Effect.flatMap((tmp) => f(tmp.path)))
}

describe("LocationMutation tilde expansion (write/edit)", () => {
  effectIt.live("resolves a ~/ path to a home-directory target instead of a literal ~ folder", () =>
    withTmp((directory) =>
      Effect.gen(function* () {
        // A unique probe under the real home directory so the canonical path is deterministic.
        const name = `opencode-tilde-${process.pid}-${Date.now()}.txt`
        const target = yield* (yield* LocationMutation.Service).resolve({ path: `~/${name}`, kind: "file" })
        const realHome = yield* Effect.promise(() => fs.realpath(home))

        expect(target.canonical).toBe(path.join(realHome, name))
        // Home is outside the active Location, so it is gated as an external directory.
        expect(target.externalDirectory?.directory).toBe(realHome)
      }).pipe(provideMutation(directory)),
    ),
  )

  effectIt.live('resolves a bare "~" to the home directory', () =>
    withTmp((directory) =>
      Effect.gen(function* () {
        const target = yield* (yield* LocationMutation.Service).resolve({ path: "~", kind: "directory" })
        const realHome = yield* Effect.promise(() => fs.realpath(home))
        expect(target.canonical).toBe(realHome)
      }).pipe(provideMutation(directory)),
    ),
  )

  effectIt.live("still rejects a genuinely relative path that escapes the Location", () =>
    withTmp((directory) =>
      Effect.gen(function* () {
        const error = yield* Effect.flip((yield* LocationMutation.Service).resolve({ path: "../outside.txt" }))
        expect(error).toMatchObject({ _tag: "LocationMutation.PathError", reason: "relative_escape" })
      }).pipe(provideMutation(directory)),
    ),
  )
})

// ---------------------------------------------------------------------------
// read resolution flows through the read tool's own path handling.
// ---------------------------------------------------------------------------
const readCalls: AbsolutePath[] = []
const reader = Layer.succeed(
  ReadToolFileSystem.Service,
  ReadToolFileSystem.Service.of({
    inspect: () => Effect.succeed("file" as const),
    read: (input) => {
      readCalls.push(input)
      return Effect.succeed({
        uri: "file:///probe",
        name: "probe",
        content: "hi",
        encoding: "utf8",
        mime: "text/plain",
      } satisfies FileSystem.Content)
    },
    list: () => Effect.succeed(new ReadToolFileSystem.ListPage({ entries: [], truncated: false })),
  }),
)
const permission = Layer.succeed(
  PermissionV2.Service,
  PermissionV2.Service.of({
    assert: () => Effect.void,
    ask: () => Effect.die("unused"),
    reply: () => Effect.die("unused"),
    get: () => Effect.die("unused"),
    forSession: () => Effect.die("unused"),
    list: () => Effect.die("unused"),
  }),
)
const registry = ToolRegistry.defaultLayer.pipe(Layer.provide(permission))
const config = Layer.succeed(Config.Service, Config.Service.of({ entries: () => Effect.succeed([]) }))
const image = Image.layer.pipe(Layer.provide(config))
// realPath identity keeps the assertion focused on path resolution, not symlink canonicalization.
const testFileSystem = Layer.effect(
  FSUtil.Service,
  FSUtil.Service.use((fs) => Effect.succeed(FSUtil.Service.of({ ...fs, realPath: (p) => Effect.succeed(p) }))),
).pipe(Layer.provide(FSUtil.defaultLayer))
const infrastructure = Layer.mergeAll(
  testFileSystem,
  Layer.succeed(Location.Service, Location.Service.of(location({ directory: AbsolutePath.make(process.cwd()) }))),
  Global.layerWith({ data: Global.Path.data }),
)
const read = ReadTool.layer.pipe(
  Layer.provide(registry),
  Layer.provide(reader),
  Layer.provide(permission),
  Layer.provide(config),
  Layer.provide(image),
  Layer.provide(infrastructure),
)
const itRead = testEffect(Layer.mergeAll(registry, reader, permission, config, image, infrastructure, read))
const sessionID = SessionV2.ID.make("ses_tilde_read_test")

describe("ReadTool tilde expansion", () => {
  beforeEach(() => {
    readCalls.length = 0
  })

  itRead.effect("expands ~/ to an absolute home path and reads it without an escape error", () =>
    Effect.gen(function* () {
      const registry = yield* ToolRegistry.Service
      const name = "opencode-tilde-read-probe.txt"
      const result = yield* executeTool(registry, {
        sessionID,
        ...toolIdentity,
        call: { type: "tool-call", id: "call-tilde", name: "read", input: { path: `~/${name}` } },
      })
      expect(result).toMatchObject({ type: "json" })
      // Resolution expanded ~ to the home dir; isAbsolute branch treated it as absolute, no escape death.
      expect(readCalls).toEqual([AbsolutePath.make(path.join(home, name))])
    }),
  )

  itRead.effect("still rejects a genuinely relative path that escapes the read root", () =>
    Effect.gen(function* () {
      const registry = yield* ToolRegistry.Service
      // A relative path that escapes the read root is a guarded defect, never expanded.
      const exit = yield* executeTool(registry, {
        sessionID,
        ...toolIdentity,
        call: { type: "tool-call", id: "call-escape", name: "read", input: { path: "../escape.txt" } },
      }).pipe(Effect.exit)
      expect(Exit.isFailure(exit)).toBe(true)
      expect(readCalls).toEqual([])
    }),
  )
})
