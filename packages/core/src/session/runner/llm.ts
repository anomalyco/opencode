import { LLM, LLMClient, LLMEvent } from "@opencode-ai/llm"
import { eq } from "drizzle-orm"
import { Deferred, Effect, Layer, Semaphore, Stream } from "effect"
import { Database } from "../../database/database"
import { EventV2 } from "../../event"
import { ModelV2 } from "../../model"
import { ProviderV2 } from "../../provider"
import { fromRow } from "../info"
import { SessionContext } from "../context"
import { SessionSchema } from "../schema"
import { SessionTable } from "../sql"
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
 *   - [ ] Acquire one active run for the Session; concurrent resume calls join or observe it.
 *   - [ ] Mark busy, retrying, idle, interrupted, or terminal-failure status durably.
 *   - [ ] Honor interruption and reject stale work after runtime attachment replacement.
 *   - [x] Bound model steps.
 *   - [ ] Bound provider retries and repeated identical tool calls.
 *
 * - Runtime context assembly
 *   - [x] Load Session placement and chronological projected V2 history.
 *   - [x] Resolve the selected model through `SessionRunnerModel.Service`.
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
 *   - [x] Durably admit each tool call before side effects begin.
 *   - [x] Authorize and execute admitted local calls through a core-owned registry hook.
 *   - [x] Persist typed success, failure, and provider-executed tool outcomes.
 *   - [ ] Add scoped runtime context, progress updates, output truncation, attachment normalization,
 *     plugins, and cancellation settlement.
 *   - [x] Reload projected history and start the next explicit provider turn after local tool results.
 *   - [ ] Continue for queued user input, compaction, or another continuation condition when required.
 *
 * - Post-run maintenance
 *   - [ ] Settle final status and expose durable output events to replayable consumers.
 *   - [ ] Update title, summaries, compaction state, and cleanup in bounded background work.
 *
 * Use `llm.stream(request)` for each provider turn. Do not delegate orchestration to the
 * `llm.stream({ request, tools, stopWhen })` convenience overload: that executes tools and
 * loops in memory, skipping the durable Session boundaries needed for recovery and routing.
 *
 * The current slice loads V2 history, translates it, resolves a model through a core service, and persists one
 * provider turn. Registry definitions are advertised, local tool calls are settled durably, and a
 * bounded explicit loop starts the next provider turn after local settlement.
 */
const MAX_STEPS = 25

export const layer = Layer.effect(
    Service,
    Effect.gen(function* () {
      const { db } = yield* Database.Service
      const events = yield* EventV2.Service
      const llm = yield* LLMClient.Service
      const tools = yield* ToolRegistry.Service
      const models = yield* SessionRunnerModel.Service
      const active = new Map<SessionSchema.ID, Deferred.Deferred<void, RunError>>()
      const activeLock = Semaphore.makeUnsafe(1)

      const getSession = Effect.fn("SessionRunner.getSession")(function* (sessionID: SessionSchema.ID) {
        const row = yield* db.select().from(SessionTable).where(eq(SessionTable.id, sessionID)).get().pipe(Effect.orDie)
        if (!row) return yield* Effect.die(`Session not found: ${sessionID}`)
        return fromRow(row)
      })

      const getContext = Effect.fn("SessionRunner.getContext")(function* (sessionID: SessionSchema.ID) {
        return yield* SessionContext.load(db, sessionID)
      })

      const runTurn = Effect.fn("SessionRunner.runTurn")(function* (session: SessionSchema.Info) {
        let settledLocalTool = false
        const model = yield* models.resolve(session)
        const context = yield* getContext(session.id)
        const request = LLM.request({ model, messages: toLLMMessages(context), tools: yield* tools.definitions() })
        const publishLLMEvent = createLLMEventPublisher(events, {
          sessionID: session.id,
          agent: session.agent ?? "build",
          model: {
            id: ModelV2.ID.make(model.id),
            providerID: ProviderV2.ID.make(model.provider),
            ...(session.model?.variant === undefined ? {} : { variant: session.model.variant }),
          },
        })

        yield* llm.stream(request).pipe(
          Stream.runForEach((event) =>
            Effect.gen(function* () {
              yield* publishLLMEvent(event)
              if (event.type !== "tool-call" || event.providerExecuted) return
              const result = yield* tools.execute({ sessionID: session.id, call: event })
              yield* publishLLMEvent(LLMEvent.toolResult({ id: event.id, name: event.name, result }))
              settledLocalTool = true
            }),
          ),
        )
        return settledLocalTool
      })

      return Service.of({
        run: Effect.fn("SessionRunner.run")(function* (sessionID) {
          const current = yield* activeLock.withPermit(
            Effect.gen(function* () {
              const existing = active.get(sessionID)
              if (existing) return { deferred: existing, owner: false as const }
              const deferred = yield* Deferred.make<void, RunError>()
              active.set(sessionID, deferred)
              return { deferred, owner: true as const }
            }),
          )
          if (!current.owner) return yield* Deferred.await(current.deferred)

          return yield* Effect.gen(function* () {
            const session = yield* getSession(sessionID)
            for (let step = 0; step < MAX_STEPS; step++) {
              if (!(yield* runTurn(session))) return
            }
            return yield* new StepLimitExceededError({ sessionID, limit: MAX_STEPS })
          }).pipe(
            Effect.exit,
            Effect.tap((exit) => Deferred.done(current.deferred, exit)),
            Effect.ensuring(Effect.sync(() => active.delete(sessionID))),
            Effect.flatten,
          )
        }),
      })
    }),
  )
