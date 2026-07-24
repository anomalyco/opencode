import { describe, expect } from "bun:test"
import { Tool } from "@opencode-ai/core/tool/tool"
import { AgentV2 } from "@opencode-ai/core/agent"
import type { PermissionV2 } from "@opencode-ai/core/permission"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { Image } from "@opencode-ai/core/image"
import { SessionV2 } from "@opencode-ai/core/session"
import { SessionMessage } from "@opencode-ai/core/session/message"
import { ToolOutputStore } from "@opencode-ai/core/tool-output-store"
import { ToolRegistry } from "@opencode-ai/core/tool/registry"
import { executeTool, toolDefinitions } from "./lib/tool"
import { Cause, Deferred, Effect, Exit, Fiber, Layer, Option, Schema, SchemaGetter, SchemaIssue, Scope } from "effect"
import { testEffect } from "./lib/effect"

const bounds: ToolOutputStore.BoundInput[] = []
const retentionFailure = new ToolOutputStore.StorageError({ operation: "write", cause: new Error("disk full") })
const outputStore = Layer.mock(ToolOutputStore.Service, {
  limits: () => Effect.succeed({ maxLines: ToolOutputStore.MAX_LINES, maxBytes: ToolOutputStore.MAX_BYTES }),
  bound: (input) => {
    if (input.callID === "call-retention-failure") return Effect.fail(retentionFailure)
    return Effect.sync(() => bounds.push(input)).pipe(
      Effect.as(
        input.callID === "call-bounded"
          ? {
              content: [{ type: "text" as const, text: "bounded reference" }],
              outputPaths: ["/managed/generic"],
            }
          : { content: input.content, outputPaths: [] },
      ),
    )
  },
})
const imageStore = Layer.mock(Image.Service, {
  normalize: (resource, content) => {
    if (resource === "corrupt.png") return Effect.fail(new Image.DecodeError({ resource }))
    if (resource === "too-large.png")
      return Effect.fail(
        new Image.SizeError({
          resource,
          width: 9_000,
          height: 9_000,
          bytes: content.content.length,
          maxWidth: 2_000,
          maxHeight: 2_000,
          maxBytes: 5,
        }),
      )
    return Effect.succeed({ ...content, content: "bm9ybWFsaXplZA==", mime: "image/jpeg" })
  },
})
const registryLayer = AppNodeBuilder.build(ToolRegistry.node, [
  [ToolOutputStore.node, outputStore],
  [Image.node, imageStore],
])
const it = testEffect(registryLayer)
const identity = {
  agent: AgentV2.ID.make("build"),
  messageID: SessionMessage.ID.make("msg_registry"),
}
const sessionID = SessionV2.ID.make("ses_registry")
const call = (name: string, id = `call-${name}`): ToolRegistry.ExecuteInput => ({
  sessionID,
  ...identity,
  call: { type: "tool-call", id, name, input: { text: name } },
})

const make = () =>
  Tool.make({
    description: "Echo text",
    input: Schema.Struct({ text: Schema.String }),
    output: Schema.Struct({ text: Schema.String }),
    execute: ({ text }) => Effect.succeed({ output: { text }, content: text }),
  })

const constant = (text: string) =>
  Tool.make({
    description: "Return text",
    input: Schema.Struct({ text: Schema.String }),
    output: Schema.Struct({ text: Schema.String }),
    execute: () => Effect.succeed({ output: { text }, content: text }),
  })

