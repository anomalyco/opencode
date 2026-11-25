import fs from "fs/promises"
import path from "path"
import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Environment } from "@opencode/core/environment/index"
import { FileAccess } from "@opencode/core/file-access"
import { FileMutation } from "@opencode/core/file-mutation"
import { FileWrite } from "@opencode/core/file-write"
import { Formatter } from "@opencode/core/formatter"
import { Location } from "@opencode/core/location"
import { Permission } from "@opencode/core/permission"
import { Session } from "@opencode/core/session"
import { Tool } from "@opencode/core/tool"
import { AbsolutePath } from "@opencode/core/schema"
import { WriteTool } from "@opencode/core/tool/plugin/write"
import { EditTool } from "@opencode/core/tool/plugin/edit"
import { ReadTool } from "@opencode/core/tool/plugin/read"
import { ReadToolFileSystem } from "@opencode/core/tool/read-filesystem"
import { Config } from "@opencode/core/config"
import { Image } from "@opencode/core/image"
import { SessionInstructions } from "@opencode/core/session/instructions"
import { Skill } from "@opencode/core/skill"
import { FSUtil } from "@opencode/util/fs-util"
import { Global } from "@opencode/util/global"
import { hostEnvironmentLayer, transformEnvironmentFiles } from "./fixture/environment"
import { location } from "./fixture/location"
import { tmpdirScoped } from "./fixture/tmpdir"
import { makeLocationNode } from "@opencode/util/effect/app-node"
import { testEffect } from "./lib/effect"
import { permissionLayer } from "./lib/permission"
import { executeTool, registerToolPlugin, toolIdentity } from "./lib/tool"

const writeToolNode = makeLocationNode({
  name: "test/session-child-write",
  layer: Layer.effectDiscard(registerToolPlugin(WriteTool.Plugin)),
  deps: [Tool.node, FileWrite.node],
})

const editToolNode = makeLocationNode({
  name: "test/session-child-edit",
  layer: Layer.effectDiscard(registerToolPlugin(EditTool.Plugin)),
  deps: [Tool.node, FileWrite.node, FileMutation.node, Environment.node, Location.node, Permission.node],
})

const readToolNode = makeLocationNode({
  name: "test/session-child-read",
  layer: Layer.effectDiscard(registerToolPlugin(ReadTool.Plugin)),
  deps: [
    Tool.node,
    ReadToolFileSystem.node,
    FileAccess.node,
    Image.node,
    Permission.node,
    SessionInstructions.node,
    Skill.node,
    FSUtil.node,
    Environment.node,
    Location.node,
  ],
})

const allowPerm = permissionLayer({ assert: () => Effect.void, allows: () => Effect.succeed(true) })
const fmt = Layer.mock(Formatter.Service, { file: () => Effect.succeed(false) })

const withWriteEdit = <A, E, R>(
  directory: string,
  body: (registry: Tool.Interface) => Effect.Effect<A, E, R>,
) => {
  const loc = Layer.succeed(Location.Service, Location.Service.of(location({ directory: AbsolutePath.make(directory) })))
  return Effect.gen(function* () {
    const registry = yield* Tool.Service
    return yield* body(registry)
  }).pipe(
    Effect.provide(
      AppNodeBuilder.build(LayerNode.group([Tool.node, FileAccess.node, FileMutation.node, writeToolNode, editToolNode]), [
        Environment.node.replace(transformEnvironmentFiles((files) => files)),
        Location.node.replace(loc),
        Formatter.node.replace(fmt),
        Permission.node.replace(allowPerm),
      ]),
    ),
  )
}

const withRead = <A, E, R>(
  directory: string,
  body: (registry: Tool.Interface) => Effect.Effect<A, E, R>,
) => {
  const dir = AbsolutePath.make(directory)
  const loc = Layer.succeed(Location.Service, Location.Service.of(location({ directory: dir })))
  const config = Config.testLayer()
  const imageLayer = AppNodeBuilder.build(Image.node)
  return Effect.gen(function* () {
    const registry = yield* Tool.Service
    return yield* body(registry)
  }).pipe(
    Effect.provide(
      Layer.mergeAll(
        AppNodeBuilder.build(LayerNode.group([Tool.node, readToolNode, Skill.node]), [
          Environment.node.replace(hostEnvironmentLayer),
          Permission.node.replace(allowPerm),
          Config.node.replace(config),
          Image.node.replace(imageLayer),
          Location.node.replace(loc),
          Global.node.replace(Global.layerWith({ data: Global.Path.data })),
        ]),
        config,
        imageLayer,
      ),
    ),
  )
}

const it = testEffect(Layer.empty)

