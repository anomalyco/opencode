import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { LocationFileSystem } from "@opencode-ai/core/location-filesystem"
import { PermissionV2 } from "@opencode-ai/core/permission"
import { SessionV2 } from "@opencode-ai/core/session"
import { ToolRegistry } from "@opencode-ai/core/tool-registry"
import { ReadTool } from "@opencode-ai/core/tool/read"
import { RelativePath } from "@opencode-ai/core/schema"
import { testEffect } from "./lib/effect"

const assertions: PermissionV2.AssertInput[] = []
const reads: LocationFileSystem.ReadInput[] = []
const filesystem = Layer.succeed(LocationFileSystem.Service, LocationFileSystem.Service.of({
  read: (input) =>
    Effect.sync(() => {
      reads.push(input)
      return new LocationFileSystem.TextContent({ type: "text", content: "hello", mime: "text/plain" })
    }),
  list: () => Effect.die("unused"),
  find: () => Effect.die("unused"),
  grep: () => Effect.die("unused"),
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
const registry = ToolRegistry.layer()
const read = ReadTool.layer.pipe(Layer.provide(registry), Layer.provide(filesystem), Layer.provide(permission))
const it = testEffect(Layer.mergeAll(registry, filesystem, permission, read))
const sessionID = SessionV2.ID.make("ses_read_tool_test")

describe("ReadTool", () => {
  it.effect("registers, authorizes, and reads through the location filesystem", () =>
    Effect.gen(function* () {
      assertions.length = 0
      reads.length = 0
      allow = true
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
      const registry = yield* ToolRegistry.Service

      expect(
        yield* registry.execute({
          sessionID,
          call: { type: "tool-call", id: "call-read", name: "read", input: { path: "README.md" } },
        }),
      ).toEqual({ type: "error", value: "Permission denied: read README.md" })
      expect(reads).toEqual([])
    }),
  )
})
