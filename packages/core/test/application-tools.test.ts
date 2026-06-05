import { describe, expect } from "bun:test"
import { Tool } from "@opencode-ai/core/public"
import { ApplicationTools } from "@opencode-ai/core/tool/application-tools"
import { PermissionV2 } from "@opencode-ai/core/permission"
import { SessionV2 } from "@opencode-ai/core/session"
import { ToolRegistry } from "@opencode-ai/core/tool/registry"
import { ToolOutputStore } from "@opencode-ai/core/tool-output-store"
import { Effect, Exit, Layer, Schema, Scope } from "effect"
import { testEffect } from "./lib/effect"

const permission = Layer.mock(PermissionV2.Service, {
  assert: () => Effect.void,
})
const applications = ApplicationTools.layer
const registry = ToolRegistry.layer.pipe(
  Layer.provide(permission),
  Layer.provide(applications),
  Layer.provide(ToolOutputStore.defaultLayer),
)
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

describe("ApplicationTools", () => {
  it.effect("advertises and executes a scoped application tool with Session context", () =>
    Effect.gen(function* () {
      const applications = yield* ApplicationTools.Service
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
      const applications = yield* ApplicationTools.Service
      const registry = yield* ToolRegistry.Service
      const scope = yield* Scope.make()

      yield* applications.attach({ temporary: contextual([]) }).pipe(Scope.provide(scope))
      expect((yield* registry.definitions()).map((tool) => tool.name)).toEqual(["temporary"])

      yield* Scope.close(scope, Exit.void)
      expect(yield* registry.definitions()).toEqual([])
    }),
  )

  it.effect("removes a tool before settling a call produced from an earlier definition", () =>
    Effect.gen(function* () {
      const applications = yield* ApplicationTools.Service
      const registry = yield* ToolRegistry.Service
      const attachmentScope = yield* Scope.make()
      yield* applications.attach({ contextual: contextual([]) }).pipe(Scope.provide(attachmentScope))
      expect((yield* registry.definitions()).map((tool) => tool.name)).toEqual(["contextual"])

      yield* Scope.close(attachmentScope, Exit.void)
      expect(
        yield* registry.settle({
          sessionID,
          call: { type: "tool-call", id: "call-removed", name: "contextual", input: { query: "hello" } },
        }),
      ).toEqual({ result: { type: "error", value: "Unknown tool: contextual" } })
    }),
  )

  it.effect("does not leak an attachment into an already closed scope", () =>
    Effect.gen(function* () {
      const applications = yield* ApplicationTools.Service
      const registry = yield* ToolRegistry.Service
      const scope = yield* Scope.make()
      yield* Scope.close(scope, Exit.void)

      yield* applications.attach({ closed: contextual([]) }).pipe(Scope.provide(scope))

      expect(yield* registry.definitions()).toEqual([])
    }),
  )

  it.effect("captures the attached record before later State rebuilds", () =>
    Effect.gen(function* () {
      const applications = yield* ApplicationTools.Service
      const registry = yield* ToolRegistry.Service
      const attached = { stable: contextual([]) }
      yield* applications.attach(attached)
      Object.assign(attached, { late: contextual([]) })

      yield* Effect.scoped(applications.attach({ temporary: contextual([]) }))

      expect((yield* registry.definitions()).map((tool) => tool.name)).toEqual(["stable"])
    }),
  )

  it.effect("settles with the current same-name application tool and restores earlier attachments", () =>
    Effect.gen(function* () {
      const applications = yield* ApplicationTools.Service
      const registry = yield* ToolRegistry.Service
      const firstContexts: Tool.Context[] = []
      const secondContexts: Tool.Context[] = []
      const scope = yield* Scope.make()
      yield* applications.attach({ contextual: contextual(firstContexts) })
      expect((yield* registry.definitions()).map((tool) => tool.name)).toEqual(["contextual"])
      yield* applications.attach({ contextual: contextual(secondContexts) }).pipe(Scope.provide(scope))

      yield* registry.settle({
        sessionID,
        call: { type: "tool-call", id: "call-second", name: "contextual", input: { query: "second" } },
      })
      yield* Scope.close(scope, Exit.void)
      yield* registry.settle({
        sessionID,
        call: { type: "tool-call", id: "call-first", name: "contextual", input: { query: "first" } },
      })

      expect(secondContexts).toEqual([{ sessionID, id: "call-second", name: "contextual" }])
      expect(firstContexts).toEqual([{ sessionID, id: "call-first", name: "contextual" }])
    }),
  )

  it.effect("keeps the Location tool when an application tool has the same name", () =>
    Effect.gen(function* () {
      const applications = yield* ApplicationTools.Service
      const registry = yield* ToolRegistry.Service
      const transform = yield* registry.transform()
      const locationContexts: Tool.Context[] = []
      const applicationContexts: Tool.Context[] = []
      const location = contextual(locationContexts)
      yield* transform((editor) =>
        editor.set("shared", {
          tool: location.definition,
          execute: ({ parameters, sessionID, call }) =>
            location.execute(parameters, { sessionID, id: call.id, name: call.name }),
        }),
      )
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
