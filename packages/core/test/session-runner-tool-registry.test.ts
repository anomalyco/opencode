import { describe, expect } from "bun:test"
import { Agent } from "@opencode-ai/core/agent"
import type { Permission } from "@opencode-ai/core/permission"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { Image } from "@opencode-ai/core/image"
import { Session } from "@opencode-ai/core/session"
import { SessionMessage } from "@opencode-ai/core/session/message"
import { Tool } from "@opencode-ai/core/tool"
import type { Info } from "@opencode-ai/schema/tool"
import { executeTool, toolDefinitions } from "./lib/tool"
import { Cause, Deferred, Effect, Exit, Fiber, Layer, Option, Schema, SchemaGetter, SchemaIssue, Scope } from "effect"
import { testEffect } from "./lib/effect"

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
const registryLayer = AppNodeBuilder.build(Tool.node, [[Image.node, imageStore]])
const it = testEffect(registryLayer)
const identity = {
  agent: Agent.ID.make("build"),
  messageID: SessionMessage.ID.make("msg_registry"),
}
const sessionID = Session.ID.make("ses_registry")
const call = (name: string, id = `call-${name}`): Parameters<Tool.Snapshot["execute"]>[0] => ({
  sessionID,
  ...identity,
  call: { type: "tool-call", id, name, input: { text: name } },
})

const make = (): Info =>
  ({
    name: "echo",
    description: "Echo text",
    input: Schema.Struct({ text: Schema.String }),
    output: Schema.Struct({ text: Schema.String }),
    execute: ({ text }) => Effect.succeed({ output: { text }, content: text }),
  })

const constant = (text: string): Info =>
  ({
    name: "constant",
    description: "Return text",
    input: Schema.Struct({ text: Schema.String }),
    output: Schema.Struct({ text: Schema.String }),
    execute: () => Effect.succeed({ output: { text }, content: text }),
  })

const transform = (
  service: Tool.Interface,
  tools: Readonly<Record<string, Info>>,
  options?: Tool.Options,
) =>
  service.transform((draft) =>
    Object.entries(tools).forEach(([name, tool]) =>
      draft.add({ ...tool, name, options: { ...tool.options, ...options } }),
    ),
  )

