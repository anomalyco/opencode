import fs from "fs/promises"
import path from "path"
import { describe, expect } from "bun:test"
import { Effect, Exit, Layer } from "effect"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Location } from "@opencode-ai/core/location"
import { FileSystem } from "@opencode-ai/core/filesystem"
import { Search } from "@opencode-ai/core/filesystem/search"
import { Ripgrep as FileSystemRipgrep } from "@opencode-ai/core/filesystem/ripgrep"
import { LocationSearch } from "@opencode-ai/core/location-search"
import { PermissionV2 } from "@opencode-ai/core/permission"
import { AppProcess } from "@opencode-ai/core/process"
import { Ripgrep } from "@opencode-ai/core/ripgrep"
import { AbsolutePath, RelativePath } from "@opencode-ai/core/schema"
import { SessionV2 } from "@opencode-ai/core/session"
import { GrepTool } from "@opencode-ai/core/tool/grep"
import { ToolRegistry } from "@opencode-ai/core/tool/registry"
import { location } from "./fixture/location"
import { tmpdir } from "./fixture/tmpdir"
import { it as runtimeIt } from "./lib/effect"
import { testEffect } from "./lib/effect"
import { toolIdentity, executeTool, settleTool, toolDefinitions } from "./lib/tool"

const assertions: PermissionV2.AssertInput[] = []
const searches: LocationSearch.GrepInput[] = []
let allow = true
let result = new LocationSearch.GrepResult({ items: [], truncated: false, partial: false })
let searchFailure: Ripgrep.InvalidPatternError | undefined

const search = Layer.succeed(
  LocationSearch.Service,
  LocationSearch.Service.of({
    files: () => Effect.die("unused"),
    grep: (input) =>
      Effect.sync(() => {
        searches.push(input)
        if (searchFailure) throw searchFailure
        return result
      }),
  }),
)
const permission = Layer.succeed(
  PermissionV2.Service,
  PermissionV2.Service.of({
    assert: (input) =>
      Effect.sync(() => {
        assertions.push(input)
      }).pipe(Effect.andThen(allow ? Effect.void : Effect.fail(new PermissionV2.DeniedError({ rules: [] })))),
    ask: () => Effect.die("unused"),
    reply: () => Effect.die("unused"),
    get: () => Effect.die("unused"),
    forSession: () => Effect.die("unused"),
    list: () => Effect.die("unused"),
  }),
)
const registry = ToolRegistry.defaultLayer.pipe(Layer.provide(permission))
const grep = GrepTool.layer.pipe(Layer.provide(registry), Layer.provide(search), Layer.provide(permission))
const it = testEffect(Layer.mergeAll(registry, search, permission, grep))
const sessionID = SessionV2.ID.make("ses_grep_tool_test")

const execute = (input: Record<string, unknown>) =>
  ToolRegistry.Service.use((registry) =>
    executeTool(registry, {
      sessionID,
      ...toolIdentity,
      call: { type: "tool-call", id: "call-grep", name: "grep", input },
    }),
  )

const settle = (input: Record<string, unknown>) =>
  ToolRegistry.Service.use((registry) =>
    settleTool(registry, {
      sessionID,
      ...toolIdentity,
      call: { type: "tool-call", id: "call-grep", name: "grep", input },
    }),
  )

const reset = () => {
  assertions.length = 0
  searches.length = 0
  allow = true
  searchFailure = undefined
  result = new LocationSearch.GrepResult({ items: [], truncated: false, partial: false })
}

function provideLive(directory: string) {
  const dependencies = Layer.mergeAll(
    FSUtil.defaultLayer,
    FileSystemRipgrep.defaultLayer,
    Search.defaultLayer,
    AppProcess.defaultLayer,
    Layer.succeed(Location.Service, Location.Service.of(location({ directory: AbsolutePath.make(directory) }))),
  )
  const filesystem = FileSystem.layer.pipe(Layer.provide(dependencies))
  const search = LocationSearch.layer.pipe(
    Layer.provide(filesystem),
    Layer.provide(Ripgrep.layer.pipe(Layer.provide(dependencies))),
    Layer.provide(FSUtil.defaultLayer),
    Layer.provide(dependencies),
  )
  const registry = ToolRegistry.defaultLayer.pipe(Layer.provide(permission))
  const grep = GrepTool.layer.pipe(
    Layer.provide(registry),
    Layer.provide(filesystem),
    Layer.provide(search),
    Layer.provide(permission),
  )
  return Layer.mergeAll(registry, filesystem, search, permission, grep)
}

