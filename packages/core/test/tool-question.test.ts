import { describe, expect } from "bun:test"
import { Effect, Exit, Fiber, Layer } from "effect"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Form } from "@opencode-ai/core/form"
import { PermissionV2 } from "@opencode-ai/core/permission"
import { SessionV2 } from "@opencode-ai/core/session"
import { ToolRegistry } from "@opencode-ai/core/tool/registry"
import { QuestionTool } from "@opencode-ai/core/tool/question"
import { ToolOutputStore } from "@opencode-ai/core/tool-output-store"
import { testEffect } from "./lib/effect"
import { toolIdentity, executeTool, settleTool, toolDefinitions } from "./lib/tool"

const sessionID = SessionV2.ID.make("ses_question_tool_test")
const assertions: PermissionV2.AssertInput[] = []
let captured: Form.CreateInput | undefined
let reject = false
let deny = false
const capturedInput = () => captured
const permission = Layer.succeed(
  PermissionV2.Service,
  PermissionV2.Service.of({
    assert: (input) =>
      Effect.sync(() => assertions.push(input)).pipe(
        Effect.andThen(deny ? Effect.fail(new PermissionV2.DeniedError({ rules: [] })) : Effect.void),
      ),
    ask: () => Effect.die("unused"),
    reply: () => Effect.die("unused"),
    get: () => Effect.die("unused"),
    forSession: () => Effect.die("unused"),
    list: () => Effect.die("unused"),
  }),
)
const form = Layer.succeed(
  Form.Service,
  Form.Service.of({
    create: () => Effect.die("unused"),
    ask: (input: Form.CreateInput) =>
      Effect.gen(function* () {
        captured = input
        if (reject) return { status: "cancelled" } as const
        return { status: "answered", answer: { question_0: "Build" } } as const
      }),
    get: () => Effect.die("unused"),
    list: () => Effect.die("unused"),
    state: () => Effect.die("unused"),
    reply: () => Effect.die("unused"),
    cancel: () => Effect.die("unused"),
  }),
)
const it = testEffect(
  AppNodeBuilder.build(LayerNode.group([ToolRegistry.node, ToolRegistry.toolsNode, QuestionTool.node]), [
    [PermissionV2.node, permission],
    [Form.node, form],
    [ToolOutputStore.node, ToolOutputStore.nodeWithoutConfig],
  ]),
)

describe("QuestionTool", () => {
  it.effect("omits a denied built-in question and terminally settles a stale call", () =>
    Effect.gen(function* () {
      captured = undefined
      deny = true
      const registry = yield* ToolRegistry.Service

      expect(yield* toolDefinitions(registry, [{ action: "question", resource: "*", effect: "deny" }])).toEqual([])
      expect(
        yield* settleTool(registry, {
          sessionID,
          ...toolIdentity,
          call: { type: "tool-call", id: "call-question-denied", name: "question", input: { questions: [] } },
        }),
      ).toEqual({ result: { type: "error", value: "Permission denied: question" } })
      expect(capturedInput()).toBeUndefined()
      deny = false
    }),
  )

  it.effect("registers question and projects user answers without a permission assertion", () =>
    Effect.gen(function* () {
      assertions.length = 0
      captured = undefined
      reject = false
      deny = false
      const registry = yield* ToolRegistry.Service
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
        },
      ]

      expect((yield* toolDefinitions(registry)).map((definition) => definition.name)).toEqual(["question"])
      expect(
        yield* settleTool(registry, {
          sessionID,
          ...toolIdentity,
          call: { type: "tool-call", id: "call-question", name: "question", input: { questions } },
        }),
      ).toEqual({
        result: {
          type: "text",
          value:
            'User has answered your questions: "What should happen?"="Build", "Which environment?"="Unanswered". You can now continue with the user\'s answers in mind.',
        },
        output: {
          structured: { answers: [["Build"], []] },
          content: [
            {
              type: "text",
              text: 'User has answered your questions: "What should happen?"="Build", "Which environment?"="Unanswered". You can now continue with the user\'s answers in mind.',
            },
          ],
        },
      })
      expect(assertions).toMatchObject([{ sessionID, action: "question", resources: ["*"] }])
      expect(capturedInput()).toEqual({
        sessionID,
        title: "Questions",
        metadata: { kind: "question", tool: { messageID: toolIdentity.assistantMessageID, callID: "call-question" } },
        mode: "form",
        fields: [
          {
            key: "question_0",
            title: "What should happen?",
            description: "Action",
            type: "string",
            options: [{ value: "Build", label: "Build", description: "Build it" }],
            custom: true,
          },
          {
            key: "question_1",
            title: "Which environment?",
            description: "Environment",
            type: "string",
            options: [{ value: "Dev", label: "Dev", description: "Development" }],
            custom: true,
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
      const registryService = yield* ToolRegistry.Service

      yield* executeTool(registryService, {
        sessionID,
        ...toolIdentity,
        call: { type: "tool-call", id: "call-question", name: "question", input: { questions: [] } },
      })
      expect(capturedInput()).toEqual({
        sessionID,
        title: "Questions",
        metadata: { kind: "question", tool: { messageID: toolIdentity.assistantMessageID, callID: "call-question" } },
        mode: "form",
        fields: [],
      })
    }),
  )

  it.effect("keeps dismissed questions out of model-facing output", () =>
    Effect.gen(function* () {
      captured = undefined
      reject = true
      deny = false
      const registryService = yield* ToolRegistry.Service
      const fiber = yield* executeTool(registryService, {
        sessionID,
        ...toolIdentity,
        call: { type: "tool-call", id: "call-question", name: "question", input: { questions: [] } },
      }).pipe(Effect.forkScoped)

      const exit = yield* Fiber.await(fiber)
      expect(Exit.isFailure(exit)).toBe(true)
    }),
  )
})
