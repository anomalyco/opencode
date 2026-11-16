import { describe, expect, test } from "bun:test"
import { Cause, Deferred, Effect, Exit, Fiber, Layer, Schema } from "effect"
import { Bus } from "@opencode/core/bus"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Form } from "@opencode/core/form"
import { Permission } from "@opencode/core/permission"
import { PluginHooks } from "@opencode/core/plugin/hooks"
import { Session } from "@opencode/core/session"
import { Tool } from "@opencode/core/tool"
import { QuestionContinuation } from "@opencode/schema/question-continuation"
import { QuestionTool } from "@opencode/core/tool/plugin/question"
import type { Info } from "@opencode/schema/tool"
import { testEffect } from "./lib/effect"
import { permissionLayer } from "./lib/permission"
import { makeLocationNode } from "@opencode/util/effect/app-node"
import { toolIdentity, executeTool, registerToolPlugin, toolDefinitions, toolNodeReplacements } from "./lib/tool"

const sessionID = Session.ID.make("ses_question_tool_test")
const assertions: Permission.AssertInput[] = []
const asks: Form.CreateInput[] = []
let captured: Form.CreateInput | undefined
let reject = false
let deny = false
let terminal: Form.TerminalState | undefined
const capturedInput = () => captured
const questionInput = {
  questions: [
    {
      question: "Continue?",
      header: "Continue",
      options: [{ label: "Yes", description: "Continue" }],
    },
  ],
}
const permission = permissionLayer({
  assert: (input) =>
    Effect.sync(() => assertions.push(input)).pipe(
      Effect.andThen(
        deny
          ? Effect.fail(
              new Permission.BlockedError({
                rules: [],
                permission: input.action,
                resources: input.resources,
              }),
            )
          : Effect.void,
      ),
    ),
})
const form = Layer.mock(Form.Service, {
  ask: (input: Form.CreateInput) => {
    asks.push(input)
    return Effect.sync(() => {
      captured = input
    }).pipe(
      Effect.andThen(
        Effect.sync(
          (): Form.TerminalState =>
            terminal ?? (reject ? { status: "cancelled" } : { status: "answered", answer: { q0: "Build", q1: ["Dev"] } }),
        ),
      ),
    )
  },
})
const questionToolNode = makeLocationNode({
  name: "test/question-tool-plugin",
  layer: Layer.effectDiscard(registerToolPlugin(QuestionTool.Plugin)),
  deps: [Tool.node, Permission.node, Form.node],
})

const it = testEffect(
  AppNodeBuilder.build(LayerNode.group([Tool.node, PluginHooks.node, questionToolNode]), [
    ...toolNodeReplacements(permission),
    Form.node.replace(form),
  ]),
)
const real = testEffect(
  AppNodeBuilder.build(LayerNode.group([Tool.node, Bus.node, Form.node, questionToolNode]), toolNodeReplacements(permission)),
)
const invocation = (input: unknown = questionInput): Parameters<Tool.Snapshot["execute"]>[0] => ({
  sessionID,
  ...toolIdentity,
  call: { type: "tool-call", id: "call-continuation", name: "question", input },
})