describe("GrepTool", () => {
  it.effect("registers grep", () =>
    Effect.gen(function* () {
      reset()
      expect(yield* toolDefinitions(yield* ToolRegistry.Service)).toMatchObject([{ name: "grep" }])
    }),
  )

  it.effect("authorizes the regex resource and delegates an active Location grep", () =>
    Effect.gen(function* () {
      reset()
      const input = { pattern: "needle", path: "src", include: "*.ts", limit: 2 }

      expect(yield* execute(input)).toEqual({ type: "text", value: "No files found" })
      expect(assertions).toMatchObject([
        {
          sessionID,
          action: "grep",
          resources: ["needle"],
          save: ["*"],
          metadata: { root: "src", path: RelativePath.make("src"), include: "*.ts", limit: 2 },
        },
      ])
      expect(searches).toEqual([{ pattern: "needle", path: RelativePath.make("src"), include: "*.ts", limit: 2 }])
    }),
  )

  it.effect("does not search when permission is denied", () =>
    Effect.gen(function* () {
      reset()
      allow = false

      expect(yield* execute({ pattern: "secret" })).toEqual({ type: "error", value: "Unable to grep for secret" })
      expect(assertions).toHaveLength(1)
      expect(searches).toEqual([])
    }),
  )

  it.effect("keeps structured results raw while formatting bounded partial previews for models", () =>
    Effect.gen(function* () {
      reset()
      result = new LocationSearch.GrepResult({
        items: [
          new LocationSearch.Match({
            path: RelativePath.make("src/index.ts"),
            canonical: "/project/src/index.ts",
            resource: "src/index.ts",
            lines: "needle preview",
            linePreviewTruncated: true,
            line: 3,
            offset: 8,
            submatches: [new LocationSearch.Submatch({ text: "needle", start: 0, end: 6 })],
            mtime: 1,
          }),
        ],
        truncated: true,
        partial: true,
      })

      const settlement = yield* settle({ pattern: "needle" })
      expect(settlement.output?.structured).toEqual(result)
      expect(settlement.result).toEqual({
        type: "text",
        value:
          "Found 1 matches\nsrc/index.ts:\n  Line 3: needle preview...\n\n(Results are truncated: showing first 1 matches. Consider using a more specific path or pattern.)\n\n(Some paths were inaccessible and skipped)",
      })
    }),
  )

  it.effect("preserves an unexpected search defect", () =>
    Effect.gen(function* () {
      reset()
      searchFailure = new Ripgrep.InvalidPatternError({
        pattern: "[",
        message: "regex parse error: unclosed character class",
      })

      expect(Exit.isFailure(yield* execute({ pattern: "[" }).pipe(Effect.exit))).toBe(true)
      expect(searches).toEqual([{ pattern: "[" }])
    }),
  )

  runtimeIt.live("greps active Location files with include globs", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((tmp) => {
        const docs = path.join(tmp.path, "docs")
        return Effect.gen(function* () {
          reset()
          yield* Effect.promise(async () => {
            await fs.mkdir(path.join(tmp.path, "src"))
            await fs.writeFile(path.join(tmp.path, "src", "index.ts"), "needle ts\n")
            await fs.writeFile(path.join(tmp.path, "src", "notes.txt"), "needle txt\n")
          })

          expect(yield* execute({ pattern: "needle", path: "src", include: "*.ts" })).toEqual({
            type: "text",
            value: "Found 1 matches\nsrc/index.ts:\n  Line 1: needle ts\n",
          })
        }).pipe(Effect.provide(provideLive(tmp.path)))
      }),
    ),
  )
})
