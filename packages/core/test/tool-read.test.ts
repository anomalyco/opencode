import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { FileSystem } from "@opencode-ai/core/filesystem"
import { PermissionV2 } from "@opencode-ai/core/permission"
import { SessionV2 } from "@opencode-ai/core/session"
import { ToolRegistry } from "@opencode-ai/core/tool-registry"
import { ReadTool } from "@opencode-ai/core/tool/read"
import { ToolOutputStore } from "@opencode-ai/core/tool-output-store"
import { RelativePath } from "@opencode-ai/core/schema"
import { testEffect } from "./lib/effect"

const assertions: PermissionV2.AssertInput[] = []
const reads: FileSystem.ReadInput[] = []
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
const resourceReads: ToolOutputStore.ReadInput[] = []
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
              resource: input.reference === undefined ? "README.md" : `${input.reference}:README.md`,
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
                  resource: input.reference === undefined ? "README.md" : `${input.reference}:README.md`,
                  size,
                  dev: 1,
                }),
              )
            : Effect.die(resolveFailure),
        ),
      ),
    readResolved: () =>
      Effect.sync(() => {
        reads.push({ path: RelativePath.make("README.md") })
        return new FileSystem.TextContent({ type: "text", content: "hello", mime: "text/plain" })
      }),
    readTextPageResolved: (_target, page = {}) =>
      Effect.sync(() => {
        textPageInputs.push(page)
        return new FileSystem.TextPage({
          type: "text-page",
          content: "hello",
          mime: "text/plain",
          offset: page.offset ?? 1,
          truncated: true,
          next: (page.offset ?? 1) + 1,
        })
      }),
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
const registry = ToolRegistry.layer.pipe(Layer.provide(permission))
const resources = Layer.succeed(
  ToolOutputStore.Service,
  ToolOutputStore.Service.of({
    limits: () => Effect.die("unused"),
    write: () => Effect.die("unused"),
    truncate: () => Effect.die("unused"),
    cleanup: () => Effect.die("unused"),
    read: (input) =>
      Effect.sync(() => {
        resourceReads.push(input)
        return new ToolOutputStore.Page({
          resource: new ToolOutputStore.Resource({ uri: input.uri, mime: "text/plain", size: 5 }),
          content: "hello",
          offset: input.offset ?? 0,
          truncated: false,
        })
      }),
  }),
)
const read = ReadTool.layer.pipe(
  Layer.provide(registry),
  Layer.provide(filesystem),
  Layer.provide(permission),
  Layer.provide(resources),
)
const it = testEffect(Layer.mergeAll(registry, filesystem, permission, resources, read))
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

  it.effect("reads an opaque managed resource without treating it as a path", () =>
    Effect.gen(function* () {
      resourceReads.length = 0
      assertions.length = 0
      const registry = yield* ToolRegistry.Service

      expect(
        yield* registry.execute({
          sessionID,
          call: {
            type: "tool-call",
            id: "call-read-resource",
            name: "read",
            input: { resource: "tool-output://opaque", offset: 2, limit: 10 },
          },
        }),
      ).toEqual({
        type: "json",
        value: {
          resource: { uri: "tool-output://opaque", mime: "text/plain", size: 5 },
          content: "hello",
          offset: 2,
          truncated: false,
        },
      })
      expect(resourceReads).toEqual([{ sessionID, uri: "tool-output://opaque", offset: 2, limit: 10 }])
      expect(assertions).toEqual([])
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

  it.effect("does not read when the file changes after permission approval", () =>
    Effect.gen(function* () {
      assertions.length = 0
      reads.length = 0
      allow = true
      resolveFailure = undefined
      listResolveFailure = new Error("not a directory")
      size = 5
      real = "/project/README.md"
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
