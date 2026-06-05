import { LLM, LLMClient, SystemPart } from "@opencode-ai/llm"
import { DateTime, Effect, Layer } from "effect"
import { EventV2 } from "../../event"
import { SessionSchema } from "../schema"
import { SessionEvent } from "../event"
import { SessionStore } from "../store"
import { Service, StepLimitExceededError } from "./index"
import { toLLMMessages } from "./to-llm-message"
import { ToolRegistry } from "../../tool/registry"
import { SessionRunnerModel } from "./model"
import { Database } from "../../database/database"
import { SessionInput } from "../input"
import { SystemContextRegistry } from "../../system-context-registry"
import { SessionContextEpoch } from "../context-epoch"
import { SessionRunnerProviderTurn } from "./provider-turn"

/**
 * Runs one durable coding-agent Session until it settles.
 *
 * Keep this as orchestration over smaller collaborators rather than rebuilding the legacy
 * `SessionPrompt` monolith. Implement the unchecked items in small reviewed slices:
 *
 * - Session ownership and controls
 *   - [x] Coordinate one local active drain per Session; explicit resumes join and prompt wakeups coalesce.
 *   - [ ] Replace local ownership with durable multi-node ownership when clustered.
 *   - [ ] Mark busy, retrying, idle, interrupted, or terminal-failure status durably.
 *   - [ ] Honor interruption and reject stale work after runtime attachment replacement.
 *   - [x] Bound model steps.
 *   - [ ] Bound provider retries and repeated identical tool calls.
 *
 * - Runtime context assembly
 *   - [x] Load Session placement and chronological projected V2 history.
 *   - [x] Resolve the selected model through the location-scoped runner environment.
 *   - [ ] Load the selected agent and effective permissions.
 *   - [ ] Build provider/model-specific base instructions and environment facts.
 *   - [x] Load global and upward project `AGENTS.md` instructions.
 *   - [ ] Load configured and remote instructions plus nearby nested instructions discovered while files are read.
 *   - [ ] List available skills in the system prompt and expose a tool for loading skill bodies.
 *   - [ ] Resolve referenced files, directories, agents, repositories, MCP resources, and media.
 *   - [ ] Apply steering reminders, plugin transforms, and structured-output policy.
 *   - [ ] Compact or summarize history when context pressure requires it.
 *
 * - One provider turn
 *   - [x] Translate every projected V2 Session message variant into canonical
 *     `@opencode-ai/llm` messages.
 *   - [ ] Resolve policy-filtered built-in, MCP, plugin, and structured-output tool definitions.
 *   - [x] Stream exactly one `llm.stream(request)` provider turn.
 *   - [x] Persist assistant text and usage events incrementally as they arrive.
 *   - [ ] Persist snapshots, patches, and retry notices incrementally as they arrive.
 *   - [x] Persist reasoning, provider errors, and tool-call events incrementally as they arrive.
 *
 * - Tool settlement and continuation
 *   - [x] Durably record each tool call before side effects begin.
 *   - [x] Authorize and execute recorded local calls through a core-owned registry hook.
 *   - [x] Persist typed success, failure, and provider-executed tool outcomes.
 *   - [x] Start each recorded local call eagerly and await all settlements before continuation.
 *   - [ ] Add scoped runtime context, progress updates, output truncation, attachment normalization,
 *     plugins, and cancellation settlement.
 *   - [x] Reload projected history and start the next explicit provider turn after local tool results.
 *   - [x] Continue for durable user steering accepted during an active provider turn.
 *   - [ ] Continue for compaction or another continuation condition when required.
 *
 * - Post-run maintenance
 *   - [ ] Settle final status and expose durable output events to replayable consumers.
 *   - [ ] Coalesce streamed deltas and add covering projected-history indexes.
 *   - [ ] Update title, summaries, compaction state, and cleanup in bounded background work.
 *
 * Use `llm.stream(request)` for each provider turn. Keep activity continuation here.
 * Durable activity recovery remains a separate future slice with an explicit retry policy.
 *
 * The current slice loads V2 history, translates it, resolves a model through a core service, and persists one
 * provider turn. Registry definitions are advertised, local tool calls are settled durably, and a
 * bounded explicit loop starts the next provider turn after local settlement.
 */

