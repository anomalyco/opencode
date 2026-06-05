import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { Config } from "@opencode-ai/core/config"
import { ConfigAttachments } from "@opencode-ai/core/config/attachments"
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
let configEntries: Config.Entry[] = []
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
    readToolResolved: (_target, page = {}) => {
      samples.push(FileSystem.READ_SAMPLE_BYTES)
      if (readFailure !== undefined) return Effect.die(readFailure)
      if (sample[0] === 0x89 && sample[1] === 0x50 && sample[2] === 0x4e && sample[3] === 0x47)
        return Effect.succeed(
          readContent.type === "binary"
            ? new FileSystem.BinaryContent({ ...readContent, mime: "image/png" })
            : readContent,
        )
      if (FileSystem.isBinary(real.split("/").at(-1) ?? real, sample))
        return Effect.die(new FileSystem.BinaryFileError(real.split("/").at(-1) ?? real))
      if (size > FileSystem.MAX_READ_BYTES || page.offset !== undefined || page.limit !== undefined)
        return Effect.sync(() => {
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
      return Effect.sync(() => {
        reads.push({ path: RelativePath.make("README.md") })
        return readContent
      })
    },
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
const config = Layer.succeed(Config.Service, Config.Service.of({ entries: () => Effect.succeed(configEntries) }))
const read = ReadTool.layer.pipe(
  Layer.provide(registry),
  Layer.provide(filesystem),
  Layer.provide(permission),
  Layer.provide(config),
)
const it = testEffect(Layer.mergeAll(registry, filesystem, permission, config, read))
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
      configEntries = []
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
      configEntries = []
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
      expect(reads).toHaveLength(0)

      const settled = yield* registry.settle({
        sessionID,
        call: { type: "tool-call", id: "call-image-settle", name: "read", input: { path: "pixel.png" } },
      })
      expect(settled.output?.structured).toEqual({ type: "media", mime: "image/png" })
      expect(JSON.stringify(settled.output?.structured)).not.toContain(png)
      expect(settled.output?.content).toMatchObject([
        { type: "text", text: "Image read successfully" },
        { type: "file", mime: "image/png", source: { type: "data", data: png } },
      ])
    }),
  )

  it.effect("rejects invalid or truncated image data after signature classification", () =>
    Effect.gen(function* () {
      allow = true
      resolveFailure = undefined
      listResolveFailure = new Error("not a directory")
      size = 8
      real = "/project/truncated.png"
      afterApproval = () => {}
      sample = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
      readContent = new FileSystem.BinaryContent({
        type: "binary",
        content: Buffer.from(sample).toString("base64"),
        encoding: "base64",
        mime: "image/png",
      })
      readFailure = undefined
      configEntries = []
      const registry = yield* ToolRegistry.Service

      expect(
        yield* registry.execute({
          sessionID,
          call: { type: "tool-call", id: "call-truncated-image", name: "read", input: { path: "truncated.png" } },
        }),
      ).toEqual({ type: "error", value: "Image could not be decoded: truncated.png" })
    }),
  )

  it.effect("rejects oversized images when resizing is disabled", () =>
    Effect.gen(function* () {
      const photon = yield* Effect.promise(() => import("@silvia-odwyer/photon-node"))
      const source = new photon.PhotonImage(new Uint8Array(Array.from({ length: 16 * 4 }, () => 255)), 16, 1)
      const base64 = Buffer.from(source.get_bytes()).toString("base64")
      source.free()
      allow = true
      resolveFailure = undefined
      listResolveFailure = new Error("not a directory")
      size = Buffer.from(base64, "base64").length
      real = "/project/wide.png"
      afterApproval = () => {}
      sample = Buffer.from(base64, "base64")
      readContent = new FileSystem.BinaryContent({
        type: "binary",
        content: base64,
        encoding: "base64",
        mime: "image/png",
      })
      readFailure = undefined
      configEntries = [
        new Config.Document({
          type: "document",
          info: new Config.Info({
            attachments: new ConfigAttachments.Info({
              image: new ConfigAttachments.Image({ auto_resize: false, max_width: 4 }),
            }),
          }),
        }),
      ]
      const registry = yield* ToolRegistry.Service
      const result = yield* registry.execute({
        sessionID,
        call: { type: "tool-call", id: "call-wide-image", name: "read", input: { path: "wide.png" } },
      })

      expect(result.type).toBe("error")
      if (result.type === "error") expect(result.value).toContain("exceeding configured limits 4x2000")
    }),
  )

  it.effect("resizes images to configured dimensions before returning media", () =>
    Effect.gen(function* () {
      const photon = yield* Effect.promise(() => import("@silvia-odwyer/photon-node"))
      const source = new photon.PhotonImage(new Uint8Array(Array.from({ length: 16 * 4 }, () => 255)), 16, 1)
      const base64 = Buffer.from(source.get_bytes()).toString("base64")
      source.free()
      allow = true
      resolveFailure = undefined
      listResolveFailure = new Error("not a directory")
      size = Buffer.from(base64, "base64").length
      real = "/project/wide.png"
      afterApproval = () => {}
      sample = Buffer.from(base64, "base64")
      readContent = new FileSystem.BinaryContent({
        type: "binary",
        content: base64,
        encoding: "base64",
        mime: "image/png",
      })
      readFailure = undefined
      configEntries = [
        new Config.Document({
          type: "document",
          info: new Config.Info({
            attachments: new ConfigAttachments.Info({ image: new ConfigAttachments.Image({ max_width: 4 }) }),
          }),
        }),
      ]
      const registry = yield* ToolRegistry.Service
      const result = yield* registry.execute({
        sessionID,
        call: { type: "tool-call", id: "call-resize-image", name: "read", input: { path: "wide.png" } },
      })

      expect(result.type).toBe("content")
      if (result.type !== "content") return
      const media = result.value[1]
      expect(media?.type).toBe("media")
      if (media?.type !== "media") return
      const resized = photon.PhotonImage.new_from_byteslice(Buffer.from(media.data, "base64"))
      expect(resized.get_width()).toBeLessThanOrEqual(4)
      expect(resized.get_height()).toBeLessThanOrEqual(2_000)
      resized.free()
    }),
  )

  it.effect("enforces max base64 bytes after resize attempts", () =>
    Effect.gen(function* () {
      const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
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
      configEntries = [
        new Config.Document({
          type: "document",
          info: new Config.Info({
            attachments: new ConfigAttachments.Info({
              image: new ConfigAttachments.Image({ max_base64_bytes: 1 }),
            }),
          }),
        }),
      ]
      const registry = yield* ToolRegistry.Service
      const result = yield* registry.execute({
        sessionID,
        call: { type: "tool-call", id: "call-max-bytes", name: "read", input: { path: "pixel.png" } },
      })

      expect(result.type).toBe("error")
      if (result.type === "error") expect(result.value).toContain("/1 bytes")
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
      configEntries = []
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
