import fs from "fs/promises"
import path from "path"
import { describe, expect, test } from "bun:test"
import { Cause, Effect, Exit, Layer, Schema } from "effect"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Location } from "@opencode-ai/core/location"
import { FileSystem } from "@opencode-ai/core/filesystem"
import { LocationSearch } from "@opencode-ai/core/location-search"
import { AppProcess } from "@opencode-ai/core/process"
import { Ripgrep as FileSystemRipgrep } from "@opencode-ai/core/filesystem/ripgrep"
import { ProjectReference } from "@opencode-ai/core/project-reference"
import { Ripgrep } from "@opencode-ai/core/ripgrep"
import { AbsolutePath, RelativePath } from "@opencode-ai/core/schema"
import { Global } from "@opencode-ai/core/global"
import { tmpdir } from "./fixture/tmpdir"
import { location } from "./fixture/location"
import { it } from "./lib/effect"

const inertReferences = references({})

function provide(directory: string, projectReferences = inertReferences, data = Global.Path.data) {
  const dependencies = Layer.mergeAll(
    FSUtil.defaultLayer,
    FileSystemRipgrep.defaultLayer,
    AppProcess.defaultLayer,
    Layer.succeed(Location.Service, Location.Service.of(location({ directory: AbsolutePath.make(directory) }))),
    Layer.succeed(ProjectReference.Service, projectReferences),
    Global.layerWith({ data }),
  )
  const filesystem = FileSystem.layer.pipe(Layer.provide(dependencies))
  const search = LocationSearch.layer.pipe(
    Layer.provide(filesystem),
    Layer.provide(Ripgrep.layer.pipe(Layer.provide(dependencies))),
    Layer.provide(FSUtil.defaultLayer),
    Layer.provide(dependencies),
  )
  return Effect.provide(Layer.merge(filesystem, search))
}

