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
import { Cause, DateTime, Duration, Effect, FiberSet, Layer, Option, Semaphore, Stream } from "effect"
import { AgentV2 } from "../../agent"
import { Config } from "../../config"
import { Database } from "../../database/database"
import { EventV2 } from "../../event"
import { Location } from "../../location"
import { ModelV2 } from "../../model"
import { PermissionV2 } from "../../permission"
import { ProviderV2 } from "../../provider"
import { QuestionV2 } from "../../question"
import { SystemContext } from "../../system-context/index"
import { SystemContextRegistry } from "../../system-context/registry"
import { SkillGuidance } from "../../skill/guidance"
import { ReferenceGuidance } from "../../reference/guidance"
import { ToolRegistry } from "../../tool/registry"
import { ToolOutputStore } from "../../tool-output-store"
import { SessionContextEpoch } from "../context-epoch"
import { SessionCompaction } from "../compaction"
import { SessionEvent } from "../event"
import { SessionHistory } from "../history"
import { SessionInput } from "../input"
import { SessionMessage } from "../message"
import { Prompt } from "../prompt"
import { SessionSchema } from "../schema"
import { SessionStore } from "../store"
import { type ReflectionResult, type RunError, Service } from "./index"
import { SessionRunnerModel } from "./model"
import { createLLMEventPublisher } from "./publish-llm-event"
import { toLLMMessages } from "./to-llm-message"
import { MAX_STEPS_PROMPT } from "./max-steps"
import { containsHedge } from "./hedge"
import { ReflectionState } from "./reflection-state"
import { Snapshot } from "../../snapshot"
import { makeLocationNode } from "../../effect/app-node"
import { llmClient } from "../../effect/app-node-platform"

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
 *   - [x] Honor optional agent step limits.
 *   - [ ] Bound provider retries and repeated identical tool calls.
 *
 * - Runtime context assembly
 *   - Track V1 runtime-context parity canonically in `specs/v2/session.md`.
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
 *   - [ ] Add scoped runtime context, progress updates, attachment normalization,
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
 * Use `llm.stream(request)` for each provider turn. Keep tool execution and continuation here.
 * Durable continuation recovery remains a separate future slice with an explicit retry policy.
 *
 * The current slice loads V2 history, translates it, resolves a model through a core service, and persists one
 * provider turn. Registry definitions are advertised, local tool calls are settled durably, and an
 * explicit loop starts the next provider turn after local settlement. Configured agent step limits bound the loop.
 */

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const events = yield* EventV2.Service
    const llm = yield* LLMClient.Service
    const agents = yield* AgentV2.Service
    const tools = yield* ToolRegistry.Service
    const models = yield* SessionRunnerModel.Service
    const store = yield* SessionStore.Service
    const location = yield* Location.Service
    const systemContext = yield* SystemContextRegistry.Service
    const skillGuidance = yield* SkillGuidance.Service
    const referenceGuidance = yield* ReferenceGuidance.Service
    const config = yield* Config.Service
    const snapshots = yield* Snapshot.Service
    const db = (yield* Database.Service).db
    const configEntries = yield* config.entries()
    const compaction = SessionCompaction.make({ events, llm, config: configEntries })
    const reflectiveReasoning = Config.latest(configEntries, "reflective_reasoning")
    const maxReflectionBudget = Math.max(0, reflectiveReasoning?.maxReflectionBudget ?? 1)
    const approxTcaTolerance = Math.max(0, reflectiveReasoning?.approxTcaTolerance ?? 0)
    const preActionProjection = reflectiveReasoning?.preActionProjection ?? true
    const reflectionTimeout = Duration.millis(reflectiveReasoning?.reflectionTimeoutMs ?? 120_000)
    const streamIdleTimeout = Duration.millis(Config.latest(configEntries, "stream_idle_timeout_ms") ?? 300_000)
    const streamIdleGapThreshold = 5_000
    const getSession = Effect.fn("SessionRunner.getSession")(function* (sessionID: SessionSchema.ID) {
      const session = yield* store.get(sessionID)
      if (!session) return yield* Effect.die(`Session not found: ${sessionID}`)
      return session
    })

    const getContext = Effect.fn("SessionRunner.getContext")(function* (sessionID: SessionSchema.ID) {
      return yield* store.context(sessionID)
    })
    const failInterruptedTools = Effect.fn("SessionRunner.failInterruptedTools")(function* (
      sessionID: SessionSchema.ID,
    ) {
      for (const message of yield* getContext(sessionID)) {
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

    const awaitToolFibers = (fibers: FiberSet.FiberSet<void, ToolOutputStore.Error>) =>
      Effect.raceFirst(FiberSet.join(fibers), FiberSet.awaitEmpty(fibers))

    // Match V1: declining a user prompt halts the loop instead of becoming model-facing tool output.
    const isUserDeclined = (cause: Cause.Cause<unknown>) =>
      cause.reasons.some(
        (reason) =>
          Cause.isDieReason(reason) &&
          (reason.defect instanceof PermissionV2.DeclinedError || reason.defect instanceof QuestionV2.RejectedError),
      )

    type TurnTransition =
      // Automatic compaction completed; rebuild the request from compacted history.
      | { readonly _tag: "ContinueAfterCompaction"; readonly step: number }
      // Overflow compaction completed; rebuild once through the path without overflow recovery.
      | { readonly _tag: "ContinueAfterOverflowCompaction"; readonly step: number }

    class TurnTransitionError extends Error {
      constructor(readonly transition: TurnTransition) {
        super()
      }
    }

    const continueAfterCompaction = (step: number) => new TurnTransitionError({ _tag: "ContinueAfterCompaction", step })
    const continueAfterOverflowCompaction = (step: number) =>
      new TurnTransitionError({ _tag: "ContinueAfterOverflowCompaction", step })

    const lastAssistantText = (entries: ReadonlyArray<{ message: SessionMessage.Message }>): string => {
      for (let i = entries.length - 1; i >= 0; i--) {
        const message = entries[i].message
        if (message.type !== "assistant") continue
        const text = message.content
          .filter((part): part is SessionMessage.AssistantText => part.type === "text")
          .map((part) => part.text)
          .join(" ")
        return text
      }
      return ""
    }

    const readLastAssistantText = Effect.fn("SessionRunner.readLastAssistantText")(function* (
      sessionID: SessionSchema.ID,
    ) {
      const session = yield* getSession(sessionID).pipe(Effect.option)
      if (Option.isNone(session)) return ""
      const agent = yield* agents.select(session.value.agent)
      const system = yield* SessionContextEpoch.prepare(db, events, loadSystemContext(agent), session.value.id).pipe(
        Effect.option,
      )
      if (Option.isNone(system)) return ""
      const entries = yield* SessionHistory.entriesForRunner(db, session.value.id, system.value.baselineSeq).pipe(
        Effect.option,
      )
      if (Option.isNone(entries)) return ""
      return lastAssistantText(entries.value)
    })

    const publishCycle = Effect.fn("SessionRunner.publishCycle")(function* (
      loop: "why" | "then",
      sessionID: SessionSchema.ID,
      gated: boolean,
      steered: boolean,
      messageID?: SessionMessage.ID,
      diagnostics?: { readonly iterates: number; readonly epsilon: number; readonly approximationGap?: number },
    ) {
      yield* events
        .publish(SessionEvent.ReasoningCycle.Fired, {
          loop,
          gated,
          steered,
          ...(messageID === undefined ? {} : { messageID }),
          ...(diagnostics === undefined ? {} : diagnostics),
          timestamp: yield* DateTime.now,
          sessionID,
        })
        .pipe(Effect.ignore, Effect.asVoid)
    })

    const loadSystemContext = (agent: AgentV2.Selection) =>
      Effect.all([systemContext.load(), skillGuidance.load(agent), referenceGuidance.load()], {
        concurrency: "unbounded",
      }).pipe(Effect.map(SystemContext.combine))

    const runTurnAttempt = Effect.fn("SessionRunner.runTurn")(function* (
      sessionID: SessionSchema.ID,
      promotion: SessionInput.Delivery | undefined,
      step: number,
      recoverOverflow?: typeof compaction.compactAfterOverflow,
    ) {
      const session = yield* getSession(sessionID)
      if (session.location.directory !== location.directory || session.location.workspaceID !== location.workspaceID)
        return yield* Effect.interrupt
      const agent = yield* agents.select(session.agent)
      const initialized = yield* SessionContextEpoch.initialize(db, loadSystemContext(agent), session.id)
      const toolFibers = yield* FiberSet.make<void, ToolOutputStore.Error>()
      let needsContinuation = false
      let whyLoopBudget = maxReflectionBudget
      let currentStep = step
      if (promotion) {
        const cutoff = yield* EventV2.latestSequence(db, session.id)
        let promoted = 0
        if (promotion === "steer") promoted = yield* SessionInput.promoteSteers(db, events, session.id, cutoff)
        if (promotion === "queue") {
          promoted += Number(yield* SessionInput.promoteNextQueued(db, events, session.id))
          promoted += yield* SessionInput.promoteSteers(db, events, session.id, cutoff)
        }
        if (promoted > 0) {
          currentStep = 1
          ReflectionState.clear(session.id)
        }
      }
      const system =
        initialized ?? (yield* SessionContextEpoch.prepare(db, events, loadSystemContext(agent), session.id))
      const model = yield* models.resolve(session)
      const entries = yield* SessionHistory.entriesForRunner(db, session.id, system.baselineSeq)
      const context = entries.map((entry) => entry.message)
      const isLastStep = agent.info?.steps !== undefined && currentStep >= agent.info.steps
      const toolMaterialization = isLastStep ? undefined : yield* tools.materialize(agent.info?.permissions)
      const promptCacheKey = /^ses_[0-9a-f]{64}$/.test(session.id) ? session.id.slice(4) : session.id
      const request = LLM.request({
        model,
        http: {
          headers: {
            "x-session-affinity": session.id,
            "X-Session-Id": session.id,
            ...(session.parentID ? { "x-parent-session-id": session.parentID } : {}),
          },
        },
        providerOptions: { openai: { promptCacheKey } },
        system: [
          agent.info?.system,
          system.baseline,
          ReflectionState.getReflectionText(session.id),
          ReflectionState.consumeSteerGuidanceText(session.id),
        ]
          .filter((part): part is string => part !== undefined && part.length > 0)
          .map(SystemPart.make),
        messages: [...toLLMMessages(context, model), ...(isLastStep ? [Message.assistant(MAX_STEPS_PROMPT)] : [])],
        tools: toolMaterialization?.definitions ?? [],
        toolChoice: isLastStep ? "none" : undefined,
      })
      if (yield* compaction.compactIfNeeded({ sessionID: session.id, entries, model, request }))
        return yield* Effect.die(continueAfterCompaction(currentStep))
      const startSnapshot = yield* snapshots.capture()
      const publisher = createLLMEventPublisher(events, {
        sessionID: session.id,
        agent: agent.id,
        model: {
          id: ModelV2.ID.make(model.id),
          providerID: ProviderV2.ID.make(model.provider),
          ...(session.model?.variant === undefined ? {} : { variant: session.model.variant }),
        },
        snapshot: startSnapshot,
      })
      const withPublication = Semaphore.makeUnsafe(1).withPermit
      const publish = (event: LLMEvent, outputPaths: ReadonlyArray<string> = []) =>
        withPublication(publisher.publish(event, outputPaths))

      if (
        preActionProjection &&
        step === 1 &&
        promotion === undefined &&
        !ReflectionState.get(session.id).directionConfirmed
      ) {
        const recentMsgs = entries.slice(-6).map((e) => e.message)
        const hasDecision = recentMsgs.some((m) => m.type === "assistant" && m.content.some((p) => p.type === "text"))
        if (hasDecision && entries.length >= 2) {
          const projectionModel = yield* models.resolveReflection(session).pipe(Effect.option)
          if (Option.isSome(projectionModel)) {
            const projectionMsgs = [
              ...toLLMMessages(recentMsgs, projectionModel.value),
              Message.user(
                "You are about to act. In 1-2 sentences, evaluate the deductive soundness of your next action: verify that all preconditions hold, necessary files have been checked, and no contradictions exist with past observations or tool errors. If sound, output exactly 'Proceed.' Otherwise, state the missing premise or risk.",
              ),
            ]
            const preReq = LLM.request({
              model: projectionModel.value,
              messages: projectionMsgs,
              tools: [],
              generation: { maxTokens: 256 },
            })
            const preChunks: string[] = []
            let preFailed = false
            yield* llm.stream(preReq).pipe(
              Stream.runForEach((event) => {
                if (LLMEvent.is.providerError(event)) preFailed = true
                if (LLMEvent.is.textDelta(event)) preChunks.push(event.text)
                return Effect.void
              }),
              Effect.timeout(reflectionTimeout),
              Effect.option,
            )
            if (!preFailed && preChunks.length > 0) {
              const projection = preChunks.join("").trim()
              const cleanProceed = /^proceed\.?$/i.test(projection)
              const hasAdversarialRisk = /\b(however|but|risk|caution|warning|contradiction|missing|error|broken|fail)\b/i.test(projection)
              if ((!cleanProceed || hasAdversarialRisk) && projection.length > 20) {
                ReflectionState.addSteer(session.id, `[Pre-action check]\n${projection}`)
                return yield* Effect.die(continueAfterCompaction(currentStep))
              }
            }
          }
        }
      }

      let overflowFailure: ProviderErrorEvent | undefined
      let lastProviderEventAt = 0
      const providerStream = llm.stream(request).pipe(
        Stream.timeout(streamIdleTimeout),
        Stream.runForEach((event) =>
          Effect.gen(function* () {
            const now = DateTime.toEpochMillis(yield* DateTime.now)
            if (lastProviderEventAt !== 0) {
              const gap = now - lastProviderEventAt
              if (gap > streamIdleGapThreshold) {
                const message = `Provider stream gap of ${Math.round(gap / 1000)}s between events; possible dropped packet or network delay`
                yield* Effect.logWarning(message)
                yield* withPublication(publisher.appendLog(message))
              }
            }
            lastProviderEventAt = now
            if (overflowFailure || publisher.hasProviderError()) return
            if (LLMEvent.is.providerError(event)) {
              if (isContextOverflowFailure(event) && !publisher.hasAssistantStarted()) {
                overflowFailure = event
                return
              }
            }
            yield* publish(event)
            if (event.type !== "tool-call" || event.providerExecuted) return
            if (!toolMaterialization) {
              yield* withPublication(publisher.failUnsettledTools("Tools are disabled after the maximum agent steps"))
              return
            }
            needsContinuation = true
            const assistantMessageID = yield* publisher.assistantMessageID(event.id)
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
                  Effect.gen(function* () {
                    yield* publish(
                      LLMEvent.toolResult({
                        id: event.id,
                        name: event.name,
                        result: settlement.result,
                        output: settlement.output,
                      }),
                      settlement.outputPaths ?? [],
                    )
                    if (whyLoopBudget <= 0) return
                    const refreshed = yield* SessionHistory.entriesForRunner(db, session.id, system.baselineSeq).pipe(
                      Effect.option,
                    )
                    if (Option.isNone(refreshed)) return
                    if (!containsHedge(lastAssistantText(refreshed.value))) {
                      yield* publishCycle("why", session.id, true, false)
                      return
                    }
                    whyLoopBudget--
                    const whyResult = yield* whyLoop(session.id).pipe(Effect.option)
                    if (Option.isNone(whyResult)) return
                    if (whyResult.value.steered) {
                      needsContinuation = true
                      ReflectionState.clearDirection(session.id)
                    } else if (whyResult.value.converged) {
                      const prev = ReflectionState.get(session.id)
                      ReflectionState.set(session.id, {
                        ...prev,
                        lastWhyConverged: true,
                        directionConfirmed: false,
                      })
                    }
                  }),
                ),
              ),
            ).pipe(FiberSet.run(toolFibers))
          }),
        ),
        Effect.ensuring(withPublication(publisher.flush())),
      )

      return yield* Effect.uninterruptibleMask((restore) =>
        Effect.gen(function* () {
          const stream = yield* restore(providerStream).pipe(Effect.exit)
          const failure =
            stream._tag === "Failure" ? Option.getOrUndefined(Cause.findErrorOption(stream.cause)) : undefined
          if (
            recoverOverflow &&
            !publisher.hasAssistantStarted() &&
            isContextOverflowFailure(overflowFailure ?? failure) &&
            (yield* restore(recoverOverflow({ sessionID: session.id, entries, model, request })))
          )
            return yield* Effect.die(continueAfterOverflowCompaction(currentStep))
          if (overflowFailure) yield* publish(overflowFailure)
          const llmFailure = failure instanceof LLMError ? failure : undefined
          if (llmFailure && !publisher.hasProviderError()) {
            yield* withPublication(publisher.failUnsettledTools("Provider did not return a tool result", true))
            yield* withPublication(publisher.failAssistant(llmFailure.reason.message))
          }
          if (stream._tag === "Failure" && Cause.hasInterrupts(stream.cause)) yield* FiberSet.clear(toolFibers)
          const settled = yield* restore(awaitToolFibers(toolFibers)).pipe(Effect.exit)
          if (settled._tag === "Failure" && isUserDeclined(settled.cause)) {
            yield* FiberSet.clear(toolFibers)
            yield* withPublication(publisher.failUnsettledTools("Tool execution interrupted"))
            return yield* Effect.interrupt
          }
          if (
            (stream._tag === "Failure" && Cause.hasInterrupts(stream.cause)) ||
            (settled._tag === "Failure" && Cause.hasInterrupts(settled.cause))
          ) {
            yield* FiberSet.clear(toolFibers)
            yield* withPublication(publisher.failUnsettledTools("Tool execution interrupted"))
            if (publisher.hasActiveAssistant())
              yield* withPublication(publisher.failAssistant("Provider turn interrupted"))
          }
          if (settled._tag === "Failure" && !Cause.hasInterrupts(settled.cause)) {
            const failure = Cause.squash(settled.cause)
            const message = failure instanceof Error ? failure.message : String(failure)
            yield* withPublication(publisher.failUnsettledTools(`Tool execution failed: ${message}`))
          }
          const stepSettlement = publisher.stepSettlement()
          if (stepSettlement && !publisher.hasProviderError()) {
            const endSnapshot = yield* snapshots.capture()
            const files =
              startSnapshot && endSnapshot
                ? yield* snapshots
                    .files({ from: startSnapshot, to: endSnapshot })
                    .pipe(Effect.catch(() => Effect.succeed(undefined)))
                : undefined
            yield* withPublication(
              events.publish(SessionEvent.Step.Ended, {
                sessionID: session.id,
                timestamp: yield* DateTime.now,
                assistantMessageID: yield* publisher.startAssistant(),
                finish: stepSettlement.finish,
                cost: 0,
                tokens: stepSettlement.tokens,
                snapshot: endSnapshot,
                files,
              }),
            )
          }
          if (publisher.hasProviderError())
            yield* withPublication(publisher.failUnsettledTools("Tool execution interrupted"))
          if (stream._tag === "Success" && !publisher.hasProviderError()) {
            if (!publisher.hasStepFinish() && publisher.hasProducedText()) {
              const message = "Provider stream ended without a step-finish event; the response was truncated (dropped packets)"
              yield* Effect.logWarning(message)
              yield* withPublication(publisher.failAssistant(message))
            }
            yield* withPublication(publisher.failUnsettledTools("Provider did not return a tool result", true))
          }
          if (stream._tag === "Failure") return yield* Effect.failCause(stream.cause)
          if (settled._tag === "Failure" && Cause.hasInterrupts(settled.cause))
            return yield* Effect.failCause(settled.cause)
          return { needsContinuation: !publisher.hasProviderError() && needsContinuation, step: currentStep }
        }),
      )
    }, Effect.scoped)
    type RunTurn = (
      sessionID: SessionSchema.ID,
      promotion: SessionInput.Delivery | undefined,
      step: number,
    ) => Effect.Effect<{ readonly needsContinuation: boolean; readonly step: number }, RunError>

    const runAfterOverflowCompaction: RunTurn = Effect.fnUntraced(function* (sessionID, promotion, step) {
      return yield* runTurnAttempt(sessionID, promotion, step).pipe(
        Effect.catchDefect(
          Effect.fnUntraced(function* (defect) {
            if (!(defect instanceof TurnTransitionError)) return yield* Effect.die(defect)
            if (defect.transition._tag === "ContinueAfterOverflowCompaction")
              return yield* Effect.die("Post-compaction provider attempt cannot recover another overflow")
            yield* Effect.yieldNow
            return yield* runAfterOverflowCompaction(sessionID, undefined, defect.transition.step)
          }),
        ),
      )
    })

    const runTurn: RunTurn = Effect.fnUntraced(function* (sessionID, promotion, step) {
      return yield* runTurnAttempt(sessionID, promotion, step, compaction.compactAfterOverflow).pipe(
        Effect.catchDefect(
          Effect.fnUntraced(function* (defect) {
            if (!(defect instanceof TurnTransitionError)) return yield* Effect.die(defect)
            yield* Effect.yieldNow
            if (defect.transition._tag === "ContinueAfterOverflowCompaction")
              return yield* runAfterOverflowCompaction(sessionID, undefined, defect.transition.step)
            return yield* runTurn(sessionID, undefined, defect.transition.step)
          }),
        ),
      )
    })

    const thenLoop = Effect.fn("SessionRunner.thenLoop")(function* (
      sessionID: SessionSchema.ID,
      modelOverride?: { providerID: string; modelID: string },
    ) {
      const converge = (
        steered: boolean,
        iterates: number,
        text: string,
        extensionsDetected: number,
        approximationGap?: number,
      ): ReflectionResult => ({
        steered,
        iterates,
        converged: !steered,
        certificate:
          approximationGap === undefined
            ? { epsilon: approxTcaTolerance }
            : { epsilon: approxTcaTolerance, approximationGap },
        text,
        extensionsDetected,
      })
      const session = yield* getSession(sessionID).pipe(Effect.option)
      if (Option.isNone(session)) return converge(false, 0, "", 0)
      const agent = yield* agents.select(session.value.agent)
      const model = yield* models.resolveReflection(session.value, modelOverride).pipe(Effect.option)
      if (Option.isNone(model)) return converge(false, 0, "", 0)
      const system = yield* SessionContextEpoch.prepare(db, events, loadSystemContext(agent), session.value.id).pipe(
        Effect.option,
      )
      if (Option.isNone(system)) return converge(false, 0, "", 0)
      const startBaselineSeq = system.value.baselineSeq
      const entries = yield* SessionHistory.entriesForRunner(db, session.value.id, system.value.baselineSeq).pipe(
        Effect.option,
      )
      if (Option.isNone(entries)) return converge(false, 0, "", 0)
      if (!containsHedge(lastAssistantText(entries.value))) {
        yield* publishCycle("then", sessionID, true, false)
        return converge(false, 0, "", 0)
      }
      let iterates = 0
      let steered = false
      let projection = ""
      let extensionsDetected = 0
      let currentBaselineSeq = startBaselineSeq
      while (iterates < maxReflectionBudget) {
        iterates++
        const nextSystem = yield* SessionContextEpoch.prepare(
          db,
          events,
          loadSystemContext(agent),
          session.value.id,
        ).pipe(Effect.option)
        if (Option.isNone(nextSystem)) break
        if (nextSystem.value.baselineSeq !== currentBaselineSeq) {
          extensionsDetected++
          currentBaselineSeq = nextSystem.value.baselineSeq
        }
        const currentEntries = yield* SessionHistory.entriesForRunner(
          db,
          session.value.id,
          nextSystem.value.baselineSeq,
        ).pipe(Effect.option)
        if (Option.isNone(currentEntries)) break
        const lastMsgs = currentEntries.value.slice(-6).map((e) => e.message)
        const hasDecision = lastMsgs.some((m) => m.type === "assistant" && m.content.some((p) => p.type === "text"))
        if (!hasDecision || currentEntries.value.length < 2) break
        const projectionMsgs = [
          ...toLLMMessages(lastMsgs, model.value),
          Message.user(
            `Forward-project 3-5 steps from the reasoning above to test for logical validity and safety. Act as an adversarial verifier: attempt to construct a minimal counter-model or failure scenario (e.g. unhandled command failure, invalid state transition, or broken invariant). If a failure scenario exists, describe it in 1-2 sentences. If no contradiction or risk exists, output exactly "No issues projected."`,
          ),
        ]
        const req = LLM.request({
          model: model.value,
          messages: projectionMsgs,
          tools: [],
          generation: { maxTokens: 1024 },
        })
        const chunks: string[] = []
        let failed = false
        yield* llm.stream(req).pipe(
          Stream.runForEach((event) => {
            if (LLMEvent.is.providerError(event)) failed = true
            if (LLMEvent.is.textDelta(event)) chunks.push(event.text)
            return Effect.void
          }),
          Effect.timeout(reflectionTimeout),
          Effect.option,
        )
        if (failed || chunks.length === 0) break
        projection = chunks.join("").trim()
        const claimsNoIssues = /no issues?|no negative/i.test(projection)
        const hasAdversarialRisk = /\b(however|but|except|risk|contradiction|failure|warning|error|broken|flaw)\b/i.test(projection)
        const converged = (claimsNoIssues && !hasAdversarialRisk) || (projection.length < 40 && !hasAdversarialRisk)
        if (converged) {
          yield* publishCycle(
            "then",
            sessionID,
            false,
            false,
            undefined,
            approxTcaTolerance > 0 ? { iterates, epsilon: approxTcaTolerance, approximationGap: 0 } : undefined,
          )
          return converge(false, iterates, projection, extensionsDetected, approxTcaTolerance > 0 ? 0 : undefined)
        }
        ReflectionState.addSteer(sessionID, `[Then Loop forward check]\n${projection}`)
        steered = true
        break
      }
      yield* publishCycle("then", sessionID, false, true, undefined, { iterates, epsilon: approxTcaTolerance })
      return converge(steered, iterates, projection, extensionsDetected)
    })

    const whyLoop = Effect.fn("SessionRunner.whyLoop")(function* (
      sessionID: SessionSchema.ID,
      modelOverride?: { providerID: string; modelID: string },
    ) {
      const converge = (
        steered: boolean,
        iterates: number,
        text: string,
        extensionsDetected: number,
        approximationGap?: number,
      ): ReflectionResult => ({
        steered,
        iterates,
        converged: !steered,
        certificate:
          approximationGap === undefined
            ? { epsilon: approxTcaTolerance }
            : { epsilon: approxTcaTolerance, approximationGap },
        text,
        extensionsDetected,
      })
      const session = yield* getSession(sessionID).pipe(Effect.option)
      if (Option.isNone(session)) return converge(false, 0, "", 0)
      const agent = yield* agents.select(session.value.agent)
      const model = yield* models.resolveReflection(session.value, modelOverride).pipe(Effect.option)
      if (Option.isNone(model)) return converge(false, 0, "", 0)
      const system = yield* SessionContextEpoch.prepare(db, events, loadSystemContext(agent), session.value.id).pipe(
        Effect.option,
      )
      if (Option.isNone(system)) return converge(false, 0, "", 0)
      const startBaselineSeq = system.value.baselineSeq
      const entries = yield* SessionHistory.entriesForRunner(db, session.value.id, system.value.baselineSeq).pipe(
        Effect.option,
      )
      if (Option.isNone(entries)) return converge(false, 0, "", 0)
      const initialHasDecision = entries.value
        .slice(-6)
        .some((e) => e.message.type === "assistant" && e.message.content.some((p) => p.type === "text"))
      if (!initialHasDecision || entries.value.length < 2) return converge(false, 0, "", 0)
      let iterates = 0
      let steered = false
      let reflection = ""
      let extensionsDetected = 0
      let currentBaselineSeq = startBaselineSeq
      while (iterates < maxReflectionBudget) {
        iterates++
        const nextSystem = yield* SessionContextEpoch.prepare(
          db,
          events,
          loadSystemContext(agent),
          session.value.id,
        ).pipe(Effect.option)
        if (Option.isNone(nextSystem)) break
        if (nextSystem.value.baselineSeq !== currentBaselineSeq) {
          extensionsDetected++
          currentBaselineSeq = nextSystem.value.baselineSeq
        }
        const currentEntries = yield* SessionHistory.entriesForRunner(
          db,
          session.value.id,
          nextSystem.value.baselineSeq,
        ).pipe(Effect.option)
        if (Option.isNone(currentEntries)) break
        const lastMsgs = currentEntries.value.slice(-6).map((e) => e.message)
        const reflectionMsgs = [
          ...toLLMMessages(lastMsgs, model.value),
          Message.user(
            `Reflect on the most recent tool result against the active goal premises. Determine if the result refutes your assumptions (e.g. non-zero exit code, error trace, missing resource, unexpected output) requiring a shift to a new or debugging sub-goal. If the goal changes, state the new sub-goal in one sentence. If all premises hold, output exactly "Goal unchanged."`,
          ),
        ]
        const req = LLM.request({
          model: model.value,
          messages: reflectionMsgs,
          tools: [],
          generation: { maxTokens: 1024 },
        })
        const chunks: string[] = []
        let failed = false
        yield* llm.stream(req).pipe(
          Stream.runForEach((event) => {
            if (LLMEvent.is.providerError(event)) failed = true
            if (LLMEvent.is.textDelta(event)) chunks.push(event.text)
            return Effect.void
          }),
          Effect.timeout(reflectionTimeout),
          Effect.option,
        )
        if (failed || chunks.length === 0) break
        reflection = chunks.join("").trim()
        const claimsUnchanged = /goal unchanged|goal is unchanged/i.test(reflection)
        const hasGoalShift = /\b(however|but|shift|switch|modify|instead|update|error|fail|debug|broken)\b/i.test(reflection)
        const converged = (claimsUnchanged && !hasGoalShift) || (reflection.length < 20 && !hasGoalShift)
        if (converged) {
          yield* publishCycle(
            "why",
            sessionID,
            false,
            false,
            undefined,
            approxTcaTolerance > 0 ? { iterates, epsilon: approxTcaTolerance, approximationGap: 0 } : undefined,
          )
          return converge(false, iterates, reflection, extensionsDetected, approxTcaTolerance > 0 ? 0 : undefined)
        }
        ReflectionState.addSteer(sessionID, `[Why Loop reflection]\n${reflection}`)
        steered = true
        break
      }
      yield* publishCycle("why", sessionID, false, true, undefined, { iterates, epsilon: approxTcaTolerance })
      return converge(steered, iterates, reflection, extensionsDetected)
    })

    const run = Effect.fn("SessionRunner.run")(function* (input: {
      readonly sessionID: SessionSchema.ID
      readonly force: boolean
    }) {
      const hasSteer =
        (yield* SessionInput.hasPending(db, input.sessionID, "steer")) || ReflectionState.hasSteers(input.sessionID)
      const hasQueue = hasSteer ? false : yield* SessionInput.hasPending(db, input.sessionID, "queue")
      if (!input.force && !hasSteer && !hasQueue) return
      yield* failInterruptedTools(input.sessionID)
      let promotion: SessionInput.Delivery | undefined = hasSteer ? "steer" : hasQueue ? "queue" : undefined
      let shouldRun = input.force || hasSteer || hasQueue
      let thenLoopBudget = maxReflectionBudget
      while (shouldRun) {
        let needsContinuation = true
        let step = 1
        while (needsContinuation) {
          const result = yield* runTurn(input.sessionID, promotion, step)
          needsContinuation = result.needsContinuation
          step = result.step + 1
          promotion = "steer"
          if (!needsContinuation) {
            if (thenLoopBudget > 0) {
              const thenResult = yield* thenLoop(input.sessionID)
              if (thenResult.steered) {
                thenLoopBudget--
                needsContinuation = true
                step = 1
                ReflectionState.clearDirection(input.sessionID)
                if (thenResult.extensionsDetected > 0) {
                  const extendedWhy = yield* whyLoop(input.sessionID)
                  if (extendedWhy.steered) {
                    needsContinuation = true
                    step = 1
                    ReflectionState.clearDirection(input.sessionID)
                  } else if (extendedWhy.converged) {
                    const prev = ReflectionState.get(input.sessionID)
                    ReflectionState.set(input.sessionID, {
                      ...prev,
                      lastWhyConverged: true,
                      directionConfirmed: false,
                    })
                  }
                }
              } else if (thenResult.converged) {
                const prev = ReflectionState.get(input.sessionID)
                ReflectionState.set(input.sessionID, {
                  ...prev,
                  lastThenConverged: true,
                  directionConfirmed: true,
                  confirmedAt: new Date(),
                })
              }
            }
            if (!needsContinuation)
              needsContinuation =
                (yield* SessionInput.hasPending(db, input.sessionID, "steer")) ||
                ReflectionState.hasSteers(input.sessionID)
          }
        }
        shouldRun =
          (yield* SessionInput.hasPending(db, input.sessionID, "queue")) ||
          ReflectionState.hasSteers(input.sessionID)
        promotion = shouldRun ? "queue" : undefined
      }
    })

    return Service.of({
      run,
      whyLoop,
      thenLoop,
      lastAssistantText: readLastAssistantText,
    })
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
    SessionRunnerModel.node,
    SessionStore.node,
    Location.node,
    SystemContextRegistry.node,
    SkillGuidance.node,
    ReferenceGuidance.node,
    Config.node,
    Snapshot.node,
    Database.node,
  ],
})