// QUESTION: Did this exist previously, or did we add this limit? Does it make sense?
const MAX_STEPS = 25

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const events = yield* EventV2.Service
    const llm = yield* LLMClient.Service
    const tools = yield* ToolRegistry.Service
    const models = yield* SessionRunnerModel.Service
    const store = yield* SessionStore.Service
    const systemContext = yield* SystemContextRegistry.Service
    const db = (yield* Database.Service).db
    const runProviderTurn = SessionRunnerProviderTurn.make({ events, llm, tools })
    const getSession = Effect.fn("SessionRunner.getSession")(function* (sessionID: SessionSchema.ID) {
      const session = yield* store.get(sessionID)
      if (!session) return yield* Effect.die(`Session not found: ${sessionID}`)
      return session
    })

    const failInterruptedTools = Effect.fn("SessionRunner.failInterruptedTools")(function* (
      sessionID: SessionSchema.ID,
    ) {
      for (const message of yield* store.context(sessionID)) {
        if (message.type !== "assistant") continue
        for (const tool of message.content) {
          if (tool.type !== "tool" || (tool.state.status !== "pending" && tool.state.status !== "running")) continue
          yield* events.publish(SessionEvent.Tool.Failed, {
            sessionID,
            timestamp: yield* DateTime.now,
            assistantMessageID: message.id,
            callID: tool.id,
            error: { type: "unknown", message: "Tool execution interrupted" },
            provider: {
              executed: tool.provider?.executed === true,
              ...(tool.provider?.metadata === undefined ? {} : { metadata: tool.provider.metadata }),
            },
          })
        }
      }
    })

    const prepareProviderTurn = Effect.fn("SessionRunner.prepareProviderTurn")(function* (
      sessionID: SessionSchema.ID,
      promotion: SessionInput.Delivery | undefined,
    ) {
      const session = yield* getSession(sessionID)
      const initialized = yield* SessionContextEpoch.initialize(db, systemContext, session.id, session.location)
      const model = yield* models.resolve(session)
      if (promotion) {
        const cutoff = yield* SessionInput.latestSeq(db, session.id)
        if (promotion === "steer") yield* SessionInput.promoteSteers(db, events, session.id, cutoff)
        if (promotion === "queue") {
          yield* SessionInput.promoteNextQueued(db, events, session.id)
          yield* SessionInput.promoteSteers(db, events, session.id, cutoff)
        }
      }
      const system = initialized ?? (yield* SessionContextEpoch.prepare(db, events, systemContext, session.id, session.location))
      const context = yield* store.runnerContext(session.id, system.baselineSeq)
      return {
        sessionID: session.id,
        agent: session.agent ?? "build",
        ...(session.model?.variant === undefined ? {} : { variant: session.model.variant }),
        request: LLM.request({
          model,
          system: system.baseline.length > 0 ? [SystemPart.make(system.baseline)] : [],
          messages: toLLMMessages(context, model),
          tools: yield* tools.definitions(),
        }),
      }
    })

    const runActivity = Effect.fn("SessionRunner.runActivity")(function* (
      sessionID: SessionSchema.ID,
      initialPromotion: SessionInput.Delivery | undefined,
    ) {
      let promotion = initialPromotion
      for (let step = 0; step < MAX_STEPS; step++) {
        const needsContinuation = yield* prepareProviderTurn(sessionID, promotion).pipe(Effect.flatMap(runProviderTurn))
        promotion = "steer"
        if (needsContinuation || (yield* SessionInput.hasPending(db, sessionID, "steer"))) continue
        return
      }
      return yield* new StepLimitExceededError({ sessionID, limit: MAX_STEPS })
    })

    const run = Effect.fn("SessionRunner.run")(function* (input: {
      readonly sessionID: SessionSchema.ID
      readonly force?: boolean
    }) {
      const hasSteer = yield* SessionInput.hasPending(db, input.sessionID, "steer")
      const hasQueue = hasSteer ? false : yield* SessionInput.hasPending(db, input.sessionID, "queue")
      if (input.force !== true && !hasSteer && !hasQueue) return
      yield* failInterruptedTools(input.sessionID)
      yield* runActivity(input.sessionID, hasSteer ? "steer" : hasQueue ? "queue" : undefined)
      while (yield* SessionInput.hasPending(db, input.sessionID, "queue")) yield* runActivity(input.sessionID, "queue")
    })

    return Service.of({
      run,
    })
  }),
)

export const defaultLayer = layer
