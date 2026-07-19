import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Location } from "@opencode-ai/core/location"
import { PermissionV2 } from "@opencode-ai/core/permission"
import { Ripgrep } from "@opencode-ai/core/ripgrep"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { SessionV2 } from "@opencode-ai/core/session"
import { GlobTool } from "@opencode-ai/core/tool/glob"
import { ToolRegistry } from "@opencode-ai/core/tool/registry"
import { ToolOutputStore } from "@opencode-ai/core/tool-output-store"
import { location } from "./fixture/location"
import { testEffect } from "./lib/effect"
import { toolIdentity, executeTool } from "./lib/tool"

const sessionID = SessionV2.ID.make("ses_glob_test")
const assertions: PermissionV2.AssertInput[] = []

const permission = Layer.succeed(
  PermissionV2.Service,
  PermissionV2.Service.of({
    assert: (input) => Effect.sync(() => assertions.push(input)),
    ask: () => Effect.die("unused"),
    reply: () => Effect.die("unused"),
    get: () => Effect.die("unused"),
    forSession: () => Effect.die("unused"),
    list: () => Effect.die("unused"),
  }),
)
const ripgrep = Layer.succeed(
  Ripgrep.Service,
  Ripgrep.Service.of({
    find: () => Effect.die("unused"),
    glob: () => Effect.succeed([]),
    grep: () => Effect.die("unused"),
  }),
)
const current = Layer.succeed(
  Location.Service,
  Location.Service.of(location({ directory: AbsolutePath.make("/project") })),
)

const it = testEffect(
  AppNodeBuilder.build(LayerNode.group([ToolRegistry.node, ToolRegistry.toolsNode, GlobTool.node]), [
    [PermissionV2.node, permission],
    [Ripgrep.node, ripgrep],
    [Location.node, current],
    [ToolOutputStore.node, ToolOutputStore.nodeWithoutConfig],
  ]),
)

const call = (input: typeof GlobTool.Input.Encoded) => ({
  sessionID,
  ...toolIdentity,
  call: { type: "tool-call" as const, id: "call-glob", name: "glob", input },
})

describe("GlobTool permission metadata", () => {
  it.effect("omits absent optional fields so the metadata bag holds no undefined values", () =>
    Effect.gen(function* () {
      assertions.length = 0
      const registry = yield* ToolRegistry.Service
      yield* executeTool(registry, call({ pattern: "**/*.txt" }))

      expect(assertions).toHaveLength(1)
      const metadata = assertions[0].metadata!
      expect(metadata).toEqual({ root: "." })
      // toEqual ignores undefined-valued keys, so guard the actual keys directly:
      // undefined entries break JSON encoding of session.permission.list.
      expect(Object.keys(metadata)).toEqual(["root"])
    }),
  )

  it.effect("keeps provided optional fields", () =>
    Effect.gen(function* () {
      assertions.length = 0
      const registry = yield* ToolRegistry.Service
      yield* executeTool(registry, call({ pattern: "**/*.ts", path: "src", limit: 10 }))

      expect(assertions[0].metadata).toEqual({ root: "src", path: "src", limit: 10 })
    }),
  )
})
