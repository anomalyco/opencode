import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { FileSystem } from "@opencode-ai/core/filesystem"
import { PermissionV2 } from "@opencode-ai/core/permission"
import { SessionV2 } from "@opencode-ai/core/session"
import { ToolRegistry } from "@opencode-ai/core/tool-registry"
import { ReadTool } from "@opencode-ai/core/tool/read"
import { RelativePath } from "@opencode-ai/core/schema"
import { testEffect } from "./lib/effect"

const assertions: PermissionV2.AssertInput[] = []
const reads: FileSystem.ReadInput[] = []
let resolvedInput: FileSystem.ReadInput | undefined
let resolveFailure: unknown
let size = 5
const filesystem = Layer.succeed(FileSystem.Service, FileSystem.Service.of({
  read: () => Effect.die("unused"),
  resolveRead: (input) =>
    Effect.sync(() => {
      resolvedInput = input
    }).pipe(
      Effect.andThen(resolveFailure === undefined
      ? Effect.succeed(
          new FileSystem.ReadTarget({
            real: "/project/README.md",
            resource: input.reference === undefined ? "README.md" : `${input.reference}:README.md`,
            size,
          }),
        )
      : Effect.die(resolveFailure)),
    ),
  readResolved: () =>
    Effect.sync(() => {
      if (resolvedInput) reads.push(resolvedInput)
      return new FileSystem.TextContent({ type: "text", content: "hello", mime: "text/plain" })
    }),
  list: () => Effect.die("unused"),
  find: () => Effect.die("unused"),
  grep: () => Effect.die("unused"),
  isIgnored: () => false,
}))
let allow = true
const permission = Layer.succeed(PermissionV2.Service, PermissionV2.Service.of({
  assert: (input) =>
    Effect.sync(() => {
      assertions.push(input)
    }).pipe(Effect.andThen(allow ? Effect.void : Effect.fail(new PermissionV2.DeniedError({ rules: [] })))),
  ask: () => Effect.die("unused"),
  reply: () => Effect.die("unused"),
  get: () => Effect.die("unused"),
  forSession: () => Effect.die("unused"),
  list: () => Effect.die("unused"),
}))
const registry = ToolRegistry.layer
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
      size = 5
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
      size = 5
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

  it.effect("authorizes project references with their canonical identity", () =>
    Effect.gen(function* () {
      assertions.length = 0
      reads.length = 0
      allow = true
      resolveFailure = undefined
      size = 5
      resolvedInput = undefined
      const registry = yield* ToolRegistry.Service

      yield* registry.execute({
        sessionID,
        call: { type: "tool-call", id: "call-read", name: "read", input: { path: "README.md", reference: "docs" } },
      })

      expect(assertions).toMatchObject([{ resources: ["docs:README.md"] }])
    }),
  )

  it.effect("settles missing and oversized files as typed tool errors", () =>
    Effect.gen(function* () {
      allow = true
      reads.length = 0
      const registry = yield* ToolRegistry.Service

      resolveFailure = new Error("missing")
      expect(
        yield* registry.execute({
          sessionID,
          call: { type: "tool-call", id: "call-missing", name: "read", input: { path: "missing.txt" } },
        }),
      ).toEqual({ type: "error", value: "Unable to read missing.txt" })

      resolveFailure = undefined
      size = 50 * 1024 + 1
      expect(
        yield* registry.execute({
          sessionID,
          call: { type: "tool-call", id: "call-large", name: "read", input: { path: "large.txt" } },
        }),
      ).toEqual({ type: "error", value: "Unable to read large.txt" })
      expect(reads).toEqual([])
    }),
  )
})
