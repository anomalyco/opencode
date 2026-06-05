import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { FileSystem } from "@opencode-ai/core/filesystem"
import { PermissionV2 } from "@opencode-ai/core/permission"
import { SessionV2 } from "@opencode-ai/core/session"
import { ToolRegistry } from "@opencode-ai/core/tool/registry"
import { ReadTool } from "@opencode-ai/core/tool/read"
import { RelativePath } from "@opencode-ai/core/schema"
import { testEffect } from "./lib/effect"

const assertions: PermissionV2.AssertInput[] = []
const reads: FileSystem.ReadInput[] = []
const samples: number[] = []
const textPageInputs: FileSystem.TextPageInput[] = []
const pages: FileSystem.ListTarget[] = []
const pageInputs: Pick<FileSystem.ListPageInput, "offset" | "limit">[] = []
let resolvedInput: FileSystem.ReadInput | undefined
let resolveFailure: unknown
let listResolveFailure: unknown = new Error("not a directory")
let listReal = "/project/src"
let size = 5
let real = "/project/README.md"
let afterApproval = () => {}
let readContent: FileSystem.Content = new FileSystem.TextContent({
  type: "text",
  content: "hello",
  mime: "text/plain",
})
let sample = new TextEncoder().encode("hello")
let readFailure: unknown
const filesystem = Layer.succeed(
  FileSystem.Service,
  FileSystem.Service.of({
    read: () => Effect.die("unused"),
    resolveReadPath: (input) =>
      resolveFailure === undefined
        ? Effect.succeed({
            type: "file" as const,
            target: new FileSystem.ReadTarget({
              real,
              resource: input.reference === undefined ? input.path : `${input.reference}:${input.path}`,
              size,
              dev: 1,
            }),
          })
        : listResolveFailure === undefined
          ? Effect.succeed({
              type: "directory" as const,
              target: new FileSystem.ListTarget({
                absolute: `/project/${input.path ?? "."}`,
                real: listReal,
                directory: "/project",
                root: "/project",
                resource: input.path ?? ".",
              }),
            })
          : Effect.die(resolveFailure),
    resolveRead: (input) =>
      Effect.sync(() => {
        resolvedInput = input
      }).pipe(
        Effect.andThen(
          resolveFailure === undefined
            ? Effect.succeed(
                new FileSystem.ReadTarget({
                  real,
                  resource: input.reference === undefined ? input.path : `${input.reference}:${input.path}`,
                  size,
                  dev: 1,
                }),
              )
            : Effect.die(resolveFailure),
        ),
      ),
    readResolved: () =>
      readFailure === undefined
        ? Effect.sync(() => {
            reads.push({ path: RelativePath.make("README.md") })
            return readContent
          })
        : Effect.die(readFailure),
    readSampleResolved: (_target, maximumBytes) =>
      Effect.sync(() => {
        samples.push(maximumBytes)
        return sample.slice(0, maximumBytes)
      }),
    readTextPageResolved: (_target, page = {}) =>
      readFailure === undefined
        ? Effect.sync(() => {
            textPageInputs.push(page)
            return new FileSystem.TextPage({
              type: "text-page",
              content: "hello",
              mime: "text/plain",
              offset: page.offset ?? 1,
              truncated: true,
              next: (page.offset ?? 1) + 1,
            })
          })
        : Effect.die(readFailure),
    resolveRoot: () => Effect.die("unused"),
    revalidateRoot: Effect.succeed,
    list: () => Effect.die("unused"),
    resolveList: (input = {}) =>
      listResolveFailure === undefined
        ? Effect.succeed(
            new FileSystem.ListTarget({
              absolute: `/project/${input.path ?? "."}`,
              real: listReal,
              directory: "/project",
              root: "/project",
              resource: input.path ?? ".",
            }),
          )
        : Effect.die(listResolveFailure),
    listResolved: () => Effect.die("unused"),
    listPage: () => Effect.die("unused"),
    listPageResolved: (target, page = {}) =>
      Effect.sync(() => {
        pages.push(target)
        pageInputs.push(page)
        return new FileSystem.ListPage({ entries: [], truncated: false })
      }),
    find: () => Effect.die("unused"),
    grep: () => Effect.die("unused"),
    isIgnored: () => false,
  }),
)
let allow = true
const permission = Layer.succeed(
  PermissionV2.Service,
  PermissionV2.Service.of({
    assert: (input) =>
      Effect.sync(() => {
        assertions.push(input)
        if (allow) afterApproval()
      }).pipe(Effect.andThen(allow ? Effect.void : Effect.fail(new PermissionV2.DeniedError({ rules: [] })))),
    ask: () => Effect.die("unused"),
    reply: () => Effect.die("unused"),
    get: () => Effect.die("unused"),
    forSession: () => Effect.die("unused"),
    list: () => Effect.die("unused"),
  }),
)
const registry = ToolRegistry.defaultLayer.pipe(Layer.provide(permission))
const read = ReadTool.layer.pipe(Layer.provide(registry), Layer.provide(filesystem), Layer.provide(permission))
const it = testEffect(Layer.mergeAll(registry, filesystem, permission, read))
const sessionID = SessionV2.ID.make("ses_read_tool_test")

