import { describe, expect } from "bun:test"
import { Cause, Effect, Exit, Fiber, Layer } from "effect"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/util/effect/layer-node"
import { Form } from "@opencode-ai/core/form"
import { Permission } from "@opencode-ai/core/permission"
import { Session } from "@opencode-ai/core/session"
import { Tool } from "@opencode-ai/core/tool"
import { QuestionTool } from "@opencode-ai/core/tool/plugin/question"
import { Image } from "@opencode-ai/core/image"
import { testEffect } from "./lib/effect"
import { imagePassthrough } from "./lib/image"
import { permissionLayer } from "./lib/permission"
import { makeLocationNode } from "@opencode-ai/util/effect/app-node"
import { toolIdentity, executeTool, registerToolPlugin, toolDefinitions } from "./lib/tool"

const sessionID = Session.ID.make("ses_question_tool_test")
const assertions: Permission.AssertInput[] = []
let captured: Form.CreateInput | undefined
let reject = false
let deny = false
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
  ask: (input: Form.CreateInput) =>
    Effect.sync(() => {
      captured = input
    }).pipe(
      Effect.andThen(
        Effect.sync(
          (): Form.TerminalState =>
            reject ? { status: "cancelled" } : { status: "answered", answer: { q0: "Build", q1: ["Dev"] } },
        ),
      ),
    ),
})
const questionToolNode = makeLocationNode({
  name: "test/question-tool-plugin",
  layer: Layer.effectDiscard(registerToolPlugin(QuestionTool.Plugin)),
  deps: [Tool.node, Permission.node, Form.node],
})

const it = testEffect(
  AppNodeBuilder.build(LayerNode.group([Tool.node, questionToolNode]), [
    [Permission.node, permission],
    [Form.node, form],
    [Image.node, imagePassthrough],
  ]),
)

describe("QuestionTool", () => {
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