function withTmp<A, E, R>(f: (directory: string) => Effect.Effect<A, E, R>) {
  return Effect.acquireRelease(
    Effect.promise(() => tmpdir()),
    (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
  ).pipe(Effect.flatMap((tmp) => f(tmp.path)))
}

describe("LocationSearch", () => {
  it.live("greps an absolute managed tool-output file", () =>
    withTmp((directory) => {
      const data = path.join(directory, "data")
      const managed = path.join(data, "tool-output")
      const output = path.join(managed, "tool_123")
      return Effect.gen(function* () {
        yield* Effect.promise(() => fs.mkdir(managed, { recursive: true }))
        yield* Effect.promise(() => fs.writeFile(output, "ok\nFAIL here\nok"))
        const search = yield* LocationSearch.Service
        const result = yield* search.grep({ pattern: "FAIL", path: output })
        expect(result.items).toMatchObject([{ canonical: output, line: 2, lines: "FAIL here\n" }])
      }).pipe(provide(directory, inertReferences, data))
    }),
  )

  it.live("searches files in the active Location with structured bounded results", () =>
    withTmp((directory) =>
      Effect.gen(function* () {
        yield* Effect.promise(async () => {
          await fs.mkdir(path.join(directory, "src"))
          await fs.writeFile(path.join(directory, "src", "index.ts"), "export const value = 1\n")
          await fs.writeFile(path.join(directory, "notes.txt"), "notes\n")
        })
        const result = yield* (yield* LocationSearch.Service).files({ pattern: "*.ts" })
        const canonical = yield* Effect.promise(() => fs.realpath(path.join(directory, "src", "index.ts")))

        expect(result).toMatchObject({ truncated: false, partial: false })
        expect(result.items).toHaveLength(1)
        expect(result.items[0]).toMatchObject({
          path: RelativePath.make("src/index.ts"),
          canonical,
          resource: "src/index.ts",
        })
        expect(typeof result.items[0].mtime).toBe("number")
      }).pipe(provide(directory)),
    ),
  )

  it.live("searches files under a relative subdirectory and named local reference", () =>
    withTmp((directory) => {
      const docs = path.join(directory, "docs")
      return Effect.gen(function* () {
        yield* Effect.promise(async () => {
          await fs.mkdir(path.join(directory, "src"))
          await fs.mkdir(docs)
          await fs.writeFile(path.join(directory, "src", "active.ts"), "active\n")
          await fs.writeFile(path.join(docs, "guide.md"), "guide\n")
        })
        const search = yield* LocationSearch.Service

        expect(
          (yield* search.files({ pattern: "*.ts", path: RelativePath.make("src") })).items.map((item) => item.path),
        ).toEqual([RelativePath.make("src/active.ts")])
        const guide = yield* Effect.promise(() => fs.realpath(path.join(docs, "guide.md")))
        expect((yield* search.files({ pattern: "*.md", reference: "docs" })).items).toMatchObject([
          { path: RelativePath.make("guide.md"), resource: "docs:guide.md", canonical: guide },
        ])
      }).pipe(provide(directory, references({ docs: { name: "docs", kind: "local", path: docs } })))
    }),
  )

  it.live("greps the Location, exact relative files and directories, and include globs", () =>
    withTmp((directory) =>
      Effect.gen(function* () {
        yield* Effect.promise(async () => {
          await fs.mkdir(path.join(directory, "src"))
          await fs.writeFile(path.join(directory, "src", "one.ts"), "needle ts\n")
          await fs.writeFile(path.join(directory, "src", "two.txt"), "needle txt\n")
          await fs.writeFile(path.join(directory, "root.md"), "needle root\n")
        })
        const search = yield* LocationSearch.Service

        expect((yield* search.grep({ pattern: "needle" })).items.map((item) => item.path).sort()).toEqual([
          RelativePath.make("root.md"),
          RelativePath.make("src/one.ts"),
          RelativePath.make("src/two.txt"),
        ])
        expect(
          (yield* search.grep({ pattern: "needle", path: RelativePath.make("src") })).items
            .map((item) => item.path)
            .sort(),
        ).toEqual([RelativePath.make("src/one.ts"), RelativePath.make("src/two.txt")])
        expect((yield* search.grep({ pattern: "needle", path: RelativePath.make("src/one.ts") })).items).toMatchObject([
          { path: RelativePath.make("src/one.ts"), resource: "src/one.ts", lines: "needle ts\n", line: 1, offset: 0 },
        ])
        expect((yield* search.grep({ pattern: "needle", include: "*.ts" })).items.map((item) => item.path)).toEqual([
          RelativePath.make("src/one.ts"),
        ])
      }).pipe(provide(directory)),
    ),
  )

  it.live("does not discover hidden files during broad V2 searches", () =>
    withTmp((directory) =>
      Effect.gen(function* () {
        yield* Effect.promise(async () => {
          await fs.mkdir(path.join(directory, "nested", ".private"), { recursive: true })
          await fs.writeFile(path.join(directory, "visible.txt"), "needle visible\n")
          await fs.writeFile(path.join(directory, ".env"), "needle root secret\n")
          await fs.writeFile(path.join(directory, "nested", "visible.txt"), "needle nested visible\n")
          await fs.writeFile(path.join(directory, "nested", ".env"), "needle nested secret\n")
          await fs.writeFile(path.join(directory, "nested", ".private", "secret.txt"), "needle hidden directory\n")
        })
        const search = yield* LocationSearch.Service

        expect((yield* search.files({ pattern: "*" })).items.map((item) => item.path).sort()).toEqual([
          RelativePath.make("nested/visible.txt"),
          RelativePath.make("visible.txt"),
        ])
        expect((yield* search.files({ pattern: ".env" })).items).toEqual([])
        expect((yield* search.grep({ pattern: "needle", include: "*" })).items.map((item) => item.path).sort()).toEqual(
          [RelativePath.make("nested/visible.txt"), RelativePath.make("visible.txt")],
        )
      }).pipe(provide(directory)),
    ),
  )

  it.live("caps result counts and line previews", () =>
    withTmp((directory) =>
      Effect.gen(function* () {
        yield* Effect.promise(async () => {
          await Promise.all(
            Array.from({ length: 101 }, (_, index) => fs.writeFile(path.join(directory, `${index}.txt`), "needle\n")),
          )
          await fs.writeFile(
            path.join(directory, "long.txt"),
            `needle ${"x".repeat(LocationSearch.MAX_LINE_PREVIEW_LENGTH)}\n`,
          )
        })
        const search = yield* LocationSearch.Service
        const files = yield* search.files({ pattern: "*.txt", limit: 2 })
        const hardCappedFiles = yield* search.files({ pattern: "*.txt", limit: LocationSearch.MAX_RESULT_LIMIT + 1 })
        const hardCappedGrep = yield* search.grep({ pattern: "needle", limit: LocationSearch.MAX_RESULT_LIMIT + 1 })
        const grep = yield* search.grep({ pattern: "needle", path: RelativePath.make("long.txt") })

        expect(files.items).toHaveLength(2)
        expect(files.truncated).toBe(true)
        expect(hardCappedFiles.items).toHaveLength(LocationSearch.MAX_RESULT_LIMIT)
        expect(hardCappedFiles.truncated).toBe(true)
        expect(hardCappedGrep.items).toHaveLength(LocationSearch.MAX_RESULT_LIMIT)
        expect(hardCappedGrep.truncated).toBe(true)
        expect(grep.items[0].lines).toHaveLength(LocationSearch.MAX_LINE_PREVIEW_LENGTH)
        expect(grep.items[0].linePreviewTruncated).toBe(true)
      }).pipe(provide(directory)),
    ),
  )

  it.live("reports invalid regex as a typed failure", () =>
    withTmp((directory) =>
      Effect.gen(function* () {
        yield* Effect.promise(() => fs.writeFile(path.join(directory, "notes.txt"), "notes\n"))
        const exit = yield* (yield* LocationSearch.Service).grep({ pattern: "[" }).pipe(Effect.exit)

        expect(Exit.isFailure(exit)).toBe(true)
        if (Exit.isFailure(exit)) expect(Cause.squash(exit.cause)).toBeInstanceOf(Ripgrep.InvalidPatternError)
      }).pipe(provide(directory)),
    ),
  )

  it.live("rejects oversized ripgrep JSON records before durable projection", () =>
    withTmp((directory) =>
      Effect.gen(function* () {
        yield* Effect.promise(() =>
          fs.writeFile(path.join(directory, "huge.txt"), `needle ${"x".repeat(Ripgrep.MAX_RECORD_BYTES)}\n`),
        )
        const exit = yield* (yield* LocationSearch.Service).grep({ pattern: "needle" }).pipe(Effect.exit)

        expect(Exit.isFailure(exit)).toBe(true)
        if (Exit.isFailure(exit)) expect(String(Cause.squash(exit.cause))).toContain("Ripgrep JSON record exceeded")
      }).pipe(provide(directory)),
    ),
  )

  it.live("rejects lexical and symlink escapes through root resolution", () =>
    withTmp((directory) =>
      Effect.gen(function* () {
        if (process.platform === "win32") return
        const outside = `${directory}-outside`
        yield* Effect.promise(async () => {
          await fs.mkdir(outside)
          await fs.writeFile(path.join(outside, "secret.txt"), "secret\n")
          await fs.symlink(outside, path.join(directory, "escape"))
        })
        const search = yield* LocationSearch.Service

        expect(
          Exit.isFailure(
            yield* search.files({ pattern: "*", path: RelativePath.make("../outside") }).pipe(Effect.exit),
          ),
        ).toBe(true)
        expect(
          Exit.isFailure(yield* search.files({ pattern: "*", path: RelativePath.make("escape") }).pipe(Effect.exit)),
        ).toBe(true)
        yield* Effect.promise(() => fs.rm(outside, { recursive: true, force: true }))
      }).pipe(provide(directory)),
    ),
  )

  it.live("rejects an approved root swapped to a symlink before ripgrep traversal", () =>
    withTmp((directory) =>
      Effect.gen(function* () {
        if (process.platform === "win32") return
        const source = path.join(directory, "src")
        const outside = `${directory}-outside`
        yield* Effect.promise(async () => {
          await fs.mkdir(source)
          await fs.mkdir(outside)
          await fs.writeFile(path.join(outside, "secret.txt"), "secret\n")
        })
        const filesystem = yield* FileSystem.Service
        const approved = yield* filesystem.resolveRoot({ path: RelativePath.make("src") })
        yield* Effect.promise(async () => {
          await fs.rmdir(source)
          await fs.symlink(outside, source)
        })

        expect(
          Exit.isFailure(yield* (yield* LocationSearch.Service).files({ pattern: "*" }, approved).pipe(Effect.exit)),
        ).toBe(true)
        yield* Effect.promise(() => fs.rm(outside, { recursive: true, force: true }))
      }).pipe(provide(directory)),
    ),
  )

  it.live("honors a pre-aborted cancellation signal", () =>
    withTmp((directory) =>
      Effect.gen(function* () {
        const controller = new AbortController()
        controller.abort()
        const exit = yield* (yield* LocationSearch.Service)
          .files({ pattern: "*", signal: controller.signal })
          .pipe(Effect.exit)
        expect(Exit.isFailure(exit)).toBe(true)
      }).pipe(provide(directory)),
    ),
  )

  test("exposes schema-testable search bounds", () => {
    const decode = Schema.decodeUnknownSync(LocationSearch.FilesInput)
    expect(LocationSearch.DEFAULT_RESULT_LIMIT).toBe(100)
    expect(LocationSearch.MAX_RESULT_LIMIT).toBe(100)
    expect(LocationSearch.MAX_LINE_PREVIEW_LENGTH).toBe(2_000)
    expect(() => decode({ pattern: "*", limit: LocationSearch.MAX_RESULT_LIMIT + 1 })).toThrow()
  })
})

function references(entries: Record<string, ProjectReference.Resolved>) {
  return ProjectReference.Service.of({
    list: () => Effect.succeed(Object.values(entries)),
    get: (name) => Effect.succeed(entries[name]),
    resolveMention: () => Effect.succeed(undefined),
    ensurePath: () => Effect.void,
    containsManagedPath: () => Effect.succeed(false),
  })
}
