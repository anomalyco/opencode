import fs from "fs/promises"
import path from "path"
import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { AbsolutePath, RelativePath } from "@opencode-ai/core/schema"
import { SessionV2 } from "@opencode-ai/core/session"
import { ToolRegistry } from "@opencode-ai/core/tool/registry"
import { GrepTool } from "@opencode-ai/core/tool/grep"
import { Location } from "@opencode-ai/core/location"
import { PermissionV2 } from "@opencode-ai/core/permission"
import { location } from "./fixture/location"
import { tmpdir } from "./fixture/tmpdir"
import { testEffect } from "./lib/effect"
import { toolIdentity, executeTool } from "./lib/tool"

const sessionID = SessionV2.ID.make("ses_grep_tool_test")

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

const withTool = <A, E, R>(directory: string, body: (registry: ToolRegistry.Interface) => Effect.Effect<A, E, R>) => {
  const activeLocation = Layer.succeed(
    Location.Service,
    Location.Service.of(location({ directory: AbsolutePath.make(directory) })),
  )
  return Effect.gen(function* () {
    return yield* body(yield* ToolRegistry.Service)
  }).pipe(
    Effect.provide(
      AppNodeBuilder.build(LayerNode.group([ToolRegistry.node, ToolRegistry.toolsNode, GrepTool.node]), [
        [Location.node, activeLocation],
        [PermissionV2.node, permission],
      ]),
    ),
  )
}

const call = (input: typeof GrepTool.Input.Type, id = "call-grep") => ({
  sessionID,
  ...toolIdentity,
  call: { type: "tool-call" as const, id, name: "grep", input },
})

const it = testEffect(Layer.empty)

describe("GrepTool", () => {
  const seed = (tmp: { path: string }) =>
    Effect.promise(async () => {
      await fs.mkdir(path.join(tmp.path, "src"), { recursive: true })
      await fs.writeFile(path.join(tmp.path, "src", "needle.txt"), "needle here\n")
      await fs.writeFile(path.join(tmp.path, "root.txt"), "needle too\n")
    })

  it.live("fails when the requested search path does not exist instead of widening to the parent", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) =>
        Effect.gen(function* () {
          yield* seed(tmp)
          yield* withTool(tmp.path, (registry) =>
            Effect.gen(function* () {
              expect(yield* executeTool(registry, call({ pattern: "needle", path: RelativePath.make("src/missing") }))).toEqual({
                type: "error",
                value: "Search path not found: src/missing",
              })
            }),
          )
        }),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ),
  )

  it.live("searches a relative directory and reports matches", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) =>
        Effect.gen(function* () {
          yield* seed(tmp)
          yield* withTool(tmp.path, (registry) =>
            Effect.gen(function* () {
              const result = yield* executeTool(registry, call({ pattern: "needle", path: RelativePath.make("src") }))
              expect(result.type).toBe("text")
              if (result.type !== "text") return
              expect(result.value).toContain("needle.txt")
            }),
          )
        }),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ),
  )

  it.live("searches a single file when the path points at one", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) =>
        Effect.gen(function* () {
          yield* seed(tmp)
          yield* withTool(tmp.path, (registry) =>
            Effect.gen(function* () {
              const result = yield* executeTool(registry, call({ pattern: "needle", path: RelativePath.make("root.txt") }))
              expect(result.type).toBe("text")
              if (result.type !== "text") return
              expect(result.value).toContain("root.txt")
              expect(result.value).not.toContain("needle.txt")
            }),
          )
        }),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ),
  )
})
