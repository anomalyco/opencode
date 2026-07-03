export * as SessionTitle from "./title"

import { LLM, LLMClient, LLMError, LLMEvent, Message, type LLMRequest } from "@opencode-ai/llm"
import { Context, DateTime, Effect, Layer, Stream } from "effect"
import { AgentV2 } from "../agent"
import { Database } from "../database/database"
import { EventV2 } from "../event"
import { makeLocationNode } from "../effect/app-node"
import { llmClient } from "../effect/app-node-platform"
import { SessionEvent } from "./event"
import { SessionHistory } from "./history"
import { SessionRunnerModel } from "./runner/model"
import { SessionSchema } from "./schema"

const MAX_LENGTH = 100

type Dependencies = {
  readonly events: EventV2.Interface
  readonly llm: {
    readonly stream: (request: LLMRequest) => Stream.Stream<LLMEvent, LLMError>
  }
  readonly agents: AgentV2.Interface
  readonly models: SessionRunnerModel.Interface
}

export interface Interface {
  /** Generates a title from the session's first user message and renames the session. Runs at most once per session. */
  readonly generateForFirstPrompt: (session: SessionSchema.Info) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/SessionTitle") {}

const truncate = (value: string) => (value.length <= MAX_LENGTH ? value : `${value.slice(0, MAX_LENGTH - 3)}...`)

const make = (dependencies: Dependencies) => {
  const generateForFirstPrompt = Effect.fn("SessionTitle.generateForFirstPrompt")(function* (
    db: Database.Interface["db"],
    session: SessionSchema.Info,
  ) {
    if (session.parentID) return
    const firstUser = yield* SessionHistory.firstUserMessageIfOnly(db, session.id)
    if (!firstUser) return
    const agent = yield* dependencies.agents.get(AgentV2.ID.make("title"))
    if (!agent) return
    const resolved = yield* (
      agent.model
        ? dependencies.models.resolve({ ...session, model: agent.model })
        : dependencies.models.resolve(session)
    ).pipe(Effect.catch(() => Effect.succeed(undefined)))
    if (!resolved) return
    const chunks: string[] = []
    let failed = false
    const streamed = yield* dependencies.llm
      .stream(
        LLM.request({
          model: resolved.model,
          system: agent.system,
          messages: [Message.user(firstUser.text)],
          tools: [],
        }),
      )
      .pipe(
        Stream.runForEach((event) => {
          if (LLMEvent.is.providerError(event)) failed = true
          if (LLMEvent.is.textDelta(event)) chunks.push(event.text)
          return Effect.void
        }),
        Effect.as(true),
        Effect.catchTag("LLM.Error", () => Effect.succeed(false)),
      )
    if (!streamed || failed) return
    const title = chunks
      .join("")
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line.length > 0)
    if (!title) return
    yield* dependencies.events.publish(SessionEvent.Renamed, {
      sessionID: session.id,
      title: truncate(title),
    })
  })
  return { generateForFirstPrompt }
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const events = yield* EventV2.Service
    const llm = yield* LLMClient.Service
    const agents = yield* AgentV2.Service
    const models = yield* SessionRunnerModel.Service
    const database = yield* Database.Service
    const title = make({ events, llm, agents, models })
    return Service.of({
      generateForFirstPrompt: (session) => title.generateForFirstPrompt(database.db, session),
    })
  }),
)

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [EventV2.node, llmClient, AgentV2.node, SessionRunnerModel.node, Database.node],
})
