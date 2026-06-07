import { describe, expect } from "bun:test"
import { Tool } from "@opencode-ai/core/tool/tool"
import { AgentV2 } from "@opencode-ai/core/agent"
import { ApplicationTools } from "@opencode-ai/core/tool/application-tools"
import { SessionV2 } from "@opencode-ai/core/session"
import { SessionMessage } from "@opencode-ai/core/session/message"
import { ToolOutputStore } from "@opencode-ai/core/tool-output-store"
import { ToolRegistry } from "@opencode-ai/core/tool/registry"
import { executeTool, settleTool, toolDefinitions } from "./lib/tool"
import { Cause, Deferred, Effect, Exit, Fiber, Layer, Option, Schema, Scope } from "effect"
import { testEffect } from "./lib/effect"

const bounds: ToolOutputStore.BoundInput[] = []
const retentionFailure = new ToolOutputStore.StorageError({ operation: "write", cause: new Error("disk full") })
const outputStore = Layer.mock(ToolOutputStore.Service, {
  bound: (input) => {
    if (input.toolCallID === "call-retention-failure") return Effect.fail(retentionFailure)
    return Effect.sync(() => bounds.push(input)).pipe(
      Effect.as(
        input.toolCallID === "call-bounded"
          ? {
              output: { structured: {}, content: [{ type: "text" as const, text: "bounded reference" }] },
              outputPaths: ["/managed/generic"],
            }
          : { output: input.output, outputPaths: [] },
      ),
    )
  },
})
const registry = ToolRegistry.layer.pipe(Layer.provide(ApplicationTools.layer), Layer.provide(outputStore))
const it = testEffect(registry)
const identity = {
  agent: AgentV2.ID.make("build"),
  assistantMessageID: SessionMessage.ID.make("msg_registry"),
}
const sessionID = SessionV2.ID.make("ses_registry")
const call = (name: string, id = `call-${name}`): ToolRegistry.ExecuteInput => ({
  sessionID,
  ...identity,
  call: { type: "tool-call", id, name, input: { text: name } },
})

const make = (permission?: string) => {
  const tool = Tool.make({
    description: "Echo text",
    input: Schema.Struct({ text: Schema.String }),
    output: Schema.Struct({ text: Schema.String }),
    execute: ({ text }) => Effect.succeed({ text }),
    toModelOutput: ({ output }) => [{ type: "text", text: output.text }],
  })
  return permission ? Tool.withPermission(tool, permission) : tool
}

