import fs from "fs/promises"
import path from "path"
import { fileURLToPath } from "url"
import { describe, expect, test } from "bun:test"
import { Effect, Exit, Layer, Schema } from "effect"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Location } from "@opencode-ai/core/location"
import { FileSystem } from "@opencode-ai/core/filesystem"
import { Ripgrep } from "@opencode-ai/core/filesystem/ripgrep"
import { ProjectReference } from "@opencode-ai/core/project-reference"
import { Repository } from "@opencode-ai/core/repository"
import { Global } from "@opencode-ai/core/global"
import { AbsolutePath, RelativePath } from "@opencode-ai/core/schema"
import { tmpdir } from "./fixture/tmpdir"
import { location } from "./fixture/location"
import { it } from "./lib/effect"

const inertReferences = ProjectReference.Service.of({
  list: () => Effect.succeed([]),
  get: () => Effect.succeed(undefined),
  resolveMention: () => Effect.succeed(undefined),
  ensurePath: () => Effect.void,
  containsManagedPath: () => Effect.succeed(false),
})

function provide(
  directory: string,
  references = inertReferences,
  filesystem = FSUtil.defaultLayer,
  data = Global.Path.data,
) {
  return Effect.provide(
    FileSystem.layer.pipe(
      Layer.provide(
        Layer.mergeAll(
          filesystem,
          Ripgrep.defaultLayer,
          Layer.succeed(Location.Service, Location.Service.of(location({ directory: AbsolutePath.make(directory) }))),
          Layer.succeed(ProjectReference.Service, references),
          Global.layerWith({ data }),
        ),
      ),
    ),
  )
}

