import { beforeEach, describe, expect } from "bun:test"
import path from "path"
import { Effect, Layer } from "effect"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { FileSystem } from "@opencode-ai/core/filesystem"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Location } from "@opencode-ai/core/location"
import { LocationMutation } from "@opencode-ai/core/location-mutation"
import { PermissionV2 } from "@opencode-ai/core/permission"
import { Ripgrep } from "@opencode-ai/core/ripgrep"
import { SessionV2 } from "@opencode-ai/core/session"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { GlobTool } from "@opencode-ai/core/tool/glob"
import { ToolRegistry } from "@opencode-ai/core/tool/registry"
import { ToolOutputStore } from "@opencode-ai/core/tool-output-store"
import { location } from "./fixture/location"
import { testEffect } from "./lib/effect"
import { toolIdentity, executeTool } from "./lib/tool"

const assertions: PermissionV2.AssertInput[] = []
const globCalls: { cwd: string; pattern: string; limit: number }[] = []
let denyAction: string | undefined

const ripgrep = Layer.succeed(
  Ripgrep.Service,
  Ripgrep.Service.of({
    find: () => Effect.succeed([]),
    glob: (input) =>
      Effect.sync(() => {
        globCalls.push(input)
        return []
      }),
    grep: () => Effect.succeed([]),
  }),
)

const permission = Layer.succeed(
  PermissionV2.Service,
  PermissionV2.Service.of({
    assert: (input) =>
      Effect.sync(() => {
        assertions.push(input)
      }).pipe(
        Effect.andThen(
          input.action === denyAction ? Effect.fail(new PermissionV2.BlockedError({ rules: [] })) : Effect.void,
        ),
      ),
    ask: () => Effect.die("unused"),
    reply: () => Effect.die("unused"),
    get: () => Effect.die("unused"),
    forSession: () => Effect.die("unused"),
    list: () => Effect.die("unused"),
  }),
)

const locationLayer = Layer.succeed(
  Location.Service,
  Location.Service.of(location({ directory: AbsolutePath.make(process.cwd()) })),
)

const mutation = Layer.succeed(
  LocationMutation.Service,
  LocationMutation.Service.of({
    resolve: (input) => {
      const canonical = path.resolve(process.cwd(), input.path)
      const external = path.isAbsolute(input.path) && !FSUtil.contains(process.cwd(), canonical)
      const resource = external ? canonical.replaceAll("\\", "/") : path.relative(process.cwd(), canonical) || "."
      const externalResource = path.join(canonical, "*").replaceAll("\\", "/")
      return Effect.succeed({
        canonical,
        resource,
        externalDirectory: external
          ? {
              action: "external_directory" as const,
              directory: canonical,
              resource: externalResource,
              save: externalResource,
            }
          : undefined,
      })
    },
  }),
)

const globLayer = AppNodeBuilder.build(LayerNode.group([ToolRegistry.node, ToolRegistry.toolsNode, GlobTool.node]), [
  [Ripgrep.node, ripgrep],
  [Location.node, locationLayer],
  [LocationMutation.node, mutation],
  [PermissionV2.node, permission],
  [ToolOutputStore.node, ToolOutputStore.nodeWithoutConfig],
])

const it = testEffect(globLayer)
const sessionID = SessionV2.ID.make("ses_glob_tool_test")

describe("GlobTool", () => {
  beforeEach(() => {
    assertions.length = 0
    globCalls.length = 0
    denyAction = undefined
  })

  it.effect("searches the location without external approval for a relative path", () =>
    Effect.gen(function* () {
      const registry = yield* ToolRegistry.Service
      yield* executeTool(registry, {
        sessionID,
        ...toolIdentity,
        call: { type: "tool-call", id: "call-glob", name: "glob", input: { pattern: "**/*.ts", path: "src" } },
      })
      expect(globCalls).toEqual([
        { cwd: path.join(process.cwd(), "src"), pattern: "**/*.ts", limit: Number.MAX_SAFE_INTEGER },
      ])
      expect(assertions).toMatchObject([{ sessionID, action: "glob", resources: ["**/*.ts"] }])
    }),
  )

  it.effect("asks for external_directory approval before searching an external absolute path", () =>
    Effect.gen(function* () {
      const registry = yield* ToolRegistry.Service
      const external = path.join(path.parse(process.cwd()).root, "external-search")
      yield* executeTool(registry, {
        sessionID,
        ...toolIdentity,
        call: { type: "tool-call", id: "call-glob-ext", name: "glob", input: { pattern: "*.env", path: external } },
      })
      expect(assertions).toMatchObject([
        { sessionID, action: "glob", resources: ["*.env"] },
        { sessionID, action: "external_directory", resources: [path.join(external, "*").replaceAll("\\", "/")] },
      ])
    }),
  )

  it.effect("blocks the search when external_directory approval is denied", () =>
    Effect.gen(function* () {
      denyAction = "external_directory"
      const registry = yield* ToolRegistry.Service
      const external = path.join(path.parse(process.cwd()).root, "external-search")
      expect(
        yield* executeTool(registry, {
          sessionID,
          ...toolIdentity,
          call: { type: "tool-call", id: "call-glob-deny", name: "glob", input: { pattern: "*.env", path: external } },
        }),
      ).toEqual({ type: "error", value: "Unable to find files matching *.env" })
      expect(assertions.map((input) => input.action)).toEqual(["glob", "external_directory"])
      expect(globCalls).toEqual([])
    }),
  )
})
