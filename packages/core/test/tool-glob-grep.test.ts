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
import { GrepTool } from "@opencode-ai/core/tool/grep"
import { ToolRegistry } from "@opencode-ai/core/tool/registry"
import { location } from "./fixture/location"
import { testEffect } from "./lib/effect"
import { executeTool, toolIdentity } from "./lib/tool"

const sessionID = SessionV2.ID.make("ses_glob_grep_tool_test")
const assertions: PermissionV2.AssertInput[] = []

const permission = Layer.succeed(
  PermissionV2.Service,
  PermissionV2.Service.of({
    assert: (input) =>
      Effect.sync(() => {
        assertions.push(input)
      }),
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
    find: () => Effect.succeed([]),
    glob: () => Effect.succeed([]),
    grep: () => Effect.succeed([]),
  }),
)

const activeLocation = Layer.succeed(
  Location.Service,
  Location.Service.of(location({ directory: AbsolutePath.make("/project") })),
)

const withTool = <A, E, R>(body: (registry: ToolRegistry.Interface) => Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    return yield* body(yield* ToolRegistry.Service)
  }).pipe(
    Effect.provide(
      AppNodeBuilder.build(
        LayerNode.group([ToolRegistry.node, ToolRegistry.toolsNode, GlobTool.node, GrepTool.node]),
        [
          [Location.node, activeLocation],
          [PermissionV2.node, permission],
          [Ripgrep.node, ripgrep],
        ],
      ),
    ),
  )

const call = (name: string, input: Record<string, unknown>, id = "call-glob-grep") => ({
  sessionID,
  ...toolIdentity,
  call: { type: "tool-call" as const, id, name, input },
})

const it = testEffect(Layer.empty)

describe("glob and grep permission metadata", () => {
  it.live("omits absent optional metadata fields when only the pattern is provided", () =>
    withTool((registry) =>
      Effect.gen(function* () {
        assertions.length = 0
        yield* executeTool(registry, call("glob", { pattern: "**/*.txt" }))
        yield* executeTool(registry, call("grep", { pattern: "needle" }))
        expect(assertions).toMatchObject([
          { action: "glob", resources: ["**/*.txt"] },
          { action: "grep", resources: ["needle"] },
        ])
        for (const assertion of assertions) {
          expect(assertion.metadata).not.toBeUndefined()
          expect(Object.values(assertion.metadata!)).not.toContain(undefined)
          expect(JSON.parse(JSON.stringify(assertion.metadata))).toEqual(assertion.metadata)
        }
        expect(assertions[0].metadata).toEqual({ root: "." })
        expect(assertions[1].metadata).toEqual({ root: "." })
      }),
    ),
  )

  it.live("includes optional metadata fields when provided", () =>
    withTool((registry) =>
      Effect.gen(function* () {
        assertions.length = 0
        yield* executeTool(registry, call("glob", { pattern: "**/*.ts", path: "src", limit: 5 }))
        yield* executeTool(
          registry,
          call("grep", { pattern: "needle", path: "src", include: "*.ts", limit: 10 }),
        )
        expect(assertions[0].metadata).toEqual({ root: "src", path: "src", limit: 5 })
        expect(assertions[1].metadata).toEqual({ root: ".", path: "src", include: "*.ts", limit: 10 })
        for (const assertion of assertions) {
          expect(JSON.parse(JSON.stringify(assertion.metadata))).toEqual(assertion.metadata)
        }
      }),
    ),
  )
})
