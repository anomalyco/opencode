import { SessionProjector } from "@opencode-ai/core/session/projector"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { expect } from "bun:test"
import { Cause, Effect, Exit, Fiber } from "effect"
import { Question } from "../../src/question"
import { Session } from "@/session/session"
import { MessageID, SessionID } from "../../src/session/schema"
import { PlanExitTool } from "../../src/tool/plan"
import { Truncate } from "@/tool/truncate"
import { Agent } from "../../src/agent/agent"
import { Provider as ProviderSvc } from "@/provider/provider"
import { EventV2Bridge } from "../../src/event-v2-bridge"
import { testEffect, pollWithTimeout } from "../lib/effect"

const it = testEffect(
  LayerNode.compile(
    LayerNode.group([
      Session.node,
      SessionProjector.node,
      Question.node,
      Agent.node,
      ProviderSvc.node,
      Truncate.node,
      EventV2Bridge.node,
    ]),
  ),
)

const ctx = (sessionID: SessionID) => ({
  sessionID,
  messageID: MessageID.ascending(),
  callID: "call_test",
  agent: "plan",
  abort: AbortSignal.any([]),
  messages: [] as SessionV1.WithParts[],
  metadata: () => Effect.void,
  ask: () => Effect.void,
})

function seedPlanMessage(sessionID: SessionID) {
  return Effect.gen(function* () {
    const sessions = yield* Session.Service
    yield* sessions.updateMessage({
      id: MessageID.ascending(),
      sessionID,
      role: "user",
      time: { created: Date.now() },
      agent: "plan",
      model: { providerID: ProviderV2.ID.make("test"), modelID: ModelV2.ID.make("test-model") },
    } satisfies SessionV1.User)
  })
}

function lastUserMessage(sessionID: SessionID) {
  return Effect.gen(function* () {
    const sessions = yield* Session.Service
    const msgs = yield* sessions.messages({ sessionID })
    const last = msgs.at(-1)
    if (last?.info.role !== "user") throw new Error("expected last message to be a user message")
    return last.info
  })
}

const runPlanExit = Effect.fn("PlanExitTest.runPlanExit")(function* (sessionID: SessionID) {
  const question = yield* Question.Service
  const toolInfo = yield* PlanExitTool
  const tool = yield* toolInfo.init()
  const fiber = yield* tool.execute({}, ctx(sessionID)).pipe(Effect.forkScoped)
  const pending = yield* pollWithTimeout(
    Effect.gen(function* () {
      const exit = fiber.pollUnsafe()
      if (exit && Exit.isFailure(exit))
        throw new Error(`plan_exit fiber exited before asking:\n${Cause.pretty(exit.cause)}`)
      const items = yield* question.list()
      return items[0]
    }),
    "plan_exit question never appeared",
  )
  yield* question.reply({ requestID: pending.id, answers: [["Yes"]] })
  yield* Fiber.join(fiber)
})

it.instance(
  "plan_exit stamps the build agent's configured model on the synthetic message",
  () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const session = yield* sessions.create({})
      yield* seedPlanMessage(session.id)

      yield* runPlanExit(session.id)

      const last = yield* lastUserMessage(session.id)
      expect(last.agent).toBe("build")
      expect(last.model.providerID).toBe(ProviderV2.ID.make("test"))
      expect(last.model.modelID).toBe(ModelV2.ID.make("build-model"))
    }),
  {
    config: {
      agent: {
        plan: { model: "test/test-model" },
        build: { model: "test/build-model" },
      },
    },
  },
)

it.instance(
  "plan_exit falls back to the plan model when the build agent has no configured model",
  () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const session = yield* sessions.create({})
      yield* seedPlanMessage(session.id)

      yield* runPlanExit(session.id)

      const last = yield* lastUserMessage(session.id)
      expect(last.agent).toBe("build")
      expect(last.model.providerID).toBe(ProviderV2.ID.make("test"))
      expect(last.model.modelID).toBe(ModelV2.ID.make("test-model"))
    }),
  {
    config: {
      agent: {
        plan: { model: "test/test-model" },
      },
    },
  },
)
