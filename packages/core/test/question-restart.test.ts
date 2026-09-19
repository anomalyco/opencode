import { describe, expect } from "bun:test"
import path from "path"
import { LLMClient, LLMEvent, Model, type LLMClientShape, type LLMRequest } from "@opencode-ai/llm"
import * as OpenAIChat from "@opencode-ai/llm/protocols/openai-chat"
import { Context, Deferred, Effect, Exit, Fiber, Layer, Schema, Scope, Stream } from "effect"
import { AgentV2 } from "@opencode-ai/core/agent"
import { ApplicationTools } from "@opencode-ai/core/tool/application-tools"
import { Config } from "@opencode-ai/core/config"
import { ConfigCompaction } from "@opencode-ai/core/config/compaction"
import { Database } from "@opencode-ai/core/database/database"
import { makeGlobalNode, makeLocationNode } from "@opencode-ai/core/effect/app-node"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNodePlatform } from "@opencode-ai/core/effect/app-node-platform"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { EventV2 } from "@opencode-ai/core/event"
import { Location } from "@opencode-ai/core/location"
import { PermissionV2 } from "@opencode-ai/core/permission"
import { QuestionV2 } from "@opencode-ai/core/question"
import { ReferenceGuidance } from "@opencode-ai/core/reference/guidance"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { SessionV2 } from "@opencode-ai/core/session"
import { SessionExecution } from "@opencode-ai/core/session/execution"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { SessionRunCoordinator } from "@opencode-ai/core/session/run-coordinator"
import { SessionRunner } from "@opencode-ai/core/session/runner"
import * as SessionRunnerLLM from "@opencode-ai/core/session/runner/llm"
import { SessionRunnerModel } from "@opencode-ai/core/session/runner/model"
import { SessionStore } from "@opencode-ai/core/session/store"
import { SkillGuidance } from "@opencode-ai/core/skill/guidance"
import { Snapshot } from "@opencode-ai/core/snapshot"
import { SystemContext } from "@opencode-ai/core/system-context"
import { SystemContextRegistry } from "@opencode-ai/core/system-context/registry"
import { Tool } from "@opencode-ai/core/tool/tool"
import { ToolRegistry } from "@opencode-ai/core/tool/registry"
import { tmpdir } from "./fixture/tmpdir"
import { testEffect } from "./lib/effect"

const it = testEffect(Layer.empty)

const sessionID = SessionV2.ID.make("ses_question_restart_repro")
const callID = "call-question-restart"

const question: QuestionV2.Info = {
  question: "Which option?",
  header: "Option",
  options: [{ label: "One", description: "First option" }],
}

const model = Model.make({
  id: "fake-model",
  provider: "fake",
  route: OpenAIChat.route,
})

const requests: LLMRequest[] = []
let responses: LLMEvent[][] = []
let providerStarted: Deferred.Deferred<void> | undefined
let continuationStarted: Deferred.Deferred<void> | undefined
let continuationGate: Deferred.Deferred<void> | undefined

const client = Layer.succeed(
  LLMClient.Service,
  LLMClient.Service.of({
    prepare: () => Effect.die("unused"),

    stream: ((request: LLMRequest) => {
      requests.push(request)
      const current = requests.length
      const events = Stream.fromIterable(responses.shift() ?? [])

      if (current === 1 && providerStarted) {
        return Stream.unwrap(Deferred.succeed(providerStarted, undefined).pipe(Effect.as(events)))
      }

      if (current !== 2 || !continuationGate) return events

      return Stream.unwrap(
        (continuationStarted ? Deferred.succeed(continuationStarted, undefined) : Effect.void).pipe(
          Effect.andThen(Deferred.await(continuationGate)),
          Effect.as(events),
        ),
      )
    }) as unknown as LLMClientShape["stream"],

    generate: () => Effect.die("unused"),
  }),
)

const models = SessionRunnerModel.layerWith(() => Effect.succeed(model))

const permission = Layer.succeed(
  PermissionV2.Service,
  PermissionV2.Service.of({
    assert: () => Effect.void,
    ask: () => Effect.die("unused"),
    reply: () => Effect.die("unused"),
    get: () => Effect.die("unused"),
    forSession: () => Effect.die("unused"),
    list: () => Effect.die("unused"),
  }),
)

const systemContext = Layer.mock(SystemContextRegistry.Service, {
  register: () => Effect.void,
  load: () => Effect.succeed(SystemContext.empty),
})

const skillGuidance = Layer.mock(SkillGuidance.Service, {
  load: () => Effect.succeed(SystemContext.empty),
})

const referenceGuidance = Layer.mock(ReferenceGuidance.Service, {
  load: () => Effect.succeed(SystemContext.empty),
})

