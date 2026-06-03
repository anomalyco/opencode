import fs from "fs/promises"
import path from "path"
import { fileURLToPath } from "url"
import { describe, expect } from "bun:test"
import { Effect, Exit, Layer } from "effect"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Location } from "@opencode-ai/core/location"
import { FileSystem } from "@opencode-ai/core/filesystem"
import { Ripgrep } from "@opencode-ai/core/filesystem/ripgrep"
import { ProjectReference } from "@opencode-ai/core/project-reference"
import { Repository } from "@opencode-ai/core/repository"
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

function provide(directory: string, references = inertReferences) {
  return Effect.provide(
    FileSystem.layer.pipe(
      Layer.provide(
        Layer.mergeAll(
          FSUtil.defaultLayer,
          Ripgrep.defaultLayer,
          Layer.succeed(Location.Service, Location.Service.of(location({ directory: AbsolutePath.make(directory) }))),
          Layer.succeed(ProjectReference.Service, references),
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

  it.live("finds files and directories", () =>
    withTmp((directory) =>
      Effect.gen(function* () {
        yield* Effect.promise(() => fs.mkdir(path.join(directory, "src")))
        yield* Effect.promise(() => fs.writeFile(path.join(directory, "src", "index.ts"), "const needle = true\n"))
        const service = yield* FileSystem.Service

        expect((yield* service.find({ query: "index", type: "file" })).map((item) => item.path)).toEqual([
          RelativePath.make(path.join("src", "index.ts")),
        ])
        expect((yield* service.find({ query: "src", type: "directory" })).map((item) => item.path)).toEqual([
          RelativePath.make("src"),
        ])
      }).pipe(provide(directory)),
    ),
  )

  it.live("greps file contents", () =>
    withTmp((directory) =>
      Effect.gen(function* () {
        yield* Effect.promise(() => fs.writeFile(path.join(directory, "index.ts"), "const needle = true\n"))
        const service = yield* FileSystem.Service

        expect(yield* service.grep({ pattern: "needle" })).toEqual([
          {
            path: RelativePath.make("index.ts"),
            lines: "const needle = true\n",
            line: 1,
            offset: 0,
            submatches: [{ text: "needle", start: 6, end: 12 }],
          },
        ])
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
