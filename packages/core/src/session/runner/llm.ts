export * as SessionRunnerLLM from "./llm"

import {
  LLM,
  LLMClient,
  LLMError,
  LLMEvent,
  Message,
  SystemPart,
  isContextOverflowFailure,
  type ProviderErrorEvent,
} from "@opencode-ai/llm"
import { SessionError } from "@opencode-ai/schema/session-error"
import { Cause, Effect, Exit, Fiber, FiberSet, Layer, Option, Semaphore, Stream } from "effect"
import { AgentV2 } from "../../agent"
import { Config } from "../../config"
import { Database } from "../../database/database"
import { EventV2 } from "../../event"
import { Location } from "../../location"
import { ModelV2 } from "../../model"
import { PermissionV2 } from "../../permission"
import { Instructions } from "../../instructions/index"
import { InstructionBuiltIns } from "../../instructions/builtins"
import { InstructionDiscovery } from "../../instruction-discovery"
import { SkillGuidance } from "../../skill/guidance"
import { ReferenceGuidance } from "../../reference/guidance"
import { McpGuidance } from "../../mcp/guidance"
import { InstructionEntry } from "../instruction-entry"
import { QuestionTool } from "../../tool/question"
import { ToolRegistry } from "../../tool/registry"
import { ToolOutputStore } from "../../tool-output-store"
import { InstructionCheckpoint } from "../instruction-checkpoint"
import { SessionCompaction } from "../compaction"
import { SessionEvent } from "../event"
import { SessionHistory } from "../history"
import { SessionInput } from "../input"
import { SessionMessage } from "../message"
import { SessionSchema } from "../schema"
import { SessionStore } from "../store"
import { SessionTitle } from "../title"
import { Service } from "./index"
import { SessionRunnerModel } from "./model"
import { createLLMEventPublisher } from "./publish-llm-event"
import { toLLMMessages } from "./to-llm-message"
import { MAX_STEPS_PROMPT } from "./max-steps"
import { SessionRunnerSystemPrompt } from "./system-prompt"
import { Snapshot } from "../../snapshot"
import { makeLocationNode } from "../../effect/app-node"
import { llmClient } from "../../effect/app-node-platform"
import { StepFailedError, UserInterruptedError } from "../error"
import { toSessionError } from "../to-session-error"
import { SessionRunnerRetry } from "./retry"
import type { SessionHooks } from "@opencode-ai/plugin/v2/effect/session"
import { PluginHooks } from "../../plugin/hooks"

type StepTokens = {
  readonly input: number
  readonly output: number
  readonly reasoning: number
  readonly cache: { readonly read: number; readonly write: number }
}

// TODO(#35765): Use Copilot's reported billed amount once billing has a dedicated typed runtime contract.
export function calculateCost(costs: ModelV2.Info["cost"], tokens: StepTokens) {
  const context = tokens.input + tokens.cache.read + tokens.cache.write
  const tier = costs
    .filter((cost) => cost.tier?.type === "context" && context > cost.tier.size)
    .toSorted((a, b) => (b.tier?.size ?? 0) - (a.tier?.size ?? 0))[0]
  const cost = tier ?? costs.find((cost) => cost.tier === undefined)
  if (!cost) return 0
  return (
    (tokens.input * cost.input +
      (tokens.output + tokens.reasoning) * cost.output +
      tokens.cache.read * cost.cache.read +
      tokens.cache.write * cost.cache.write) /
    1_000_000
  )
}