const config = Layer.succeed(
  Config.Service,
  Config.Service.of({
    entries: () =>
      Effect.succeed([
        new Config.Document({
          type: "document",
          info: new Config.Info({
            compaction: new ConfigCompaction.Info({
              buffer: 3_000,
              keep: new ConfigCompaction.Keep({ tokens: 1_000 }),
            }),
          }),
        }),
      ]),
  }),
)

const questionTool = Layer.effectDiscard(
  Effect.gen(function* () {
    const registry = yield* ToolRegistry.Service
    const questions = yield* QuestionV2.Service

    yield* registry.register({
      question: Tool.make({
        description: "Ask the user",
        input: Schema.Struct({
          questions: Schema.Array(QuestionV2.Prompt),
        }),
        output: Schema.Struct({
          answers: Schema.Array(QuestionV2.Answer),
        }),
        toModelOutput: ({ input, output }) => [
          {
            type: "text",
            text: input.questions
              .map((item, index) => `"${item.question}"="${output.answers[index]?.join(", ") ?? "Unanswered"}"`)
              .join(", "),
          },
        ],
        execute: (input, context) =>
          questions
            .ask({
              sessionID: context.sessionID,
              questions: input.questions,
              tool: {
                messageID: context.assistantMessageID,
                callID: context.toolCallID,
              },
            })
            .pipe(
              Effect.map((answers) => ({ answers })),
              Effect.orDie,
            ),
      }),
    })
  }),
)

const questionToolNode = makeLocationNode({
  name: "test/question-restart-tool",
  layer: questionTool,
  deps: [ToolRegistry.node, QuestionV2.node],
})

function graph(databasePath: string, location: Location.Ref) {
  const database = makeGlobalNode({
    service: Database.Service,
    layer: Database.layerFromPath(databasePath),
    deps: [],
  })

  const runnerLayer = AppNodeBuilder.build(SessionRunnerLLM.node, [
    [Database.node, database],
    [LayerNodePlatform.llmClient, client],
    [SessionRunnerModel.node, models],
    [SystemContextRegistry.node, systemContext],
    [Location.node, Location.boundNode(location)],
    [SkillGuidance.node, skillGuidance],
    [ReferenceGuidance.node, referenceGuidance],
    [PermissionV2.node, permission],
    [Snapshot.node, Snapshot.noopLayer],
    [Config.node, config],
  ])

  const execution = Layer.effect(
    SessionExecution.Service,
    Effect.gen(function* () {
      const runner = yield* SessionRunner.Service

      const coordinator = yield* SessionRunCoordinator.make<SessionV2.ID, SessionRunner.RunError>({
        drain: (id, force) =>
          runner.run({
            sessionID: id,
            force,
          }),
      })

      return SessionExecution.Service.of({
        active: coordinator.active,
        resume: coordinator.run,
        wake: coordinator.wake,
        interrupt: coordinator.interrupt,
      })
    }),
  ).pipe(Layer.provide(runnerLayer))

  return AppNodeBuilder.build(
    LayerNode.group([
      Database.node,
      EventV2.node,
      QuestionV2.node,
      SessionProjector.node,
      SessionStore.node,
      ApplicationTools.node,
      AgentV2.node,
      ToolRegistry.node,
      ToolRegistry.toolsNode,
      questionToolNode,
      SessionRunnerModel.node,
      SystemContextRegistry.node,
      SkillGuidance.node,
      ReferenceGuidance.node,
      Config.node,
      Snapshot.node,
      SessionRunnerLLM.node,
      SessionExecution.node,
      SessionV2.node,
    ]),
    [
      [Database.node, database],
      [LayerNodePlatform.llmClient, client],
      [PermissionV2.node, permission],
      [SessionRunnerModel.node, models],
      [SystemContextRegistry.node, systemContext],
      [Location.node, Location.boundNode(location)],
      [SkillGuidance.node, skillGuidance],
      [ReferenceGuidance.node, referenceGuidance],
      [Snapshot.node, Snapshot.noopLayer],
      [SessionExecution.node, execution],
      [Config.node, config],
    ],
  )
}