describe("QuestionTool", () => {
  it.effect("authorizes and prepares post-hook input once without asking a Form", () =>
    Effect.gen(function* () {
      assertions.length = 0
      asks.length = 0
      deny = false
      const registry = yield* Tool.Service
      const hooks = yield* PluginHooks.Service
      const calls: string[] = []
      yield* hooks.register("tool", "execute.before", (event) =>
        Effect.sync(() => {
          calls.push(event.id)
          event.tool = "question"
          event.input = questionInput
        }),
      )
      const snapshot = yield* registry.snapshot()
      if (!snapshot.prepareAuthorizedQuestion) throw new Error("Missing authorized preparation")
      const input = { ...invocation({}), call: { ...invocation({}).call, name: "repair-me" } }
      expect(yield* snapshot.prepareAuthorizedQuestion(input)).toEqual({
        prepared: { adapter: "question@1", input: questionInput },
      })
      expect(calls).toEqual([input.call.id])
      expect(assertions).toHaveLength(1)
      expect(assertions[0]).toMatchObject({
        action: "question",
        resources: ["*"],
        sessionID,
        source: { type: "tool", messageID: input.messageID, id: input.call.id },
      })
      expect(asks).toEqual([])
    }),
  )

  it.effect("executes the ordinary Question once when after-hooks prevent parking", () =>
    Effect.gen(function* () {
      assertions.length = 0
      asks.length = 0
      deny = false
      reject = false
      terminal = { status: "answered", answer: { q0: "Yes" } }
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          terminal = undefined
        }),
      )
      const hooks = yield* PluginHooks.Service
      const calls: string[] = []
      yield* hooks.register("tool", "execute.before", (event) =>
        Effect.sync(() => {
          calls.push(event.id)
        }),
      )
      yield* hooks.register("tool", "execute.after", (event) =>
        Effect.sync(() => {
          calls.push(event.id)
        }),
      )
      const registry = yield* Tool.Service
      const snapshot = yield* registry.snapshot()
      if (!snapshot.prepareAuthorizedQuestion) throw new Error("Missing authorized preparation")
      expect(yield* snapshot.prepareAuthorizedQuestion(invocation())).toMatchObject({
        outcome: { output: { answers: [["Yes"]] } },
      })
      expect(calls).toEqual(["call-continuation", "call-continuation"])
      expect(assertions).toHaveLength(1)
      expect(asks).toHaveLength(1)
    }),
  )

  test("re-exports the exact canonical continuation schemas", () => {
    expect(QuestionTool.Input).toBe(QuestionContinuation.Input)
    expect(QuestionTool.Prepared).toBe(QuestionContinuation.Prepared)
    expect(QuestionTool.Prepared.fields.input).toBe(QuestionTool.Input)
  })

  it.effect("round trips prepared input and preserves ordinary answer conversion without running preparation side effects", () =>
    Effect.gen(function* () {
      assertions.length = 0
      captured = undefined
      deny = false
      yield* Effect.addFinalizer(() => Effect.sync(() => (terminal = undefined)))
      const registry = yield* Tool.Service
      const snapshot = yield* registry.snapshot()
      if (!snapshot.prepareQuestion) return yield* Effect.die("Missing Question preparation capability")
      const input = {
        questions: [0, 1, 2, 3, 4].map((index) => ({ ...questionInput.questions[0], question: `Question ${index}` })),
      }
      const prepared = yield* snapshot.prepareQuestion(invocation(input))
      expect(prepared).toEqual({ adapter: "question@1", input })
      expect(Object.keys(prepared).sort()).toEqual(["adapter", "input"])
      expect(assertions).toEqual([])
      expect(capturedInput()).toBeUndefined()
      terminal = { status: "answered", answer: { q3: false, q1: ["B", "A"], q0: "Build", q2: 42 } }
      const envelope = JSON.parse(JSON.stringify(prepared))
      const state = JSON.parse(JSON.stringify(yield* Schema.encodeEffect(Form.State)(terminal)))
      const original = JSON.stringify({ envelope, state })
      const restored = yield* Tool.restoreQuestion(envelope, state)
      expect(restored).toEqual({
        output: { answers: [["Build"], ["B", "A"], ["42"], ["false"], []] },
        content: [
          {
            type: "text",
            text: QuestionTool.toModelContent(input.questions, [["Build"], ["B", "A"], ["42"], ["false"], []]),
          },
        ],
        metadata: { answers: [["Build"], ["B", "A"], ["42"], ["false"], []] },
      })
      expect(restored).toEqual(yield* Tool.restoreQuestion(envelope, state))
      expect(JSON.stringify({ envelope, state })).toBe(original)
      expect(restored.output?.answers[1]).not.toBe(state.answer.q1)
      expect(assertions).toEqual([])
      expect(capturedInput()).toBeUndefined()
      const ordinary = yield* snapshot.execute(invocation(input))
      expect(ordinary).toEqual(restored)
      expect(ordinary.metadata?.answers[1]).not.toBe(terminal.answer.q1)
      expect(assertions).toHaveLength(1)
      expect(capturedInput()).toBeDefined()
    }),
  )

  it.effect("preserves feedback failures and dismissal defects in ordinary and restored finalization", () =>
    Effect.gen(function* () {
      deny = false
      yield* Effect.addFinalizer(() => Effect.sync(() => (terminal = undefined)))
      const registry = yield* Tool.Service
      const snapshot = yield* registry.snapshot()
      if (!snapshot.prepareQuestion) return yield* Effect.die("Missing Question preparation capability")
      const prepared = yield* snapshot.prepareQuestion(invocation())
      yield* Effect.forEach(["No interactive client", "", undefined], (message) =>
        Effect.gen(function* () {
          terminal = message === undefined ? { status: "cancelled" } : { status: "cancelled", message }
          const ordinary = yield* snapshot.execute(invocation()).pipe(Effect.exit)
          const restored = yield* Tool.restoreQuestion(prepared, terminal).pipe(Effect.exit)
          expect(Exit.isFailure(ordinary)).toBe(true)
          expect(Exit.isFailure(restored)).toBe(true)
          if (!Exit.isFailure(ordinary) || !Exit.isFailure(restored)) return
          expect(Cause.hasFails(ordinary.cause)).toBe(message !== undefined)
          expect(Cause.hasDies(ordinary.cause)).toBe(message === undefined)
          expect(Cause.hasFails(restored.cause)).toBe(message !== undefined)
          expect(Cause.hasDies(restored.cause)).toBe(message === undefined)
          expect(Cause.squash(restored.cause)).toEqual(Cause.squash(ordinary.cause))
          if (message !== undefined) {
            expect(Cause.squash(restored.cause)).toBeInstanceOf(Tool.Error)
            expect(Cause.squash(restored.cause)).toHaveProperty("message", message)
            return
          }
          expect(Cause.squash(restored.cause)).toBeInstanceOf(QuestionTool.CancelledError)
        }),
      )
    }),
  )

  it.effect("rejects malformed input, pending states and missing or unknown versions", () =>
    Effect.gen(function* () {
      assertions.length = 0
      asks.length = 0
      const registry = yield* Tool.Service
      const snapshot = yield* registry.snapshot()
      if (!snapshot.prepareQuestion) return yield* Effect.die("Missing Question preparation capability")
      const prepared = yield* snapshot.prepareQuestion(invocation())
      yield* Effect.forEach([null, {}, { questions: [] }, { questions: [{ question: 1 }] }], (input) =>
        Effect.gen(function* () {
          if (!snapshot.prepareQuestion) return yield* Effect.die("Missing Question preparation capability")
          expect(yield* snapshot.prepareQuestion(invocation(input)).pipe(Effect.flip)).toBeInstanceOf(Tool.Error)
          expect(
            yield* Tool.restoreQuestion({ adapter: "question@1", input }, { status: "answered", answer: {} }).pipe(
              Effect.flip,
            ),
          ).toBeInstanceOf(Tool.Error)
        }),
      )
      yield* Effect.forEach(
        [
          null,
          {},
          { input: questionInput },
          { adapter: "question@2", input: questionInput },
          { adapter: "question", input: questionInput },
        ],
        (envelope) =>
          Effect.gen(function* () {
            expect(
              yield* Tool.restoreQuestion(envelope, { status: "answered", answer: {} }).pipe(Effect.flip),
            ).toBeInstanceOf(Tool.Error)
          }),
      )
      yield* Effect.forEach(
        [
          null,
          {},
          { status: "pending" },
          { status: "answered" },
          { status: "answered", answer: { q0: {} } },
          { status: "cancelled", message: 1 },
        ],
        (state) =>
          Effect.gen(function* () {
            expect(yield* Tool.restoreQuestion(prepared, state).pipe(Effect.flip)).toBeInstanceOf(Tool.Error)
          }),
      )
      expect(assertions).toHaveLength(0)
      expect(asks).toHaveLength(0)
    }),
  )

  it.effect("runs the before hook once, resolves its repaired alias and restores without hooks", () =>
    Effect.gen(function* () {
      const registry = yield* Tool.Service
      const hooks = yield* PluginHooks.Service
      const calls: string[] = []
      yield* hooks.register("tool", "execute.before", (event) =>
        Effect.sync(() => {
          calls.push(event.tool)
          event.tool = "ask"
          event.input = questionInput
        }),
      )
      const snapshot = yield* registry.snapshot()
      if (!snapshot.prepareQuestion) return yield* Effect.die("Missing Question preparation capability")
      const definition = snapshot.definitions.find((item) => item.name === "question")
      if (!definition) return yield* Effect.die("Missing Question definition")
      const prepared = yield* snapshot.prepareQuestion({
        ...invocation(null),
        call: { ...invocation(null).call, name: "typo" },
        definitions: new Map([["ask", definition]]),
      })
      expect(prepared).toEqual({ adapter: "question@1", input: questionInput })
      expect(calls).toEqual(["typo"])
      // Late hooks are outside the Gate 1 preparation restriction, and restoration still never runs them.
      yield* hooks.register("tool", "execute.after", () => Effect.die("restoration ran an after hook"))
      yield* Tool.restoreQuestion(prepared, { status: "answered", answer: {} })
      expect(calls).toEqual(["typo"])
    }),
  )

  it.effect("rejects after hooks while preserving ordinary success and failure hooks", () =>
    Effect.gen(function* () {
      assertions.length = 0
      asks.length = 0
      deny = false
      terminal = { status: "answered", answer: { q0: "Yes" } }
      yield* Effect.addFinalizer(() => Effect.sync(() => (terminal = undefined)))
      const registry = yield* Tool.Service
      const hooks = yield* PluginHooks.Service
      const statuses: string[] = []
      const registration = yield* hooks.register("tool", "execute.after", (event) =>
        Effect.sync(() => {
          statuses.push(event.status)
          if (event.status === "completed") event.result = { ...event.result, content: "after hook content" }
        }),
      )
      const snapshot = yield* registry.snapshot()
      if (!snapshot.prepareQuestion) return yield* Effect.die("Missing Question preparation capability")
      expect((yield* snapshot.prepareQuestion(invocation()).pipe(Effect.flip)).message).toContain("execute.after")
      expect(statuses).toEqual([])
      expect(assertions).toHaveLength(0)
      expect(asks).toHaveLength(0)
      expect((yield* snapshot.execute(invocation())).content).toEqual([{ type: "text", text: "after hook content" }])
      terminal = { status: "cancelled", message: "feedback" }
      expect((yield* snapshot.execute(invocation()).pipe(Effect.flip)).message).toBe("feedback")
      expect(statuses).toEqual(["completed", "error"])
      expect(assertions).toHaveLength(2)
      expect(asks).toHaveLength(2)
      yield* registration.dispose
      expect((yield* snapshot.prepareQuestion(invocation())).adapter).toBe("question@1")
      expect(assertions).toHaveLength(2)
      expect(asks).toHaveLength(2)
    }),
  )

  it.effect("requires the original built-in executor, schemas and registration while preserving captured snapshots", () =>
    Effect.gen(function* () {
      assertions.length = 0
      asks.length = 0
      const registry = yield* Tool.Service
      const original = (yield* registry.list()).find((tool) => tool.id === "question")
      if (!original) return yield* Effect.die("Missing built-in Question registration")
      const snapshot = yield* registry.snapshot()
      if (!snapshot.prepareQuestion) return yield* Effect.die("Missing Question preparation capability")
      const prepared = yield* snapshot.prepareQuestion(invocation())
      const executions: string[] = []
      const variants: Info[] = [
        {
          ...original,
          execute: () => {
            executions.push("replacement")
            return Effect.die("replacement executor ran")
          },
        },
        {
          ...original,
          execute: (input, context) => {
            executions.push("wrapper")
            return original.execute(input, context)
          },
        },
        {
          ...original,
          execute: Object.defineProperties(
            (input: typeof QuestionTool.Input.Type, context: Tool.Context) => {
              executions.push("copied wrapper")
              return original.execute(input, context)
            },
            Object.getOwnPropertyDescriptors(original.execute),
          ),
        },
        { ...original, input: QuestionTool.Input.annotate({ description: "Different input identity" }) },
        { ...original, output: QuestionTool.Output.annotate({ description: "Different output identity" }) },
        { ...original, name: "ask" },
        { ...original, options: { namespace: "core", codemode: false } },
        { ...original, options: { codemode: true } },
        { ...original, options: undefined },
      ]
      yield* Effect.forEach(variants, (tool) =>
        Effect.scoped(
          Effect.gen(function* () {
            yield* registry.transform((editor) => {
              editor.remove("question")
              editor.add(tool)
            })
            const current = yield* registry.snapshot()
            if (!current.prepareQuestion) return yield* Effect.die("Missing Question preparation capability")
            const request = { ...invocation(), call: { ...invocation().call, name: (yield* registry.list())[0].id } }
            expect(yield* current.prepareQuestion(request).pipe(Effect.flip)).toBeInstanceOf(Tool.Error)
            const direct = yield* registry.snapshot([{ action: "execute", resource: "*", effect: "deny" }])
            if (!direct.prepareQuestion) return yield* Effect.die("Missing Question preparation capability")
            expect(yield* direct.prepareQuestion(request).pipe(Effect.flip)).toBeInstanceOf(Tool.Error)
            if (!snapshot.prepareQuestion) return yield* Effect.die("Missing Question preparation capability")
            expect(yield* snapshot.prepareQuestion(invocation())).toEqual(prepared)
            expect(executions).toHaveLength(0)
            expect(assertions).toHaveLength(0)
            expect(asks).toHaveLength(0)
          }),
        ),
      )
      yield* registry.transform((editor) => editor.remove("question"))
      expect(yield* snapshot.prepareQuestion(invocation())).toEqual(prepared)
      const current = yield* registry.snapshot()
      if (!current.prepareQuestion) return yield* Effect.die("Missing Question preparation capability")
      expect(yield* current.prepareQuestion(invocation()).pipe(Effect.flip)).toBeInstanceOf(Tool.Error)
      expect((yield* Tool.restoreQuestion(prepared, { status: "answered", answer: {} })).output).toEqual({
        answers: [[]],
      })
      expect(executions).toHaveLength(0)
      expect(assertions).toHaveLength(0)
      expect(asks).toHaveLength(0)
    }),
  )

  it.effect("honors post-hook request availability and catalog filtering", () =>
    Effect.gen(function* () {
      assertions.length = 0
      asks.length = 0
      const registry = yield* Tool.Service
      const snapshot = yield* registry.snapshot()
      if (!snapshot.prepareQuestion) return yield* Effect.die("Missing Question preparation capability")
      const removed = yield* snapshot.prepareQuestion({ ...invocation(), definitions: new Map() }).pipe(Effect.flip)
      expect(removed.message).toBe("Tool is not available for this request: question")
      const denied = yield* registry.snapshot([{ action: "question", resource: "*", effect: "deny" }])
      if (!denied.prepareQuestion) return yield* Effect.die("Missing Question preparation capability")
      expect(yield* denied.prepareQuestion(invocation()).pipe(Effect.flip)).toBeInstanceOf(Tool.Error)
      const hooks = yield* PluginHooks.Service
      const calls: string[] = []
      yield* hooks.register("tool", "execute.before", (event) => {
        calls.push(event.tool)
        return new Tool.Error({ message: "before rejected" })
      })
      expect((yield* snapshot.prepareQuestion(invocation()).pipe(Effect.flip)).message).toBe("before rejected")
      expect(calls).toEqual(["question"])
      expect(assertions).toHaveLength(0)
      expect(asks).toHaveLength(0)
    }),
  )
  ;(["answer", "feedback", "empty feedback", "dismissal"] as const).forEach((outcome) => {
    real.effect(`matches a real Form ${outcome} after its state and envelope cross a JSON boundary`, () =>
      Effect.gen(function* () {
        deny = false
        const registry = yield* Tool.Service
        const forms = yield* Form.Service
        const bus = yield* Bus.Service
        const created = yield* Deferred.make<Form.Info>()
        const unsubscribe = yield* bus.listen((event) =>
          event.type === Form.Event.Created.type
            ? Deferred.succeed(created, (event.data as { readonly form: Form.Info }).form).pipe(Effect.asVoid)
            : Effect.void,
        )
        yield* Effect.addFinalizer(() => unsubscribe)
        const snapshot = yield* registry.snapshot()
        if (!snapshot.prepareQuestion) return yield* Effect.die("Missing Question preparation capability")
        const prepared = yield* snapshot.prepareQuestion(invocation())
        expect(yield* forms.list()).toEqual([])
        const fiber = yield* snapshot.execute(invocation()).pipe(Effect.exit, Effect.forkScoped)
        const form = yield* Deferred.await(created)
        const message = outcome === "feedback" ? "No interactive client" : outcome === "empty feedback" ? "" : undefined
        if (outcome === "answer") yield* forms.reply({ id: form.id, answer: { q0: "Yes" } })
        if (outcome !== "answer") yield* forms.cancel(form.id, message === undefined ? undefined : { message })
        const state = yield* Schema.encodeEffect(Form.State)(yield* forms.state(form.id))
        const restored: Exit.Exit<Tool.NormalizedResult, Tool.Error> = yield* Tool.restoreQuestion(
          JSON.parse(JSON.stringify(prepared)),
          JSON.parse(JSON.stringify(state)),
        ).pipe(Effect.exit)
        const ordinary = yield* Fiber.join(fiber)
        expect(yield* forms.list()).toEqual([])
        if (outcome === "answer") {
          expect(Exit.isSuccess(restored)).toBe(true)
          expect(restored).toEqual(ordinary)
          return
        }
        expect(state).toEqual(message === undefined ? { status: "cancelled" } : { status: "cancelled", message })
        expect(Exit.isFailure(ordinary)).toBe(true)
        expect(Exit.isFailure(restored)).toBe(true)
        if (!Exit.isFailure(ordinary) || !Exit.isFailure(restored)) return
        expect(Cause.hasFails(ordinary.cause)).toBe(message !== undefined)
        expect(Cause.hasDies(ordinary.cause)).toBe(message === undefined)
        expect(Cause.hasFails(restored.cause)).toBe(message !== undefined)
        expect(Cause.hasDies(restored.cause)).toBe(message === undefined)
        expect(Cause.squash(restored.cause)).toEqual(Cause.squash(ordinary.cause))
        if (message !== undefined) {
          expect(Cause.squash(restored.cause)).toBeInstanceOf(Tool.Error)
          expect(Cause.squash(restored.cause)).toHaveProperty("message", message)
          return
        }
        expect(Cause.squash(restored.cause)).toBeInstanceOf(QuestionTool.CancelledError)
      }),
    )
  })

  it.effect("emits one item schema for the nonempty questions array", () =>
    Effect.gen(function* () {
      captured = undefined
      const registry = yield* Tool.Service
      const definition = (yield* toolDefinitions(registry)).find((tool) => tool.name === QuestionTool.name)

      expect(definition?.inputSchema).toHaveProperty("properties.questions.type", "array")
      expect(definition?.inputSchema).toHaveProperty("properties.questions.minItems", 1)
      expect(definition?.inputSchema).toHaveProperty("properties.questions.items")
      expect(definition?.inputSchema).not.toHaveProperty("properties.questions.prefixItems")
      expect(
        yield* executeTool(registry, {
          sessionID,
          ...toolIdentity,
          call: { type: "tool-call", id: "call-question-empty", name: QuestionTool.name, input: { questions: [] } },
        }),
      ).toMatchObject({
        status: "error",
        error: {
          type: "tool.execution",
          message:
            'Invalid arguments for tool "question":\n- questions: Expected a value with a length of at least 1\n\nArguments provided:\n{\n  "questions": []\n}\n\nUpdate the arguments and call the tool again.',
        },
      })
      expect(capturedInput()).toBeUndefined()
    }),
  )

  it.effect("omits a catalog-denied question and enforces its leaf permission", () =>
    Effect.gen(function* () {
      captured = undefined
      deny = true
      yield* Effect.addFinalizer(() => Effect.sync(() => (deny = false)))
      const registry = yield* Tool.Service

      expect(
        (yield* toolDefinitions(registry, [{ action: "question", resource: "*", effect: "deny" }])).map(
          (tool) => tool.name,
        ),
      ).toEqual(["execute"])
      expect(
        yield* executeTool(registry, {
          sessionID,
          ...toolIdentity,
          call: { type: "tool-call", id: "call-question-denied", name: "question", input: questionInput },
        }),
      ).toEqual({
        status: "error",
        error: {
          type: "permission.rejected",
          message: "Permission denied: question",
        },
      })
      expect(capturedInput()).toBeUndefined()
    }),
  )

  it.effect("registers question and projects user answers without a permission assertion", () =>
    Effect.gen(function* () {
      assertions.length = 0
      captured = undefined
      reject = false
      deny = false
      const registry = yield* Tool.Service
      const questions = [
        {
          question: "What should happen?",
          header: "Action",
          options: [{ label: "Build", description: "Build it" }],
        },
        {
          question: "Which environment?",
          header: "Environment",
          options: [{ label: "Dev", description: "Development" }],
          multiple: true,
        },
        {
          question: "Anything else?",
          header: "Optional",
          options: [],
        },
      ]

      expect((yield* toolDefinitions(registry)).map((definition) => definition.name)).toEqual(["question", "execute"])
      expect(
        yield* executeTool(registry, {
          sessionID,
          ...toolIdentity,
          call: { type: "tool-call", id: "call-question", name: "question", input: { questions } },
        }),
      ).toEqual({
        status: "completed",
        output: { answers: [["Build"], ["Dev"], []] },
        content: [
          {
            type: "text",
            text: 'User has answered your questions: "What should happen?"="Build", "Which environment?"="Dev", "Anything else?"="Unanswered". You can now continue with the user\'s answers in mind.',
          },
        ],
        metadata: { answers: [["Build"], ["Dev"], []] },
      })
      expect(assertions).toMatchObject([{ sessionID, action: "question", resources: ["*"] }])
      expect(capturedInput()).toEqual({
        sessionID,
        title: "Questions",
        metadata: { kind: "question", tool: { messageID: toolIdentity.messageID, id: "call-question" } },
        fields: [
          {
            key: "q0",
            title: "Action",
            description: "What should happen?",
            options: [{ value: "Build", label: "Build", description: "Build it" }],
            custom: true,
            type: "string",
          },
          {
            key: "q1",
            title: "Environment",
            description: "Which environment?",
            options: [{ value: "Dev", label: "Dev", description: "Development" }],
            custom: true,
            type: "multiselect",
          },
          {
            key: "q2",
            title: "Optional",
            description: "Anything else?",
            options: [],
            custom: true,
            type: "string",
          },
        ],
      })
    }),
  )

  it.effect("does not invent tool ownership metadata without a durable registry source", () =>
    Effect.gen(function* () {
      captured = undefined
      reject = false
      deny = false
      const registryService = yield* Tool.Service

      yield* executeTool(registryService, {
        sessionID,
        ...toolIdentity,
        call: { type: "tool-call", id: "call-question", name: "question", input: questionInput },
      })
      expect(capturedInput()).toEqual({
        sessionID,
        title: "Questions",
        metadata: { kind: "question", tool: { messageID: toolIdentity.messageID, id: "call-question" } },
        fields: [
          {
            key: "q0",
            title: "Continue",
            description: "Continue?",
            options: [{ value: "Yes", label: "Yes", description: "Continue" }],
            custom: true,
            type: "string",
          },
        ],
      })
    }),
  )

  it.effect("keeps dismissed questions out of model-facing output", () =>
    Effect.gen(function* () {
      captured = undefined
      reject = true
      deny = false
      const registryService = yield* Tool.Service
      const fiber = yield* executeTool(registryService, {
        sessionID,
        ...toolIdentity,
        call: { type: "tool-call", id: "call-question", name: "question", input: questionInput },
      }).pipe(Effect.forkScoped)

      const exit = yield* Fiber.await(fiber)
      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        const error = Cause.squash(exit.cause)
        expect(error).toBeInstanceOf(QuestionTool.CancelledError)
        expect(error).toHaveProperty("message", "The user dismissed this question")
      }
    }),
  )
})
