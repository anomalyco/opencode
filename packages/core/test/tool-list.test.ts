import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { FileSystem } from "@opencode-ai/core/filesystem"
import { PermissionV2 } from "@opencode-ai/core/permission"
import { SessionV2 } from "@opencode-ai/core/session"
import { ToolRegistry } from "@opencode-ai/core/tool-registry"
import { ListTool } from "@opencode-ai/core/tool/list"
import { RelativePath } from "@opencode-ai/core/schema"
import { testEffect } from "./lib/effect"

const assertions: PermissionV2.AssertInput[] = []
const resolved: FileSystem.ListPageInput[] = []
const pages: FileSystem.ListTarget[] = []
const pageInputs: Pick<FileSystem.ListPageInput, "offset" | "limit">[] = []
let allow = true
const target = new FileSystem.ListTarget({
  absolute: "/docs/src",
  real: "/docs/src",
  directory: "/docs",
  root: "/docs",
  resource: "docs:src",
})
let resolvedTarget = target
let afterApproval = () => {}
const filesystem = Layer.succeed(
  FileSystem.Service,
  FileSystem.Service.of({
    read: () => Effect.die("unused"),
    resolveRead: () => Effect.die("unused"),
    readResolved: () => Effect.die("unused"),
    list: () => Effect.die("unused"),
    resolveList: (input = {}) => Effect.sync(() => resolved.push(input)).pipe(Effect.as(resolvedTarget)),
    listResolved: () => Effect.die("unused"),
    listPage: () => Effect.die("unused"),
    listPageResolved: (target, page = {}) =>
      Effect.sync(() => {
        pages.push(target)
        pageInputs.push(page)
        return new FileSystem.ListPage({
          entries: [
            new FileSystem.Entry({
              path: RelativePath.make("src"),
              uri: "file:///project/src",
              type: "directory",
              mime: "application/x-directory",
            }),
          ],
          truncated: false,
        })
      }),
    find: () => Effect.die("unused"),
    grep: () => Effect.die("unused"),
    isIgnored: () => false,
  }),
)
const permission = Layer.succeed(
  PermissionV2.Service,
  PermissionV2.Service.of({
    assert: (input) =>
      Effect.sync(() => {
        assertions.push(input)
        if (allow) afterApproval()
      }).pipe(
        Effect.andThen(allow ? Effect.void : Effect.fail(new PermissionV2.DeniedError({ rules: [] }))),
      ),
    ask: () => Effect.die("unused"),
    reply: () => Effect.die("unused"),
    get: () => Effect.die("unused"),
    forSession: () => Effect.die("unused"),
    list: () => Effect.die("unused"),
  }),
)
const registry = ToolRegistry.layer
const list = ListTool.layer.pipe(Layer.provide(registry), Layer.provide(filesystem), Layer.provide(permission))
const it = testEffect(Layer.mergeAll(registry, filesystem, permission, list))
const sessionID = SessionV2.ID.make("ses_list_tool_test")

function reset() {
  assertions.length = 0
  resolved.length = 0
  pages.length = 0
  pageInputs.length = 0
  allow = true
  resolvedTarget = target
  afterApproval = () => {}
}

describe("ListTool", () => {
  it.effect("registers, authorizes, and lists a bounded page", () =>
    Effect.gen(function* () {
      reset()
      const registry = yield* ToolRegistry.Service

      expect(yield* registry.definitions()).toMatchObject([{ name: "list" }])
      expect(
        yield* registry.execute({
          sessionID,
          call: {
            type: "tool-call",
            id: "call-list",
            name: "list",
            input: { path: "src", reference: "docs", offset: 2, limit: 10 },
          },
        }),
      ).toMatchObject({ type: "json", value: { entries: [{ path: "src", type: "directory" }], truncated: false } })
      expect(assertions).toMatchObject([{ sessionID, action: "list", resources: ["docs:src"], save: ["*"] }])
      expect(resolved).toEqual([
        { path: RelativePath.make("src"), reference: "docs" },
        { path: RelativePath.make("src"), reference: "docs" },
      ])
      expect(pages).toEqual([target])
      expect(pageInputs).toEqual([{ offset: 2, limit: 10 }])
    }),
  )

  it.effect("does not list when permission is denied", () =>
    Effect.gen(function* () {
      reset()
      allow = false
      const registry = yield* ToolRegistry.Service

      expect(
        yield* registry.execute({ sessionID, call: { type: "tool-call", id: "call-denied", name: "list", input: {} } }),
      ).toEqual({ type: "error", value: "Unable to list ." })
      expect(pages).toEqual([])
    }),
  )

  it.effect("rejects out-of-range page limits", () =>
    Effect.gen(function* () {
      reset()
      const registry = yield* ToolRegistry.Service

      expect(
        (yield* registry.execute({
          sessionID,
          call: { type: "tool-call", id: "call-zero", name: "list", input: { limit: 0 } },
        })).type,
      ).toBe("error")
      expect(
        (yield* registry.execute({
          sessionID,
          call: { type: "tool-call", id: "call-large", name: "list", input: { limit: 2_001 } },
        })).type,
      ).toBe("error")
    }),
  )

  it.effect("does not list when the canonical directory changes after permission approval", () =>
    Effect.gen(function* () {
      reset()
      afterApproval = () => {
        resolvedTarget = new FileSystem.ListTarget({ ...target, real: "/outside/src" })
      }
      const registry = yield* ToolRegistry.Service

      expect(
        yield* registry.execute({
          sessionID,
          call: { type: "tool-call", id: "call-swapped", name: "list", input: { path: "src", reference: "docs" } },
        }),
      ).toEqual({ type: "error", value: "Unable to list src" })
      expect(pages).toEqual([])
    }),
  )
})
