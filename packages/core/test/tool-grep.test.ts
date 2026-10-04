import fs from "fs/promises"
import path from "path"
import { describe, expect } from "bun:test"
import { Cause, Effect, Exit, Layer, PlatformError } from "effect"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { FSUtil } from "@opencode-ai/core/fs-util"
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
import { executeTool, settleTool, toolIdentity } from "./lib/tool"

const withTool = <A, E, R>(
  directory: string,
  body: (registry: ToolRegistry.Interface) => Effect.Effect<A, E, R>,
  denied = false,
  filesystem = LayerNode.compile(FSUtil.node),
) =>
  Effect.gen(function* () {
    const registry = yield* ToolRegistry.Service
    return yield* body(registry)
  }).pipe(
    Effect.provide(
      AppNodeBuilder.build(LayerNode.group([ToolRegistry.node, ToolRegistry.toolsNode, GrepTool.node]), [
        [FSUtil.node, filesystem],
        [Location.node, Layer.succeed(Location.Service, location({ directory: AbsolutePath.make(directory) }))],
        [
          PermissionV2.node,
          Layer.mock(PermissionV2.Service, {
            assert: () => (denied ? Effect.fail(new PermissionV2.BlockedError({ rules: [] })) : Effect.void),
          }),
        ],
        [ToolOutputStore.node, ToolOutputStore.nodeWithoutConfig],
      ]),
    ),
  )

const call = (input: typeof GrepTool.Input.Encoded) => ({
  sessionID: SessionV2.ID.make("ses_grep_tool_test"),
  ...toolIdentity,
  call: { type: "tool-call" as const, id: "call-grep", name: "grep", input },
})

