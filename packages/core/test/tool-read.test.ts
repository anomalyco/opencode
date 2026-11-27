import { beforeEach, describe, expect } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { pathToFileURL } from "url"
import { Effect, Exit, Layer, Result } from "effect"
import { Config } from "@opencode/core/config"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { FSUtil } from "@opencode/util/fs-util"
import { Location } from "@opencode/core/location"
import { Image } from "@opencode/core/image"
import { Permission } from "@opencode/core/permission"
import { Session } from "@opencode/core/session"
import { Skill } from "@opencode/core/skill"
import { AbsolutePath } from "@opencode/core/schema"
import { Global } from "@opencode/util/global"
import { FileAccess } from "@opencode/core/file-access"
import { InstructionDiscovery } from "@opencode/core/instruction-discovery"
import { Flag } from "@opencode/core/flag"
import { hostEnvironmentLayer } from "./fixture/environment"
import { location } from "./fixture/location"
import { withTempDir } from "./fixture/tmpdir"
import { Tool } from "@opencode/core/tool"
import { ReadTool } from "@opencode/core/tool/plugin/read"
import { makeLocationNode } from "@opencode/util/effect/app-node"
import { SessionInstructions } from "@opencode/core/session/instructions"
import { Environment } from "@opencode/core/environment/index"
import { testEffect } from "./lib/effect"
import { permissionLayer } from "./lib/permission"
import { toolIdentity, executeTool, registerToolPlugin, toolDefinitions } from "./lib/tool"

const readToolNode = makeLocationNode({
  name: "test/read-tool-plugin",
  layer: Layer.effectDiscard(registerToolPlugin(ReadTool.Plugin)),
  deps: [
    Tool.node,
    FileAccess.node,
    Image.node,
    Permission.node,
    SessionInstructions.node,
    InstructionDiscovery.node,
    Skill.node,
    FSUtil.node,
    Environment.node,
    Location.node,
    Config.node,
    Flag.node,
  ],
})

const assertions: Permission.AssertInput[] = []
const missingPath = "__missing_read_target__.txt"
const missingAbsolutePath = path.join(process.cwd(), missingPath)
const readCalls: AbsolutePath[] = []
const listCalls: AbsolutePath[] = []
const encoder = new TextEncoder()
let readDefect: unknown
let readBytes: Uint8Array | undefined
let readFailure: Environment.WrongKind | undefined
let memory = Environment.makeFiles(Environment.makeMemoryDriver())
// The memory driver keys paths with path.posix, so a Windows path reaches it as one flat name.
const slash = (value: string) => value.replaceAll("\\", "/")
// Stands in for the environment the read tool resolves each target into, so a test can seed
// entries, count reads, and fail or defect a read the way the real filesystem would.
const files: Environment.Files = {
  read: (path, range) => {
    readCalls.push(AbsolutePath.make(path))
    if (readDefect !== undefined) return Effect.die(readDefect)
    if (readFailure !== undefined) return Effect.fail(readFailure)
    if (readBytes === undefined) return memory.read(slash(path), range)
    return Effect.succeed({
      info: { type: "file" as const, size: readBytes.length, mtimeMs: 0 },
      bytes: range === undefined ? readBytes.slice() : readBytes.slice(range.offset, range.offset + range.length),
    })
  },
  list: (path) => {
    listCalls.push(AbsolutePath.make(path))
    return memory.list(slash(path))
  },
  write: (path, bytes) => memory.write(slash(path), bytes),
  stat: (path) => memory.stat(slash(path)),
  remove: (path) => memory.remove(slash(path)),
  move: (from, to) => memory.move(slash(from), slash(to)),
  mkdir: (path) => memory.mkdir(slash(path)),
  append: (path, bytes) => memory.append(slash(path), bytes),
}
const environment = Layer.succeed(
  Environment.Service,
  Environment.Service.of({
    id: Environment.localID,
    local: true,
    path,
    files,
    spawner: Environment.makeMemoryDriver().spawner,
  }),
)
const seed = (file: string, content: string | Uint8Array = "x\n") =>
  files.write(AbsolutePath.make(file), typeof content === "string" ? encoder.encode(content) : content)
const readPaths = () => [...new Set(readCalls)]
let allow = true
let deniedResource: string | undefined
const permission = permissionLayer({
  assert: (input) =>
    Effect.sync(() => {
      assertions.push(input)
    }).pipe(
      Effect.andThen(
        allow && !input.resources.some((resource) => resource === deniedResource)
          ? Effect.void
          : Effect.fail(
              new Permission.BlockedError({
                rules: [],
                permission: input.action,
                resources: input.resources,
              }),
            ),
      ),
    ),
  allows: (input) => Effect.succeed(allow && !input.resources.some((resource) => resource === deniedResource)),
})
const config = Config.testLayer()
const imageLayer = AppNodeBuilder.build(Image.node)
const locationLayer = Layer.succeed(
  Location.Service,
  Location.Service.of(location({ directory: AbsolutePath.make(process.cwd()) })),
)
const unavailableImage = Layer.mock(Image.Service, {
  normalize: () => Effect.fail(new Image.ResizerUnavailableError()),
})
const readLayer = (imageLayer: Layer.Layer<Image.Service>) =>
  Layer.mergeAll(
    AppNodeBuilder.build(LayerNode.group([Tool.node, readToolNode, Skill.node]), [
      Environment.node.replace(environment),
      Permission.node.replace(permission),
      Config.node.replace(config),
      Image.node.replace(imageLayer),
      Location.node.replace(locationLayer),
      Global.node.replace(Global.layerWith({ data: Global.Path.data })),
    ]),
    // Merge by reference so Config.Test and Image.Service resolve to the memoized instances.
    config,
    imageLayer,
  )
const noFlagOverrides = Layer.succeed(Flag.Overrides, undefined)
const it = testEffect(readLayer(imageLayer).pipe(Layer.provide(noFlagOverrides)))
const codeModeIt = testEffect(readLayer(imageLayer).pipe(Layer.provide(Layer.succeed(Flag.Overrides, "full_codemode"))))
// Real-file tests provide their own layer per temp folder.
const live = testEffect(noFlagOverrides)
// Reads through the real filesystem with the location at `directory`.
const readReal = (directory: string, file: string) =>
  Effect.gen(function* () {
    const registry = yield* Tool.Service
    return yield* executeTool(registry, {
      sessionID,
      ...toolIdentity,
      call: { type: "tool-call", id: "call-suggest", name: "read", input: { path: file } },
    })
  }).pipe(
    Effect.provide(
      Layer.mergeAll(
        AppNodeBuilder.build(LayerNode.group([Tool.node, readToolNode, Skill.node]), [
          Environment.node.replace(hostEnvironmentLayer),
          Permission.node.replace(permission),
          Config.node.replace(config),
          Image.node.replace(imageLayer),
          Location.node.replace(
            Layer.succeed(Location.Service, Location.Service.of(location({ directory: AbsolutePath.make(directory) }))),
          ),
          Global.node.replace(Global.layerWith({ data: Global.Path.data })),
        ]),
        config,
        imageLayer,
      ),
    ),
  )