describe("ToolRegistry", () => {
  it.effect("filters disabled tools with edit aliases and ordered wildcard precedence", () =>
    Effect.gen(function* () {
      const service = yield* ToolRegistry.Service
      yield* service.register({
        question: make(),
        bash: make(),
        edit: make("edit"),
        write: make("edit"),
        apply_patch: make("edit"),
      })
      const names = (rules: Parameters<ToolRegistry.Interface["materialize"]>[0]) =>
        toolDefinitions(service, rules).pipe(Effect.map((definitions) => definitions.map((tool) => tool.name)))

      expect(yield* names([{ action: "question", resource: "*", effect: "deny" }])).toEqual([
        "bash",
        "edit",
        "write",
        "apply_patch",
      ])
      expect(
        yield* names([
          { action: "*", resource: "*", effect: "deny" },
          { action: "question", resource: "private", effect: "allow" },
        ]),
      ).toEqual(["question"])
      expect(
        yield* names([
          { action: "question", resource: "private", effect: "allow" },
          { action: "*", resource: "*", effect: "deny" },
        ]),
      ).toEqual([])
      expect(yield* names([{ action: "edit", resource: "*", effect: "deny" }])).toEqual(["question", "bash"])
    }),
  )

  it.effect("keeps permission decoration isolated between registrations", () =>
    Effect.gen(function* () {
      const service = yield* ToolRegistry.Service
      const shared = make()
      yield* service.register({ first: shared })
      yield* service.register({ second: Tool.withPermission(shared, "edit") })
      Tool.withPermission(shared, "question")

      expect(
        (yield* toolDefinitions(service, [{ action: "edit", resource: "*", effect: "deny" }])).map(
          (definition) => definition.name,
        ),
      ).toEqual(["first"])
    }),
  )

  it.effect("reuses model definitions across provider turns", () =>
    Effect.gen(function* () {
      const service = yield* ToolRegistry.Service
      yield* service.register({ echo: make() })
      const first = yield* toolDefinitions(service)
      const second = yield* toolDefinitions(service)

      expect(second[0]).toBe(first[0])
    }),
  )

  it.effect("removes a scoped registration", () =>
    Effect.gen(function* () {
      const service = yield* ToolRegistry.Service
      const scope = yield* Scope.make()
      yield* service.register({ echo: make() }).pipe(Scope.provide(scope))
      expect((yield* toolDefinitions(service)).map((tool) => tool.name)).toEqual(["echo"])
      yield* Scope.close(scope, Exit.void)
      expect(yield* toolDefinitions(service)).toEqual([])
    }),
  )

  it.effect("returns model errors without swallowing interruption or defects", () =>
    Effect.gen(function* () {
      const service = yield* ToolRegistry.Service
      yield* service.register({
        failed: Tool.make({
          description: "Failed",
          input: Schema.Struct({}),
          output: Schema.Struct({ ok: Schema.Boolean }),
          execute: () => Effect.fail(new Tool.Failure({ message: "Denied" })),
        }),
      })
      expect(
        yield* executeTool(service, {
          sessionID,
          ...identity,
          call: { type: "tool-call", id: "failed", name: "failed", input: {} },
        }),
      ).toEqual({ type: "error", value: "Denied" })
      expect(
        yield* executeTool(service, {
          sessionID,
          ...identity,
          call: { type: "tool-call", id: "missing", name: "missing", input: {} },
        }),
      ).toEqual({ type: "error", value: "Unknown tool: missing" })

      yield* service.register({
        defect: Tool.make({
          description: "Defect",
          input: Schema.Struct({}),
          output: Schema.Struct({}),
          execute: () => Effect.die("unexpected executor defect"),
        }),
      })
      expect(
        yield* service.materialize().pipe(
          Effect.flatMap((materialized) =>
            materialized.settle({
              sessionID,
              ...identity,
              call: { type: "tool-call", id: "defect", name: "defect", input: {} },
            }),
          ),
          Effect.catchDefect(Effect.succeed),
        ),
      ).toBe("unexpected executor defect")
    }),
  )

  it.effect("propagates retention failures through settlement", () =>
    Effect.gen(function* () {
      const service = yield* ToolRegistry.Service
      yield* service.register({ echo: make() })
      const materialized = yield* service.materialize()
      const exit = yield* materialized.settle(call("echo", "call-retention-failure")).pipe(Effect.exit)

      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) expect(Option.getOrUndefined(Cause.findErrorOption(exit.cause))).toBe(retentionFailure)
    }),
  )

  it.effect("exposes settlement only through materialization", () =>
    Effect.gen(function* () {
      const service = yield* ToolRegistry.Service
      expect("definitions" in service).toBe(false)
      expect("execute" in service).toBe(false)
      expect("settle" in service).toBe(false)
      expect(typeof service.materialize).toBe("function")
    }),
  )

  it.effect("passes complete invocation identity to the canonical handler", () =>
    Effect.gen(function* () {
      const service = yield* ToolRegistry.Service
      const contexts: Tool.Context[] = []
      yield* service.register({
        context: Tool.make({
          description: "Context",
          input: Schema.Struct({}),
          output: Schema.Struct({ ok: Schema.Boolean }),
          execute: (_, context) => Effect.sync(() => contexts.push(context)).pipe(Effect.as({ ok: true })),
        }),
      })
      yield* executeTool(service, {
        sessionID,
        ...identity,
        call: { type: "tool-call", id: "call-context", name: "context", input: {} },
      })
      expect(contexts).toEqual([{ sessionID, ...identity, toolCallID: "call-context" }])
    }),
  )

  it.effect("encodes output and applies generic settlement bounding", () =>
    Effect.gen(function* () {
      bounds.length = 0
      const service = yield* ToolRegistry.Service
      yield* service.register({ bounded: make() })
      expect(
        yield* settleTool(service, {
          sessionID,
          ...identity,
          call: { type: "tool-call", id: "call-bounded", name: "bounded", input: { text: "complete" } },
        }),
      ).toEqual({
        result: { type: "text", value: "bounded reference" },
        output: { structured: {}, content: [{ type: "text", text: "bounded reference" }] },
        outputPaths: ["/managed/generic"],
      })
      expect(bounds).toHaveLength(1)
    }),
  )

  it.effect("executes the unchanged registration advertised for a provider turn", () =>
    Effect.gen(function* () {
      const service = yield* ToolRegistry.Service
      yield* service.register({ echo: make() })
      const materialized = yield* service.materialize()

      expect((yield* materialized.settle(call("echo"))).result).toEqual({ type: "text", value: "echo" })
    }),
  )

  it.effect("rejects a call when its advertised registration was removed", () =>
    Effect.gen(function* () {
      const service = yield* ToolRegistry.Service
      const scope = yield* Scope.make()
      yield* service.register({ echo: make() }).pipe(Scope.provide(scope))
      const materialized = yield* service.materialize()
      yield* Scope.close(scope, Exit.void)

      expect((yield* materialized.settle(call("echo"))).result).toEqual({
        type: "error",
        value: "Stale tool call: echo",
      })
    }),
  )

  it.effect("rejects only the replaced name from a multi-tool provider turn", () =>
    Effect.gen(function* () {
      const service = yield* ToolRegistry.Service
      yield* service.register({ first: make(), second: make() })
      const materialized = yield* service.materialize()
      yield* service.register({ first: make() })

      expect((yield* materialized.settle(call("first"))).result).toEqual({
        type: "error",
        value: "Stale tool call: first",
      })
      expect((yield* materialized.settle(call("second"))).result).toEqual({ type: "text", value: "second" })
    }),
  )

  it.effect("treats revealing a previous overlay as stale", () =>
    Effect.gen(function* () {
      const service = yield* ToolRegistry.Service
      yield* service.register({ echo: make() })
      const overlay = yield* Scope.make()
      yield* service.register({ echo: make() }).pipe(Scope.provide(overlay))
      const materialized = yield* service.materialize()
      yield* Scope.close(overlay, Exit.void)

      expect((yield* materialized.settle(call("echo"))).result).toEqual({
        type: "error",
        value: "Stale tool call: echo",
      })
    }),
  )

  it.effect("keeps captured execution running after registration mutation", () =>
    Effect.gen(function* () {
      const service = yield* ToolRegistry.Service
      const started = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      const scope = yield* Scope.make()
      yield* service
        .register({
          echo: Tool.make({
            description: "Echo text",
            input: Schema.Struct({ text: Schema.String }),
            output: Schema.Struct({ text: Schema.String }),
            execute: ({ text }) =>
              Deferred.succeed(started, undefined).pipe(Effect.andThen(Deferred.await(release)), Effect.as({ text })),
            toModelOutput: ({ output }) => [{ type: "text", text: output.text }],
          }),
        })
        .pipe(Scope.provide(scope))
      const materialized = yield* service.materialize()
      const settlement = yield* materialized.settle(call("echo")).pipe(Effect.forkChild)
      yield* Deferred.await(started)
      yield* Scope.close(scope, Exit.void)
      yield* service.register({ echo: make() })
      yield* Deferred.succeed(release, undefined)

      expect(yield* Fiber.join(settlement)).toMatchObject({ result: { type: "text", value: "echo" } })
    }),
  )
})
