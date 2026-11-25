import fs from "fs/promises"
import path from "path"
import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { Config } from "@opencode/core/config"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
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
import { EditTool } from "@opencode/core/tool/plugin/edit"
import { PatchTool } from "@opencode/core/tool/plugin/patch"
import { WriteTool } from "@opencode/core/tool/plugin/write"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { makeLocationNode } from "@opencode/util/effect/app-node"
import { hostEnvironmentLayer } from "./fixture/environment"
import { location } from "./fixture/location"
import { withTempDir } from "./fixture/tmpdir"
import { testEffect } from "./lib/effect"
import { permissionLayer } from "./lib/permission"
import { registerToolPlugin, toolIdentity } from "./lib/tool"

// The real write, edit and patch tools, called from a script: their own results are what the script records, so this
// pins the shape and wording each returns.

const writeNode = makeLocationNode({
  name: "test/write",
  layer: Layer.effectDiscard(registerToolPlugin(WriteTool.Plugin)),
  deps: [Tool.node, FileWrite.node, Config.node, Flag.node],
})

const editNode = makeLocationNode({
  name: "test/edit",
  layer: Layer.effectDiscard(registerToolPlugin(EditTool.Plugin)),
  deps: [
    Tool.node,
    FileWrite.node,
    FileMutation.node,
    Environment.node,
    Location.node,
    Permission.node,
    Config.node,
    Flag.node,
  ],
})

const patchNode = makeLocationNode({
  name: "test/patch",
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

const it = testEffect(Layer.succeed(Flag.Overrides, "full_codemode"))

const run = (directory: string, code: string) =>
  Effect.gen(function* () {
    const registry = yield* Tool.Service
    const snapshot = yield* registry.snapshot()
    return yield* snapshot.execute({
      sessionID: Session.ID.make("ses_script_diffs"),
      ...toolIdentity,
      call: { type: "tool-call", id: "call-execute", name: "execute", input: { code } },
    })
  }).pipe(
    Effect.provide(
      AppNodeBuilder.build(
        LayerNode.group([
          Tool.node,
          FileAccess.node,
          FileMutation.node,
          FileWrite.node,
          writeNode,
          editNode,
          patchNode,
        ]),
        [
          Environment.node.replace(hostEnvironmentLayer),
          Location.node.replace(
            Layer.succeed(Location.Service, Location.Service.of(location({ directory: AbsolutePath.make(directory) }))),
          ),
          Formatter.node.replace(Layer.mock(Formatter.Service, { file: () => Effect.succeed(false) })),
          Permission.node.replace(permissionLayer({ assert: () => Effect.void })),
          Config.node.replace(Config.testLayer()),
        ],
      ),
    ),
  )

describe("a script's changes from the real file tools", () => {
  it.live("records each write, edit and patch from the tool's own result", () =>
    withTempDir((tmp) =>
      Effect.gen(function* () {
        yield* Effect.promise(() => fs.writeFile(path.join(tmp.path, "old.txt"), "keep\n"))
        const result = yield* run(
          tmp.path,
          `await tools.write({ path: "a.txt", content: "one\\n" })
          await tools.edit({ path: "a.txt", oldString: "one", newString: "two" })
          await tools.patch({ patchText: "*** Begin Patch\\n*** Add File: b.txt\\n+b\\n*** Delete File: old.txt\\n*** End Patch" })
          await tools.write({ path: "a.txt", content: "three\\n" })
          return []`,
        )
        const files = (result.metadata?.files ?? []) as Array<Record<string, unknown>>
        expect(files.map(({ file, status, additions, deletions }) => [file, status, additions, deletions])).toEqual([
          ["a.txt", "added", 1, 0],
          ["a.txt", "modified", 1, 1],
          ["b.txt", "added", 1, 0],
          ["old.txt", "deleted", 0, 1],
          ["a.txt", "modified", undefined, undefined],
        ])
        expect(files.slice(0, 4).every((file) => typeof file.patch === "string")).toBe(true)
      }),
    ),
  )
})
