import { HttpRecorder } from "@opencode/http-recorder"
import { OpenAIChat } from "@opencode/ai/protocols/openai-chat"
import { Auth, LLMClient, RequestExecutor } from "@opencode/ai/route"
import { Database } from "@opencode/core/database/database"
import { EventTable } from "@opencode/core/event/sql"
import { Session } from "@opencode/core/session"
import { SessionRunnerModel } from "@opencode/core/session/runner/model"
import { describe, expect } from "bun:test"
import { eq } from "drizzle-orm"
import { Effect, Layer, Option, Tracer } from "effect"
import path from "node:path"
import { testEffect } from "./lib/effect"
import { seedSession, sessionRunnerTestLayer } from "./lib/session-runner-harness"

const cassetteName = "session-runner/openai-chat-streams-text"
const cassetteDirectory = path.resolve(import.meta.dir, "fixtures/recordings")
if (process.env.RECORD === "true") {
  if (process.env.CI !== undefined) throw new Error("Unset CI before recording HTTP cassettes")
  HttpRecorder.removeCassetteSync(cassetteName, { directory: cassetteDirectory })
}
const cassette = HttpRecorder.layerFetch(cassetteName, { directory: cassetteDirectory })
const executor = RequestExecutor.layer.pipe(Layer.provide(cassette))
const client = LLMClient.layer.pipe(Layer.provide(executor))
const model = OpenAIChat.route
  .with({
    endpoint: { baseURL: "https://api.openai.com/v1" },
    auth: Auth.bearer(process.env.OPENAI_API_KEY ?? "fixture"),
    maxTokens: 20,
    temperature: 0,
  })
  .model({ id: "gpt-4o-mini", capabilities: { promptCacheKey: true } })
const models = Layer.mock(SessionRunnerModel.Service)({
  resolve: () =>
    Effect.succeed(
      SessionRunnerModel.resolved(model, {
        capabilities: { tools: true, input: ["text", "image"], output: ["text"] },
        cost: [],
        limit: { context: 200_000, output: 20 },
      }),
    ),
})
const spans: Tracer.NativeSpan[] = []
const tracer = Tracer.make({
  span(options) {
    const span = new Tracer.NativeSpan(options)
    spans.push(span)
    return span
  },
})
const it = testEffect(
  sessionRunnerTestLayer({ llmClient: client, models }).pipe(Layer.provide(Layer.succeed(Tracer.Tracer, tracer))),
)
const sessionID = Session.ID.make("ses_runner_recorded")

describe("SessionRunnerLLM recorded", () => {
  it.effect("executes one recorded prompt through the recorded HTTP transport", () =>
    Effect.gen(function* () {
      const { session, prompt } = yield* seedSession(sessionID)

      yield* session.resume(sessionID)

      const messages = yield* session.context(sessionID)
      expect(messages).toHaveLength(2)
      expect(messages[0]).toMatchObject({ id: prompt.id, type: "user", text: "Say hello in one short sentence." })
      expect(messages[1]).toMatchObject({ type: "assistant", agent: "build", finish: "stop" })
      expect(messages[1]?.type === "assistant" ? messages[1].content : []).toMatchObject([
        { type: "text", text: "Hello!" },
      ])
      const { db } = yield* Database.Service
      expect(
        (yield* db
          .select({ type: EventTable.type })
          .from(EventTable)
          .where(eq(EventTable.aggregate_id, sessionID))
          .orderBy(EventTable.seq)
          .all()).map((event) => event.type),
      ).toEqual([
        "session.inbox.enqueued.1",
        "session.instructions.updated.2",
        "session.inbox.delivered.1",
        "session.step.started.1",
        "session.text.started.1",
        "session.text.ended.1",
        "session.step.streamed.1",
        "session.step.ended.1",
      ])

      // The turn is its own trace, every span in it names the session, and the attempt names the model and tokens.
      const drain = spans.find((span) => span.name === "SessionRunner.drain")
      expect(drain).toBeDefined()
      expect(Option.isNone(drain!.parent)).toBe(true)
      const turn = spans.filter((span) => span.traceId === drain!.traceId)
      expect(turn.filter((span) => span.attributes.get("session.id") !== sessionID).map((span) => span.name)).toEqual(
        [],
      )
      const attempt = turn.find((span) => span.name === "SessionStep.attempt")
      expect(Object.fromEntries(attempt?.attributes ?? [])).toMatchObject({
        "gen_ai.agent.name": "build",
        "gen_ai.provider.name": "openai",
        "gen_ai.request.model": "gpt-4o-mini",
        "gen_ai.response.finish_reasons": ["stop"],
        "gen_ai.usage.input_tokens": 465,
        "gen_ai.usage.output_tokens": 2,
        "opencode.usage.cost_usd": 0,
      })
      expect(attempt?.attributes.get("opencode.llm.first_output_ms")).toBeNumber()
      // The provider stream has its own span under the attempt, so model time splits from tool time.
      const stream = turn.find((span) => span.name === "LLM.stream")
      expect(Option.getOrUndefined(stream!.parent)?.spanId).toBe(attempt!.spanId)
      expect(Object.fromEntries(stream!.attributes)).toMatchObject({
        "gen_ai.provider.name": "openai",
        "gen_ai.request.model": "gpt-4o-mini",
      })
      expect(stream!.status._tag).toBe("Ended")
    }).pipe(Effect.withSpan("fixture.request")),
  )
})