describe("QuestionV2 restart recovery", () => {
  it.live("recovers a pending question and continues without replaying the provider turn", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (dir) => Effect.promise(() => dir[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((dir) =>
        Effect.gen(function* () {
          const directory = AbsolutePath.make(dir.path)
          const location = Location.Ref.make({
            directory,
          })
          const databasePath = path.join(dir.path, "question-restart.db")

          requests.length = 0
          providerStarted = yield* Deferred.make<void>()
          continuationStarted = yield* Deferred.make<void>()
          continuationGate = yield* Deferred.make<void>()

          responses = [
            [
              LLMEvent.stepStart({ index: 0 }),
              LLMEvent.toolCall({
                id: callID,
                name: "question",
                input: {
                  questions: [question],
                },
              }),
              LLMEvent.stepFinish({
                index: 0,
                reason: "tool-calls",
              }),
              LLMEvent.finish({
                reason: "tool-calls",
              }),
            ],
            [
              LLMEvent.stepStart({ index: 0 }),
              LLMEvent.stepFinish({
                index: 0,
                reason: "stop",
              }),
              LLMEvent.finish({
                reason: "stop",
              }),
            ],
          ]

          /*
           * Runtime A.
           */
          const firstScope = yield* Scope.make()

          const firstContext = yield* Layer.buildWithScope(Layer.fresh(graph(databasePath, location)), firstScope)

          const firstSession = Context.get(firstContext, SessionV2.Service)

          const firstQuestions = Context.get(firstContext, QuestionV2.Service)

          const created = yield* firstSession.create({
            id: sessionID,
            location,
          })

          expect(created.id).toBe(sessionID)

          yield* firstSession.prompt({
            sessionID,
            prompt: {
              text: "Ask me which option to use.",
            },
            resume: false,
          })

          const firstRun = yield* firstSession.resume(sessionID).pipe(Effect.forkIn(firstScope))

          const providerProgress = yield* Effect.raceFirst(
            Deferred.await(providerStarted!).pipe(Effect.as("provider-started" as const)),
            Fiber.await(firstRun).pipe(Effect.as("runner-exited" as const)),
          )

          expect(providerProgress).toBe("provider-started")

          expect(requests).toHaveLength(1)

          expect(requests[0]?.tools.map((tool) => tool.name)).toContain("question")

          /*
           * Synchronize on observable product state.
           * No sleeps/yields.
           */
          const pendingProgress = yield* Effect.raceFirst(
            firstQuestions.list().pipe(
              Effect.repeat({
                until: (items) => items.length === 1,
              }),
              Effect.map((items) => ({
                type: "pending" as const,
                items,
              })),
            ),
            Fiber.await(firstRun).pipe(
              Effect.map((exit) => ({
                type: "runner-exited" as const,
                exit,
              })),
            ),
          )

          expect(pendingProgress.type).toBe("pending")

          if (pendingProgress.type !== "pending") {
            throw new Error(`Runtime A exited before Question became pending: ${JSON.stringify(pendingProgress.exit)}`)
          }

          const request = pendingProgress.items[0]!

          expect(request.sessionID).toBe(sessionID)

          expect(request.tool).toMatchObject({
            callID,
            messageID: expect.stringMatching(/^msg_/),
          })

          expect(yield* firstSession.context(sessionID)).toMatchObject([
            {
              type: "user",
              text: "Ask me which option to use.",
            },
            {
              type: "assistant",
              content: [
                {
                  type: "tool",
                  id: callID,
                  state: {
                    status: "running",
                  },
                },
              ],
            },
          ])

          /*
           * Managed teardown.
           */
          yield* Scope.close(firstScope, Exit.void)

          expect(Exit.isFailure(yield* Fiber.await(firstRun))).toBe(true)

          /*
           * Runtime B: completely fresh graph,
           * same Location identity and SQLite.
           */
          const secondScope = yield* Scope.make()

          const secondContext = yield* Layer.buildWithScope(Layer.fresh(graph(databasePath, location)), secondScope)

          const secondSession = Context.get(secondContext, SessionV2.Service)

          const secondQuestions = Context.get(secondContext, QuestionV2.Service)

          const reopened = yield* secondSession.get(sessionID)

          expect(reopened.id).toBe(sessionID)
          expect(reopened.location).toEqual(location)

          /*
           * DEFINITIVE RED #1.
           *
           * Current upstream should fail here:
           * QuestionV2 pending state is only
           * process-local.
           */
          expect(yield* secondQuestions.list()).toEqual([request])

          /*
           * RED #2: original request identity
           * remains usable in runtime B.
           */
          yield* secondQuestions.reply({
            requestID: request.id,
            answers: [["One"]],
          })

          expect(yield* secondQuestions.list()).toEqual([])

          /*
           * RED #3:
           * reply must wake durable work.
           * No resume(force=true).
           */
          yield* Deferred.await(continuationStarted!)

          /*
           * Exactly:
           *   #1 original provider turn
           *   #2 continuation after recovery
           *
           * Never replay #1.
           */
          expect(requests).toHaveLength(2)

          expect(requests[1]?.messages.map((message) => message.role)).toEqual(["user", "assistant", "tool"])

          expect(JSON.stringify(requests[1]?.messages)).toContain("One")

          yield* Deferred.succeed(continuationGate!, undefined)

          yield* Scope.close(secondScope, Exit.void)
        }),
      ),
    ),
  )
})
