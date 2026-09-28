import { describe, expect } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Effect, Layer } from "effect"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Location } from "@opencode-ai/core/location"
import { PermissionV2 } from "@opencode-ai/core/permission"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { SessionV2 } from "@opencode-ai/core/session"
import { GrepTool } from "@opencode-ai/core/tool/grep"
import { ToolRegistry } from "@opencode-ai/core/tool/registry"
import { ToolOutputStore } from "@opencode-ai/core/tool-output-store"
import { location } from "./fixture/location"
import { tmpdir } from "./fixture/tmpdir"
import { testEffect } from "./lib/effect"
import { executeTool, toolIdentity } from "./lib/tool"

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

const withTool = <A, E, R>(directory: string, body: (registry: ToolRegistry.Interface) => Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    return yield* body(yield* ToolRegistry.Service)
  }).pipe(
    Effect.provide(
      AppNodeBuilder.build(LayerNode.group([ToolRegistry.node, GrepTool.node]), [
        [Location.node, Layer.succeed(Location.Service, location({ directory: AbsolutePath.make(directory) }))],
        [PermissionV2.node, permission],
        [ToolOutputStore.node, ToolOutputStore.nodeWithoutConfig],
      ]),
    ),
  )

const call = (input: typeof GrepTool.Input.Encoded) => ({
  sessionID: SessionV2.ID.make("ses_grep_tool_test"),
  ...toolIdentity,
  call: { type: "tool-call" as const, id: "call-grep", name: "grep", input },
})

const it = testEffect(Layer.empty)

describe("GrepTool", () => {
  it.live("reports missing targets instead of returning matches from their parent", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) =>
        Effect.gen(function* () {
          yield* Effect.promise(() => fs.writeFile(path.join(tmp.path, "sibling.txt"), "needle\n"))
          yield* withTool(tmp.path, (registry) =>
            Effect.gen(function* () {
              for (const target of ["missing.txt", "missing-directory"]) {
                const result = yield* executeTool(registry, call({ pattern: "needle", path: target }))
                expect(result).toEqual({ type: "error", value: "Unable to grep for needle" })
              }
            }),
          )
        }),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ),
  )

  it.live("keeps existing file and directory searches confined to the requested target", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) =>
        Effect.gen(function* () {
          yield* Effect.promise(() => fs.mkdir(path.join(tmp.path, "src")))
          yield* Effect.promise(() => fs.writeFile(path.join(tmp.path, "sibling.txt"), "needle outside\n"))
          yield* Effect.promise(() => fs.writeFile(path.join(tmp.path, "src", "target.txt"), "needle inside\n"))
          yield* withTool(tmp.path, (registry) =>
            Effect.gen(function* () {
              for (const target of ["src", "src/target.txt"]) {
                const result = yield* executeTool(registry, call({ pattern: "needle", path: target }))
                expect(result.type).toBe("text")
                if (result.type !== "text") throw new Error("Expected grep text output")
                expect(result.value).toContain("needle inside")
                expect(result.value).not.toContain("needle outside")
                expect(result.value).toContain(path.join(tmp.path, "src", "target.txt"))
              }
            }),
          )
        }),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ),
  )
})
