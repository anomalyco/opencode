import { describe, expect } from "bun:test"
import path from "path"
import fs from "fs/promises"
import { Effect, Layer } from "effect"
import { ChildProcessSpawner } from "effect/process"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Config } from "@opencode/core/config"
import { Environment } from "@opencode/core/environment/index"
import { FileAccess } from "@opencode/core/file-access"
import { FileMutation } from "@opencode/core/file-mutation"
import { FileWrite } from "@opencode/core/file-write"
import { Flag } from "@opencode/core/flag"
import { Location } from "@opencode/core/location"
import { Permission } from "@opencode/core/permission"
import { Ripgrep } from "@opencode/core/ripgrep"
import { AbsolutePath } from "@opencode/core/schema"
import { Session } from "@opencode/core/session"
import { Tool } from "@opencode/core/tool"
import { EditTool } from "@opencode/core/tool/plugin/edit"
import { GlobTool } from "@opencode/core/tool/plugin/glob"
import { GrepTool } from "@opencode/core/tool/plugin/grep"
import { WriteTool } from "@opencode/core/tool/plugin/write"
import { makeLocationNode } from "@opencode/util/effect/app-node"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { hostEnvironmentLayer } from "./fixture/environment"
import { location } from "./fixture/location"
import { withTempDir } from "./fixture/tmpdir"
import { it } from "./lib/effect"
import { permissionLayer } from "./lib/permission"
import { executeTool, registerToolPlugin, toolIdentity } from "./lib/tool"

const plugins = makeLocationNode({
  name: "test/file-rtts",
  layer: Layer.effectDiscard(
    Effect.all([
      registerToolPlugin(WriteTool.Plugin),
      registerToolPlugin(EditTool.Plugin),
      registerToolPlugin(GlobTool.Plugin),
      registerToolPlugin(GrepTool.Plugin),
    ]),
  ),
  deps: [
    Tool.node,
    FileWrite.node,
    FileMutation.node,
    FileAccess.node,
    Ripgrep.node,
    Config.node,
    Flag.node,
    Permission.node,
    Location.node,
  ],
})

// Real files and ripgrep behind the same FilesImpl/spawner boundary a remote driver supplies.
const withTools = <A, E, R>(
  directory: string,
  body: (registry: Tool.Interface, calls: string[]) => Effect.Effect<A, E, R>,
) => {
  const calls: string[] = []
  const environment = Layer.effect(
    Environment.Service,
    Effect.gen(function* () {
      const local = yield* Environment.Service
      return Environment.Service.of({
        ...local,
        id: Environment.ID.make("remote-test"),
        hostsServer: false,
        files: {
          ...local.files,
          read: (file, range) =>
            Effect.sync(() => calls.push("read")).pipe(Effect.andThen(local.files.read(file, range))),
          write: (file, bytes) =>
            Effect.sync(() => calls.push("write")).pipe(Effect.andThen(local.files.write(file, bytes))),
          stat: (file) => Effect.sync(() => calls.push("stat")).pipe(Effect.andThen(local.files.stat(file))),
        },
        spawner: ChildProcessSpawner.make((command) =>
          Effect.sync(() => calls.push("spawn")).pipe(Effect.andThen(local.spawner.spawn(command))),
        ),
      })
    }),
  ).pipe(Layer.provide(hostEnvironmentLayer))
  return Effect.gen(function* () {
    const registry = yield* Tool.Service
    calls.length = 0
    return yield* body(registry, calls)
  }).pipe(
    Effect.provide(
      AppNodeBuilder.build(LayerNode.group([Tool.node, plugins]), [
        Environment.node.replace(environment),
        Config.node.replace(Config.testLayer()),
        Location.node.replace(
          Layer.succeed(Location.Service, Location.Service.of(location({ directory: AbsolutePath.make(directory) }))),
        ),
        Permission.node.replace(permissionLayer({ assert: () => Effect.void })),
      ]),
    ),
  )
}

const call = (name: string, input: unknown) => ({
  sessionID: Session.ID.make("ses_file_rtts"),
  ...toolIdentity,
  call: { type: "tool-call" as const, id: `call-${name}`, name, input },
})

