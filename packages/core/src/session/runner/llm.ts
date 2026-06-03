import { LLM, LLMClient, LLMEvent } from "@opencode-ai/llm"
import { Cause, DateTime, Effect, FiberSet, Layer, Semaphore, Stream } from "effect"
import { EventV2 } from "../../event"
import { ModelV2 } from "../../model"
import { ProviderV2 } from "../../provider"
import { SessionSchema } from "../schema"
import { SessionEvent } from "../event"
import { SessionStore } from "../store"
import { Service, StepLimitExceededError } from "./index"
import { createLLMEventPublisher } from "./publish-llm-event"
import { toLLMMessages } from "./to-llm-message"
import { ToolRegistry } from "../../tool-registry"
import { SessionRunnerModel } from "./model"
import { Database } from "../../database/database"
import { SessionInput } from "../input"

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
 *   - [ ] Load configured project instructions such as `AGENTS.md`, remote instructions, and
 *     nearby nested instructions discovered while files are read.
 *   - [ ] List available skills in the system prompt and expose a tool for loading skill bodies.
 *   - [ ] Resolve referenced files, directories, agents, repositories, MCP resources, and media.
 *   - [ ] Apply steering reminders, queued delivery policy, plugin transforms, and structured-output policy.
 *   - [ ] Compact or summarize history when context pressure requires it.
 *
 * - One provider turn
 *   - [x] Translate every projected V2 Session message variant into canonical
 *     `@opencode-ai/llm` messages.
 *   - [ ] Resolve policy-filtered built-in, MCP, plugin, and structured-output tool definitions.
 *   - [x] Persist one outer Turn.Started prompt watermark before provider execution begins.
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
 *   - [ ] Continue for queued delivery, compaction, or another continuation condition when required.
 *
 * - Post-run maintenance
 *   - [ ] Settle final status and expose durable output events to replayable consumers.
 *   - [ ] Coalesce streamed deltas and add covering projected-history indexes.
 *   - [ ] Update title, summaries, compaction state, and cleanup in bounded background work.
 *
 * Use `llm.stream(request)` for each provider turn. Keep tool execution and continuation here;
 * durable outer-turn watermarks preserve steering decisions and stale-attempt recovery while
 * automatic startup discovery remains a separate future slice.
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
    const db = (yield* Database.Service).db
    const getSession = Effect.fn("SessionRunner.getSession")(function* (sessionID: SessionSchema.ID) {
      const session = yield* store.get(sessionID)
      if (!session) return yield* Effect.die(`Session not found: ${sessionID}`)
      return session
    })

    const getContext = Effect.fn("SessionRunner.getContext")(function* (sessionID: SessionSchema.ID) {
      return yield* store.context(sessionID)
    })

    const hasPendingInput = (sessionID: SessionSchema.ID, deliveries?: ReadonlyArray<SessionInput.Delivery>) =>
      SessionInput.hasPending(db, sessionID, deliveries)

    const runTurn = Effect.fn("SessionRunner.runTurn")(function* (
      session: SessionSchema.Info,
      promotion: { readonly steer: boolean; readonly queueThrough?: number },
    ) {
      const model = yield* models.resolve(session)
      const settlements = yield* FiberSet.make<void, never>()
      let needsContinuation = false
      yield* SessionInput.promote(db, events, session.id, promotion)
      const context = yield* getContext(session.id)
      const request = LLM.request({ model, messages: toLLMMessages(context), tools: yield* tools.definitions() })
      const turn = yield* events.publish(SessionEvent.Turn.Started, {
        sessionID: session.id,
        timestamp: yield* DateTime.now,
      })
      const publisher = createLLMEventPublisher(events, {
        sessionID: session.id,
        agent: session.agent ?? "build",
        model: {
          id: ModelV2.ID.make(model.id),
          providerID: ProviderV2.ID.make(model.provider),
          ...(session.model?.variant === undefined ? {} : { variant: session.model.variant }),
        },
      })
      const withPublication = Semaphore.makeUnsafe(1).withPermit
      const publish = (event: LLMEvent) => withPublication(publisher.publish(event))

      const stream = yield* llm.stream(request).pipe(
        Stream.runForEach((event) =>
          Effect.gen(function* () {
            yield* publish(event)
            if (event.type !== "tool-call" || event.providerExecuted) return
            needsContinuation = true
            yield* tools.execute({ sessionID: session.id, call: event }).pipe(
              Effect.catchCause((cause) =>
                Effect.succeed({ type: "error" as const, value: String(Cause.squash(cause)) }),
              ),
              Effect.flatMap((result) => publish(LLMEvent.toolResult({ id: event.id, name: event.name, result }))),
              FiberSet.run(settlements),
            )
          }),
        ),
        Effect.ensuring(withPublication(publisher.flush())),
        Effect.exit,
      )
      const settled = yield* Effect.raceFirst(FiberSet.join(settlements), FiberSet.awaitEmpty(settlements)).pipe(
        Effect.exit,
      )
      const attempt = stream._tag === "Failure" ? stream : settled
      yield* events.publish(SessionEvent.Turn.Settled, {
        sessionID: session.id,
        timestamp: yield* DateTime.now,
        turnID: turn.id,
        outcome:
          attempt._tag === "Success" ? "completed" : Cause.hasInterruptsOnly(attempt.cause) ? "interrupted" : "failed",
      })
      if (attempt._tag === "Failure") return yield* Effect.failCause(attempt.cause)
      return needsContinuation
    }, Effect.scoped)

    const run = Effect.fn("SessionRunner.run")(function* (input: {
      readonly sessionID: SessionSchema.ID
      readonly force?: boolean
    }) {
      const session = yield* getSession(input.sessionID)
      const pending = yield* hasPendingInput(input.sessionID)
      const unsettled = input.force !== true && !pending ? (yield* store.attemptState(input.sessionID)).unsettled : false
      if (input.force !== true && !pending && !unsettled) return
      const queueThrough = yield* SessionInput.latestPendingQueueSeq(db, input.sessionID)
      let needsContinuation = input.force === true || pending || unsettled
      let promotion: { readonly steer: boolean; readonly queueThrough?: number } = {
        steer: true,
        ...(queueThrough === undefined ? {} : { queueThrough }),
      }
      for (let step = 0; step < MAX_STEPS; step++) {
        if (!needsContinuation) return
        needsContinuation = yield* runTurn(session, promotion)
        promotion = { steer: true }
        if (!needsContinuation) needsContinuation = yield* hasPendingInput(input.sessionID, ["steer"])
      }
      if (!needsContinuation) return
      return yield* new StepLimitExceededError({ sessionID: input.sessionID, limit: MAX_STEPS })
    })

    return Service.of({
      run,
    })
  }),
)