describe("ToolRegistry", () => {
  it.effect("rejects invalid dotted namespaces", () =>
    Effect.gen(function* () {
      const service = yield* ToolRegistry.Service
      const error = yield* service.register({ echo: make() }, { namespace: "slack..admin" }).pipe(Effect.flip)

      expect(error).toBeInstanceOf(Tool.RegistrationError)
      expect(error.message).toBe('Invalid tool namespace: "slack..admin"')
      expect((yield* service.snapshot()).definitions).toEqual([])
    }),
  )

  it.effect("rejects invalid and colliding normalized names", () =>
    Effect.gen(function* () {
      const service = yield* ToolRegistry.Service
      const invalid = yield* service.register({ "123": make() }, { codemode: false }).pipe(Effect.flip)
      expect(invalid.message).toBe("Invalid tool name: 123")

      const collision = yield* service
        .register({ "echo.tool": make(), echo_tool: make() }, { codemode: false })
        .pipe(Effect.flip)
      expect(collision.message).toBe("Duplicate normalized tool name: echo_tool")
      expect((yield* service.snapshot()).definitions).toEqual([])
    }),
  )

  it.effect("validates a registration batch before installing any tools", () =>
    Effect.gen(function* () {
      const service = yield* ToolRegistry.Service
      const error = yield* service
        .registerBatch([
          { tools: { first: make() }, options: { codemode: false } },
          { tools: { second: make() }, options: { namespace: "invalid..namespace", codemode: false } },
        ])
        .pipe(Effect.flip)

      expect(error).toBeInstanceOf(Tool.RegistrationError)
      expect((yield* service.snapshot()).definitions).toEqual([])
    }),
  )

  it.effect("canonicalizes effective definitions and keeps Code Mode last", () =>
    Effect.gen(function* () {
      const service = yield* ToolRegistry.Service
      const tool = make()
      const capture = (registrations: Parameters<typeof service.registerBatch>[0]) =>
        Effect.scoped(
          Effect.gen(function* () {
            yield* service.registerBatch(registrations)
            return (yield* service.snapshot()).definitions
          }),
        )
      const first = yield* capture([
        { tools: { zeta: tool, alpha: tool }, options: { codemode: false } },
        { tools: { beta: tool }, options: { namespace: "alpha", codemode: false } },
        { tools: { echo: tool } },
      ])
      const second = yield* capture([
        { tools: { echo: tool } },
        { tools: { beta: tool }, options: { namespace: "alpha", codemode: false } },
        { tools: { alpha: tool, zeta: tool }, options: { codemode: false } },
      ])

      expect(first).toEqual(second)
      expect(first.map((definition) => definition.name)).toEqual(["alpha", "alpha_beta", "zeta", "execute"])
    }),
  )

  it.effect("filters disabled tools with edit aliases and ordered wildcard precedence", () =>
    Effect.gen(function* () {
      const service = yield* ToolRegistry.Service
      yield* service.register({ question: make(), bash: make() }, { codemode: false })
      yield* service.register({ edit: make(), write: make() }, { codemode: false, permission: "edit" })
      const names = (permissions: PermissionV2.Ruleset) =>
        toolDefinitions(service, permissions).pipe(Effect.map((definitions) => definitions.map((tool) => tool.name)))

      expect(yield* names([{ action: "question", resource: "*", effect: "deny" }])).toEqual(["bash", "edit", "write"])
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
      expect(yield* names([{ action: "edit", resource: "*", effect: "deny" }])).toEqual(["bash", "question"])
    }),
  )

  it.effect("keeps permission options isolated between registrations", () =>
    Effect.gen(function* () {
      const service = yield* ToolRegistry.Service
      const shared = make()
      yield* service.register({ first: shared }, { codemode: false })
      yield* service.register({ second: shared }, { codemode: false, permission: "edit" })

      expect(
        (yield* toolDefinitions(service, [{ action: "edit", resource: "*", effect: "deny" }])).map((tool) => tool.name),
      ).toEqual(["first"])
    }),
  )

  it.effect("removes a scoped registration", () =>
    Effect.gen(function* () {
      const service = yield* ToolRegistry.Service
      const scope = yield* Scope.make()
      yield* service.register({ echo: make() }, { codemode: false }).pipe(Scope.provide(scope))
      expect((yield* toolDefinitions(service)).map((tool) => tool.name)).toEqual(["echo"])
      yield* Scope.close(scope, Exit.void)
      expect(yield* toolDefinitions(service)).toEqual([])
    }),
  )

  it.effect("preserves an interrupted registration until its scope closes", () =>
    Effect.gen(function* () {
      const service = yield* ToolRegistry.Service
      const scope = yield* Scope.make()
      const registered = yield* Deferred.make<void>()
      const fiber = yield* service
        .register({ echo: make() }, { codemode: false })
        .pipe(
          Effect.andThen(Deferred.succeed(registered, undefined)),
          Effect.andThen(Effect.never),
          Scope.provide(scope),
          Effect.forkChild,
        )
      yield* Deferred.await(registered)
      yield* Fiber.interrupt(fiber)

      expect((yield* toolDefinitions(service)).map((tool) => tool.name)).toEqual(["echo"])
      yield* Scope.close(scope, Exit.void)
      expect(yield* toolDefinitions(service)).toEqual([])
    }),
  )

  it.effect("returns model errors without swallowing interruption or defects", () =>
    Effect.gen(function* () {
      const service = yield* ToolRegistry.Service
      yield* service.register(
        {
          failed: Tool.make({
            description: "Failed",
            input: Schema.Struct({}),
            output: Schema.Struct({ ok: Schema.Boolean }),
            execute: () => Effect.fail(new Tool.Failure({ message: "Denied" })),
          }),
        },
        { codemode: false },
      )
      expect(
        yield* executeTool(service, {
          sessionID,
          ...identity,
          call: { type: "tool-call", id: "failed", name: "failed", input: {} },
        }),
      ).toEqual({ status: "error", error: { type: "tool.execution", message: "Denied" } })
      expect(
        yield* executeTool(service, {
          sessionID,
          ...identity,
          call: { type: "tool-call", id: "missing", name: "missing", input: {} },
        }),
      ).toEqual({ status: "error", error: { type: "tool.unknown", message: "Unknown tool: missing" } })

      yield* service.register(
        {
          defect: Tool.make({
            description: "Defect",
            input: Schema.Struct({}),
            output: Schema.Struct({}),
            execute: () => Effect.die("unexpected executor defect"),
          }),
        },
        { codemode: false },
      )
      expect(
        yield* service.snapshot().pipe(
          Effect.flatMap((toolSet) =>
            toolSet.execute({
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

  it.effect("propagates retention failures through execution", () =>
    Effect.gen(function* () {
      const service = yield* ToolRegistry.Service
      yield* service.register({ echo: make() }, { codemode: false })
      const toolSet = yield* service.snapshot()
      const exit = yield* toolSet.execute(call("echo", "call-retention-failure")).pipe(Effect.exit)

      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) expect(Option.getOrUndefined(Cause.findErrorOption(exit.cause))).toBe(retentionFailure)
      expect(retentionFailure.message).toBe("Failed to write tool output: disk full")
    }),
  )

  it.effect("exposes execution only through a snapshot", () =>
    Effect.gen(function* () {
      const service = yield* ToolRegistry.Service
      expect("definitions" in service).toBe(false)
      expect("execute" in service).toBe(false)
      expect("settle" in service).toBe(false)
      expect(typeof service.snapshot).toBe("function")
    }),
  )

  it.effect("passes complete call identity to tool execution", () =>
    Effect.gen(function* () {
      const service = yield* ToolRegistry.Service
      const contexts: Tool.Context[] = []
      yield* service.register(
        {
          context: Tool.make({
            description: "Context",
            input: Schema.Struct({}),
            output: Schema.Struct({ ok: Schema.Boolean }),
            execute: (_, context) =>
              Effect.sync(() => contexts.push(context)).pipe(Effect.as({ output: { ok: true } })),
          }),
        },
        { codemode: false },
      )
      yield* executeTool(service, {
        sessionID,
        ...identity,
        call: { type: "tool-call", id: "call-context", name: "context", input: {} },
      })
      expect(contexts).toEqual([{ sessionID, ...identity, callID: "call-context", progress: expect.any(Function) }])
    }),
  )

  it.effect("encodes output and applies generic execution bounding", () =>
    Effect.gen(function* () {
      bounds.length = 0
      const service = yield* ToolRegistry.Service
      yield* service.register({ bounded: make() }, { codemode: false })
      expect(
        yield* executeTool(service, {
          sessionID,
          ...identity,
          call: { type: "tool-call", id: "call-bounded", name: "bounded", input: { text: "complete" } },
        }),
      ).toEqual({
        status: "completed",
        output: { text: "complete" },
        content: [{ type: "text", text: "bounded reference" }],
        outputPaths: ["/managed/generic"],
      })
      expect(bounds).toHaveLength(1)
    }),
  )

  it.effect("normalizes image tool output at execution and drops unresizable images", () =>
    Effect.gen(function* () {
      const service = yield* ToolRegistry.Service
      yield* service.register(
        {
          snapshot: Tool.make({
            description: "Return images",
            input: Schema.Struct({ text: Schema.String }),
            output: Schema.Struct({ text: Schema.String }),
            execute: ({ text }) =>
              Effect.succeed({
                output: { text },
                content: [
                  { type: "file", data: "aW1hZ2U=", mime: "image/png", name: "frame.png" },
                  { type: "file", data: "aW1hZ2U=", mime: "image/png", name: "too-large.png" },
                  { type: "file", data: "aW1hZ2U=", mime: "image/png", name: "corrupt.png" },
                  { type: "text", text },
                ],
              }),
          }),
        },
        { codemode: false },
      )

      const execution = yield* executeTool(service, call("snapshot"))
      expect(execution.content).toEqual([
        { type: "file", uri: "data:image/jpeg;base64,bm9ybWFsaXplZA==", mime: "image/jpeg", name: "frame.png" },
        { type: "text", text: "snapshot" },
        { type: "text", text: "[1 image omitted: could not be decoded.]" },
        { type: "text", text: "[1 image omitted: could not be resized below the image size limit.]" },
      ])
    }),
  )

  it.effect("publishes progress metadata unchanged", () =>
    Effect.gen(function* () {
      const service = yield* ToolRegistry.Service
      yield* service.register(
        {
          progressive: Tool.make({
            description: "Emit image progress",
            input: Schema.Struct({ text: Schema.String }),
            output: Schema.Struct({ text: Schema.String }),
            execute: ({ text }, context) =>
              context.progress({ stage: "capture" }).pipe(Effect.as({ output: { text } })),
          }),
        },
        { codemode: false },
      )

      const updates: ToolRegistry.Progress[] = []
      yield* executeTool(service, {
        ...call("progressive"),
        progress: (update) =>
          Effect.sync(() => {
            updates.push(update)
          }),
      })
      expect(updates).toEqual([{ stage: "capture" }])
    }),
  )

  it.effect("enforces transformed codecs at execution and projection boundaries", () =>
    Effect.gen(function* () {
      const service = yield* ToolRegistry.Service
      const executed: string[] = []
      const Transformed = Schema.Boolean.pipe(
        Schema.decodeTo(Schema.String, {
          decode: SchemaGetter.transform((value) => (value ? "yes" : "no")),
          encode: SchemaGetter.transform((value) => value === "yes"),
        }),
      )
      yield* service.register(
        {
          transformed: Tool.make({
            description: "Transform values",
            input: Schema.Struct({ value: Transformed }),
            output: Schema.Struct({ value: Transformed }),
            execute: ({ value }) =>
              Effect.sync(() => executed.push(value)).pipe(Effect.as({ output: { value }, content: String(value) })),
          }),
        },
        { codemode: false },
      )

      // Canonical content observes the decoded domain value; Code Mode observes the encoded value.
      expect(
        yield* executeTool(service, {
          sessionID,
          ...identity,
          call: { type: "tool-call", id: "transformed", name: "transformed", input: { value: true } },
        }),
      ).toEqual({
        status: "completed",
        output: { value: true },
        content: [{ type: "text", text: "yes" }],
      })
      expect(executed).toEqual(["yes"])
      expect(
        yield* executeTool(service, {
          sessionID,
          ...identity,
          call: { type: "tool-call", id: "invalid-input", name: "transformed", input: { value: "yes" } },
        }),
      ).toMatchObject({
        status: "error",
        error: { type: "tool.execution", message: expect.stringContaining("Invalid tool input") },
      })
      expect(executed).toEqual(["yes"])

      yield* service.register(
        {
          invalid_output: Tool.make({
            description: "Return invalid output",
            input: Schema.Struct({}),
            output: Schema.Struct({
              value: Schema.Boolean.pipe(
                Schema.decodeTo(Schema.String, {
                  decode: SchemaGetter.transform((value) => String(value)),
                  encode: SchemaGetter.transformOrFail((value) =>
                    value === "valid"
                      ? Effect.succeed(true)
                      : Effect.fail(new SchemaIssue.InvalidValue(Option.some(value), { message: "invalid output" })),
                  ),
                }),
              ),
            }),
            execute: () => Effect.succeed({ output: { value: "invalid" } }),
          }),
        },
        { codemode: false },
      )
      expect(
        yield* executeTool(service, {
          sessionID,
          ...identity,
          call: { type: "tool-call", id: "invalid-output", name: "invalid_output", input: {} },
        }),
      ).toMatchObject({
        status: "error",
        error: { type: "tool.execution", message: expect.stringContaining("invalid value for its output schema") },
      })
    }),
  )

  it.effect("executes the tool advertised in a model request", () =>
    Effect.gen(function* () {
      const service = yield* ToolRegistry.Service
      const scope = yield* Scope.make()
      yield* service.register({ echo: constant("advertised") }, { codemode: false }).pipe(Scope.provide(scope))
      const request = yield* service.snapshot()
      yield* Scope.close(scope, Exit.void)
      yield* service.register({ echo: constant("replacement") }, { codemode: false })

      expect((yield* request.execute(call("echo"))).content).toEqual([{ type: "text", text: "advertised" }])
      expect((yield* executeTool(service, call("echo"))).content).toEqual([{ type: "text", text: "replacement" }])
    }),
  )

  it.effect("reveals the previous registration after an overlay closes", () =>
    Effect.gen(function* () {
      const service = yield* ToolRegistry.Service
      yield* service.register({ echo: constant("base") }, { codemode: false })
      const overlay = yield* Scope.make()
      yield* service.register({ echo: constant("overlay") }, { codemode: false }).pipe(Scope.provide(overlay))

      expect((yield* executeTool(service, call("echo"))).content).toEqual([{ type: "text", text: "overlay" }])
      yield* Scope.close(overlay, Exit.void)
      expect((yield* executeTool(service, call("echo"))).content).toEqual([{ type: "text", text: "base" }])
    }),
  )

  it.effect("executes codemode tools advertised in a model request", () =>
    Effect.gen(function* () {
      const service = yield* ToolRegistry.Service
      const executed: string[] = []
      const scope = yield* Scope.make()
      yield* service
        .register({
          echo: Tool.make({
            description: "Echo text",
            input: Schema.Struct({ text: Schema.String }),
            output: Schema.Struct({ text: Schema.String }),
            execute: ({ text }) =>
              Effect.sync(() => executed.push(`old:${text}`)).pipe(Effect.as({ output: { text } })),
          }),
        })
        .pipe(Scope.provide(scope))
      const toolSet = yield* service.snapshot()
      const execute = toolSet.definitions.find((tool) => tool.name === "execute")
      expect(toolSet.codeModeInstructions).toContain("tools.echo")
      expect(execute?.description).toContain("confined Code Mode runtime")
      expect(execute?.description).not.toContain("Echo text")
      yield* Scope.close(scope, Exit.void)
      yield* service.register({
        echo: Tool.make({
          description: "Echo text",
          input: Schema.Struct({ text: Schema.String }),
          output: Schema.Struct({ text: Schema.String }),
          execute: ({ text }) => Effect.sync(() => executed.push(`new:${text}`)).pipe(Effect.as({ output: { text } })),
        }),
      })

      const execution = yield* toolSet.execute({
        ...call("execute"),
        call: {
          type: "tool-call",
          id: "call-execute",
          name: "execute",
          input: { code: 'return await tools.echo({ text: "request" })' },
        },
      })

      expect(execution).toMatchObject({ status: "completed", content: [{ type: "text" }] })
      expect(executed).toEqual(["old:request"])
    }),
  )
})
