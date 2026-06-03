import { LLM, LLMClient, LLMEvent } from "@opencode-ai/llm"
import { Cause, Deferred, Effect, FiberSet, Layer, Ref, Semaphore, Stream } from "effect"
import { EventV2 } from "../../event"
import { ModelV2 } from "../../model"
import { ProviderV2 } from "../../provider"
import { SessionSchema } from "../schema"
import { SessionStore } from "../store"
import { Service, StepLimitExceededError, type RunError } from "./index"
import { createLLMEventPublisher } from "./publish-llm-event"
import { toLLMMessages } from "./to-llm-message"
import { ToolRegistry } from "../../tool-registry"
import { SessionRunnerModel } from "./model"

/**
 * Runs one durable coding-agent Session until it settles.
 *
 * Keep this as orchestration over smaller collaborators rather than rebuilding the legacy
 * `SessionPrompt` monolith. Implement the unchecked items in small reviewed slices:
 *
 * - Session ownership and controls
 *   - [x] Acquire one local active run for the Session; concurrent resume calls join it.
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
 *   - [ ] Apply reminders, queued user steering, plugin transforms, and structured-output policy.
 *   - [ ] Compact or summarize history when context pressure requires it.
 *
 * - One provider turn
 *   - [x] Translate every projected V2 Session message variant into canonical
 *     `@opencode-ai/llm` messages.
 *   - [ ] Resolve policy-filtered built-in, MCP, plugin, and structured-output tool definitions.
 *   - [ ] Create one durable assistant step before provider execution begins.
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
 *   - [ ] Continue for queued user input, compaction, or another continuation condition when required.
 *
 * - Post-run maintenance
 *   - [ ] Settle final status and expose durable output events to replayable consumers.
 *   - [ ] Coalesce streamed deltas and add covering projected-history indexes.
 *   - [ ] Update title, summaries, compaction state, and cleanup in bounded background work.
 *
 * Use `llm.stream(request)` for each provider turn. Keep tool execution and continuation here
 * so every Session boundary remains durable for recovery and routing.
 *
 * The current slice loads V2 history, translates it, resolves a model through a core service, and persists one
 * provider turn. Registry definitions are advertised, local tool calls are settled durably, and a
 * bounded explicit loop starts the next provider turn after local settlement.
 */
const MAX_STEPS = 25

export const layer = Layer.effect(
    Service,
    Effect.gen(function* () {
      const events = yield* EventV2.Service
      const llm = yield* LLMClient.Service
      const tools = yield* ToolRegistry.Service
      const models = yield* SessionRunnerModel.Service
      const store = yield* SessionStore.Service
      type ActiveRun = Deferred.Deferred<void, RunError>
      type Ownership = { readonly deferred: ActiveRun; readonly owner: boolean }
      const active = yield* Ref.make(new Map<SessionSchema.ID, ActiveRun>())

      const getSession = Effect.fn("SessionRunner.getSession")(function* (sessionID: SessionSchema.ID) {
        const session = yield* store.get(sessionID)
        if (!session) return yield* Effect.die(`Session not found: ${sessionID}`)
        return session
      })

      const getContext = Effect.fn("SessionRunner.getContext")(function* (sessionID: SessionSchema.ID) {
        return yield* store.context(sessionID)
      })

      const runTurn = Effect.fn("SessionRunner.runTurn")(function* (session: SessionSchema.Info) {
        const model = yield* models.resolve(session)
        return yield* Effect.gen(function* () {
            const settlements = yield* FiberSet.make<void>()
            let settledLocalTool = false
            const context = yield* getContext(session.id)
            const request = LLM.request({ model, messages: toLLMMessages(context), tools: yield* tools.definitions() })
            const publisher = createLLMEventPublisher(events, {
              sessionID: session.id,
              agent: session.agent ?? "build",
              model: {
                id: ModelV2.ID.make(model.id),
                providerID: ProviderV2.ID.make(model.provider),
                ...(session.model?.variant === undefined ? {} : { variant: session.model.variant }),
              },
            })
            const publication = Semaphore.makeUnsafe(1)
            const publish = (event: LLMEvent) => publication.withPermit(publisher.publish(event))

             yield* llm.stream(request).pipe(
               Stream.runForEach((event) =>
                Effect.gen(function* () {
                   yield* publish(event)
                   if (event.type !== "tool-call" || event.providerExecuted) return
                   settledLocalTool = true
                   yield* tools.execute({ sessionID: session.id, call: event }).pipe(
                       Effect.catchCause((cause) =>
                         Effect.succeed({ type: "error" as const, value: String(Cause.squash(cause)) }),
                       ),
                       Effect.flatMap((result) => publish(LLMEvent.toolResult({ id: event.id, name: event.name, result }))),
                       FiberSet.run(settlements, { startImmediately: true }),
                     )
                 }),
               ),
               Effect.ensuring(publication.withPermit(publisher.flushText())),
             )
             yield* FiberSet.awaitEmpty(settlements)
             return settledLocalTool
        })
      }, Effect.scoped)

      const runOwned = Effect.fn("SessionRunner.runOwned")(function* (sessionID: SessionSchema.ID) {
        const session = yield* getSession(sessionID)
        for (let step = 0; step < MAX_STEPS; step++) {
          if (!(yield* runTurn(session))) return
        }
        return yield* new StepLimitExceededError({ sessionID, limit: MAX_STEPS })
      })

      return Service.of({
        run: Effect.fn("SessionRunner.run")(function* (sessionID) {
          return yield* Effect.uninterruptibleMask((restore) =>
            Effect.gen(function* () {
              const deferred = yield* Deferred.make<void, RunError>()
              const current = yield* Ref.modify(active, (active): readonly [Ownership, Map<SessionSchema.ID, ActiveRun>] => {
                const existing = active.get(sessionID)
                if (existing) return [{ deferred: existing, owner: false as const }, active]
                return [{ deferred, owner: true as const }, new Map(active).set(sessionID, deferred)]
              })
              if (!current.owner) return yield* restore(Deferred.await(current.deferred))

              const exit = yield* restore(runOwned(sessionID)).pipe(Effect.exit)
              yield* Ref.update(active, (active) => {
                if (active.get(sessionID) !== current.deferred) return active
                const next = new Map(active)
                next.delete(sessionID)
                return next
              })
              yield* Deferred.done(current.deferred, exit)
              return yield* exit
            }),
          )
        }),
      })
    }),
  )