/**
 * Runs one durable coding-agent Session until it settles.
 *
 * Keep this as orchestration over smaller collaborators rather than rebuilding the legacy
 * `SessionPrompt` monolith. Implement the unchecked items in small reviewed slices:
 *
 * - Session ownership and controls
 *   - [x] Coordinate one local active drain per Session; explicit resumes join and prompt wakeups coalesce.
 *   - [ ] Replace local ownership with durable multi-node ownership when clustered.
 *   - [x] Publish durable historical execution lifecycle and bounded retry observations.
 *   - [ ] Honor interruption and reject stale work after runtime attachment replacement.
 *   - [x] Honor optional agent step limits.
 *   - [ ] Bound repeated identical tool calls (provider retries are bounded).
 *
 * - Runtime context assembly
 *   - Track V1 runtime-context parity canonically in `specs/v2/session.md`.
 *
 * - One step
 *   - [x] Translate every projected V2 Session message variant into canonical
 *     `@opencode-ai/llm` messages.
 *   - [ ] Resolve policy-filtered built-in, MCP, plugin, and structured-output tool definitions.
 *   - [x] Stream exactly one `llm.stream(request)` call per attempt.
 *   - [x] Persist assistant text and usage events incrementally as they arrive.
 *   - [ ] Persist snapshots, patches, and retry notices incrementally as they arrive.
 *   - [x] Persist reasoning, provider errors, and tool-call events incrementally as they arrive.
 *
 * - Tool settlement and continuation
 *   - [x] Durably record each tool call before side effects begin.
 *   - [x] Authorize and execute recorded local calls through a core-owned registry hook.
 *   - [x] Persist typed success, failure, and provider-executed tool outcomes.
 *   - [x] Start each recorded local call eagerly and await all settlements before continuation.
 *   - [ ] Add scoped runtime context, progress updates, attachment normalization,
 *     plugins, and cancellation settlement.
 *   - [x] Reload projected history and start the next explicit step after local tool results.
 *   - [x] Continue for durable user steering accepted during an active step.
 *   - [ ] Continue for compaction or another continuation condition when required.
 *
 * - Post-run maintenance
 *   - [ ] Settle final status and expose durable output events to replayable consumers.
 *   - [ ] Coalesce streamed deltas and add covering projected-history indexes.
 *   - [ ] Update title, summaries, compaction state, and cleanup in bounded background work.
 *
 * Use `llm.stream(request)` for each attempt. Keep tool execution and continuation here.
 * Durable continuation recovery remains a separate future slice with an explicit retry policy.
 *
 * The current slice loads V2 history, translates it, resolves a model through a core service, and persists one
 * step. Registry definitions are advertised, local tool calls are settled durably, and an
 * explicit loop starts the next step after local settlement. Configured agent step limits bound the loop.
 */

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const events = yield* EventV2.Service
    const llm = yield* LLMClient.Service
    const agents = yield* AgentV2.Service
    const tools = yield* ToolRegistry.Service
    const hooks = yield* PluginHooks.Service
    const models = yield* SessionRunnerModel.Service
    const store = yield* SessionStore.Service
    const location = yield* Location.Service
    const builtins = yield* InstructionBuiltIns.Service
    const discovery = yield* InstructionDiscovery.Service
    const skillGuidance = yield* SkillGuidance.Service
    const referenceGuidance = yield* ReferenceGuidance.Service
    const mcpGuidance = yield* McpGuidance.Service
    const entries = yield* InstructionEntry.Service
    const snapshots = yield* Snapshot.Service
    const db = (yield* Database.Service).db
    const compaction = yield* SessionCompaction.Service
    const title = yield* SessionTitle.Service
    // Title generation is a side effect of the first step; it must not delay step continuation.
    // Tracked per process so repeated wakes before the second user message arrives don't
    // re-fire a redundant LLM call; `SessionTitle` itself is idempotent based on durable history.
    const titleAttempted = new Set<SessionSchema.ID>()
    const forkTitle = yield* FiberSet.makeRuntime<never, void, never>()
    const getSession = Effect.fn("SessionRunner.getSession")(function* (sessionID: SessionSchema.ID) {
      const session = yield* store.get(sessionID)
      if (!session) return yield* Effect.die(new Error(`Session not found: ${sessionID}`))
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
            assistantMessageID: message.id,
            callID: tool.id,
            error: { type: "tool.stale", message: `Tool execution interrupted: ${tool.name}` },
            executed: tool.executed === true,
          })
        }
      }
    })

    // Declining an interactive prompt halts the drain instead of becoming model-facing tool output.
    const isUserDeclined = (cause: Cause.Cause<unknown>) =>
      cause.reasons.some(
        (reason) =>
          Cause.isDieReason(reason) &&
          (reason.defect instanceof PermissionV2.DeclinedError || reason.defect instanceof QuestionTool.CancelledError),
      )

    const loadInstructions = (agent: AgentV2.Selection, sessionID: SessionSchema.ID) =>
      Effect.all(
        [
          builtins.load(),
          discovery.load(),
          skillGuidance.load(agent),
          referenceGuidance.load(),
          mcpGuidance.load(agent),
          entries.load(sessionID),
        ],
        { concurrency: "unbounded" },
      ).pipe(Effect.map(Instructions.combine))

    const attemptStep = Effect.fn("SessionRunner.attemptStep")(function* (
      sessionID: SessionSchema.ID,
      promotion: SessionInput.Delivery | undefined,
      step: number,
      recoverOverflow?: typeof compaction.compactAfterOverflow,
      assistantMessageID?: SessionMessage.ID,
    ) {
      const session = yield* getSession(sessionID)
      if (session.location.directory !== location.directory || session.location.workspaceID !== location.workspaceID)
        return yield* Effect.interrupt
      const agent = yield* agents.select(session.agent)
      // Establish what the model knows before admitting what the user said, so
      // a blocked first step leaves pending inputs untouched.
      const checkpoint = yield* InstructionCheckpoint.prepare(
        db,
        events,
        loadInstructions(agent, session.id),
        session.id,
      )
      const toolFibers = yield* FiberSet.make<void, ToolOutputStore.Error | UserInterruptedError>()
      const ownedToolFibers: Array<Fiber.Fiber<void, ToolOutputStore.Error | UserInterruptedError>> = []
      let needsContinuation = false
      let currentStep = step
      if (promotion) {
        let promoted = 0
        if (promotion === "steer") promoted = yield* SessionInput.promoteSteers(db, events, session.id)
        if (promotion === "queue") {
          promoted += Number(yield* SessionInput.promoteNextQueued(db, events, session.id))
          promoted += yield* SessionInput.promoteSteers(db, events, session.id)
        }
        if (promoted > 0) currentStep = 1
      }
      const resolved = yield* models.resolve(session)
      const model = resolved.model
      const entries = yield* SessionHistory.entriesForRunner(db, session.id, checkpoint.baselineSeq)
      const context = entries.map((entry) => entry.message)
      const isLastStep = agent.info?.steps !== undefined && currentStep >= agent.info.steps
      const toolMaterialization = isLastStep
        ? undefined
        : yield* tools.materialize({ permissions: agent.info?.permissions, model })
      const promptCacheKey = /^ses_[0-9a-f]{64}$/.test(session.id) ? session.id.slice(4) : session.id
      const request = LLM.request({
        model,
        providerOptions: { openai: { promptCacheKey } },
        system: [
          agent.info?.system ? agent.info.system : SessionRunnerSystemPrompt.provider(model),
          checkpoint.baseline,
        ]
          .filter((part): part is string => part !== undefined && part.length > 0)
          .map(SystemPart.make),
        messages: [
          ...toLLMMessages(context, resolved.ref),
          ...(isLastStep ? [Message.assistant(MAX_STEPS_PROMPT)] : []),
        ],
        tools: toolMaterialization?.definitions ?? [],
        toolChoice: isLastStep ? "none" : undefined,
      })
      const availableTools = new Map(request.tools.map((tool) => [tool.name, tool]))
      const requestEvent: SessionHooks["request"] = {
        sessionID: session.id,
        agent: agent.id,
        model: resolved.ref,
        system: [...request.system],
        messages: [...request.messages],
        tools: Object.fromEntries(
          request.tools.map((tool) => [tool.name, { description: tool.description, input: { ...tool.inputSchema } }]),
        ),
      }
      // Plugins may reshape the draft, but cannot advertise tools excluded earlier
      // by permissions or registration state.
      yield* hooks.trigger("session", "request", requestEvent)
      const hookedRequest = LLM.updateRequest(request, {
        system: requestEvent.system,
        messages: requestEvent.messages,
        tools: Object.entries(requestEvent.tools).flatMap(([name, tool]) => {
          const registered = availableTools.get(name)
          if (!registered) return []
          return [{ ...registered, description: tool.description, inputSchema: tool.input }]
        }),
      })
      const advertisedTools = new Set(hookedRequest.tools.map((tool) => tool.name))
      // Automatic compaction completed; rebuild the request from compacted history.
      if (
        !(yield* SessionInput.pendingCompaction(db, session.id)) &&
        (yield* compaction.compactIfNeeded({ sessionID: session.id, messages: context, request: hookedRequest }))
      )
        return { _tag: "RestartAfterCompaction", step: currentStep } as const
      const startSnapshot = yield* snapshots.capture()
      const publisher = createLLMEventPublisher(events, {
        sessionID: session.id,
        agent: agent.id,
        // The selected catalog identity, not model.id: route-level ids are provider API
        // model ids (for example gpt-5.5-fast resolves to api id gpt-5.5).
        model: resolved.ref,
        provider: model.provider,
        snapshot: startSnapshot,
        assistantMessageID,
      })
      const publication = Semaphore.makeUnsafe(1)
      // Durable publishes are serialized so tool fibers and step settlement never interleave
      // mid-event.
      const serialized = <A, E, R>(effect: Effect.Effect<A, E, R>) => publication.withPermit(effect)
      const publish = (event: LLMEvent, outputPaths: ReadonlyArray<string> = [], error?: SessionError.Error) =>
        serialized(publisher.publish(event, outputPaths, error))
      let overflowFailure: ProviderErrorEvent | undefined
      const providerStream = llm.stream(hookedRequest).pipe(
        Stream.runForEach((event) =>
          Effect.gen(function* () {
            if (overflowFailure || publisher.hasProviderError()) return
            if (LLMEvent.is.providerError(event)) {
              if (isContextOverflowFailure(event) && !publisher.hasRetryEvidence()) {
                overflowFailure = event
                return
              }
            }
            yield* publish(event)
            if (event.type !== "tool-call" || event.providerExecuted) return
            if (!toolMaterialization || !advertisedTools.has(event.name)) {
              yield* serialized(
                publisher.failUnsettledTools({
                  type: "tool.execution",
                  message: `Tool is not available for this request: ${event.name}`,
                }),
              )
              return
            }
            needsContinuation = true
            const assistantMessageID = yield* publisher.assistantMessageID(event.id)
            ownedToolFibers.push(
              yield* Effect.uninterruptibleMask((restore) =>
                restore(
                  toolMaterialization.settle({
                    sessionID: session.id,
                    agent: agent.id,
                    assistantMessageID,
                    call: event,
                  }),
                ).pipe(
                  Effect.flatMap((settlement) =>
                    publish(
                      LLMEvent.toolResult({
                        id: event.id,
                        name: event.name,
                        result: settlement.result,
                        output: settlement.output,
                      }),
                      settlement.outputPaths ?? [],
                      settlement.error,
                    ).pipe(
                      Effect.andThen(
                        settlement.error?.type === "permission.rejected"
                          ? serialized(publisher.failAssistant(settlement.error)).pipe(
                              Effect.andThen(Effect.fail(new UserInterruptedError())),
                            )
                          : Effect.void,
                      ),
                    ),
                  ),
                ),
              ).pipe(FiberSet.run(toolFibers)),
            )
          }),
        ),
        Effect.ensuring(serialized(publisher.flush())),
      )

      const stepUsage = (settlement: NonNullable<ReturnType<typeof publisher.stepSettlement>>) => ({
        cost: calculateCost(resolved.cost, settlement.tokens),
        tokens: settlement.tokens,
      })

      // Captures the end snapshot, diffs it against the step's start, and durably ends the
      // assistant step.
      const publishStepEnd = (settlement: NonNullable<ReturnType<typeof publisher.stepSettlement>>) =>
        Effect.gen(function* () {
          const endSnapshot = yield* snapshots.capture()
          const files =
            startSnapshot && endSnapshot
              ? yield* snapshots
                  .files({ from: startSnapshot, to: endSnapshot })
                  .pipe(Effect.catch(() => Effect.succeed(undefined)))
              : undefined
          yield* serialized(
            events.publish(SessionEvent.Step.Ended, {
              sessionID: session.id,
              assistantMessageID: yield* publisher.startAssistant(),
              finish: settlement.finish,
              ...stepUsage(settlement),
              snapshot: endSnapshot,
              files,
            }),
          )
        })

      return yield* Effect.uninterruptibleMask((restore) =>
        Effect.gen(function* () {
          // Gather the evidence: how did the provider stream end?
          const stream = yield* restore(providerStream).pipe(Effect.exit)
          const streamFailure = Option.getOrUndefined(Exit.findErrorOption(stream))
          // Note: Exit.hasInterrupts is a type guard whose false branch unsoundly narrows
          // away non-interrupt failures, so both interrupt checks stay Cause-based.
          const streamInterrupted = stream._tag === "Failure" && Cause.hasInterrupts(stream.cause)

          // A context overflow before any assistant output is recoverable: compact and
          // restart the step instead of surfacing the provider error.
          if (
            recoverOverflow &&
            !publisher.hasRetryEvidence() &&
            isContextOverflowFailure(overflowFailure ?? streamFailure) &&
            (yield* restore(recoverOverflow({ sessionID: session.id, messages: context, request })))
          )
            return { _tag: "RestartAfterOverflowCompaction", step: currentStep } as const

          // An unrecovered held-back overflow becomes the step's durable provider error. A
          // thrown LLM failure records the assistant failure unless a provider error was
          // already recorded from the stream. Terminal publication waits for owned tools.
          if (overflowFailure) yield* publish(overflowFailure)
          const llmFailure = streamFailure instanceof LLMError ? streamFailure : undefined
          if (llmFailure && !publisher.hasProviderError()) {
            const error = toSessionError(llmFailure)
            if (
              SessionRunnerRetry.isRetryable(llmFailure) &&
              !publisher.hasRetryEvidence() &&
              (agent.info?.steps === undefined || currentStep < agent.info.steps)
            ) {
              return yield* new SessionRunnerRetry.RetryableFailure({
                cause: llmFailure,
                assistantMessageID: yield* publisher.startAssistant(),
                error,
                step: currentStep,
              })
            }
            yield* serialized(publisher.failAssistant(error))
          }
          // Provider error events only arrive from the stream, so the flag is final here.
          const providerFailed = publisher.hasProviderError()

          // Settle every owned tool fiber. FiberSet.join returns on the first failure, so retain
          // the individual fibers and await all exits before publishing the terminal step event.
          if (streamInterrupted) yield* FiberSet.clear(toolFibers)
          const settled = yield* restore(
            Effect.forEach(ownedToolFibers, Fiber.await, { concurrency: "unbounded" }),
          ).pipe(Effect.exit)
          const settledCauses =
            settled._tag === "Failure"
              ? [settled.cause]
              : settled.value.flatMap((exit) => (exit._tag === "Failure" ? [exit.cause] : []))
          const toolsInterrupted = settledCauses.some(Cause.hasInterrupts)
          const userDeclined = settledCauses.some(isUserDeclined)
          const permissionRejected = settledCauses.some(
            (cause) => Option.getOrUndefined(Cause.findErrorOption(cause)) instanceof UserInterruptedError,
          )

          if (userDeclined || permissionRejected || streamInterrupted || toolsInterrupted) {
            yield* FiberSet.clear(toolFibers)
            yield* serialized(publisher.failUnsettledTools({ type: "aborted", message: "Tool execution interrupted" }))
            yield* serialized(publisher.failAssistant({ type: "aborted", message: "Step interrupted" }))
          }
          // A settled tool fiber failure is one of two things. A defect from a tool
          // implementation becomes a failed tool call the model can read, and the step still
          // settles so the model may recover. A typed infrastructure failure (tool output
          // could not be persisted) also fails the assistant and then fails the drain.
          const settledFailure = settledCauses.find(
            (cause) => !Cause.hasInterrupts(cause) && !isUserDeclined(cause) && !permissionRejected,
          )
          const infraError =
            settledFailure === undefined ? undefined : Option.getOrUndefined(Cause.findErrorOption(settledFailure))
          if (settledFailure !== undefined) {
            const failure = infraError ?? Cause.squash(settledFailure)
            const error = toSessionError(failure)
            yield* serialized(publisher.failUnsettledTools(error))
            if (infraError !== undefined) yield* serialized(publisher.failAssistant(error))
          }

          // Fail unresolved calls before the terminal step event. Local calls have joined, so
          // these sweeps only close calls that could not produce a truthful settlement.
          if (providerFailed)
            yield* serialized(publisher.failUnsettledTools({ type: "aborted", message: "Tool execution interrupted" }))
          if (llmFailure && !providerFailed)
            yield* serialized(
              publisher.failUnsettledTools(
                {
                  type: "tool.result-missing",
                  message: "Provider did not return a tool result",
                },
                true,
              ),
            )
          const hostedResultMissing =
            stream._tag === "Success" && !providerFailed
              ? yield* serialized(
                  publisher.failUnsettledTools(
                    { type: "tool.result-missing", message: "Provider did not return a tool result" },
                    true,
                  ),
                )
              : false
          if (hostedResultMissing && !publisher.stepSettlement())
            yield* serialized(
              publisher.failAssistant({
                type: "tool.result-missing",
                message: "Provider did not return a tool result",
              }),
            )

          const stepFailure = publisher.stepFailure()
          const stepSettlement = publisher.stepSettlement()
          const stepEndedCleanly =
            !streamInterrupted && !toolsInterrupted && infraError === undefined && !providerFailed && !stepFailure
          if (stepSettlement && stepEndedCleanly) yield* publishStepEnd(stepSettlement)
          if (stepFailure)
            yield* serialized(publisher.publishStepFailure(stepSettlement ? stepUsage(stepSettlement) : undefined))

          if (stream._tag === "Failure") return yield* Effect.failCause(stream.cause)
          if (userDeclined) return yield* Effect.interrupt
          if (permissionRejected) return yield* new UserInterruptedError()
          if ((toolsInterrupted || infraError !== undefined) && settledFailure)
            return yield* Effect.failCause(settledFailure)
          if (toolsInterrupted && settled._tag === "Failure") return yield* Effect.failCause(settled.cause)
          if (stepFailure) return yield* new StepFailedError({ error: stepFailure })
          return {
            _tag: "Completed",
            needsContinuation: !providerFailed && needsContinuation,
            step: currentStep,
          } as const
        }),
      )
    }, Effect.scoped)

    const runStep = Effect.fnUntraced(function* (
      sessionID: SessionSchema.ID,
      promotion: SessionInput.Delivery | undefined,
      step: number,
    ) {
      // Compaction restarts rebuild the request from compacted history without re-promoting.
      // Overflow recovery is one-shot: a post-compaction attempt must not recover another
      // overflow, so the recovery hook is dropped after it fires.
      let recoverOverflow: typeof compaction.compactAfterOverflow | undefined = compaction.compactAfterOverflow
      let currentPromotion = promotion
      let currentStep = step
      let assistantMessageID: SessionMessage.ID | undefined
      while (true) {
        const attempt = yield* Effect.suspend(() =>
          attemptStep(sessionID, currentPromotion, currentStep, recoverOverflow, assistantMessageID),
        ).pipe(
          Effect.tapError((error) =>
            error instanceof SessionRunnerRetry.RetryableFailure
              ? Effect.sync(() => {
                  currentStep = error.step + 1
                  assistantMessageID = error.assistantMessageID
                  currentPromotion = undefined
                })
              : Effect.void,
          ),
          Effect.retryOrElse(SessionRunnerRetry.schedule(events, sessionID), (error) => {
            if (!(error instanceof SessionRunnerRetry.RetryableFailure)) return Effect.fail(error)
            return events
              .publish(SessionEvent.Step.Failed, {
                sessionID,
                assistantMessageID: error.assistantMessageID,
                error: error.error,
              })
              .pipe(Effect.andThen(Effect.fail(error.cause)))
          }),
        )
        if (attempt._tag === "Completed") return { needsContinuation: attempt.needsContinuation, step: attempt.step }
        if (attempt._tag === "RestartAfterOverflowCompaction") recoverOverflow = undefined
        yield* Effect.yieldNow
        currentPromotion = undefined
        currentStep = attempt.step
      }
    })

    const runPendingCompaction = Effect.fn("SessionRunner.runPendingCompaction")(function* (
      sessionID: SessionSchema.ID,
    ) {
      const pending = yield* SessionInput.pendingCompaction(db, sessionID)
      if (!pending) return false
      const session = yield* getSession(sessionID)
      return yield* Effect.uninterruptibleMask((restore) =>
        Effect.gen(function* () {
          const compacted = yield* restore(
            Effect.gen(function* () {
              return yield* compaction.compactManual({
                session,
                messages: yield* store.context(sessionID),
              })
            }),
          ).pipe(Effect.exit)
          if (Exit.isSuccess(compacted) && compacted.value) return true
          yield* events.publish(SessionEvent.Compaction.Failed, { sessionID })
          if (Exit.isFailure(compacted)) return yield* Effect.failCause(compacted.cause)
          return true
        }),
      )
    })

    // Execution lifecycle is published per busy period by SessionExecution, not per drain here.
    const drain = Effect.fn("SessionRunner.drain")(function* (input: {
      readonly sessionID: SessionSchema.ID
      readonly force: boolean
    }) {
      yield* runPendingCompaction(input.sessionID)
      const hasSteer = yield* SessionInput.hasPending(db, input.sessionID, "steer")
      const hasQueue = hasSteer ? false : yield* SessionInput.hasPending(db, input.sessionID, "queue")
      if (!input.force && !hasSteer && !hasQueue) return
      yield* failInterruptedTools(input.sessionID)
      let promotion: SessionInput.Delivery | undefined = hasSteer ? "steer" : hasQueue ? "queue" : undefined
      let shouldRun = input.force || hasSteer || hasQueue
      while (shouldRun) {
        let needsContinuation = true
        let step = 1
        // Repeat steps while continuation is needed. A step needs continuation only
        // when it recorded local tool calls whose results the model has not yet seen;
        // a provider error suppresses it. Pending steers also continue the loop so
        // interjections are answered before the session goes idle.
        while (needsContinuation) {
          const result = yield* runStep(input.sessionID, promotion, step)
          // Steer/queue promotion inside runStep has already made the pending input a visible
          // user message by this point, so the first-user-message check below is reliable.
          if (!titleAttempted.has(input.sessionID)) {
            titleAttempted.add(input.sessionID)
            forkTitle(title.generateForFirstPrompt(yield* getSession(input.sessionID)).pipe(Effect.ignore))
          }
          needsContinuation = result.needsContinuation
          step = result.step + 1
          if (needsContinuation) {
            promotion = (yield* SessionInput.pendingCompaction(db, input.sessionID)) ? undefined : "steer"
            continue
          }
          yield* runPendingCompaction(input.sessionID)
          promotion = "steer"
          needsContinuation = yield* SessionInput.hasPending(db, input.sessionID, "steer")
        }
        yield* runPendingCompaction(input.sessionID)
        const hasSteer = yield* SessionInput.hasPending(db, input.sessionID, "steer")
        const hasQueue = hasSteer ? false : yield* SessionInput.hasPending(db, input.sessionID, "queue")
        shouldRun = hasSteer || hasQueue
        promotion = hasSteer ? "steer" : hasQueue ? "queue" : undefined
      }
    })

    return Service.of({ drain })
  }),
)

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [
    EventV2.node,
    llmClient,
    AgentV2.node,
    ToolRegistry.node,
    PluginHooks.node,
    SessionRunnerModel.node,
    SessionStore.node,
    Location.node,
    InstructionBuiltIns.node,
    InstructionDiscovery.node,
    SkillGuidance.node,
    ReferenceGuidance.node,
    McpGuidance.node,
    InstructionEntry.node,
    SessionCompaction.node,
    SessionTitle.node,
    Config.node,
    Snapshot.node,
    Database.node,
  ],
})