describe("child session worktree tool execution", () => {
  it.live("executes actual write/edit tools in separate location contexts with no root leakage", () =>
    tmpdirScoped().pipe(
      Effect.flatMap((tmp) =>
        Effect.gen(function* () {
          const root = path.join(tmp.path, "repo")
          const wtA = path.join(tmp.path, "repo-wt-a")
          const wtB = path.join(tmp.path, "repo-wt-b")
          yield* Effect.promise(async () => {
            await fs.mkdir(root, { recursive: true })
            await fs.mkdir(wtA, { recursive: true })
            await fs.mkdir(wtB, { recursive: true })
            await fs.writeFile(path.join(root, "root.txt"), "root")
            await fs.writeFile(path.join(wtA, "shared.txt"), "A")
            await fs.writeFile(path.join(wtB, "shared.txt"), "B")
          })

          const childA = Session.ID.make("ses_child_a")
          const childB = Session.ID.make("ses_child_b")

          // Child A: actual write tool (relative) and actual edit tool in worktree A context
          yield* withWriteEdit(wtA, (registry) =>
            Effect.gen(function* () {
              const w = yield* executeTool(registry, {
                sessionID: childA,
                ...toolIdentity,
                call: { type: "tool-call", id: "a-write", name: "write", input: { path: "src/only-a.txt", content: "from-a" } },
              })
              expect(w).toMatchObject({ status: "completed" })
              expect(yield* Effect.promise(() => fs.readFile(path.join(wtA, "src", "only-a.txt"), "utf8"))).toBe("from-a")

              const e = yield* executeTool(registry, {
                sessionID: childA,
                ...toolIdentity,
                call: { type: "tool-call", id: "a-edit", name: "edit", input: { path: "shared.txt", oldString: "A", newString: "A-new" } },
              })
              expect(e).toMatchObject({ status: "completed" })
              expect(yield* Effect.promise(() => fs.readFile(path.join(wtA, "shared.txt"), "utf8"))).toBe("A-new")
            }),
          )

          // Child B: actual write tool (relative) and actual edit tool in worktree B context
          yield* withWriteEdit(wtB, (registry) =>
            Effect.gen(function* () {
              const w = yield* executeTool(registry, {
                sessionID: childB,
                ...toolIdentity,
                call: { type: "tool-call", id: "b-write", name: "write", input: { path: "src/only-b.txt", content: "from-b" } },
              })
              expect(w).toMatchObject({ status: "completed" })
              expect(yield* Effect.promise(() => fs.readFile(path.join(wtB, "src", "only-b.txt"), "utf8"))).toBe("from-b")

              const e = yield* executeTool(registry, {
                sessionID: childB,
                ...toolIdentity,
                call: { type: "tool-call", id: "b-edit", name: "edit", input: { path: "shared.txt", oldString: "B", newString: "B-new" } },
              })
              expect(e).toMatchObject({ status: "completed" })
              expect(yield* Effect.promise(() => fs.readFile(path.join(wtB, "shared.txt"), "utf8"))).toBe("B-new")
            }),
          )

          // Actual read tool: returns worktree-specific content per child location context
          yield* withRead(wtA, (registry) =>
            Effect.gen(function* () {
              const r = yield* executeTool(registry, {
                sessionID: childA,
                ...toolIdentity,
                call: { type: "tool-call", id: "a-read", name: "read", input: { path: "shared.txt" } },
              })
              expect(r.status).toBe("completed")
              if (r.status === "completed")
                expect(JSON.stringify(r.output) + JSON.stringify(r.content)).toContain("A-new")
            }),
          )
          yield* withRead(wtB, (registry) =>
            Effect.gen(function* () {
              const r = yield* executeTool(registry, {
                sessionID: childB,
                ...toolIdentity,
                call: { type: "tool-call", id: "b-read", name: "read", input: { path: "shared.txt" } },
              })
              expect(r.status).toBe("completed")
              if (r.status === "completed")
                expect(JSON.stringify(r.output) + JSON.stringify(r.content)).toContain("B-new")
            }),
          )

          // Verify independent worktree-specific results
          expect(yield* Effect.promise(() => fs.readFile(path.join(wtA, "shared.txt"), "utf8"))).toBe("A-new")
          expect(yield* Effect.promise(() => fs.readFile(path.join(wtB, "shared.txt"), "utf8"))).toBe("B-new")
          expect(yield* Effect.promise(() => fs.readFile(path.join(wtA, "src", "only-a.txt"), "utf8"))).toBe("from-a")
          expect(yield* Effect.promise(() => fs.readFile(path.join(wtB, "src", "only-b.txt"), "utf8"))).toBe("from-b")

          // No relative operation created or modified an unintended root-level file
          expect(yield* Effect.promise(async () => { try { await fs.access(path.join(root, "src")); return true } catch { return false } })).toBe(false)
          expect(yield* Effect.promise(async () => { try { await fs.access(path.join(root, "shared.txt")); return true } catch { return false } })).toBe(false)
          expect(yield* Effect.promise(() => fs.readFile(path.join(root, "root.txt"), "utf8"))).toBe("root")
        }),
      ),
    ),
  )
})