describe("ReadTool", () => {
  it.effect("registers, authorizes, and reads through the location filesystem", () =>
    Effect.gen(function* () {
      assertions.length = 0
      reads.length = 0
      allow = true
      resolveFailure = undefined
      listResolveFailure = new Error("not a directory")
      size = 5
      real = "/project/README.md"
      afterApproval = () => {}
      readContent = new FileSystem.TextContent({ type: "text", content: "hello", mime: "text/plain" })
      sample = new TextEncoder().encode("hello")
      readFailure = undefined
      resolvedInput = undefined
      const registry = yield* ToolRegistry.Service

      expect(yield* registry.definitions()).toMatchObject([{ name: "read" }])
      expect(
        yield* registry.execute({
          sessionID,
          call: { type: "tool-call", id: "call-read", name: "read", input: { path: "README.md" } },
        }),
      ).toEqual({ type: "json", value: { type: "text", content: "hello", mime: "text/plain" } })
      expect(assertions).toMatchObject([{ sessionID, action: "read", resources: ["README.md"], save: ["*"] }])
      expect(reads).toEqual([{ path: RelativePath.make("README.md") }])
    }),
  )

  it.effect("returns a small PNG as native media instead of durable base64 text", () =>
    Effect.gen(function* () {
      const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
      reads.length = 0
      samples.length = 0
      allow = true
      resolveFailure = undefined
      listResolveFailure = new Error("not a directory")
      size = Buffer.from(png, "base64").length
      real = "/project/pixel.png"
      afterApproval = () => {}
      sample = Buffer.from(png, "base64")
      readContent = new FileSystem.BinaryContent({
        type: "binary",
        content: png,
        encoding: "base64",
        mime: "image/png",
      })
      readFailure = undefined
      const registry = yield* ToolRegistry.Service

      expect(
        yield* registry.execute({
          sessionID,
          call: { type: "tool-call", id: "call-image", name: "read", input: { path: "pixel.png" } },
        }),
      ).toEqual({
        type: "content",
        value: [
          { type: "text", text: "Image read successfully" },
          { type: "media", mediaType: "image/png", data: png, filename: "pixel.png" },
        ],
      })
      expect(samples).toEqual([FileSystem.READ_SAMPLE_BYTES])
      expect(reads).toHaveLength(1)
    }),
  )

  it.effect("classifies supported image contents before a misleading binary extension", () =>
    Effect.gen(function* () {
      const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
      allow = true
      resolveFailure = undefined
      listResolveFailure = new Error("not a directory")
      size = Buffer.from(png, "base64").length
      real = "/project/pixel.bin"
      afterApproval = () => {}
      sample = Buffer.from(png, "base64")
      readContent = new FileSystem.BinaryContent({
        type: "binary",
        content: png,
        encoding: "base64",
        mime: "application/octet-stream",
      })
      readFailure = undefined
      const registry = yield* ToolRegistry.Service

      expect(
        yield* registry.execute({
          sessionID,
          call: { type: "tool-call", id: "call-disguised-image", name: "read", input: { path: "pixel.bin" } },
        }),
      ).toMatchObject({
        type: "content",
        value: [{ type: "text" }, { type: "media", mediaType: "image/png", filename: "pixel.bin" }],
      })
    }),
  )

  it.effect("rejects unsupported binary before direct reads or paging", () =>
    Effect.gen(function* () {
      reads.length = 0
      textPageInputs.length = 0
      samples.length = 0
      allow = true
      resolveFailure = undefined
      listResolveFailure = new Error("not a directory")
      size = FileSystem.MAX_READ_BYTES + 1
      real = "/project/archive.dat"
      afterApproval = () => {}
      sample = new Uint8Array([0, 1, 2, 3])
      readFailure = undefined
      const registry = yield* ToolRegistry.Service

      expect(
        yield* registry.execute({
          sessionID,
          call: {
            type: "tool-call",
            id: "call-binary",
            name: "read",
            input: { path: "archive.dat", offset: 2, limit: 1 },
          },
        }),
      ).toEqual({ type: "error", value: "Cannot read binary file: archive.dat" })
      expect(samples).toEqual([FileSystem.READ_SAMPLE_BYTES])
      expect(reads).toEqual([])
      expect(textPageInputs).toEqual([])
    }),
  )

  it.effect("does not read when permission is denied", () =>
    Effect.gen(function* () {
      assertions.length = 0
      reads.length = 0
      allow = false
      resolveFailure = undefined
      listResolveFailure = new Error("not a directory")
      size = 5
      real = "/project/README.md"
      afterApproval = () => {}
      resolvedInput = undefined
      const registry = yield* ToolRegistry.Service

      expect(
        yield* registry.execute({
          sessionID,
          call: { type: "tool-call", id: "call-read", name: "read", input: { path: "README.md" } },
        }),
      ).toEqual({ type: "error", value: "Unable to read README.md" })
      expect(reads).toEqual([])
    }),
  )

  it.effect("lists a bounded directory page through read", () =>
    Effect.gen(function* () {
      assertions.length = 0
      pages.length = 0
      pageInputs.length = 0
      allow = true
      resolveFailure = new Error("Path is not a file")
      listResolveFailure = undefined
      listReal = "/project/src"
      afterApproval = () => {}
      const registry = yield* ToolRegistry.Service

      expect(
        yield* registry.execute({
          sessionID,
          call: {
            type: "tool-call",
            id: "call-read-directory",
            name: "read",
            input: { path: "src", offset: 2, limit: 10 },
          },
        }),
      ).toEqual({ type: "json", value: { entries: [], truncated: false } })
      expect(assertions).toMatchObject([{ sessionID, action: "read", resources: ["src"], save: ["*"] }])
      expect(pageInputs).toEqual([{ offset: 2, limit: 10 }])
    }),
  )

  it.effect("does not list a directory when permission is denied", () =>
    Effect.gen(function* () {
      pages.length = 0
      allow = false
      resolveFailure = new Error("Path is not a file")
      listResolveFailure = undefined
      listReal = "/project/src"
      afterApproval = () => {}
      const registry = yield* ToolRegistry.Service

      expect(
        yield* registry.execute({
          sessionID,
          call: { type: "tool-call", id: "call-read-directory-denied", name: "read", input: { path: "src" } },
        }),
      ).toEqual({ type: "error", value: "Unable to read src" })
      expect(pages).toEqual([])
    }),
  )

  it.effect("does not list when the directory changes after permission approval", () =>
    Effect.gen(function* () {
      pages.length = 0
      allow = true
      resolveFailure = new Error("Path is not a file")
      listResolveFailure = undefined
      listReal = "/project/src"
      afterApproval = () => {
        listReal = "/outside/src"
      }
      const registry = yield* ToolRegistry.Service

      expect(
        yield* registry.execute({
          sessionID,
          call: { type: "tool-call", id: "call-read-directory-swapped", name: "read", input: { path: "src" } },
        }),
      ).toEqual({ type: "error", value: "Unable to read src" })
      expect(pages).toEqual([])
    }),
  )

  it.effect("authorizes project references with their canonical identity", () =>
    Effect.gen(function* () {
      assertions.length = 0
      reads.length = 0
      allow = true
      resolveFailure = undefined
      listResolveFailure = new Error("not a directory")
      size = 5
      real = "/project/README.md"
      afterApproval = () => {}
      resolvedInput = undefined
      const registry = yield* ToolRegistry.Service

      yield* registry.execute({
        sessionID,
        call: { type: "tool-call", id: "call-read", name: "read", input: { path: "README.md", reference: "docs" } },
      })

      expect(assertions).toMatchObject([{ resources: ["docs:README.md"] }])
    }),
  )

  it.effect("settles missing files as typed tool errors", () =>
    Effect.gen(function* () {
      allow = true
      reads.length = 0
      real = "/project/README.md"
      afterApproval = () => {}
      const registry = yield* ToolRegistry.Service

      resolveFailure = new Error("missing")
      listResolveFailure = new Error("missing")
      expect(
        yield* registry.execute({
          sessionID,
          call: { type: "tool-call", id: "call-missing", name: "read", input: { path: "missing.txt" } },
        }),
      ).toEqual({ type: "error", value: "Unable to read missing.txt" })

      expect(reads).toEqual([])
    }),
  )

  it.effect("reads large UTF-8 text files as bounded pages with continuation", () =>
    Effect.gen(function* () {
      textPageInputs.length = 0
      allow = true
      resolveFailure = undefined
      listResolveFailure = new Error("not a directory")
      size = FileSystem.MAX_READ_BYTES + 1
      real = "/project/large.txt"
      afterApproval = () => {}
      sample = new TextEncoder().encode("hello")
      readFailure = undefined
      const registry = yield* ToolRegistry.Service

      expect(
        yield* registry.execute({
          sessionID,
          call: {
            type: "tool-call",
            id: "call-large",
            name: "read",
            input: { path: "large.txt", offset: 2, limit: 1 },
          },
        }),
      ).toEqual({
        type: "json",
        value: { type: "text-page", content: "hello", mime: "text/plain", offset: 2, truncated: true, next: 3 },
      })
      expect(textPageInputs).toEqual([{ offset: 2, limit: 1 }])
    }),
  )

  it.effect("preserves safe read limit errors", () =>
    Effect.gen(function* () {
      allow = true
      resolveFailure = undefined
      listResolveFailure = new Error("not a directory")
      size = 5
      real = "/project/changed.txt"
      afterApproval = () => {}
      sample = new TextEncoder().encode("hello")
      readFailure = new FileSystem.ReadLimitError("changed.txt", FileSystem.MAX_READ_BYTES)
      const registry = yield* ToolRegistry.Service

      expect(
        yield* registry.execute({
          sessionID,
          call: { type: "tool-call", id: "call-read-limit", name: "read", input: { path: "changed.txt" } },
        }),
      ).toEqual({
        type: "error",
        value: `File exceeds ${FileSystem.MAX_READ_BYTES} byte read limit: changed.txt`,
      })
    }),
  )

  it.effect("preserves binary errors discovered after the sample", () =>
    Effect.gen(function* () {
      allow = true
      resolveFailure = undefined
      listResolveFailure = new Error("not a directory")
      size = FileSystem.MAX_READ_BYTES + 1
      real = "/project/late-binary"
      afterApproval = () => {}
      sample = new TextEncoder().encode("text prefix")
      readFailure = new FileSystem.BinaryFileError("late-binary")
      const registry = yield* ToolRegistry.Service

      expect(
        yield* registry.execute({
          sessionID,
          call: { type: "tool-call", id: "call-late-binary", name: "read", input: { path: "late-binary" } },
        }),
      ).toEqual({ type: "error", value: "Cannot read binary file: late-binary" })
    }),
  )

  it.effect("rejects unsupported binary discovered by a direct read", () =>
    Effect.gen(function* () {
      allow = true
      resolveFailure = undefined
      listResolveFailure = new Error("not a directory")
      size = 5
      real = "/project/late-binary"
      afterApproval = () => {}
      sample = new TextEncoder().encode("text prefix")
      readFailure = undefined
      readContent = new FileSystem.BinaryContent({
        type: "binary",
        content: "AAECAw==",
        encoding: "base64",
        mime: "application/octet-stream",
      })
      const registry = yield* ToolRegistry.Service

      expect(
        yield* registry.execute({
          sessionID,
          call: { type: "tool-call", id: "call-direct-binary", name: "read", input: { path: "late-binary" } },
        }),
      ).toEqual({ type: "error", value: "Cannot read binary file: late-binary" })
    }),
  )

  it.effect("does not read when the file changes after permission approval", () =>
    Effect.gen(function* () {
      assertions.length = 0
      reads.length = 0
      allow = true
      resolveFailure = undefined
      listResolveFailure = new Error("not a directory")
      size = 5
      real = "/project/README.md"
      sample = new TextEncoder().encode("hello")
      readFailure = undefined
      afterApproval = () => {
        real = "/outside/README.md"
      }
      const registry = yield* ToolRegistry.Service
      expect(
        yield* registry.execute({
          sessionID,
          call: { type: "tool-call", id: "call-swapped", name: "read", input: { path: "README.md" } },
        }),
      ).toEqual({ type: "error", value: "Unable to read README.md" })
      expect(reads).toEqual([])
    }),
  )
})
