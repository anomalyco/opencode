import { beforeEach, describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { Config } from "@opencode-ai/core/config"
import { ConfigAttachments } from "@opencode-ai/core/config/attachments"
import { FileSystem } from "@opencode-ai/core/filesystem"
import { PermissionV2 } from "@opencode-ai/core/permission"
import { SessionV2 } from "@opencode-ai/core/session"
import { ToolRegistry } from "@opencode-ai/core/tool/registry"
import { ReadTool } from "@opencode-ai/core/tool/read"
import { testEffect } from "./lib/effect"

const assertions: PermissionV2.AssertInput[] = []
const readCalls: {
  input: FileSystem.ReadInput & FileSystem.TextPageInput
  page: FileSystem.TextPageInput
}[] = []
const listCalls: FileSystem.ListPageInput[] = []
let resolvedType: "file" | "directory" = "file"
let resolveFailure: unknown
let readResult: FileSystem.Content | FileSystem.TextPage = new FileSystem.TextContent({
  type: "text",
  content: "hello",
  mime: "text/plain",
})
let readFailure: unknown
let configEntries: Config.Entry[] = []
const filesystem = Layer.succeed(
  FileSystem.Service,
  FileSystem.Service.of({
    read: () => Effect.die("unused"),
    resolveReadPath: (input) =>
      resolveFailure === undefined
        ? Effect.succeed(
            new FileSystem.ReadPath({
              type: resolvedType,
              resource: input.reference === undefined ? input.path : `${input.reference}:${input.path}`,
            }),
          )
        : Effect.die(resolveFailure),
    readTool: (input, page = {}) => {
      readCalls.push({ input, page })
      if (readFailure !== undefined) return Effect.die(readFailure)
      return Effect.succeed(readResult)
    },
    resolveRoot: () => Effect.die("unused"),
    list: () => Effect.die("unused"),
    resolveList: () => Effect.die("unused"),
    listResolved: () => Effect.die("unused"),
    listPage: (input = {}) =>
      Effect.sync(() => {
        listCalls.push(input)
        return new FileSystem.ListPage({ entries: [], truncated: false })
      }),
    listPageResolved: () => Effect.die("unused"),
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
  beforeEach(() => {
    assertions.length = 0
    readCalls.length = 0
    listCalls.length = 0
    allow = true
    resolvedType = "file"
    resolveFailure = undefined
    readResult = new FileSystem.TextContent({ type: "text", content: "hello", mime: "text/plain" })
    readFailure = undefined
    configEntries = []
  })

  it.effect("registers, authorizes, and reads through the location filesystem", () =>
    Effect.gen(function* () {
      const registry = yield* ToolRegistry.Service

      expect(yield* registry.definitions()).toMatchObject([{ name: "read" }])
      expect(
        yield* registry.execute({
          sessionID,
          call: { type: "tool-call", id: "call-read", name: "read", input: { path: "README.md" } },
        }),
      ).toEqual({ type: "json", value: { type: "text", content: "hello", mime: "text/plain" } })
      expect(assertions).toMatchObject([{ sessionID, action: "read", resources: ["README.md"], save: ["*"] }])
      expect(readCalls).toEqual([{ input: { path: "README.md" }, page: {} }])
    }),
  )

  it.effect("returns a small PNG as native media instead of durable base64 text", () =>
    Effect.gen(function* () {
      const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
      readResult = new FileSystem.BinaryContent({
        type: "binary",
        content: png,
        encoding: "base64",
        mime: "image/png",
      })
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
      expect(readCalls).toEqual([{ input: { path: "pixel.png" }, page: {} }])

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

  it.effect("rejects invalid image data returned by the filesystem", () =>
    Effect.gen(function* () {
      readResult = new FileSystem.BinaryContent({
        type: "binary",
        content: "iVBORw0KGgo=",
        encoding: "base64",
        mime: "image/png",
      })
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
      readResult = new FileSystem.BinaryContent({
        type: "binary",
        content: base64,
        encoding: "base64",
        mime: "image/png",
      })
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
      readResult = new FileSystem.BinaryContent({
        type: "binary",
        content: base64,
        encoding: "base64",
        mime: "image/png",
      })
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
      readResult = new FileSystem.BinaryContent({
        type: "binary",
        content: png,
        encoding: "base64",
        mime: "image/png",
      })
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

  it.effect("returns supported image contents despite a misleading binary extension", () =>
    Effect.gen(function* () {
      const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
      readResult = new FileSystem.BinaryContent({
        type: "binary",
        content: png,
        encoding: "base64",
        mime: "image/png",
      })
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

  it.effect("preserves unsupported binary errors from the filesystem", () =>
    Effect.gen(function* () {
      readFailure = new FileSystem.BinaryFileError("archive.dat")
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
      expect(readCalls).toEqual([
        { input: { path: "archive.dat", offset: 2, limit: 1 }, page: { offset: 2, limit: 1 } },
      ])
    }),
  )

  it.effect("does not read when permission is denied", () =>
    Effect.gen(function* () {
      allow = false
      const registry = yield* ToolRegistry.Service

      expect(
        yield* registry.execute({
          sessionID,
          call: { type: "tool-call", id: "call-read", name: "read", input: { path: "README.md" } },
        }),
      ).toEqual({ type: "error", value: "Unable to read README.md" })
      expect(readCalls).toEqual([])
    }),
  )

  it.effect("lists a bounded directory page through read", () =>
    Effect.gen(function* () {
      resolvedType = "directory"
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
      expect(listCalls).toEqual([{ path: "src", offset: 2, limit: 10 }])
    }),
  )

  it.effect("does not list a directory when permission is denied", () =>
    Effect.gen(function* () {
      allow = false
      resolvedType = "directory"
      const registry = yield* ToolRegistry.Service

      expect(
        yield* registry.execute({
          sessionID,
          call: { type: "tool-call", id: "call-read-directory-denied", name: "read", input: { path: "src" } },
        }),
      ).toEqual({ type: "error", value: "Unable to read src" })
      expect(listCalls).toEqual([])
    }),
  )

  it.effect("authorizes project references with their canonical identity", () =>
    Effect.gen(function* () {
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
      const registry = yield* ToolRegistry.Service

      resolveFailure = new Error("missing")
      expect(
        yield* registry.execute({
          sessionID,
          call: { type: "tool-call", id: "call-missing", name: "read", input: { path: "missing.txt" } },
        }),
      ).toEqual({ type: "error", value: "Unable to read missing.txt" })

      expect(readCalls).toEqual([])
    }),
  )

  it.effect("forwards pagination and returns bounded text pages with continuation", () =>
    Effect.gen(function* () {
      readResult = new FileSystem.TextPage({
        type: "text-page",
        content: "hello",
        mime: "text/plain",
        offset: 2,
        truncated: true,
        next: 3,
      })
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
      expect(readCalls).toEqual([{ input: { path: "large.txt", offset: 2, limit: 1 }, page: { offset: 2, limit: 1 } }])
    }),
  )

  it.effect("rejects unsupported binary discovered by a direct read", () =>
    Effect.gen(function* () {
      readResult = new FileSystem.BinaryContent({
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
})