const fixture = Effect.acquireRelease(
  Effect.promise(() => tmpdir()),
  (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
)

const it = testEffect(Layer.empty)

// Inject only target stat failures that cannot be triggered portably with real files.
const statFailure = (target: string, failure: Effect.Effect<never, PlatformError.PlatformError>) =>
  Layer.effect(
    FSUtil.Service,
    FSUtil.Service.use((fs) =>
      Effect.succeed(FSUtil.Service.of({ ...fs, stat: (file) => (file === target ? failure : fs.stat(file)) })),
    ),
  ).pipe(Layer.provide(LayerNode.compile(FSUtil.node)))

describe("GrepTool", () => {
  it.live("fails for a missing relative directory instead of searching its parent", () =>
    Effect.gen(function* () {
      const tmp = yield* fixture
      yield* Effect.promise(() => fs.writeFile(path.join(tmp.path, "sibling.txt"), "sibling-marker"))
      const input = { pattern: "sibling-marker", path: "missing-dir" }
      const result = yield* withTool(tmp.path, (registry) => executeTool(registry, call(input)))
      expect(result.type).toBe("error")
      expect(result.value).toContain("missing-dir")
      expect(result.value).toContain("not found")
      expect(result.value).not.toContain("sibling.txt")
    }),
  )

  for (const target of ["missing-file.txt", "missing/deeper/target.txt"]) {
    it.live(`fails for missing ${target} and includes the requested path`, () =>
      Effect.gen(function* () {
        const tmp = yield* fixture
        yield* Effect.promise(() => fs.writeFile(path.join(tmp.path, "sibling.txt"), "sibling-marker"))
        const result = yield* withTool(tmp.path, (registry) =>
          executeTool(registry, call({ pattern: "sibling-marker", path: target })),
        )
        expect(result).toEqual({ type: "error", value: `Search path not found: ${target}` })
      }),
    )
  }

  for (const target of [undefined, "nested"]) {
    it.live(`searches ${target ?? "the default directory"} and maps result paths`, () =>
      Effect.gen(function* () {
        const tmp = yield* fixture
        const directory = target ? path.join(tmp.path, target) : tmp.path
        yield* Effect.promise(() => fs.mkdir(directory, { recursive: true }))
        yield* Effect.promise(() => fs.writeFile(path.join(directory, "match.txt"), "first\nneedle\n"))
        const result = yield* withTool(tmp.path, (registry) =>
          settleTool(registry, call({ pattern: "needle", path: target })),
        )
        expect(result.result.type).toBe("text")
        expect(result.result.value).toContain(path.join(directory, "match.txt"))
        expect(result.output?.structured).toMatchObject([
          { entry: { path: target ? path.join(target, "match.txt") : "match.txt" }, line: 2, text: "needle\n" },
        ])
      }),
    )
  }

  it.live("returns success when an existing directory has no matches", () =>
    Effect.gen(function* () {
      const tmp = yield* fixture
      yield* Effect.promise(() => fs.writeFile(path.join(tmp.path, "match.txt"), "needle"))
      const result = yield* withTool(tmp.path, (registry) =>
        executeTool(registry, call({ pattern: "absent-marker", path: "." })),
      )
      expect(result).toEqual({ type: "text", value: "No files found" })
    }),
  )

  it.live("searches an existing file without finding sibling matches", () =>
    Effect.gen(function* () {
      const tmp = yield* fixture
      yield* Effect.promise(() => fs.writeFile(path.join(tmp.path, "target.txt"), "target-marker"))
      yield* Effect.promise(() => fs.writeFile(path.join(tmp.path, "sibling.txt"), "sibling-marker"))
      const found = yield* withTool(tmp.path, (registry) =>
        executeTool(registry, call({ pattern: "target-marker", path: "target.txt" })),
      )
      expect(found.type).toBe("text")
      expect(found.value).toContain(path.join(tmp.path, "target.txt"))
      const absent = yield* withTool(tmp.path, (registry) =>
        executeTool(registry, call({ pattern: "sibling-marker", path: "target.txt" })),
      )
      expect(absent).toEqual({ type: "text", value: "No files found" })
    }),
  )

  it.live("preserves include filtering and the match limit", () =>
    Effect.gen(function* () {
      const tmp = yield* fixture
      yield* Effect.promise(() => fs.writeFile(path.join(tmp.path, "match.ts"), "needle\nneedle\n"))
      yield* Effect.promise(() => fs.writeFile(path.join(tmp.path, "sibling.txt"), "needle"))
      const result = yield* withTool(tmp.path, (registry) =>
        settleTool(registry, call({ pattern: "needle", include: "*.ts", limit: 1 })),
      )
      expect(result.result.type).toBe("text")
      expect(result.output?.structured).toMatchObject([{ entry: { path: "match.ts" }, line: 1 }])
      expect(result.result.value).toContain("Found 1 matches")
      expect(result.result.value).not.toContain("sibling.txt")
    }),
  )

  it.live("denies grep before inspecting a missing path or searching siblings", () =>
    Effect.gen(function* () {
      const tmp = yield* fixture
      yield* Effect.promise(() => fs.writeFile(path.join(tmp.path, "sibling.txt"), "sibling-marker"))
      const result = yield* withTool(
        tmp.path,
        (registry) => executeTool(registry, call({ pattern: "sibling-marker", path: "missing-dir" })),
        true,
      )
      expect(result).toEqual({ type: "error", value: "Unable to grep for sibling-marker" })
    }),
  )

  it.live("does not search the parent when stat fails for a reason other than NotFound", () =>
    Effect.gen(function* () {
      const tmp = yield* fixture
      yield* Effect.promise(() => fs.writeFile(path.join(tmp.path, "sibling.txt"), "sibling-marker"))
      const target = path.join(tmp.path, "target.txt")
      const result = yield* withTool(
        tmp.path,
        (registry) => executeTool(registry, call({ pattern: "sibling-marker", path: "target.txt" })),
        false,
        statFailure(
          target,
          Effect.fail(
            PlatformError.systemError({
              _tag: "PermissionDenied",
              module: "FileSystem",
              method: "stat",
              pathOrDescriptor: target,
            }),
          ),
        ),
      )
      expect(result).toEqual({ type: "error", value: "Unable to grep for sibling-marker" })
    }),
  )

  for (const failure of ["interrupt", "defect"] as const) {
    it.live(`preserves a stat ${failure} through tool settlement`, () =>
      Effect.gen(function* () {
        const tmp = yield* fixture
        const result = yield* withTool(
          tmp.path,
          (registry) => executeTool(registry, call({ pattern: "needle", path: "target.txt" })),
          false,
          statFailure(
            path.join(tmp.path, "target.txt"),
            failure === "interrupt" ? Effect.interrupt : Effect.die("stat defect"),
          ),
        ).pipe(Effect.exit)
        expect(Exit.isFailure(result)).toBe(true)
        if (Exit.isFailure(result)) {
          expect(failure === "interrupt" ? Cause.hasInterruptsOnly(result.cause) : Cause.hasDies(result.cause)).toBe(
            true,
          )
          if (failure === "defect") expect(Cause.pretty(result.cause)).toContain("stat defect")
        }
      }),
    )
  }
})
