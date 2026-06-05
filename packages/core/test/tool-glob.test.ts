import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { FileSystem } from "@opencode-ai/core/filesystem"
import { LocationSearch } from "@opencode-ai/core/location-search"
import { PermissionV2 } from "@opencode-ai/core/permission"
import { RelativePath } from "@opencode-ai/core/schema"
import { SessionV2 } from "@opencode-ai/core/session"
import { GlobTool } from "@opencode-ai/core/tool/glob"
import { ToolRegistry } from "@opencode-ai/core/tool/registry"
import { testEffect } from "./lib/effect"

const sessionID = SessionV2.ID.make("ses_glob_tool_test")
const assertions: PermissionV2.AssertInput[] = []
const resolutions: FileSystem.ListInput[] = []
const searches: LocationSearch.FilesInput[] = []
const roots: FileSystem.RootTarget[] = []
let allow = true
let result = new LocationSearch.FilesResult({ items: [], truncated: false, partial: false })

const permission = Layer.succeed(
  PermissionV2.Service,
  PermissionV2.Service.of({
    assert: (input) =>
      Effect.sync(() => assertions.push(input)).pipe(
        Effect.andThen(allow ? Effect.void : Effect.fail(new PermissionV2.DeniedError({ rules: [] }))),
      ),
    ask: () => Effect.die("unused"),
    reply: () => Effect.die("unused"),
    get: () => Effect.die("unused"),
    forSession: () => Effect.die("unused"),
    list: () => Effect.die("unused"),
  }),
)

const filesystem = Layer.succeed(
  FileSystem.Service,
  FileSystem.Service.of({
    read: () => Effect.die("unused"),
    resolveReadPath: () => Effect.die("unused"),
    resolveRead: () => Effect.die("unused"),
    readResolved: () => Effect.die("unused"),
    readTextPageResolved: () => Effect.die("unused"),
    list: () => Effect.die("unused"),
    resolveRoot: (input = {}) =>
      Effect.sync(() => {
        resolutions.push(input)
        const relative = input.path ?? RelativePath.make(".")
        const resource = input.reference === undefined ? relative : `${input.reference}:${relative}`
        return new FileSystem.RootTarget({
          absolute: `/project/${relative}`,
          real: `/project/${relative}`,
          directory: "/project",
          root: "/project",
          resource,
          reference: input.reference,
          type: "directory",
          dev: 1,
        })
      }),
    revalidateRoot: Effect.succeed,
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
    files: (input, root) =>
      Effect.sync(() => {
        searches.push(input)
        if (root) roots.push(root)
        return result
      }),
    grep: () => Effect.die("unused"),
  }),
)

const registry = ToolRegistry.defaultLayer.pipe(Layer.provide(permission))
const glob = GlobTool.layer.pipe(
  Layer.provide(registry),
  Layer.provide(permission),
  Layer.provide(filesystem),
  Layer.provide(search),
)
const it = testEffect(Layer.mergeAll(registry, permission, filesystem, search, glob))

const reset = () => {
  assertions.length = 0
  resolutions.length = 0
  searches.length = 0
  roots.length = 0
  allow = true
  result = new LocationSearch.FilesResult({ items: [], truncated: false, partial: false })
}

const call = (input: typeof GlobTool.Parameters.Type, id = "call-glob") => ({
  sessionID,
  call: { type: "tool-call" as const, id, name: "glob", input },
})

describe("GlobTool", () => {
  it.effect("registers the glob definition", () =>
    Effect.gen(function* () {
      reset()
      expect((yield* (yield* ToolRegistry.Service).definitions()).map((tool) => tool.name)).toEqual(["glob"])
    }),
  )

  it.effect("authorizes the active Location pattern and delegates traversal only to LocationSearch.files", () =>
    Effect.gen(function* () {
      reset()
      const registry = yield* ToolRegistry.Service

      expect(yield* registry.execute(call({ pattern: "**/*.ts", path: RelativePath.make("src"), limit: 12 }))).toEqual({
        type: "text",
        value: "No files found",
      })
      expect(assertions).toEqual([
        {
          sessionID,
          action: "glob",
          resources: ["**/*.ts"],
          save: ["*"],
          metadata: { root: "src", reference: undefined, path: "src", limit: 12 },
        },
      ])
      expect(resolutions).toEqual([{ path: RelativePath.make("src"), reference: undefined }])
      expect(searches).toEqual([{ pattern: "**/*.ts", path: RelativePath.make("src"), limit: 12 }])
      expect(roots).toMatchObject([{ resource: "src" }])
    }),
  )

  it.effect("prevents Location search when permission is denied", () =>
    Effect.gen(function* () {
      reset()
      allow = false

      expect(yield* (yield* ToolRegistry.Service).execute(call({ pattern: "*.secret" }))).toEqual({
        type: "error",
        value: "Unable to find files matching *.secret",
      })
      expect(searches).toEqual([])
    }),
  )

  it.effect("returns active Location glob resources", () =>
    Effect.gen(function* () {
      reset()
      result = new LocationSearch.FilesResult({
        items: [
          new LocationSearch.File({
            path: RelativePath.make("src/index.ts"),
            canonical: "/project/src/index.ts",
            resource: "src/index.ts",
            mtime: 1,
          }),
        ],
        truncated: false,
        partial: false,
      })

      expect(yield* (yield* ToolRegistry.Service).settle(call({ pattern: "*.ts" }))).toEqual({
        result: { type: "text", value: "src/index.ts" },
        output: {
          structured: result,
          content: [{ type: "text", text: "src/index.ts" }],
        },
      })
    }),
  )

  it.effect("searches named references with root and reference metadata", () =>
    Effect.gen(function* () {
      reset()
      result = new LocationSearch.FilesResult({
        items: [
          new LocationSearch.File({
            path: RelativePath.make("guide.md"),
            canonical: "/project/docs/guide.md",
            resource: "docs:guide.md",
            mtime: 1,
          }),
        ],
        truncated: false,
        partial: false,
      })

      expect(yield* (yield* ToolRegistry.Service).execute(call({ pattern: "*.md", reference: "docs" }))).toEqual({
        type: "text",
        value: "docs:guide.md",
      })
      expect(assertions).toEqual([
        {
          sessionID,
          action: "glob",
          resources: ["*.md"],
          save: ["*"],
          metadata: { root: "docs:.", reference: "docs", path: undefined, limit: undefined },
        },
      ])
      expect(searches).toEqual([{ pattern: "*.md", reference: "docs" }])
    }),
  )

  it.effect("formats bounded and partial results without discarding structured output", () =>
    Effect.sync(() => {
      const output = new LocationSearch.FilesResult({
        items: [
          new LocationSearch.File({
            path: RelativePath.make("one.ts"),
            canonical: "/project/one.ts",
            resource: "one.ts",
            mtime: 1,
          }),
        ],
        truncated: true,
        partial: true,
      })

      expect(GlobTool.toModelOutput(output)).toBe(
        "one.ts\n\n(Results are truncated: showing first 1 results. Consider using a more specific path or pattern.)\n\n(Results may be incomplete because some discovered files could not be read.)",
      )
    }),
  )
})
