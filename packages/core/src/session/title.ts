export * as SessionTitle from "./title.js"

import { isDeepStrictEqual } from "node:util"
import { LLMClient, AIError, LLMEvent, Message, SystemPart, type LLMRequest } from "@opencode-ai/ai"
import type { StreamOptions } from "@opencode-ai/ai/route"
import { Context, DateTime, Effect, Layer, Stream } from "effect"
import { Agent } from "../agent.js"
import { Catalog } from "../catalog.js"
import { Database } from "../database/database.js"
import { Bus } from "../bus.js"
import { makeLocationNode } from "@opencode-ai/util/effect/app-node"
import { isExactRootFallback } from "@opencode-ai/util/session-title-fallback"
import { llmClient } from "../effect/app-node-platform.js"
import { Model } from "../model.js"
import { SessionEvent } from "./event.js"
import { SessionHistory } from "./history.js"
import { SessionModelRequest } from "./model-request.js"
import { SessionRunnerModel } from "./runner/model.js"
import { SessionSchema } from "./schema.js"
import { SessionUsage } from "./usage.js"
import { SessionStore } from "./store.js"

const MAX_LENGTH = 100
const titleChanged = Symbol("Session title changed")

type Dependencies = {
  readonly bus: Bus.Interface
  readonly llm: {
    readonly stream: (request: LLMRequest, options?: StreamOptions) => Stream.Stream<LLMEvent, AIError>
  }
  readonly agents: Agent.Interface
  readonly catalog: Catalog.Interface
  readonly models: SessionRunnerModel.Interface
  readonly modelRequests: SessionModelRequest.Interface
  readonly store: SessionStore.Interface
}

export interface Interface {
  /** Generates a title from the session's first user message when the session remains untitled. */
  readonly generateForFirstPrompt: (sessionID: SessionSchema.ID) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SessionTitle") {}

const truncate = (value: string) => (value.length <= MAX_LENGTH ? value : `${value.slice(0, MAX_LENGTH - 3)}...`)
const isUntitled = (session: SessionSchema.Info) =>
  isExactRootFallback({
    title: session.title,
    time: { created: DateTime.toEpochMillis(session.time.created) },
  })

const attempt = Effect.fn("SessionTitle.attempt")(function* (
  dependencies: Dependencies,
  input: {
    readonly session: SessionSchema.Info
    readonly agent: Agent.Info
    readonly text: string
    readonly model: SessionRunnerModel.Resolved
  },
) {
  const chunks: string[] = []
  let failed = false
  let usage: SessionUsage.Recorded | undefined
  const recordUsage = Effect.suspend(() =>
    usage
      ? dependencies.bus.publish(SessionEvent.UsageRecorded, {
          sessionID: input.session.id,
          source: "title",
          ...usage,
        })
      : Effect.void,
  )
  const prepared = yield* dependencies.modelRequests.prepare({
    scope: { session: input.session, agentID: input.agent.id, model: input.model },
    transcript: {
      system: input.agent.system ? [SystemPart.make(input.agent.system)] : [],
      messages: [Message.user(input.text)],
    },
    contextHooks: false,
  })
  const streamed = yield* dependencies.llm.stream(prepared.request, prepared.options).pipe(
    Stream.runForEach((event) => {
      if (LLMEvent.is.providerError(event)) failed = true
      if (LLMEvent.is.textDelta(event)) chunks.push(event.text)
      if (LLMEvent.is.stepFinish(event)) {
        const step = SessionUsage.record(event.usage, input.model.cost)
        usage = usage ? SessionUsage.add(usage, step) : step
      }
      return Effect.void
    }),
    Effect.as(true),
    Effect.catchTag("AI.Error", () => Effect.succeed(false)),
    Effect.onInterrupt(() => recordUsage.pipe(Effect.asVoid)),
  )
  yield* recordUsage
  if (!streamed || failed) return
  return chunks
    .join("")
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0)
})

/** Variant IDs that minimize reasoning output, in preference order. */
const MINIMAL_REASONING_VARIANTS = ["none", "minimal", "low"].map((id) => Model.VariantID.make(id))

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
    const primary = yield* dependencies.models.resolve(session).pipe(Effect.orElseSucceed(() => undefined))
    const info = yield* Effect.gen(function* () {
      if (agent.model) return yield* dependencies.catalog.model.get(agent.model.providerID, agent.model.id)
      if (!primary) return
      return yield* dependencies.catalog.model.small(primary.ref.providerID)
    })
    const variant =
      agent.model?.variant ?? MINIMAL_REASONING_VARIANTS.find((id) => info?.variants.some((item) => item.id === id))
    const preferred =
      info &&
      (yield* dependencies.models
        .resolve({
          ...session,
          model: Model.Ref.make({
            providerID: info.providerID,
            id: info.id,
            ...(variant ? { variant } : {}),
          }),
        })
        .pipe(Effect.orElseSucceed(() => undefined)))
    const selected = preferred ?? primary
    if (!selected) return
    const title =
      (yield* attempt(dependencies, { session, agent, text: firstUser.text, model: selected })) ??
      (primary && !isDeepStrictEqual(selected.ref, primary.ref)
        ? yield* attempt(dependencies, { session, agent, text: firstUser.text, model: primary })
        : undefined)
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
    const catalog = yield* Catalog.Service
    const models = yield* SessionRunnerModel.Service
    const modelRequests = yield* SessionModelRequest.Service
    const store = yield* SessionStore.Service
    const database = yield* Database.Service
    const title = make({ bus, llm, agents, catalog, models, modelRequests, store })
    return Service.of({
      generateForFirstPrompt: (sessionID) => title.generateForFirstPrompt(database.db, sessionID),
    })
  }),
)

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [
    Bus.node,
    llmClient,
    Agent.node,
    Catalog.node,
    SessionRunnerModel.node,
    SessionModelRequest.node,
    SessionStore.node,
    Database.node,
  ],
})