describe("remote file round trips", () => {
  it.live("edit reports the encoded, BOM-stripped text without rereading", () =>
    withTempDir((tmp) =>
      Effect.gen(function* () {
        const file = path.join(tmp.path, "file.txt")
        yield* Effect.promise(() => Bun.write(file, "before\n"))
        yield* withTools(tmp.path, (registry) =>
          Effect.gen(function* () {
            const result = yield* executeTool(
              registry,
              call("edit", { path: "file.txt", oldString: "before", newString: "\uFEFF\uD800after" }),
            )
            expect(result.status).toBe("completed")
            expect(result.metadata?.files?.[0]?.patch).toContain("-before\n+\uFFFDafter")
            expect(decode(yield* Effect.promise(() => Bun.file(file).bytes()))).toBe("\uFEFF\uFFFDafter\n")
          }),
        )
      }),
    ),
  )

  for (const before of [undefined, "", "before", "\uFEFFbefore"]) {
    it.live(`write uses one read and one write for ${JSON.stringify(before)}`, () =>
      withTempDir((tmp) =>
        Effect.gen(function* () {
          const file = path.join(tmp.path, "file.txt")
          if (before !== undefined) yield* Effect.promise(() => Bun.write(file, before))
          yield* withTools(tmp.path, (registry, calls) =>
            Effect.gen(function* () {
              const result = yield* executeTool(registry, call("write", { path: "file.txt", content: "after" }))
              expect(result).toMatchObject({
                status: "completed",
                output: `${before === undefined ? "Created" : "Wrote"} file successfully: file.txt`,
              })
              expect(decode(yield* Effect.promise(() => Bun.file(file).bytes()))).toBe(
                before?.startsWith("\uFEFF") ? "\uFEFFafter" : "after",
              )
              expect(calls).toEqual(["read", "write"])
            }),
          )
        }),
      ),
    )
  }

  for (const before of ["before", "\uFEFFbefore"]) {
    it.live(`edit uses one read and one write for ${JSON.stringify(before)}`, () =>
      withTempDir((tmp) =>
        Effect.gen(function* () {
          const file = path.join(tmp.path, "file.txt")
          yield* Effect.promise(() => Bun.write(file, before))
          yield* withTools(tmp.path, (registry, calls) =>
            Effect.gen(function* () {
              const result = yield* executeTool(
                registry,
                call("edit", { path: "file.txt", oldString: "before", newString: "after" }),
              )
              expect(result.status).toBe("completed")
              expect(result.metadata?.files?.[0]?.patch).toMatch(/-before[\s\S]*\+after/)
              expect(decode(yield* Effect.promise(() => Bun.file(file).bytes()))).toBe(
                before.replace("before", "after"),
              )
              expect(calls).toEqual(["read", "write"])
            }),
          )
        }),
      ),
    )
  }

  for (const name of ["glob", "grep"] as const) {
    it.live(`${name} retains the missing working-directory error after a failed remote search`, () =>
      withTempDir((tmp) =>
        Effect.gen(function* () {
          const root = path.join(tmp.path, "root")
          yield* Effect.promise(() => fs.mkdir(root))
          yield* withTools(root, (registry) =>
            Effect.gen(function* () {
              yield* Effect.promise(() => fs.rmdir(root))
              expect(yield* executeTool(registry, call(name, { pattern: name === "glob" ? "*" : "needle" }))).toEqual({
                status: "error",
                error: { type: "tool.execution", message: "Search path does not exist: ." },
              })
            }),
          )
        }),
      ),
    )

    for (const searchPath of [undefined, "."]) {
      it.live(`${name} searches root ${JSON.stringify(searchPath)} with one spawn and no stat`, () =>
        withTempDir((tmp) =>
          Effect.gen(function* () {
            yield* Effect.promise(() => Bun.write(path.join(tmp.path, "file.txt"), "needle\n"))
            yield* withTools(tmp.path, (registry, calls) =>
              Effect.gen(function* () {
                const result = yield* executeTool(
                  registry,
                  call(name, {
                    pattern: name === "glob" ? "*.txt" : "needle",
                    ...(searchPath === undefined ? {} : { path: searchPath }),
                  }),
                )
                expect(result.status).toBe("completed")
                expect(result.output).toHaveLength(1)
                expect(calls).toEqual(["spawn"])
              }),
            )
          }),
        ),
      )
    }
  }
})

function decode(bytes: Uint8Array) {
  return new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes)
}