describe("Tool", () => {
  it.effect("rejects invalid dotted namespaces", () =>
    Effect.gen(function* () {
      const service = yield* Tool.Service
      const error = yield* transform(service, { echo: make() }, { namespace: "slack..admin" }).pipe(Effect.flip)

      expect(error).toBeInstanceOf(Tool.RegistrationError)
      expect(error.message).toBe('Invalid tool namespace: "slack..admin"')
      expect((yield* service.snapshot()).definitions.map((tool) => tool.name)).toEqual(["execute"])
    }),
  )

  it.effect("rejects invalid and colliding normalized names", () =>
    Effect.gen(function* () {
      const service = yield* Tool.Service
      const invalid = yield* transform(service, { "123": make() }, { codemode: false }).pipe(Effect.flip)
      expect(invalid.message).toBe("Invalid tool name: 123")

      const collision = yield* transform(service, { "echo.tool": make(), echo_tool: make() }, { codemode: false })
        .pipe(Effect.flip)
      expect(collision.message).toBe("Duplicate normalized tool name: echo_tool")
      expect((yield* service.snapshot()).definitions.map((tool) => tool.name)).toEqual(["execute"])
    }),
  )

  it.effect("validates a registration batch before installing any tools", () =>
    Effect.gen(function* () {
      const service = yield* Tool.Service
      const error = yield* service
        .transform((draft) => {
          draft.add({ ...make(), name: "first", options: { codemode: false } })
          draft.add({ ...make(), name: "second", options: { namespace: "invalid..namespace", codemode: false } })
        })
        .pipe(Effect.flip)

      expect(error).toBeInstanceOf(Tool.RegistrationError)
      expect((yield* service.snapshot()).definitions.map((tool) => tool.name)).toEqual(["execute"])
    }),
  )

  it.effect("canonicalizes effective definitions and keeps Code Mode last", () =>
    Effect.gen(function* () {
      const service = yield* Tool.Service
      const tool = make()
      const capture = (tools: ReadonlyArray<Info>) =>
        Effect.scoped(
          Effect.gen(function* () {
            yield* service.transform((draft) => tools.forEach(draft.add))
            return (yield* service.snapshot()).definitions
          }),
        )
      const first = yield* capture([
        { ...tool, name: "zeta", options: { codemode: false } },
        { ...tool, name: "alpha", options: { codemode: false } },
        { ...tool, name: "beta", options: { namespace: "alpha", codemode: false } },
        { ...tool, name: "echo" },
      ])
      const second = yield* capture([
        { ...tool, name: "echo" },
        { ...tool, name: "beta", options: { namespace: "alpha", codemode: false } },
        { ...tool, name: "alpha", options: { codemode: false } },
        { ...tool, name: "zeta", options: { codemode: false } },
      ])

      expect(first).toEqual(second)
      expect(first.map((definition) => definition.name)).toEqual(["alpha", "alpha_beta", "zeta", "execute"])
    }),
  )

  it.effect("snapshots external tools with missing input schemas", () =>
    Effect.gen(function* () {
      const service = yield* Tool.Service
      yield* service.transform((draft) =>
        draft.add({
          ...make(),
          input: undefined,
        } as unknown as Info),
      )

      const snapshot = yield* service.snapshot()
      expect(snapshot.definitions.map((tool) => tool.name)).toEqual(["execute"])
      expect(snapshot.codeModeCatalog?.[0]?.signature).toContain("tools.echo")
    }),
  )

  it.effect("keeps execute available without Code Mode tools unless explicitly denied", () =>
    Effect.gen(function* () {
      const service = yield* Tool.Service

      const available = yield* service.snapshot()
      expect(available.definitions.map((tool) => tool.name)).toEqual(["execute"])
      expect(available.codeModeCatalog).toEqual([])

      const denied = yield* service.snapshot([{ action: "execute", resource: "*", effect: "deny" }])
      expect(denied.definitions).toEqual([])
      expect(denied.codeModeCatalog).toBeUndefined()
    }),
  )

  it.effect("filters disabled tools with edit aliases and ordered wildcard precedence", () =>
    Effect.gen(function* () {
      const service = yield* Tool.Service
      yield* transform(service, { question: make(), bash: make() }, { codemode: false })
      yield* transform(service, { edit: make(), write: make() }, { codemode: false, permission: "edit" })
      const names = (permissions: Permission.Ruleset) =>
        toolDefinitions(service, permissions).pipe(Effect.map((definitions) => definitions.map((tool) => tool.name)))

      expect(yield* names([{ action: "question", resource: "*", effect: "deny" }])).toEqual([
        "bash",
        "edit",
        "write",
        "execute",
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
      expect(yield* names([{ action: "edit", resource: "*", effect: "deny" }])).toEqual([
        "bash",
        "question",
        "execute",
      ])
    }),
  )

  it.effect("keeps permission options isolated between registrations", () =>
    Effect.gen(function* () {
      const service = yield* Tool.Service
      const shared = make()
      yield* transform(service, { first: shared }, { codemode: false })
      yield* transform(service, { second: shared }, { codemode: false, permission: "edit" })

      expect(
        (yield* toolDefinitions(service, [{ action: "edit", resource: "*", effect: "deny" }])).map((tool) => tool.name),
      ).toEqual(["first", "execute"])
    }),
  )

  it.effect("removes a scoped registration", () =>
    Effect.gen(function* () {
      const service = yield* Tool.Service
      const scope = yield* Scope.make()
      yield* transform(service, { echo: make() }, { codemode: false }).pipe(Scope.provide(scope))
      expect((yield* toolDefinitions(service)).map((tool) => tool.name)).toEqual(["echo", "execute"])
      yield* Scope.close(scope, Exit.void)
      expect((yield* toolDefinitions(service)).map((tool) => tool.name)).toEqual(["execute"])
    }),
  )

  it.effect("preserves an interrupted registration until its scope closes", () =>
    Effect.gen(function* () {
      const service = yield* Tool.Service
      const scope = yield* Scope.make()
      const registered = yield* Deferred.make<void>()
      const fiber = yield* transform(service, { echo: make() }, { codemode: false })
        .pipe(
          Effect.andThen(Deferred.succeed(registered, undefined)),
          Effect.andThen(Effect.never),
          Scope.provide(scope),
          Effect.forkChild,
        )
      yield* Deferred.await(registered)
      yield* Fiber.interrupt(fiber)

      expect((yield* toolDefinitions(service)).map((tool) => tool.name)).toEqual(["echo", "execute"])
      yield* Scope.close(scope, Exit.void)
      expect((yield* toolDefinitions(service)).map((tool) => tool.name)).toEqual(["execute"])
    }),
  )

  it.effect("returns model errors without swallowing interruption or defects", () =>
    Effect.gen(function* () {
      const service = yield* Tool.Service
      yield* transform(service,
        {
          failed: ({
            name: "failed",
            description: "Failed",
            input: Schema.Struct({}),
            output: Schema.Struct({ ok: Schema.Boolean }),
            execute: () => Effect.fail(new Tool.Error({ message: "Denied" })),
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
      ).toEqual({ status: "error", error: { type: "tool.execution", message: "Unknown tool: missing" } })

      yield* transform(service,
        {
          defect: ({
            name: "defect",
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

  it.effect("exposes execution only through a snapshot", () =>
    Effect.gen(function* () {
      const service = yield* Tool.Service
      expect("definitions" in service).toBe(false)
      expect("execute" in service).toBe(false)
      expect("settle" in service).toBe(false)
      expect(typeof service.snapshot).toBe("function")
    }),
  )

  it.effect("passes complete call identity to tool execution", () =>
    Effect.gen(function* () {
      const service = yield* Tool.Service
      const contexts: Tool.Context[] = []
      yield* transform(service,
        {
          context: ({
            name: "context",
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
      expect(contexts).toEqual([
        { sessionID, ...identity, callID: Tool.CallID.make("call-context"), progress: expect.any(Function) },
      ])
    }),
  )

  it.effect("normalizes image tool output at execution and drops unresizable images", () =>
    Effect.gen(function* () {
      const service = yield* Tool.Service
      yield* transform(service,
        {
          snapshot: ({
            name: "snapshot",
            description: "Return images",
            input: Schema.Struct({ text: Schema.String }),
            output: Schema.Struct({ text: Schema.String }),
            execute: ({ text }) =>
              Effect.succeed({
                output: { text },
                content: [
                  { type: "file", uri: "data:image/png;base64,aW1hZ2U=", mime: "image/png", name: "frame.png" },
                  {
                    type: "file",
                    uri: "data:image/png;base64,aW1hZ2U=",
                    mime: "image/png",
                    name: "too-large.png",
                  },
                  { type: "file", uri: "data:image/png;base64,aW1hZ2U=", mime: "image/png", name: "corrupt.png" },
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
      const service = yield* Tool.Service
      yield* transform(service,
        {
          progressive: ({
            name: "progressive",
            description: "Emit image progress",
            input: Schema.Struct({ text: Schema.String }),
            output: Schema.Struct({ text: Schema.String }),
            execute: ({ text }, context) =>
              context.progress({ stage: "capture" }).pipe(Effect.as({ output: { text } })),
          }),
        },
        { codemode: false },
      )

      const updates: Tool.Metadata[] = []
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
      const service = yield* Tool.Service
      const executed: string[] = []
      const Transformed = Schema.Boolean.pipe(
        Schema.decodeTo(Schema.String, {
          decode: SchemaGetter.transform((value) => (value ? "yes" : "no")),
          encode: SchemaGetter.transform((value) => value === "yes"),
        }),
      )
      yield* transform(service,
        {
          transformed: ({
            name: "transformed",
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

      yield* transform(service,
        {
          invalid_output: ({
            name: "invalid_output",
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
      const service = yield* Tool.Service
      const scope = yield* Scope.make()
      yield* transform(service, { echo: constant("advertised") }, { codemode: false }).pipe(Scope.provide(scope))
      const request = yield* service.snapshot()
      yield* Scope.close(scope, Exit.void)
      yield* transform(service, { echo: constant("replacement") }, { codemode: false })

      expect((yield* request.execute(call("echo"))).content).toEqual([{ type: "text", text: "advertised" }])
      expect((yield* executeTool(service, call("echo"))).content).toEqual([{ type: "text", text: "replacement" }])
    }),
  )

  it.effect("reveals the previous registration after an overlay closes", () =>
    Effect.gen(function* () {
      const service = yield* Tool.Service
      yield* transform(service, { echo: constant("base") }, { codemode: false })
      const overlay = yield* Scope.make()
      yield* transform(service, { echo: constant("overlay") }, { codemode: false }).pipe(Scope.provide(overlay))

      expect((yield* executeTool(service, call("echo"))).content).toEqual([{ type: "text", text: "overlay" }])
      yield* Scope.close(overlay, Exit.void)
      expect((yield* executeTool(service, call("echo"))).content).toEqual([{ type: "text", text: "base" }])
    }),
  )

  it.effect("executes and reports progress for codemode tools advertised in a model request", () =>
    Effect.gen(function* () {
      const service = yield* Tool.Service
      const executed: string[] = []
      const scope = yield* Scope.make()
      yield* transform(service, {
          echo: ({
            name: "echo",
            description: "Echo text",
            input: Schema.Struct({ text: Schema.String }),
            output: Schema.Struct({ text: Schema.String }),
            execute: ({ text }, context) =>
              Effect.sync(() => executed.push(`old:${text}`)).pipe(
                Effect.andThen(context.progress({ stage: "old" })),
                Effect.as({ output: { text } }),
              ),
          }),
        })
        .pipe(Scope.provide(scope))
      const toolSet = yield* service.snapshot()
      const execute = toolSet.definitions.find((tool) => tool.name === "execute")
      expect(toolSet.codeModeCatalog?.[0]?.signature).toContain("tools.echo")
      expect(execute?.description).toContain("confined Code Mode runtime")
      expect(execute?.description).not.toContain("Echo text")
      yield* Scope.close(scope, Exit.void)
      yield* transform(service, {
        echo: ({
          name: "echo",
          description: "Echo text",
          input: Schema.Struct({ text: Schema.String }),
          output: Schema.Struct({ text: Schema.String }),
          execute: ({ text }) => Effect.sync(() => executed.push(`new:${text}`)).pipe(Effect.as({ output: { text } })),
        }),
      })

      const progress: Tool.Metadata[] = []
      const execution = yield* toolSet.execute({
        ...call("execute"),
        call: {
          type: "tool-call",
          id: "call-execute",
          name: "execute",
          input: { code: 'return await tools.echo({ text: "request" })' },
        },
        progress: (update) => Effect.sync(() => progress.push(update)),
      })

      expect(execution).toMatchObject({ content: [{ type: "text" }] })
      expect(executed).toEqual(["old:request"])
      expect(progress).toEqual([
        { toolCalls: [{ tool: "echo", status: "running", input: { text: "request" } }] },
        { stage: "old" },
        { toolCalls: [{ tool: "echo", status: "completed", input: { text: "request" } }] },
      ])
    }),
  )
})
