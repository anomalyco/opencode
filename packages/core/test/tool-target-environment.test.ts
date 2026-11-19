import fs from "fs/promises"
import path from "path"
import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { FSUtil } from "@opencode/util/fs-util"
import { Global } from "@opencode/util/global"
import { makeLocationNode } from "@opencode/util/effect/app-node"
import { Config } from "@opencode/core/config"
import { Environment } from "@opencode/core/environment/index"
import { FileAccess } from "@opencode/core/file-access"
import { FileMutation } from "@opencode/core/file-mutation"
import { FileWrite } from "@opencode/core/file-write"
import { Flag } from "@opencode/core/flag"
import { Formatter } from "@opencode/core/formatter"
import { Image } from "@opencode/core/image"
import { InstructionDiscovery } from "@opencode/core/instruction-discovery"
import { Location } from "@opencode/core/location"
import { Permission } from "@opencode/core/permission"
import { AbsolutePath } from "@opencode/core/schema"
import { Session } from "@opencode/core/session"
import { SessionInstructions } from "@opencode/core/session/instructions"
import { Skill } from "@opencode/core/skill"
import { Tool } from "@opencode/core/tool"
import { EditTool } from "@opencode/core/tool/plugin/edit"
import { PatchTool } from "@opencode/core/tool/plugin/patch"
import { ReadTool } from "@opencode/core/tool/plugin/read"
import { WriteTool } from "@opencode/core/tool/plugin/write"
import { hostEnvironmentLayer } from "./fixture/environment"
import { location } from "./fixture/location"
import { withTempDir } from "./fixture/tmpdir"
import { testEffect } from "./lib/effect"
import { permissionLayer } from "./lib/permission"
import { executeTool, registerToolPlugin, toolIdentity } from "./lib/tool"

const fileToolsNode = makeLocationNode({
  name: "test/file-tool-plugins",
  layer: Layer.effectDiscard(
    Effect.all(
      [
        registerToolPlugin(ReadTool.Plugin),
        registerToolPlugin(WriteTool.Plugin),
        registerToolPlugin(EditTool.Plugin),
        registerToolPlugin(PatchTool.Plugin),
      ],
      { discard: true },
    ),
  ),
  deps: [
    Tool.node,
    FileAccess.node,
    FileMutation.node,
    FileWrite.node,
    Formatter.node,
    Image.node,
    Permission.node,
    SessionInstructions.node,
    InstructionDiscovery.node,
    Skill.node,
    FSUtil.node,
    Location.node,
    Config.node,
    Flag.node,
  ],
})

const sessionID = Session.ID.make("ses_target_environment_test")
const it = testEffect(Layer.succeed(Flag.Overrides, undefined))

describe("file tools", () => {
  it.live("read and write the resolved target's environment, not the session's", () =>
    withTempDir((tmp) => {
      const file = path.join(tmp.path, "notes.txt")
      const driver = Environment.makeMemoryDriver()
      const environment: Environment.Interface = { files: Environment.makeFiles(driver), spawner: driver.spawner }
      const assertions: Permission.AssertInput[] = []
      const replacements = [
        Environment.node.replace(hostEnvironmentLayer),
        Permission.node.replace(permissionLayer({ assert: (input) => Effect.sync(() => void assertions.push(input)) })),
        Location.node.replace(
          Layer.succeed(Location.Service, Location.Service.of(location({ directory: AbsolutePath.make(tmp.path) }))),
        ),
      ]
      // Resolves and authorizes exactly as the session does, then places each target in the other environment.
      const access = Layer.effect(
        FileAccess.Service,
        Effect.gen(function* () {
          const session = yield* FileAccess.Service
          return FileAccess.Service.of({
            ...session,
            resolve: (input) => session.resolve(input).pipe(Effect.map((target) => ({ ...target, environment }))),
            authorizeRead: (input, context, options) =>
              session.authorizeRead(input, context, options).pipe(Effect.map((target) => ({ ...target, environment }))),
          })
        }),
      ).pipe(Layer.provide(LayerNode.compile(FileAccess.node, { replacements })))
      const execute = (registry: Tool.Interface, name: string, input: unknown) =>
        executeTool(registry, {
          sessionID,
          ...toolIdentity,
          call: { type: "tool-call", id: `call-${name}`, name, input },
        })

      return Effect.gen(function* () {
        yield* Effect.promise(() => fs.writeFile(file, "session\n"))
        const registry = yield* Tool.Service

        expect(yield* execute(registry, "write", { path: "notes.txt", content: "one\n" })).toMatchObject({
          status: "completed",
          output: "Created file successfully: notes.txt",
        })
        expect(assertions).toMatchObject([
          { action: "edit", metadata: { files: [{ status: "added", patch: expect.stringContaining("+one") }] } },
        ])
        expect(yield* execute(registry, "read", { path: "notes.txt" })).toMatchObject({
          status: "completed",
          output: { type: "text", content: "one\n" },
        })
        expect(
          yield* execute(registry, "edit", { path: "notes.txt", oldString: "one", newString: "two" }),
        ).toMatchObject({
          status: "completed",
          metadata: { files: [{ patch: expect.stringContaining("-one\n+two") }] },
        })
        expect(
          yield* execute(registry, "patch", {
            patchText: "*** Begin Patch\n*** Update File: notes.txt\n@@\n-two\n+three\n*** End Patch",
          }),
        ).toMatchObject({
          status: "completed",
          metadata: { files: [{ patch: expect.stringContaining("-two\n+three") }] },
        })

        expect(new TextDecoder().decode((yield* environment.files.read(file)).bytes)).toBe("three\n")
        expect(yield* Effect.promise(() => fs.readdir(tmp.path))).toEqual(["notes.txt"])
        expect(yield* Effect.promise(() => fs.readFile(file, "utf8"))).toBe("session\n")
      }).pipe(
        Effect.provide(
          AppNodeBuilder.build(LayerNode.group([Tool.node, fileToolsNode]), [
            ...replacements,
            FileAccess.node.replace(access),
            Formatter.node.replace(Layer.mock(Formatter.Service, { file: () => Effect.succeed(false) })),
            Config.node.replace(Config.testLayer()),
            Global.node.replace(Global.layerWith({ data: Global.Path.data })),
          ]),
        ),
      )
    }),
  )
})
