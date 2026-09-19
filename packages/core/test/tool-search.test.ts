import { beforeEach, describe, expect } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Effect, Layer } from "effect"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Location } from "@opencode-ai/core/location"
import { PermissionV2 } from "@opencode-ai/core/permission"
import { SessionV2 } from "@opencode-ai/core/session"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { GrepTool } from "@opencode-ai/core/tool/grep"
import { GlobTool } from "@opencode-ai/core/tool/glob"
import { ToolRegistry } from "@opencode-ai/core/tool/registry"
import { ToolOutputStore } from "@opencode-ai/core/tool-output-store"
import { location } from "./fixture/location"
import { tmpdir } from "./fixture/tmpdir"
import { testEffect } from "./lib/effect"
import { toolIdentity, executeTool, settleTool } from "./lib/tool"

const sessionID = SessionV2.ID.make("ses_search_tool_test")
const assertions: PermissionV2.AssertInput[] = []
let allow = true
const permission = Layer.succeed(
  PermissionV2.Service,
  PermissionV2.Service.of({
    assert: (input) =>
      Effect.sync(() => {
        assertions.push(input)
      }).pipe(Effect.andThen(allow ? Effect.void : Effect.fail(new PermissionV2.BlockedError({ rules: [] })))),
    ask: () => Effect.die("unused"),
    reply: () => Effect.die("unused"),
    get: () => Effect.die("unused"),
    forSession: () => Effect.die("unused"),
    list: () => Effect.die("unused"),
  }),
)
let locationDirectory: string | undefined
const locationLayer = Layer.unwrap(
  Effect.acquireRelease(
    Effect.promise(() => tmpdir()),
    (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
  ).pipe(
    Effect.map((tmp) => {
      locationDirectory = tmp.path
      const ref = Location.Ref.make({ directory: AbsolutePath.make(tmp.path) })
      return Layer.succeed(Location.Service, Location.Service.of(location(ref)))
    }),
  ),
)
const it = testEffect(
  AppNodeBuilder.build(LayerNode.group([ToolRegistry.node, ToolRegistry.toolsNode, GlobTool.node, GrepTool.node]), [
    [PermissionV2.node, permission],
    [Location.node, locationLayer],
    [ToolOutputStore.node, ToolOutputStore.nodeWithoutConfig],
  ]),
)

const fixture = Effect.promise(async () => {
  if (locationDirectory === undefined) throw new Error("location layer was not built before the test body")
  await fs.mkdir(path.join(locationDirectory, "src"), { recursive: true })
  await fs.writeFile(path.join(locationDirectory, "src", "haystack.ts"), "needle")
})

describe("GlobTool", () => {
  beforeEach(() => {
    assertions.length = 0
    allow = true
  })

  it.effect("fails with a path-specific error when the search path does not exist", () =>
    Effect.gen(function* () {
      const registry = yield* ToolRegistry.Service

      expect(
        yield* settleTool(registry, {
          sessionID,
          ...toolIdentity,
          call: {
            type: "tool-call",
            id: "call-glob-missing",
            name: "glob",
            input: { pattern: "**/*", path: "missing-dir" },
          },
        }),
      ).toEqual({
        result: { type: "error", value: "Search path does not exist: missing-dir" },
      })
    }),
  )

  it.live("finds files under an existing search path", () =>
    Effect.gen(function* () {
      yield* fixture
      const registry = yield* ToolRegistry.Service

      const result = yield* executeTool(registry, {
        sessionID,
        ...toolIdentity,
        call: {
          type: "tool-call",
          id: "call-glob-src",
          name: "glob",
          input: { pattern: "**/*.ts", path: "src" },
        },
      })

      expect(result).toEqual({
        type: "text",
        value: `${locationDirectory}/src/haystack.ts`,
      })
      expect(assertions).toMatchObject([{ action: "glob", resources: ["**/*.ts"], save: ["*"] }])
    }),
  )
})

describe("GrepTool", () => {
  beforeEach(() => {
    assertions.length = 0
    allow = true
  })

  it.effect("fails with a path-specific error when the search path does not exist", () =>
    Effect.gen(function* () {
      const registry = yield* ToolRegistry.Service

      expect(
        yield* settleTool(registry, {
          sessionID,
          ...toolIdentity,
          call: {
            type: "tool-call",
            id: "call-grep-missing",
            name: "grep",
            input: { pattern: "needle", path: "missing-dir" },
          },
        }),
      ).toEqual({
        result: { type: "error", value: "Search path does not exist: missing-dir" },
      })
    }),
  )

  it.effect("fails with a path-specific error when the path points at a missing file", () =>
    Effect.gen(function* () {
      const registry = yield* ToolRegistry.Service

      expect(
        yield* settleTool(registry, {
          sessionID,
          ...toolIdentity,
          call: {
            type: "tool-call",
            id: "call-grep-missing-file",
            name: "grep",
            input: { pattern: "needle", path: "src/missing.ts" },
          },
        }),
      ).toEqual({
        result: { type: "error", value: "Search path does not exist: src/missing.ts" },
      })
    }),
  )

  it.live("searches file contents under an existing search path", () =>
    Effect.gen(function* () {
      yield* fixture
      const registry = yield* ToolRegistry.Service

      const result = yield* executeTool(registry, {
        sessionID,
        ...toolIdentity,
        call: {
          type: "tool-call",
          id: "call-grep-src",
          name: "grep",
          input: { pattern: "needle", path: "src" },
        },
      })

      expect(result).toEqual({
        type: "text",
        value: `Found 1 matches\n${locationDirectory}/src/haystack.ts:\n  Line 1: needle`,
      })
      expect(assertions).toMatchObject([{ action: "grep", resources: ["needle"], save: ["*"] }])
    }),
  )
})