function withTmp<A, E, R>(f: (directory: string) => Effect.Effect<A, E, R>) {
  return Effect.acquireRelease(
    Effect.promise(() => tmpdir()),
    (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
  ).pipe(Effect.flatMap((tmp) => f(tmp.path)))
}

describe("FileSystem", () => {
  it.live("accepts generated managed output paths and rejects other absolute paths", () =>
    withTmp((directory) => {
      const worktree = directory
      const data = path.join(directory, "data")
      return Effect.gen(function* () {
        const managed = path.join(data, "tool-output")
        const output = path.join(managed, "tool_123")
        const unrelated = path.join(directory, "secret.txt")
        yield* Effect.promise(() => fs.mkdir(managed, { recursive: true }))
        yield* Effect.promise(() => fs.writeFile(output, "failure here"))
        yield* Effect.promise(() => fs.writeFile(unrelated, "secret"))
        const service = yield* FileSystem.Service

        expect(yield* service.read({ path: output })).toMatchObject({ type: "text", content: "failure here" })
        expect((yield* service.resolveRoot({ path: output })).real).toBe(output)
        expect(yield* Effect.exit(service.read({ path: unrelated }))).toMatchObject({ _tag: "Failure" })
        expect(yield* Effect.exit(service.read({ path: managed }))).toMatchObject({ _tag: "Failure" })
      }).pipe(provide(worktree, inertReferences, FSUtil.defaultLayer, data))
    }),
  )

  it.live("reads text and binary files", () =>
    withTmp((directory) =>
      Effect.gen(function* () {
        yield* Effect.promise(() => fs.writeFile(path.join(directory, "hello.txt"), "hello"))
        yield* Effect.promise(() => fs.writeFile(path.join(directory, "data.bin"), Buffer.from([0, 1, 2])))
        const service = yield* FileSystem.Service

        expect(yield* service.read({ path: RelativePath.make("hello.txt") })).toEqual({
          type: "text",
          content: "hello",
          mime: "text/plain",
        })
        expect(yield* service.read({ path: RelativePath.make("data.bin") })).toEqual({
          type: "binary",
          content: "AAEC",
          encoding: "base64",
          mime: "application/octet-stream",
        })
        const binary = yield* service.resolveRead({ path: RelativePath.make("data.bin") })
        expect(Exit.isFailure(yield* service.readTextPageResolved(binary).pipe(Effect.exit))).toBe(true)
      }).pipe(provide(directory)),
    ),
  )

  it.live("pages large UTF-8 text files by line with continuation", () =>
    withTmp((directory) =>
      Effect.gen(function* () {
        const lines = Array.from({ length: 30 }, (_, index) => `line-${index + 1}-é`.padEnd(2_000, "x"))
        yield* Effect.promise(() => fs.writeFile(path.join(directory, "large.txt"), lines.join("\n")))
        const service = yield* FileSystem.Service
        const target = yield* service.resolveRead({ path: RelativePath.make("large.txt") })

        const first = yield* service.readTextPageResolved(target)
        expect(first).toMatchObject({
          type: "text-page",
          offset: 1,
          truncated: true,
        })
        expect(first.next).toBeDefined()
        const next = first.next!
        expect(yield* service.readTextPageResolved(target, { offset: next, limit: 1 })).toEqual({
          type: "text-page",
          content: lines[next - 1],
          mime: "text/plain",
          offset: next,
          truncated: true,
          next: next + 1,
        })
        expect(yield* service.readTextPageResolved(target, { offset: 30 })).toEqual({
          type: "text-page",
          content: lines[29],
          mime: "text/plain",
          offset: 30,
          truncated: false,
        })
      }).pipe(provide(directory)),
    ),
  )

  it.live("lists direct children with relative paths and resolved URIs", () =>
    withTmp((directory) =>
      Effect.gen(function* () {
        yield* Effect.promise(() => fs.mkdir(path.join(directory, "src")))
        yield* Effect.promise(() => fs.writeFile(path.join(directory, "README.md"), "# Test"))
        const service = yield* FileSystem.Service

        const entries = yield* service.list()
        expect(entries.map(({ uri: _uri, ...entry }) => entry)).toEqual([
          {
            path: RelativePath.make("src"),
            type: "directory",
            mime: "application/x-directory",
          },
          {
            path: RelativePath.make("README.md"),
            type: "file",
            mime: "text/markdown",
          },
        ])
        expect(
          yield* Effect.promise(() => Promise.all(entries.map((entry) => fs.realpath(fileURLToPath(entry.uri))))),
        ).toEqual(
          yield* Effect.promise(() =>
            Promise.all([fs.realpath(path.join(directory, "src")), fs.realpath(path.join(directory, "README.md"))]),
          ),
        )
      }).pipe(provide(directory)),
    ),
  )

  it.live("lists stable bounded pages", () =>
    withTmp((directory) =>
      Effect.gen(function* () {
        yield* Effect.promise(async () => {
          await fs.mkdir(path.join(directory, "src"))
          await fs.writeFile(path.join(directory, "README.md"), "# Test")
        })
        const service = yield* FileSystem.Service

        expect(yield* service.listPage({ limit: 1 })).toMatchObject({
          entries: [{ path: "src", type: "directory" }],
          truncated: true,
          next: 2,
        })
        expect(yield* service.listPage({ offset: 2, limit: 1 })).toMatchObject({
          entries: [{ path: "README.md", type: "file" }],
          truncated: false,
        })
        expect((yield* service.resolveList()).resource).toBe(".")
      }).pipe(provide(directory)),
    ),
  )

  it.live("materializes only the selected direct children for a page", () =>
    withTmp((directory) => {
      const realPaths: string[] = []
      const filesystem = Layer.effect(
        FSUtil.Service,
        Effect.gen(function* () {
          const service = yield* FSUtil.Service
          return FSUtil.Service.of({
            ...service,
            realPath: (target) =>
              Effect.sync(() => realPaths.push(target)).pipe(Effect.andThen(service.realPath(target))),
          })
        }),
      ).pipe(Layer.provide(FSUtil.defaultLayer))
      return Effect.gen(function* () {
        yield* Effect.promise(async () => {
          await fs.mkdir(path.join(directory, "src"))
          await fs.writeFile(path.join(directory, "alpha.txt"), "alpha")
          await fs.writeFile(path.join(directory, "beta.txt"), "beta")
        })
        const service = yield* FileSystem.Service

        expect(yield* service.listPage({ offset: 2, limit: 1 })).toMatchObject({
          entries: [{ path: "alpha.txt", type: "file" }],
          truncated: true,
          next: 3,
        })
        expect(realPaths.filter((target) => target !== directory)).toEqual([path.join(directory, "alpha.txt")])
      }).pipe(provide(directory, inertReferences, filesystem))
    }),
  )

  it.live("materializes selected page entries with at most 16 concurrent real path lookups", () =>
    withTmp((directory) => {
      let active = 0
      let maximum = 0
      const filesystem = Layer.effect(
        FSUtil.Service,
        Effect.gen(function* () {
          const service = yield* FSUtil.Service
          return FSUtil.Service.of({
            ...service,
            realPath: (target) =>
              target === directory
                ? service.realPath(target)
                : Effect.acquireUseRelease(
                    Effect.sync(() => {
                      active++
                      maximum = Math.max(maximum, active)
                    }),
                    () => Effect.sleep("10 millis").pipe(Effect.andThen(service.realPath(target))),
                    () => Effect.sync(() => active--),
                  ),
          })
        }),
      ).pipe(Layer.provide(FSUtil.defaultLayer))
      return Effect.gen(function* () {
        yield* Effect.promise(() =>
          Promise.all(Array.from({ length: 32 }, (_, index) => fs.writeFile(path.join(directory, `${index}.txt`), ""))),
        )
        const service = yield* FileSystem.Service

        expect((yield* service.listPage({ limit: 32 })).entries).toHaveLength(32)
        expect(maximum).toBe(16)
      }).pipe(provide(directory, inertReferences, filesystem))
    }),
  )

  it.live("caps direct list page service calls at 2000 entries", () =>
    withTmp((directory) =>
      Effect.gen(function* () {
        yield* Effect.promise(() =>
          Promise.all(
            Array.from({ length: 2_001 }, (_, index) =>
              fs.writeFile(path.join(directory, `${index.toString().padStart(4, "0")}.txt`), ""),
            ),
          ),
        )
        const service = yield* FileSystem.Service
        const target = yield* service.resolveList()

        expect((yield* service.listPageResolved(target, { limit: 2_001 })).entries).toHaveLength(2_000)
      }).pipe(provide(directory)),
    ),
  )

  test("rejects empty list aliases and page limits over 2000", () => {
    const decode = Schema.decodeUnknownSync(FileSystem.ListPageInput)
    expect(() => decode({ reference: "" })).toThrow()
    expect(() => decode({ limit: 2_001 })).toThrow()
  })

  it.live("rejects escaping list paths and omits escaping symlink children", () =>
    withTmp((directory) =>
      Effect.gen(function* () {
        if (process.platform === "win32") return
        const outside = `${directory}-outside`
        yield* Effect.promise(async () => {
          await fs.mkdir(outside)
          await fs.writeFile(path.join(outside, "secret.txt"), "secret")
          await fs.symlink(outside, path.join(directory, "escape"))
        })
        const service = yield* FileSystem.Service

        expect(
          Exit.isFailure(yield* service.listPage({ path: RelativePath.make("../outside") }).pipe(Effect.exit)),
        ).toBe(true)
        expect((yield* service.listPage()).entries).toEqual([])
        yield* Effect.promise(() => fs.rm(outside, { recursive: true, force: true }))
      }).pipe(provide(directory)),
    ),
  )

  it.live("paginates visible entries after omitting escaping symlink children", () =>
    withTmp((directory) =>
      Effect.gen(function* () {
        if (process.platform === "win32") return
        const outside = `${directory}-outside`
        yield* Effect.promise(async () => {
          await fs.mkdir(outside)
          await fs.symlink(outside, path.join(directory, "a-escape"))
          await fs.writeFile(path.join(directory, "b-visible.txt"), "visible")
        })
        const service = yield* FileSystem.Service

        expect(yield* service.listPage({ limit: 1 })).toMatchObject({
          entries: [{ path: "b-visible.txt", type: "file" }],
          truncated: false,
        })
        yield* Effect.promise(() => fs.rm(outside, { recursive: true, force: true }))
      }).pipe(provide(directory)),
    ),
  )

  it.live("rejects paths outside the location", () =>
    withTmp((directory) =>
      Effect.gen(function* () {
        const service = yield* FileSystem.Service
        expect(
          Exit.isFailure(yield* service.read({ path: RelativePath.make("../outside.txt") }).pipe(Effect.exit)),
        ).toBe(true)
      }).pipe(provide(directory)),
    ),
  )

  it.live("reads and lists paths relative to a local project reference", () =>
    withTmp((directory) => {
      const docs = path.join(directory, "docs")
      return Effect.gen(function* () {
        yield* Effect.promise(async () => {
          await fs.mkdir(docs)
          await fs.writeFile(path.join(docs, "README.md"), "docs")
        })
        const service = yield* FileSystem.Service

        expect(yield* service.read({ reference: "docs", path: RelativePath.make("README.md") })).toMatchObject({
          type: "text",
          content: "docs",
        })
        expect(yield* service.list({ reference: "docs" })).toMatchObject([{ path: "README.md", type: "file" }])
      }).pipe(provide(directory, references({ docs: { name: "docs", kind: "local", path: docs } })))
    }),
  )

  it.live("materializes Git references before filesystem access", () =>
    withTmp((directory) => {
      const docs = path.join(directory, "docs")
      const ensured: string[] = []
      return Effect.gen(function* () {
        yield* Effect.promise(async () => {
          await fs.mkdir(docs)
          await fs.writeFile(path.join(docs, "README.md"), "docs")
        })
        expect(
          yield* (yield* FileSystem.Service).read({ reference: "sdk", path: RelativePath.make("README.md") }),
        ).toMatchObject({ content: "docs" })
        expect(ensured).toEqual([docs])
      }).pipe(
        provide(
          directory,
          references(
            {
              sdk: {
                name: "sdk",
                kind: "git",
                repository: "owner/repo",
                reference: Repository.parseRemote("owner/repo"),
                path: docs,
              },
            },
            (target) => Effect.sync(() => ensured.push(target ?? "")),
          ),
        ),
      )
    }),
  )

  it.live("rejects unknown, invalid, and escaping project reference paths", () =>
    withTmp((directory) => {
      const docs = path.join(directory, "docs")
      return Effect.gen(function* () {
        yield* Effect.promise(() => fs.mkdir(docs))
        const service = yield* FileSystem.Service
        expect(Exit.isFailure(yield* service.list({ reference: "unknown" }).pipe(Effect.exit))).toBe(true)
        expect(Exit.isFailure(yield* service.list({ reference: "invalid" }).pipe(Effect.exit))).toBe(true)
        expect(
          Exit.isFailure(
            yield* service.read({ reference: "docs", path: RelativePath.make("../outside") }).pipe(Effect.exit),
          ),
        ).toBe(true)
      }).pipe(
        provide(
          directory,
          references({
            docs: { name: "docs", kind: "local", path: docs },
            invalid: { name: "invalid", kind: "invalid", message: "invalid reference" },
          }),
        ),
      )
    }),
  )

  it.live("rejects aliases when project references are disabled", () =>
    withTmp((directory) =>
      Effect.gen(function* () {
        expect(Exit.isFailure(yield* (yield* FileSystem.Service).list({ reference: "docs" }).pipe(Effect.exit))).toBe(
          true,
        )
      }).pipe(provide(directory)),
    ),
  )

  it.live("rejects symlink escapes from project references", () =>
    withTmp((directory) => {
      const docs = path.join(directory, "docs")
      const outside = path.join(directory, "outside.txt")
      return Effect.gen(function* () {
        if (process.platform === "win32") return
        yield* Effect.promise(async () => {
          await fs.mkdir(docs)
          await fs.writeFile(outside, "outside")
          await fs.symlink(outside, path.join(docs, "link.txt"))
        })
        expect(
          Exit.isFailure(
            yield* (yield* FileSystem.Service)
              .read({ reference: "docs", path: RelativePath.make("link.txt") })
              .pipe(Effect.exit),
          ),
        ).toBe(true)
      }).pipe(provide(directory, references({ docs: { name: "docs", kind: "local", path: docs } })))
    }),
  )
})

function references(
  entries: Record<string, ProjectReference.Resolved>,
  ensurePath: ProjectReference.Interface["ensurePath"] = () => Effect.void,
) {
  return ProjectReference.Service.of({
    list: () => Effect.succeed(Object.values(entries)),
    get: (name) => Effect.succeed(entries[name]),
    resolveMention: () => Effect.succeed(undefined),
    ensurePath,
    containsManagedPath: () => Effect.succeed(false),
  })
}
