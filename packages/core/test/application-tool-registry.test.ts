import { describe, expect } from "bun:test"
import { Tool } from "@opencode-ai/core/public"
import { ApplicationTool } from "@opencode-ai/core/tool/application"
import { ApplicationToolRegistry } from "@opencode-ai/core/tool/application-registry"
import { PermissionV2 } from "@opencode-ai/core/permission"
import { SessionV2 } from "@opencode-ai/core/session"
import { ToolRegistry } from "@opencode-ai/core/tool/registry"
import { Effect, Exit, Fiber, Layer, Schema, Scope } from "effect"
import { testEffect } from "./lib/effect"

const permission = Layer.mock(PermissionV2.Service, {
  assert: () => Effect.void,
})
const applications = ApplicationToolRegistry.layer
const registry = ToolRegistry.layerWithApplications.pipe(Layer.provide(permission), Layer.provide(applications))
const it = testEffect(Layer.mergeAll(applications, registry))

const sessionID = SessionV2.ID.make("ses_application_tool")
const contextual = (contexts: Tool.Context[]) =>
  Tool.make({
    description: "Read application context",
    parameters: Schema.Struct({ query: Schema.String }),
    success: Schema.Struct({ answer: Schema.String }),
    execute: ({ query }, context) =>
      Effect.sync(() => {
        contexts.push(context)
        return { answer: query.toUpperCase() }
      }),
    toModelOutput: ({ output }) => [
      { type: "text", text: output.answer },
      { type: "file", data: "aGVsbG8=", mime: "image/png", name: "result.png" },
    ],
  })

describe("ApplicationToolRegistry", () => {
  it.effect("advertises and executes a scoped application tool with Session context", () =>
    Effect.gen(function* () {
      const applications = yield* ApplicationToolRegistry.Service
      const registry = yield* ToolRegistry.Service
      const contexts: Tool.Context[] = []

      yield* applications.attach({ application_context: contextual(contexts) })

      expect(yield* registry.definitions()).toMatchObject([
        { name: "application_context", description: "Read application context" },
      ])
      expect(
        yield* registry.settle({
          sessionID,
          call: { type: "tool-call", id: "call-context", name: "application_context", input: { query: "hello" } },
        }),
      ).toEqual({
        result: {
          type: "content",
          value: [
            { type: "text", text: "HELLO" },
            { type: "media", mediaType: "image/png", data: "aGVsbG8=", filename: "result.png" },
          ],
        },
        output: {
          structured: { answer: "HELLO" },
          content: [
            { type: "text", text: "HELLO" },
            { type: "file", source: { type: "data", data: "aGVsbG8=" }, mime: "image/png", name: "result.png" },
          ],
        },
      })
      expect(contexts).toEqual([{ sessionID, id: "call-context", name: "application_context" }])
    }),
  )

  it.effect("removes an application tool when its attachment scope closes", () =>
    Effect.gen(function* () {
      const applications = yield* ApplicationToolRegistry.Service
      const registry = yield* ToolRegistry.Service
      const scope = yield* Scope.make()

      yield* applications.attach({ temporary: contextual([]) }).pipe(Scope.provide(scope))
      expect((yield* registry.definitions()).map((tool) => tool.name)).toEqual(["temporary"])

      yield* Scope.close(scope, Exit.void)
      expect(yield* registry.definitions()).toEqual([])
    }),
  )

  it.effect("pins one attachment generation through an in-flight tool snapshot", () =>
    Effect.gen(function* () {
      const applications = yield* ApplicationToolRegistry.Service
      const registry = yield* ToolRegistry.Service
      const firstContexts: Tool.Context[] = []
      const secondContexts: Tool.Context[] = []
      const attachmentScope = yield* Scope.make()
      const snapshotScope = yield* Scope.make()
      yield* applications.attach({ contextual: contextual(firstContexts) }).pipe(Scope.provide(attachmentScope))
      const snapshot = yield* registry.snapshot().pipe(Scope.provide(snapshotScope))

      const closing = yield* Scope.close(attachmentScope, Exit.void).pipe(Effect.forkChild)
      yield* Effect.yieldNow
      yield* applications.attach({ contextual: contextual(secondContexts) })
      yield* snapshot.settle({
        sessionID,
        call: { type: "tool-call", id: "call-first", name: "contextual", input: { query: "first" } },
      })

      expect(firstContexts).toEqual([{ sessionID, id: "call-first", name: "contextual" }])
      expect(secondContexts).toEqual([])
      yield* Scope.close(snapshotScope, Exit.void)
      yield* Fiber.join(closing)
    }),
  )

  it.effect("does not leak an attachment into an already closed scope", () =>
    Effect.gen(function* () {
      const applications = yield* ApplicationToolRegistry.Service
      const registry = yield* ToolRegistry.Service
      const scope = yield* Scope.make()
      yield* Scope.close(scope, Exit.void)

      yield* applications.attach({ closed: contextual([]) }).pipe(Scope.provide(scope))

      expect(yield* registry.definitions()).toEqual([])
    }),
  )

  it.effect("rejects overlapping application tool names atomically", () =>
    Effect.gen(function* () {
      const applications = yield* ApplicationToolRegistry.Service
      yield* applications.attach({ existing: contextual([]) })

      const failure = yield* applications
        .attach({ available: contextual([]), existing: contextual([]) })
        .pipe(Effect.flip)

      expect(failure.name).toBe("existing")
      expect(Array.from((yield* Effect.scoped(applications.snapshot())).keys())).toEqual(["existing"])
    }),
  )

  it.effect("keeps the Location tool when an application tool has the same name", () =>
    Effect.gen(function* () {
      const applications = yield* ApplicationToolRegistry.Service
      const registry = yield* ToolRegistry.Service
      const transform = yield* registry.transform()
      const locationContexts: Tool.Context[] = []
      const applicationContexts: Tool.Context[] = []
      yield* transform((editor) => editor.set("shared", ApplicationTool.entry(contextual(locationContexts))))
      yield* applications.attach({ shared: contextual(applicationContexts) })

      expect((yield* registry.definitions()).map((definition) => definition.name)).toEqual(["shared"])
      expect(
        yield* registry.settle({
          sessionID,
          call: { type: "tool-call", id: "call-shared", name: "shared", input: { query: "location" } },
        }),
      ).toMatchObject({ result: { type: "content" } })
      expect(locationContexts).toEqual([{ sessionID, id: "call-shared", name: "shared" }])
      expect(applicationContexts).toEqual([])
    }),
  )
})