// Returns the failure message of a real-filesystem read.
const readMissing = (directory: string, file: string) =>
  readReal(directory, file).pipe(Effect.map((result) => result.error?.message))
const write = (file: string) =>
  Effect.promise(() => fs.mkdir(path.dirname(file), { recursive: true }).then(() => fs.writeFile(file, "x\n")))
const itWithoutResizer = testEffect(readLayer(unavailableImage).pipe(Layer.provide(noFlagOverrides)))
const sessionID = Session.ID.make("ses_read_tool_test")

describe("ReadTool", () => {
  beforeEach(async () => {
    assertions.length = 0
    readCalls.length = 0
    listCalls.length = 0
    allow = true
    deniedResource = undefined
    readDefect = undefined
    readBytes = undefined
    readFailure = undefined
    memory = Environment.makeFiles(Environment.makeMemoryDriver())
    await Effect.runPromise(seed(path.join(process.cwd(), "README.md"), "hello"))
  })

  it.effect("registers, authorizes, and reads through the location filesystem", () =>
    Effect.gen(function* () {
      const registry = yield* Tool.Service

      const direct = yield* toolDefinitions(registry)
      expect(direct.map((tool) => tool.name)).toEqual(["read", "execute"])
      expect(direct[0]?.description).toContain("Each text line is prefixed by its 1-based line number")
      expect(
        (yield* toolDefinitions(registry, [{ action: "read", resource: "*", effect: "deny" }])).map(
          (tool) => tool.name,
        ),
      ).toEqual(["execute"])
      const execution = yield* executeTool(registry, {
        sessionID,
        ...toolIdentity,
        call: { type: "tool-call", id: "call-read", name: "read", input: { path: "README.md" } },
      })
      expect(execution.status).toBe("completed")
      if (execution.status !== "completed") return
      expect(execution.output).toEqual({ type: "text", content: "hello", offset: 1 })
      expect(execution.metadata).toEqual({ truncated: false })
      expect(execution.content).toEqual([{ type: "text", text: "Read file README.md, lines 1-1\n1: hello" }])
      expect(assertions).toMatchObject([{ sessionID, action: "read", resources: ["README.md"], save: ["*"] }])
      expect(readPaths()).toEqual([AbsolutePath.make(path.join(process.cwd(), "README.md"))])
      expect(listCalls).toEqual([])
    }),
  )

  codeModeIt.effect("places read in Code Mode with full_codemode unless demoted to direct", () =>
    Effect.gen(function* () {
      const registry = yield* Tool.Service
      const inCodeMode = yield* registry.snapshot()
      expect(inCodeMode.definitions.map((tool) => tool.name)).toEqual(["execute"])
      expect(inCodeMode.codeModeCatalog?.tools[0]).toMatchObject({
        type: "tool",
        name: "read",
        pinned: true,
        signature: expect.not.stringContaining("lineCount"),
      })
      expect(inCodeMode.codeModeCatalog?.tools[0]?.description).toBe(
        "Read a file or directory: text, images, and PDFs. An image or PDF is attached to the execute result even if the program doesn't return it. A call returns one page, at most 2000 lines or 50 KB, and `next` is where the following page starts.",
      )
      const demoted = yield* registry.snapshot(undefined, { tools: { direct: new Set(["read"]) } })
      expect(demoted.definitions.map((tool) => tool.name)).toEqual(["read", "execute"])
      expect(demoted.definitions[0]?.description).toContain("Each text line is prefixed by its 1-based line number")
    }),
  )

  it.effect("rejects a zero limit before reading", () =>
    Effect.gen(function* () {
      const registry = yield* Tool.Service
      const result = yield* executeTool(registry, {
        sessionID,
        ...toolIdentity,
        call: { type: "tool-call", id: "call-zero-limit", name: "read", input: { path: "README.md", limit: 0 } },
      })
      expect(result).toMatchObject({
        status: "error",
        error: { message: "Limit must be a positive integer" },
      })
      expect(assertions).toEqual([])
      expect(readPaths()).toEqual([])
    }),
  )

  it.effect("asks for external_directory approval before reading an external absolute path", () =>
    Effect.gen(function* () {
      const registry = yield* Tool.Service
      const external = path.join(path.parse(process.cwd()).root, "external-read", "notes.txt")
      yield* seed(external, "hello")

      expect(
        yield* executeTool(registry, {
          sessionID,
          ...toolIdentity,
          call: { type: "tool-call", id: "call-external-read", name: "read", input: { path: external } },
        }),
      ).toMatchObject({ status: "completed" })
      expect(assertions).toMatchObject([
        {
          sessionID,
          action: "external_directory",
          resources: [path.join(path.dirname(external), "*").replaceAll("\\", "/")],
        },
        { sessionID, action: "read", resources: [external.replaceAll("\\", "/")], save: ["*"] },
      ])
      expect(readPaths()).toEqual([AbsolutePath.make(external)])
    }),
  )

  it.effect("returns a small PNG as native media instead of durable base64 text", () =>
    Effect.gen(function* () {
      const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
      readBytes = Buffer.from(png, "base64")
      const registry = yield* Tool.Service

      const execution = yield* executeTool(registry, {
        sessionID,
        ...toolIdentity,
        call: { type: "tool-call", id: "call-image", name: "read", input: { path: "pixel.png" } },
      })
      expect(execution.status).toBe("completed")
      if (execution.status !== "completed") return
      expect(execution.output).toEqual({
        type: "media",
        uri: pathToFileURL(path.join(process.cwd(), "pixel.png")).href,
        mime: "image/png",
        name: "pixel.png",
      })
      expect(execution.content).toEqual([
        { type: "text", text: "Image read successfully" },
        { type: "file", uri: `data:image/png;base64,${png}`, mime: "image/png", name: "pixel.png" },
      ])
      expect(readPaths()).toEqual([AbsolutePath.make(path.join(process.cwd(), "pixel.png"))])

      const settled = yield* executeTool(registry, {
        sessionID,
        ...toolIdentity,
        call: { type: "tool-call", id: "call-image-settle", name: "read", input: { path: "pixel.png" } },
      })
      expect(settled.status).toBe("completed")
      if (settled.status !== "completed") return
      expect(settled.metadata).toEqual({ truncated: false })
      expect(settled.content).toMatchObject([
        { type: "text", text: "Image read successfully" },
        { type: "file", mime: "image/png", uri: `data:image/png;base64,${png}` },
      ])
    }),
  )

  it.effect("preserves a PNG above the generic text limit as native media", () =>
    Effect.gen(function* () {
      const photon = yield* Effect.promise(() => import("@silvia-odwyer/photon-node"))
      const pixels = Uint8Array.from({ length: 256 * 256 * 4 }, (_, index) => (index * 73 + (index >> 3)) % 256)
      const source = new photon.PhotonImage(pixels, 256, 256)
      const png = Buffer.from(source.get_bytes()).toString("base64")
      source.free()
      expect(Buffer.byteLength(png)).toBeGreaterThan(50 * 1024)
      readBytes = Buffer.from(png, "base64")
      const registry = yield* Tool.Service

      const settled = yield* executeTool(registry, {
        sessionID,
        ...toolIdentity,
        call: { type: "tool-call", id: "call-large-image", name: "read", input: { path: "large.png" } },
      })

      expect(settled.status).toBe("completed")
      if (settled.status !== "completed") return
      expect(settled.output).toEqual({
        type: "media",
        uri: pathToFileURL(path.join(process.cwd(), "large.png")).href,
        name: "large.png",
        mime: "image/png",
      })
      expect(settled.content).toEqual([
        { type: "text", text: "Image read successfully" },
        { type: "file", uri: `data:image/png;base64,${png}`, mime: "image/png", name: "large.png" },
      ])
    }),
  )

  itWithoutResizer.effect("returns the original image when the resizer is unavailable", () =>
    Effect.gen(function* () {
      const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
      readBytes = Buffer.from(png, "base64")
      const registry = yield* Tool.Service

      expect(
        yield* executeTool(registry, {
          sessionID,
          ...toolIdentity,
          call: { type: "tool-call", id: "call-image-fallback", name: "read", input: { path: "pixel.png" } },
        }),
      ).toMatchObject({
        status: "completed",
        content: [{ type: "text" }, { type: "file", uri: `data:image/png;base64,${png}`, mime: "image/png" }],
      })
    }),
  )

  it.effect("drops undecodable image data from the outcome", () =>
    Effect.gen(function* () {
      readBytes = Buffer.from("iVBORw0KGgo=", "base64")
      const registry = yield* Tool.Service

      expect(
        yield* executeTool(registry, {
          sessionID,
          ...toolIdentity,
          call: { type: "tool-call", id: "call-truncated-image", name: "read", input: { path: "truncated.png" } },
        }),
      ).toMatchObject({
        status: "completed",
        content: [
          { type: "text", text: "Image read successfully" },
          { type: "text", text: "[1 image omitted: could not be decoded.]" },
        ],
      })
    }),
  )

  it.effect("drops oversized images from the outcome when resizing is disabled", () =>
    Effect.gen(function* () {
      const photon = yield* Effect.promise(() => import("@silvia-odwyer/photon-node"))
      const source = new photon.PhotonImage(new Uint8Array(Array.from({ length: 16 * 4 }, () => 255)), 16, 1)
      const base64 = Buffer.from(source.get_bytes()).toString("base64")
      source.free()
      readBytes = Buffer.from(base64, "base64")
      const image = yield* Image.Service
      yield* image.transform((editor) => editor.configure({ autoResize: false, maxWidth: 4 }))
      const registry = yield* Tool.Service

      expect(
        yield* executeTool(registry, {
          sessionID,
          ...toolIdentity,
          call: { type: "tool-call", id: "call-wide-image", name: "read", input: { path: "wide.png" } },
        }),
      ).toMatchObject({
        status: "completed",
        content: [
          { type: "text", text: "Image read successfully" },
          { type: "text", text: "[1 image omitted: could not be resized below the image size limit.]" },
        ],
      })
    }),
  )

  it.effect("resizes images to configured dimensions before returning media", () =>
    Effect.gen(function* () {
      const photon = yield* Effect.promise(() => import("@silvia-odwyer/photon-node"))
      const source = new photon.PhotonImage(new Uint8Array(Array.from({ length: 16 * 4 }, () => 255)), 16, 1)
      const base64 = Buffer.from(source.get_bytes()).toString("base64")
      source.free()
      readBytes = Buffer.from(base64, "base64")
      const image = yield* Image.Service
      yield* image.transform((editor) => editor.configure({ maxWidth: 4 }))
      const registry = yield* Tool.Service
      const result = yield* executeTool(registry, {
        sessionID,
        ...toolIdentity,
        call: { type: "tool-call", id: "call-resize-image", name: "read", input: { path: "wide.png" } },
      })

      expect(result.status).toBe("completed")
      if (result.status !== "completed") return
      const media = result.content?.[1]
      expect(media?.type).toBe("file")
      if (media?.type !== "file") return
      const resized = photon.PhotonImage.new_from_byteslice(Buffer.from(media.uri.split(",")[1] ?? "", "base64"))
      expect(resized.get_width()).toBeLessThanOrEqual(4)
      expect(resized.get_height()).toBeLessThanOrEqual(2_000)
      resized.free()
    }),
  )

  it.effect("stores large opaque PNG screenshots as JPEG", () =>
    Effect.gen(function* () {
      const photon = yield* Effect.promise(() => import("@silvia-odwyer/photon-node"))
      const width = 2000
      const height = 1125
      const opaquePixels = Uint8Array.from({ length: width * height * 4 }, (_, index) =>
        index % 4 === 3 ? 255 : (index * 31 + (index >> 7)) % 256,
      )
      const opaqueSource = new photon.PhotonImage(opaquePixels, width, height)
      const opaqueBase64 = Buffer.from(opaqueSource.get_bytes()).toString("base64")
      opaqueSource.free()
      readBytes = Buffer.from(opaqueBase64, "base64")
      const registry = yield* Tool.Service
      const result = yield* executeTool(registry, {
        sessionID,
        ...toolIdentity,
        call: { type: "tool-call", id: "call-transcode-screenshot", name: "read", input: { path: "screenshot.png" } },
      })

      expect(result.status).toBe("completed")
      if (result.status !== "completed") return
      const media = result.content?.[1]
      expect(media?.type).toBe("file")
      if (media?.type !== "file") return
      expect(media.mime).toBe("image/jpeg")
      const b64 = media.uri.split(",")[1] ?? ""
      expect(b64.length).toBeLessThan(opaqueBase64.length)
      const resized = photon.PhotonImage.new_from_byteslice(Buffer.from(b64, "base64"))
      expect(resized.get_width()).toBe(width)
      expect(resized.get_height()).toBe(height)
      resized.free()
    }),
  )

  it.effect("keeps fitting PNGs that are small, transparent, or smaller than their JPEG", () =>
    Effect.gen(function* () {
      const photon = yield* Effect.promise(() => import("@silvia-odwyer/photon-node"))
      const png = (width: number, height: number, pixel: (x: number, y: number, channel: number) => number) => {
        const pixels = new Uint8Array(width * height * 4)
        for (let index = 0; index < pixels.length; index++) {
          const offset = index >> 2
          pixels[index] = pixel(offset % width, Math.floor(offset / width), index % 4)
        }
        const source = new photon.PhotonImage(pixels, width, height)
        const content = Buffer.from(source.get_bytes()).toString("base64")
        source.free()
        return { uri: "file:///image.png", content, encoding: "base64" as const, mime: "image/png" }
      }
      let seed = 1
      const blocks = Array.from({ length: 500 * 375 }, () => {
        seed = (Math.imul(seed, 1103515245) + 12345) >>> 0
        return (seed >>> 31) * 255
      })
      const cases = {
        transparent: png(600, 600, (x, y, channel) =>
          channel === 3 ? (y < 120 ? 0 : 255) : (((y * 600 + x) * 4 + channel) * 31 + x) % 256,
        ),
        small: png(1000, 1000, (_x, y, channel) => (channel === 3 ? 255 : y % 256)),
        diagram: png(2000, 1500, (x, y, channel) =>
          channel === 3 ? 255 : blocks[Math.floor(y / 4) * 500 + Math.floor(x / 4)]!,
        ),
      }
      expect(cases.transparent.content.length).toBeGreaterThan(384 * 1024)
      expect(cases.small.content.length).toBeLessThanOrEqual(384 * 1024)
      expect(cases.diagram.content.length).toBeGreaterThan(384 * 1024)
      const image = yield* Image.Service
      for (const content of Object.values(cases)) expect(yield* image.normalize("image.png", content)).toEqual(content)
    }),
  )

  it.effect("accepts PNG candidates at the exact base64 limit and skips them one byte below", () =>
    Effect.gen(function* () {
      const photon = yield* Effect.promise(() => import("@silvia-odwyer/photon-node"))
      const source = new photon.PhotonImage(
        Uint8Array.from({ length: 16 * 4 }, () => 255),
        16,
        1,
      )
      const content = {
        uri: "file:///wide.png",
        content: Buffer.from(source.get_bytes()).toString("base64"),
        encoding: "base64" as const,
        mime: "image/png",
      }
      source.free()
      const image = yield* Image.Service

      for (const [maxWidth, padding] of [
        [4, "=="],
        [5, "="],
        [6, ""],
      ] as const) {
        yield* image.transform((editor) => editor.configure({ maxWidth, maxBase64Bytes: 1_024 }))
        const candidate = yield* image.normalize("wide.png", content)
        expect(candidate.mime).toBe("image/png")
        expect(candidate.content.match(/=*$/)?.[0]).toBe(padding)

        yield* image.transform((editor) => editor.configure({ maxBase64Bytes: candidate.content.length }))
        expect(yield* image.normalize("wide.png", content)).toEqual(candidate)

        yield* image.transform((editor) => editor.configure({ maxBase64Bytes: candidate.content.length - 1 }))
        const smaller = yield* image.normalize("wide.png", content)
        expect(smaller.mime).toBe("image/png")
        expect(smaller.content.length).toBeLessThan(candidate.content.length)
      }
    }),
  )

  it.effect("drops images that cannot fit max base64 bytes after resize attempts", () =>
    Effect.gen(function* () {
      const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
      readBytes = Buffer.from(png, "base64")
      const image = yield* Image.Service
      yield* image.transform((editor) => editor.configure({ maxBase64Bytes: 1 }))
      const registry = yield* Tool.Service

      expect(
        yield* executeTool(registry, {
          sessionID,
          ...toolIdentity,
          call: { type: "tool-call", id: "call-max-bytes", name: "read", input: { path: "pixel.png" } },
        }),
      ).toMatchObject({
        status: "completed",
        content: [
          { type: "text", text: "Image read successfully" },
          { type: "text", text: "[1 image omitted: could not be resized below the image size limit.]" },
        ],
      })
    }),
  )

  it.effect("returns supported image contents despite a misleading binary extension", () =>
    Effect.gen(function* () {
      const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
      readBytes = Buffer.from(png, "base64")
      const registry = yield* Tool.Service

      expect(
        yield* executeTool(registry, {
          sessionID,
          ...toolIdentity,
          call: { type: "tool-call", id: "call-disguised-image", name: "read", input: { path: "pixel.bin" } },
        }),
      ).toMatchObject({
        status: "completed",
        content: [{ type: "text" }, { type: "file", mime: "image/png", name: "pixel.bin" }],
      })
    }),
  )

  it.effect("returns PDFs as native media", () =>
    Effect.gen(function* () {
      const pdf = "JVBERi0xLjcK"
      readBytes = Buffer.from(pdf, "base64")
      const registry = yield* Tool.Service

      expect(
        yield* executeTool(registry, {
          sessionID,
          ...toolIdentity,
          call: { type: "tool-call", id: "call-pdf", name: "read", input: { path: "document.pdf" } },
        }),
      ).toMatchObject({
        status: "completed",
        output: {
          type: "media",
          uri: pathToFileURL(path.join(process.cwd(), "document.pdf")).href,
          mime: "application/pdf",
          name: "document.pdf",
        },
        content: [
          { type: "text", text: "PDF read successfully" },
          { type: "file", uri: `data:application/pdf;base64,${pdf}`, mime: "application/pdf", name: "document.pdf" },
        ],
      })
    }),
  )

  live.live("attaches real image and PDF files without their bytes in the structured output", () =>
    withTempDir((tmp) =>
      Effect.gen(function* () {
        const files = [
          {
            name: "pixel.png",
            mime: "image/png",
            text: "Image read successfully",
            bytes: Buffer.from(
              "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
              "base64",
            ),
          },
          {
            name: "document.pdf",
            mime: "application/pdf",
            text: "PDF read successfully",
            bytes: Buffer.from("%PDF-1.7\ncontent"),
          },
        ]
        for (const file of files) {
          const absolute = path.join(tmp.path, file.name)
          yield* Effect.promise(() => fs.writeFile(absolute, file.bytes))

          const result = yield* readReal(tmp.path, file.name)

          expect(result.status).toBe("completed")
          if (result.status !== "completed") return
          expect(result.output).toEqual({
            type: "media",
            uri: pathToFileURL(absolute).href,
            mime: file.mime,
            name: file.name,
          })
          expect(result.content).toEqual([
            { type: "text", text: file.text },
            {
              type: "file",
              uri: `data:${file.mime};base64,${file.bytes.toString("base64")}`,
              mime: file.mime,
              name: file.name,
            },
          ])
        }
      }),
    ),
  )

  it.effect("returns expected filesystem failures to the model", () =>
    Effect.gen(function* () {
      readBytes = encoder.encode("one\narchive\u0000\n")
      const registry = yield* Tool.Service

      expect(
        yield* executeTool(registry, {
          sessionID,
          ...toolIdentity,
          call: {
            type: "tool-call",
            id: "call-binary",
            name: "read",
            input: { path: "archive.dat", offset: 2, limit: 1 },
          },
        }),
      ).toEqual({ status: "error", error: { type: "unknown", message: "Cannot read binary file: archive.dat" } })
      expect(readPaths()).toEqual([AbsolutePath.make(path.join(process.cwd(), "archive.dat"))])
    }),
  )

  it.effect("preserves actionable read failure messages", () =>
    Effect.gen(function* () {
      readFailure = new Environment.WrongKind({ path: "target", actual: "other" })
      const registry = yield* Tool.Service
      expect(
        yield* executeTool(registry, {
          sessionID,
          ...toolIdentity,
          call: { type: "tool-call", id: "call-path-kind", name: "read", input: { path: "target" } },
        }),
      ).toEqual({ status: "error", error: { type: "unknown", message: "Path is not a file or directory: target" } })
    }),
  )

  it.effect("preserves unexpected filesystem defects", () =>
    Effect.gen(function* () {
      readDefect = new Error("unexpected")
      const registry = yield* Tool.Service

      const exit = yield* executeTool(registry, {
        sessionID,
        ...toolIdentity,
        call: { type: "tool-call", id: "call-defect", name: "read", input: { path: "README.md" } },
      }).pipe(Effect.exit)
      expect(Result.getOrThrow(Exit.findDefect(exit))).toBe(readDefect)
      expect(readPaths()).toEqual([AbsolutePath.make(path.join(process.cwd(), "README.md"))])
    }),
  )

  it.effect("does not read when permission is denied", () =>
    Effect.gen(function* () {
      allow = false
      const registry = yield* Tool.Service

      expect(
        yield* executeTool(registry, {
          sessionID,
          ...toolIdentity,
          call: { type: "tool-call", id: "call-read", name: "read", input: { path: "README.md" } },
        }),
      ).toEqual({ status: "error", error: { type: "permission.rejected", message: "Permission denied: read" } })
      expect(readPaths()).toEqual([])
    }),
  )

  it.effect("returns missing paths as model-visible tool failures", () =>
    Effect.gen(function* () {
      yield* Effect.forEach(
        [
          "__missing_read_target__.txt.bak",
          "copy___missing_read_target__.txt",
          "old___missing_read_target__.txt",
          "other___missing_read_target__.txt",
          "unrelated.txt",
        ],
        (name) => seed(path.join(process.cwd(), name)),
        { discard: true },
      )
      const registry = yield* Tool.Service

      expect(
        yield* executeTool(registry, {
          sessionID,
          ...toolIdentity,
          call: { type: "tool-call", id: "call-missing-path", name: "read", input: { path: missingPath } },
        }),
      ).toEqual({
        status: "error",
        error: {
          type: "tool.execution",
          message: `File not found: ${missingPath}\n\nDid you mean one of these?\n__missing_read_target__.txt.bak\nold___missing_read_target__.txt\ncopy___missing_read_target__.txt`,
        },
      })
      expect(assertions).toMatchObject([{ sessionID, action: "read", resources: [missingPath], save: ["*"] }])
      expect(readPaths()).toEqual([AbsolutePath.make(missingAbsolutePath)])
    }),
  )

  it.effect("names the first missing folder and its nearest existing parent", () =>
    Effect.gen(function* () {
      const requested = "__missing_read_folder__/src/file.ts"
      yield* files.mkdir(AbsolutePath.make(path.join(process.cwd(), "__missing_read_folder__-old")))
      const registry = yield* Tool.Service

      expect(
        yield* executeTool(registry, {
          sessionID,
          ...toolIdentity,
          call: { type: "tool-call", id: "call-missing-folder", name: "read", input: { path: requested } },
        }),
      ).toEqual({
        status: "error",
        error: {
          type: "tool.execution",
          message: [
            `File not found: ${requested}`,
            `The folder ${path.join(process.cwd(), "__missing_read_folder__")} does not exist. The nearest folder that does is ${process.cwd()}.`,
            `Did you mean one of these?\n${path.join(process.cwd(), "__missing_read_folder__-old")}`,
          ].join("\n\n"),
        },
      })
    }),
  )

  it.effect("trusts the environment, not this host, about which folders exist", () =>
    Effect.gen(function* () {
      const requested = path.join(process.cwd(), "__only_in_workspace__", "file.ts")
      yield* seed(path.join(process.cwd(), "__only_in_workspace__", "file.tsx"))
      const registry = yield* Tool.Service

      expect(
        yield* executeTool(registry, {
          sessionID,
          ...toolIdentity,
          call: { type: "tool-call", id: "call-workspace-folder", name: "read", input: { path: requested } },
        }),
      ).toEqual({
        status: "error",
        error: {
          type: "tool.execution",
          message: `File not found: ${requested}\n\nDid you mean one of these?\n${path.join(process.cwd(), "__only_in_workspace__", "file.tsx")}`,
        },
      })
    }),
  )

  live.live("suggests close names from the same folder", () =>
    withTempDir((tmp) =>
      Effect.gen(function* () {
        for (const file of ["typo/config.ts", "typo/db.ts", "ext/config.yaml", "case/README.md"])
          yield* write(path.join(tmp.path, file))
        for (const file of ["short/db.ts", "short/io.ts", "short/api.ts", "short/build.ts"])
          yield* write(path.join(tmp.path, file))

        expect(yield* readMissing(tmp.path, "typo/conifg.ts")).toBe(
          `File not found: typo/conifg.ts\n\nDid you mean one of these?\n${path.join("typo", "config.ts")}`,
        )
        expect(yield* readMissing(tmp.path, "ext/config.yml")).toBe(
          `File not found: ext/config.yml\n\nDid you mean one of these?\n${path.join("ext", "config.yaml")}`,
        )
        expect(yield* readMissing(tmp.path, "short/ui.ts")).toBe("File not found: short/ui.ts")
        // Case-insensitive filesystems, such as macOS by default, simply read the file.
        expect([
          undefined,
          `File not found: case/readme.md\n\nDid you mean one of these?\n${path.join("case", "README.md")}`,
        ]).toContain(yield* readMissing(tmp.path, "case/readme.md"))
      }),
    ),
  )

  it.effect("ranks same-folder suggestions and shows at most three", () =>
    Effect.gen(function* () {
      const registry = yield* Tool.Service
      const read = () =>
        executeTool(registry, {
          sessionID,
          ...toolIdentity,
          call: { type: "tool-call", id: "call-ranked", name: "read", input: { path: "config.ts" } },
        }).pipe(Effect.map((result) => result.error?.message))

      // Listed worst first by name, which is the reverse of their rank: a typo, a containing name,
      // the same stem, and the same name in another case.
      yield* Effect.forEach(
        ["acnfig.ts", "cconfig.ts", "config.json", "Config.ts"],
        (name) => seed(path.join(process.cwd(), name)),
        { discard: true },
      )
      expect(yield* read()).toBe(
        "File not found: config.ts\n\nDid you mean one of these?\nConfig.ts\nconfig.json\ncconfig.ts",
      )
      yield* files.remove(AbsolutePath.make(path.join(process.cwd(), "Config.ts")))
      expect(yield* read()).toBe(
        "File not found: config.ts\n\nDid you mean one of these?\nconfig.json\ncconfig.ts\nacnfig.ts",
      )
    }),
  )

  live.live("suggests a path written from the parent of the location first", () =>
    withTempDir((tmp) =>
      Effect.gen(function* () {
        const repo = path.join(tmp.path, "repo")
        yield* write(path.join(repo, "src", "a.ts"))
        const requested = path.join(tmp.path, "src", "a.ts")

        expect(yield* readMissing(repo, requested)).toBe(
          `File not found: ${requested}\n\nThe folder ${path.join(tmp.path, "src")} does not exist. The nearest folder that does is ${tmp.path}.\n\nDid you mean one of these?\n${path.join(repo, "src", "a.ts")}`,
        )
        yield* write(path.join(tmp.path, "src", "a.tsx"))
        expect(yield* readMissing(repo, requested)).toBe(
          `File not found: ${requested}\n\nDid you mean one of these?\n${path.join(repo, "src", "a.ts")}\n${path.join(tmp.path, "src", "a.tsx")}`,
        )
      }),
    ),
  )

  live.live("suggests close folder names from the nearest existing folder", () =>
    withTempDir((tmp) =>
      Effect.gen(function* () {
        yield* write(path.join(tmp.path, "lib", "x.ts"))

        expect(yield* readMissing(tmp.path, "libs/x.ts")).toBe(
          `File not found: libs/x.ts\n\nThe folder ${path.join(tmp.path, "libs")} does not exist. The nearest folder that does is ${tmp.path}.\n\nDid you mean one of these?\n${path.join(tmp.path, "lib")}`,
        )
      }),
    ),
  )

  it.effect("recovers a unique file whose non-breaking spaces differ", () =>
    Effect.gen(function* () {
      const requested = "Screenshot 2026-08-27 3.15 PM.png"
      const recovered = "Screenshot 2026-08-27 3.15\u202fPM.png"
      const requestedAbsolute = path.join(process.cwd(), requested)
      const recoveredAbsolute = path.join(process.cwd(), recovered)
      yield* seed(recoveredAbsolute, "hello")
      const registry = yield* Tool.Service

      const result = yield* executeTool(registry, {
        sessionID,
        ...toolIdentity,
        call: { type: "tool-call", id: "call-recovered-path", name: "read", input: { path: requested } },
      })

      expect(result).toMatchObject({
        status: "completed",
        content: [{ type: "text", text: `Read file ${recovered}, lines 1-1\n1: hello` }],
      })
      expect(assertions).toMatchObject([
        { action: "read", resources: [requested] },
        { action: "read", resources: [recovered] },
      ])
      expect(readPaths()).toEqual([AbsolutePath.make(requestedAbsolute), AbsolutePath.make(recoveredAbsolute)])
      expect(listCalls).toEqual([AbsolutePath.make(process.cwd())])
    }),
  )

  it.effect("recovers an external filename without repeating directory approval", () =>
    Effect.gen(function* () {
      const directory = path.join(path.parse(process.cwd()).root, "external-read")
      const requested = path.join(directory, "report final.txt")
      const recovered = path.join(directory, "report\u202ffinal.txt")
      yield* seed(recovered, "hello")
      const registry = yield* Tool.Service

      expect(
        yield* executeTool(registry, {
          sessionID,
          ...toolIdentity,
          call: { type: "tool-call", id: "call-external-recovery", name: "read", input: { path: requested } },
        }),
      ).toMatchObject({ status: "completed" })
      expect(assertions).toMatchObject([
        { action: "external_directory", resources: [path.join(directory, "*").replaceAll("\\", "/")] },
        { action: "read", resources: [requested.replaceAll("\\", "/")] },
        { action: "read", resources: [recovered.replaceAll("\\", "/")] },
      ])
      expect(readPaths()).toEqual([AbsolutePath.make(requested), AbsolutePath.make(recovered)])
    }),
  )

  it.effect("does not read a recovered filename denied by its own read rules", () =>
    Effect.gen(function* () {
      const requested = path.join(process.cwd(), "report final.txt")
      const recovered = path.join(process.cwd(), "report\u202ffinal.txt")
      deniedResource = path.basename(recovered)
      yield* seed(recovered, "hello")
      const registry = yield* Tool.Service

      expect(
        yield* executeTool(registry, {
          sessionID,
          ...toolIdentity,
          call: { type: "tool-call", id: "call-denied-recovery", name: "read", input: { path: requested } },
        }),
      ).toMatchObject({ status: "error", error: { type: "permission.rejected" } })
      expect(assertions).toMatchObject([
        { action: "read", resources: [path.basename(requested)] },
        { action: "read", resources: [path.basename(recovered)] },
      ])
      expect(readPaths()).toEqual([AbsolutePath.make(requested)])
    }),
  )

  it.effect("does not recover ambiguous files", () =>
    Effect.gen(function* () {
      const requested = "report final.txt"
      yield* seed(path.join(process.cwd(), "report\u00a0final.txt"))
      yield* seed(path.join(process.cwd(), "report\u202ffinal.txt"))
      const registry = yield* Tool.Service

      expect(
        yield* executeTool(registry, {
          sessionID,
          ...toolIdentity,
          call: { type: "tool-call", id: "call-ambiguous-path", name: "read", input: { path: requested } },
        }),
      ).toMatchObject({ status: "error", error: { message: `File not found: ${requested}` } })
      expect(assertions).toHaveLength(1)
      expect(readPaths()).toHaveLength(1)
    }),
  )

  it.effect("does not recover a directory", () =>
    Effect.gen(function* () {
      const requested = "report final"
      const recovered = "report\u00a0final"
      yield* files.mkdir(AbsolutePath.make(path.join(process.cwd(), recovered)))
      const registry = yield* Tool.Service

      expect(
        yield* executeTool(registry, {
          sessionID,
          ...toolIdentity,
          call: { type: "tool-call", id: "call-directory-recovery", name: "read", input: { path: requested } },
        }),
      ).toMatchObject({ status: "error", error: { message: `File not found: ${requested}` } })
      expect(assertions).toHaveLength(1)
      expect(readPaths()).toHaveLength(1)
    }),
  )

  it.effect("lists a bounded directory page through read", () =>
    Effect.gen(function* () {
      const source = path.join(process.cwd(), "src")
      yield* files.mkdir(AbsolutePath.make(path.join(source, "assets")))
      yield* files.mkdir(AbsolutePath.make(path.join(source, "components")))
      yield* Effect.forEach(["index.ts", "z1.ts", "z2.ts"], (name) => seed(path.join(source, name)), { discard: true })
      const registry = yield* Tool.Service

      const result = yield* executeTool(registry, {
        sessionID,
        ...toolIdentity,
        call: {
          type: "tool-call",
          id: "call-read-directory",
          name: "read",
          input: { path: "src", offset: 2, limit: 2 },
        },
      })
      const components = `components${path.sep}`
      expect(result).toMatchObject({
        status: "completed",
        output: { type: "directory", entries: [components, "index.ts"], next: 4 },
      })
      if (result.status !== "completed") return
      expect(result.metadata).toEqual({ truncated: true })
      expect(result.content).toEqual([
        {
          type: "text",
          text: `Read directory src, entries 2-3\n${components}\nindex.ts\n[Output truncated. Continue reading with offset: 4]`,
        },
      ])
      expect(assertions).toMatchObject([{ sessionID, action: "read", resources: ["src"], save: ["*"] }])
      expect(readPaths()).toEqual([AbsolutePath.make(path.join(process.cwd(), "src"))])
    }),
  )

  it.effect("normalizes a zero directory offset in the model heading", () =>
    Effect.gen(function* () {
      yield* Effect.forEach(["index.ts", "zzz.ts"], (name) => seed(path.join(process.cwd(), "src", name)), {
        discard: true,
      })
      const registry = yield* Tool.Service

      const result = yield* executeTool(registry, {
        sessionID,
        ...toolIdentity,
        call: {
          type: "tool-call",
          id: "call-read-directory-zero",
          name: "read",
          input: { path: "src", offset: 0, limit: 1 },
        },
      })
      expect(result.status).toBe("completed")
      if (result.status !== "completed") return
      expect(result.content).toEqual([
        {
          type: "text",
          text: "Read directory src, entries 1-1\nindex.ts\n[Output truncated. Continue reading with offset: 2]",
        },
      ])
      expect(readPaths()).toEqual([AbsolutePath.make(path.join(process.cwd(), "src"))])
    }),
  )

  it.effect("does not list a directory when permission is denied", () =>
    Effect.gen(function* () {
      allow = false
      const registry = yield* Tool.Service

      expect(
        yield* executeTool(registry, {
          sessionID,
          ...toolIdentity,
          call: { type: "tool-call", id: "call-read-directory-denied", name: "read", input: { path: "src" } },
        }),
      ).toEqual({ status: "error", error: { type: "permission.rejected", message: "Permission denied: read" } })
      expect(readPaths()).toEqual([])
    }),
  )

  it.effect("forwards pagination and returns bounded text pages with continuation", () =>
    Effect.gen(function* () {
      yield* seed(path.join(process.cwd(), "large.txt"), "a\nhello\nc\n")
      const registry = yield* Tool.Service

      const result = yield* executeTool(registry, {
        sessionID,
        ...toolIdentity,
        call: {
          type: "tool-call",
          id: "call-large",
          name: "read",
          input: { path: "large.txt", offset: 2, limit: 1 },
        },
      })
      expect(result).toMatchObject({ status: "completed" })
      if (result.status !== "completed") return
      expect(result.output).toEqual({ type: "text", content: "hello", offset: 2, next: 3 })
      expect(result.metadata).toEqual({ truncated: true })
      expect(result.content).toEqual([
        {
          type: "text",
          text: "Read file large.txt, lines 2-2\n2: hello\n[Output truncated. Continue reading with offset: 3]",
        },
      ])
      expect(readPaths()).toEqual([AbsolutePath.make(path.join(process.cwd(), "large.txt"))])

      const following = yield* executeTool(registry, {
        sessionID,
        ...toolIdentity,
        call: {
          type: "tool-call",
          id: "call-large-next",
          name: "read",
          input: { path: "large.txt", offset: result.output.next },
        },
      })
      expect(following).toMatchObject({ status: "completed" })
      if (following.status !== "completed") return
      expect(following.output).toEqual({ type: "text", content: "c", offset: 3 })
      expect(following.content).toEqual([{ type: "text", text: "Read file large.txt, lines 3-3\n3: c" }])
    }),
  )

  it.effect("forwards a negative offset and shows the real line numbers and continuation", () =>
    Effect.gen(function* () {
      const lines = Array.from({ length: 13 }, (_, index) =>
        index === 8 ? "nine" : index === 9 ? "ten" : `line ${index + 1}`,
      )
      yield* seed(path.join(process.cwd(), "log.txt"), lines.join("\n"))
      const registry = yield* Tool.Service

      const result = yield* executeTool(registry, {
        sessionID,
        ...toolIdentity,
        call: { type: "tool-call", id: "call-tail", name: "read", input: { path: "log.txt", offset: -5, limit: 2 } },
      })
      expect(result.status).toBe("completed")
      if (result.status !== "completed") return
      expect(result.content).toEqual([
        {
          type: "text",
          text: "Read file log.txt, lines 9-10\n9: nine\n10: ten\n[Output truncated. Continue reading with offset: 11]",
        },
      ])
      expect(readPaths()).toEqual([AbsolutePath.make(path.join(process.cwd(), "log.txt"))])
    }),
  )

  it.effect("returns the negative directory offset error to the model", () =>
    Effect.gen(function* () {
      yield* files.mkdir(AbsolutePath.make(path.join(process.cwd(), "src")))
      const registry = yield* Tool.Service

      expect(
        yield* executeTool(registry, {
          sessionID,
          ...toolIdentity,
          call: { type: "tool-call", id: "call-dir-tail", name: "read", input: { path: "src", offset: -5 } },
        }),
      ).toEqual({
        status: "error",
        error: { type: "unknown", message: "A negative offset only works for files, and src is a directory" },
      })
    }),
  )

  it.effect("reads virtual skill:// files and directories from Skill.Service without external_directory approval", () =>
    Effect.gen(function* () {
      const skills = yield* Skill.Service
      const registry = yield* Tool.Service
      yield* Effect.scoped(
        Effect.gen(function* () {
          yield* skills.transform((editor) =>
            editor.add(
              Skill.Info.make({
                id: Skill.ID.make("guide"),
                name: Skill.Name.make("Guide"),
                description: "Guide",
                path: AbsolutePath.make("skill://guide/SKILL.md"),
                content: "# Guide\nRead references/style.md",
              }),
              {
                "references/style.md": "Line 1\nLine 2",
                "references/guide.pdf": "%PDF-1.7\nguide",
              },
            ),
          )
          yield* skills.transform((editor) =>
            editor.add(
              Skill.Info.make({
                id: Skill.ID.make("disk"),
                name: Skill.Name.make("Disk"),
                path: AbsolutePath.make("/somewhere/disk/SKILL.md"),
                content: "Disk",
              }),
            ),
          )

          const file = yield* executeTool(registry, {
            sessionID,
            ...toolIdentity,
            call: {
              type: "tool-call",
              id: "call-skill-file",
              name: "read",
              input: { path: "skill://guide/references/style.md", offset: 2, limit: 1 },
            },
          })
          expect(file).toMatchObject({
            status: "completed",
            output: { type: "text", content: "Line 2", offset: 2 },
            content: [{ type: "text", text: "Read file skill://guide/references/style.md, lines 2-2\n2: Line 2" }],
          })

          const root = yield* executeTool(registry, {
            sessionID,
            ...toolIdentity,
            call: { type: "tool-call", id: "call-skill-dir", name: "read", input: { path: "skill://guide/" } },
          })
          expect(root).toMatchObject({
            status: "completed",
            output: { type: "directory", entries: ["references/", "SKILL.md"] },
            content: [
              {
                type: "text",
                text: "Read directory skill://guide/, entries 1-2\nreferences/\nSKILL.md",
              },
            ],
          })

          for (const bad of [
            "skill://",
            "skill://guide/../SKILL.md",
            "skill://guide/missing.md",
            "skill://unknown",
            "skill://disk/SKILL.md",
          ]) {
            expect(
              yield* executeTool(registry, {
                sessionID,
                ...toolIdentity,
                call: { type: "tool-call", id: `call-${bad}`, name: "read", input: { path: bad } },
              }),
            ).toEqual({
              status: "error",
              error: { type: "tool.execution", message: `File not found: ${bad}` },
            })
          }

          expect(assertions).toMatchObject([
            { sessionID, action: "skill", resources: ["guide"], save: ["guide"] },
            { sessionID, action: "read", resources: ["skill://guide/references/style.md"], save: ["*"] },
            { sessionID, action: "skill", resources: ["guide"], save: ["guide"] },
            { sessionID, action: "read", resources: ["skill://guide"], save: ["*"] },
            { sessionID, action: "skill", resources: ["guide"], save: ["guide"] },
            { sessionID, action: "read", resources: ["skill://guide/missing.md"], save: ["*"] },
          ])
          expect(readPaths()).toEqual([])

          const pdf = yield* executeTool(registry, {
            sessionID,
            ...toolIdentity,
            call: {
              type: "tool-call",
              id: "call-skill-pdf",
              name: "read",
              input: { path: "skill://guide/references/guide.pdf" },
            },
          })
          expect(pdf).toMatchObject({
            status: "completed",
            content: [
              { type: "text", text: "PDF read successfully" },
              {
                type: "file",
                uri: `data:application/pdf;base64,${Buffer.from("%PDF-1.7\nguide").toString("base64")}`,
                mime: "application/pdf",
                name: "skill://guide/references/guide.pdf",
              },
            ],
          })
          if (pdf.status !== "completed") return
          expect(pdf.output).toEqual({
            type: "media",
            uri: "skill://guide/references/guide.pdf",
            mime: "application/pdf",
            name: "guide.pdf",
          })

          deniedResource = "guide"
          expect(
            yield* executeTool(registry, {
              sessionID,
              ...toolIdentity,
              call: {
                type: "tool-call",
                id: "call-skill-denied",
                name: "read",
                input: { path: "skill://guide/SKILL.md" },
              },
            }),
          ).toEqual({ status: "error", error: { type: "permission.rejected", message: "Permission denied: skill" } })

          deniedResource = "skill://guide/SKILL.md"
          for (const path of ["skill://guide/SKILL.md", "skill://guide/SKILL.md/"]) {
            expect(
              yield* executeTool(registry, {
                sessionID,
                ...toolIdentity,
                call: { type: "tool-call", id: `call-skill-read-denied-${path}`, name: "read", input: { path } },
              }),
            ).toEqual({ status: "error", error: { type: "permission.rejected", message: "Permission denied: read" } })
          }
        }),
      )
    }),
  )
})
