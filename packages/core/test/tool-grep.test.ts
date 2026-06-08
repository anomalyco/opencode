import fs from "fs/promises"
import path from "path"
import { describe, expect } from "bun:test"
import { Effect, Exit, Layer } from "effect"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Location } from "@opencode-ai/core/location"
import { FileSystem } from "@opencode-ai/core/filesystem"
import { Ripgrep as FileSystemRipgrep } from "@opencode-ai/core/filesystem/ripgrep"
import { LocationSearch } from "@opencode-ai/core/location-search"
import { PermissionV2 } from "@opencode-ai/core/permission"
import { AppProcess } from "@opencode-ai/core/process"
import { ProjectReference } from "@opencode-ai/core/project-reference"
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

const filesystem = Layer.succeed(
  FileSystem.Service,
  FileSystem.Service.of({
    read: () => Effect.die("unused"),
    resolveReadPath: () => Effect.die("unused"),
    readTool: () => Effect.die("unused"),
    list: () => Effect.die("unused"),
    resolveRoot: (input = {}) =>
      Effect.succeed(
        new FileSystem.RootTarget({
          real: `/project/${input.path ?? "."}`,
          root: "/project",
          resource: input.reference === undefined ? (input.path ?? ".") : `${input.reference}:${input.path ?? "."}`,
          reference: input.reference,
          type: "directory",
        }),
      ),
    resolveList: () => Effect.die("unused"),
    listResolved: () => Effect.die("unused"),
    listPage: () => Effect.die("unused"),
    listPageResolved: () => Effect.die("unused"),
    find: () => Effect.die("unused"),
    grep: () => Effect.die("unused"),
    isIgnored: () => false,
  }),
)
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
const grep = GrepTool.layer.pipe(
  Layer.provide(registry),
  Layer.provide(filesystem),
  Layer.provide(search),
  Layer.provide(permission),
)
const it = testEffect(Layer.mergeAll(registry, filesystem, search, permission, grep))
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

function references(entries: Record<string, ProjectReference.Resolved>) {
  return ProjectReference.Service.of({
    list: () => Effect.succeed(Object.values(entries)),
    get: (name) => Effect.succeed(entries[name]),
    resolveMention: () => Effect.succeed(undefined),
    ensurePath: () => Effect.void,
    containsManagedPath: () => Effect.succeed(false),
  })
}

function provideLive(directory: string, projectReferences = references({})) {
  const dependencies = Layer.mergeAll(
    FSUtil.defaultLayer,
    FileSystemRipgrep.defaultLayer,
    AppProcess.defaultLayer,
    Layer.succeed(Location.Service, Location.Service.of(location({ directory: AbsolutePath.make(directory) }))),
    Layer.succeed(ProjectReference.Service, projectReferences),
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
          metadata: { root: "src", reference: undefined, path: RelativePath.make("src"), include: "*.ts", limit: 2 },
        },
      ])
      expect(searches).toEqual([{ pattern: "needle", path: RelativePath.make("src"), include: "*.ts", limit: 2 }])
    }),
  )

  it.effect("delegates named reference grep and exposes the canonical selected root in metadata", () =>
    Effect.gen(function* () {
      reset()

      yield* execute({ pattern: "guide", path: "docs", reference: "manual", include: "*.md" })

      expect(assertions[0]).toMatchObject({
        resources: ["guide"],
        metadata: { root: "manual:docs", reference: "manual", path: RelativePath.make("docs"), include: "*.md" },
      })
      expect(searches).toEqual([
        { pattern: "guide", path: RelativePath.make("docs"), reference: "manual", include: "*.md" },
      ])
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

  runtimeIt.live("greps active Location and named-reference files with include globs", () =>
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
            await fs.mkdir(docs)
            await fs.writeFile(path.join(tmp.path, "src", "index.ts"), "needle ts\n")
            await fs.writeFile(path.join(tmp.path, "src", "notes.txt"), "needle txt\n")
            await fs.writeFile(path.join(docs, "guide.md"), "needle docs\n")
          })

          expect(yield* execute({ pattern: "needle", path: "src", include: "*.ts" })).toEqual({
            type: "text",
            value: "Found 1 matches\nsrc/index.ts:\n  Line 1: needle ts\n",
          })
          expect(yield* execute({ pattern: "needle", reference: "docs", include: "*.md" })).toEqual({
            type: "text",
            value: "Found 1 matches\ndocs:guide.md:\n  Line 1: needle docs\n",
          })
        }).pipe(
          Effect.provide(provideLive(tmp.path, references({ docs: { name: "docs", kind: "local", path: docs } }))),
        )
      }),
    ),
  )
})
