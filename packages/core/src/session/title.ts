export * as SessionTitle from "./title"

import { LLM, LLMClient, LLMError, LLMEvent, Message, type LLMRequest } from "@opencode-ai/ai"
import { Context, DateTime, Effect, Layer, Stream } from "effect"
import { Agent } from "../agent"
import { Database } from "../database/database"
import { Bus } from "../bus"
import { makeLocationNode } from "@opencode-ai/util/effect/app-node"
import { App } from "../app"
import { llmClient } from "../effect/app-node-platform"
import { SessionEvent } from "./event"
import { SessionHistory } from "./history"
import { SessionModelHeaders } from "./model-headers"
import { SessionRunnerModel } from "./runner/model"
import { SessionSchema } from "./schema"
import { SessionUsage } from "./usage"
import { SessionStore } from "./store"

const MAX_LENGTH = 100
const titleChanged = Symbol("Session title changed")

type Dependencies = {
  readonly app: App.Info
  readonly bus: Bus.Interface
  readonly llm: {
    readonly stream: (request: LLMRequest) => Stream.Stream<LLMEvent, LLMError>
  }
  readonly agents: Agent.Interface
  readonly models: SessionRunnerModel.Interface
  readonly store: SessionStore.Interface
}

export interface Interface {
  /** Generates a title from the session's first user message when the session remains untitled. */
  readonly generateForFirstPrompt: (sessionID: SessionSchema.ID) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SessionTitle") {}

const truncate = (value: string) => (value.length <= MAX_LENGTH ? value : `${value.slice(0, MAX_LENGTH - 3)}...`)
const isUntitled = (session: SessionSchema.Info) =>
  session.title === undefined || session.title === `New session - ${DateTime.formatIso(session.time.created)}`

const make = (dependencies: Dependencies) => {
  const generateForFirstPrompt = Effect.fn("SessionTitle.generateForFirstPrompt")(function* (
    db: Database.Interface["db"],
    sessionID: SessionSchema.ID,
  ) {
    const session = yield* dependencies.store.get(sessionID)
    if (!session) return
    if (session.parentID) return
    if (!isUntitled(session)) return
    const firstUser = yield* SessionHistory.firstUserMessage(db, session.id)
    if (!firstUser) return
    const agent = yield* dependencies.agents.get(Agent.ID.make("title"))
    if (!agent) return
    const resolved = yield* (
      agent.model
        ? dependencies.models.resolve({ ...session, model: agent.model })
        : dependencies.models.resolve(session)
    ).pipe(Effect.catch(() => Effect.succeed(undefined)))
    if (!resolved) return
    const chunks: string[] = []
    let failed = false
    let usage: SessionUsage.Recorded | undefined
    const recordUsage = Effect.suspend(() =>
      usage
        ? dependencies.bus.publish(SessionEvent.UsageRecorded, {
            sessionID: session.id,
            source: "title",
            ...usage,
          })
        : Effect.void,
    )
    const streamed = yield* dependencies.llm
      .stream(
        LLM.request({
          model: resolved.model,
          http: { headers: SessionModelHeaders.make(session, dependencies.app) },
          system: agent.system,
          messages: [Message.user(firstUser.text)],
          tools: [],
        }),
      )
      .pipe(
        Stream.runForEach((event) => {
          if (LLMEvent.is.providerError(event)) failed = true
          if (LLMEvent.is.textDelta(event)) chunks.push(event.text)
          if (LLMEvent.is.stepFinish(event)) {
            const step = SessionUsage.record(event.usage, resolved.cost)
            usage = usage ? SessionUsage.add(usage, step) : step
          }
          return Effect.void
        }),
        Effect.as(true),
        Effect.catchTag("LLM.Error", () => Effect.succeed(false)),
        Effect.onInterrupt(() => recordUsage.pipe(Effect.asVoid)),
      )
    yield* recordUsage
    if (!streamed || failed) return
    const title = chunks
      .join("")
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line.length > 0)
    if (!title) return
    const expectedSequence = (yield* Bus.latestSequence(db, sessionID)) + 1
    const current = yield* dependencies.store.get(sessionID)
    if (!current || !isUntitled(current)) return
    yield* dependencies.bus
      .publish(
        SessionEvent.Renamed,
        {
          sessionID: session.id,
          title: truncate(title),
        },
        { commit: (sequence) => (sequence === expectedSequence ? Effect.void : Effect.die(titleChanged)) },
      )
      .pipe(Effect.catchDefect((defect) => (defect === titleChanged ? Effect.void : Effect.die(defect))))
  })
  return { generateForFirstPrompt }
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const bus = yield* Bus.Service
    const llm = yield* LLMClient.Service
    const agents = yield* Agent.Service
    const models = yield* SessionRunnerModel.Service
    const store = yield* SessionStore.Service
    const database = yield* Database.Service
    const app = yield* App.Metadata
    const title = make({ bus, llm, agents, models, store, app })
    return Service.of({
      generateForFirstPrompt: (sessionID) => title.generateForFirstPrompt(database.db, sessionID),
    })
  }),
)

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [Bus.node, llmClient, Agent.node, SessionRunnerModel.node, SessionStore.node, Database.node, App.node],
})
