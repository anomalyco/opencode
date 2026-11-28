export * as SessionRunnerLLM from "./llm.js"

import { Message } from "@opencode/ai/effect"
import { and, desc, eq, inArray, sql } from "drizzle-orm"
import { Cause, Effect, Exit, FiberMap, Layer } from "effect"
import { Database } from "../../database/database.js"
import { Bus } from "../../bus.js"
import { CodeModeAgents } from "../../codemode/agents.js"
import { Environment } from "../../environment/index.js"
import { Flag } from "../../flag.js"
import { LocationLifecycle } from "../../location-lifecycle.js"
import { Environments } from "../../environment/environments.js"
import { SessionCwd } from "../cwd.js"
import { InstructionState } from "../instruction-state.js"
import { SessionCompaction } from "../compaction.js"
import { SessionContext } from "../context.js"
import { SessionEvent } from "../event.js"
import { SessionInbox } from "../inbox.js"
import { SessionBackground } from "../background.js"
import { Job } from "../../job.js"
import { SessionHistory } from "../history.js"
import { SessionModelRequest } from "../model-request.js"
import { SessionModelTransport } from "../model-transport.js"
import { SessionMessage } from "../message.js"
import { SessionSchema } from "../schema.js"
import { SessionStore } from "../store.js"
import { SessionMessageTable } from "../sql.js"
import { SessionTitle } from "../title.js"
import { toSessionError } from "../to-session-error.js"
import { DrainResult, reach, Service, type Interface, type Position } from "./index.js"
import { Snapshot } from "../../snapshot.js"
import { makeLocationNode } from "@opencode/util/effect/app-node"
import { llmClient } from "../../effect/app-node-platform.js"
import { StepFailedError } from "../error.js"
import { SessionRunnerRetry } from "./retry.js"
import { SessionStep } from "./step.js"
import { PersistentPty } from "../../persistent-pty/index.js"
import { ToolOutput } from "../../tool-output.js"
import { Plugin } from "../../plugin.js"
import { PluginHooks } from "../../plugin/hooks.js"
import { MAX_STEPS_PROMPT } from "./max-steps.js"

const CONTINUE_AFTER_OUTPUT_LIMIT =
  "Your last response hit the output token limit (stop reason: length). Do not apologize, recap, or repeat yourself. Break the remaining work into smaller pieces."

type DrainInput = Parameters<Interface["drain"]>[0]

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const bus = yield* Bus.Service
    const flags = yield* Flag.Service
    const lifecycle = yield* LocationLifecycle.Service
    const store = yield* SessionStore.Service
    const context = yield* SessionContext.Service
    const modelTransport = yield* SessionModelTransport.Service
    const db = (yield* Database.Service).db
    const inbox = yield* SessionInbox.Service
    const compaction = yield* SessionCompaction.Service
    const plugins = yield* Plugin.Service
    const hooks = yield* PluginHooks.Service
    const jobs = yield* Job.Service
    const title = yield* SessionTitle.Service
    const steps = yield* SessionStep.make
    const cwd = yield* SessionCwd.make
    const pty = yield* PersistentPty.Service
    // Title generation starts once input is visible and must not delay model execution.
    const titles = yield* FiberMap.make<SessionSchema.ID, void, never>()

    // Each drain is one turn and starts its own trace, whatever fiber woke it.
    const drain = Effect.fn("SessionRunner.drain", { root: true })(function* (input: DrainInput) {
      const sessionID = input.sessionID
      const promotable = input.promotable ?? "input"
      let at: Position = input.at ?? { _tag: "Fresh", forced: false }
      // The step allowance. `at` carries it for a handoff: a mid-turn reset to step 1 always runs
      // that step, which records the next position, before the next handoff can happen.
      let step = at._tag === "Continue" ? at.step : 1
      let entering = true
      if (at._tag === "Fresh" && !at.forced) {
        const pending = yield* SessionInbox.boundary(db, sessionID, reach(at, entering, promotable))
        if (pending._tag === "Empty" || pending._tag === "Parked") return DrainResult.Complete()
      }
      yield* plugins.awaitActivation
      yield* settleStaleCompactions(sessionID)
      yield* settleStaleToolCalls(sessionID)

      const advanceToStep = Effect.fn("SessionRunner.advanceToStep")(() =>
        Effect.uninterruptibleMask((restore) =>
          Effect.gen(function* () {
            while (true) {
              if (lifecycle.isClosed()) {
                yield* restore(modelTransport.close(sessionID))
                return DrainResult.Reloaded({ at })
              }
              // Location entry and idle boundaries allow queued controls, not necessarily queued prompts.
              const pending = yield* inbox.serialized(
                sessionID,
                Effect.gen(function* () {
                  const next = yield* SessionInbox.boundary(db, sessionID, reach(at, entering, promotable))
                  if (next._tag !== "Control") return next
                  const item = next.item
                  if (item.type === "compaction")
                    yield* bus.publishAll([
                      [SessionEvent.InboxDelivered, { sessionID, inboxID: item.id }],
                      [SessionEvent.Compaction.Started, { sessionID, reason: "manual", inputID: item.id }],
                    ])
                  if (item.type === "move")
                    yield* restore(
                      Effect.gen(function* () {
                        yield* modelTransport.close(sessionID)
                        yield* bus.publishAll([
                          [SessionEvent.InboxDelivered, { sessionID, inboxID: item.id }],
                          [SessionEvent.Moved, { sessionID, ...item.payload }],
                        ])
                      }),
                    )
                  return next
                }),
              )
              // Anything but a steer outside a turn starts a fresh one, with a fresh step allowance.
              const steered =
                pending._tag === "Control"
                  ? pending.item.delivery === "steer"
                  : pending._tag === "Promote" && pending.items[0].delivery === "steer"
              if (at._tag !== "Continue" && !steered) {
                entering = true
                step = 1
              }
              // The destination drain picks up unforced: the move itself was this boundary's work.
              if (pending._tag === "Control" && pending.item.type === "move")
                return DrainResult.Moved({ at: at._tag === "Fresh" ? { _tag: "Fresh", forced: false } : at })
              if (pending._tag === "Control") {
                const inputID = pending.item.id
                const compacted = yield* restore(
                  Effect.gen(function* () {
                    yield* plugins.awaitActivation
                    const selected = yield* context.select(sessionID)
                    const model = yield* context.resolveModel(selected.session, {
                      kind: "compaction",
                      agent: selected.agent.id,
                    })
                    // Preview updates without admitting them after the already-delivered compaction marker.
                    const history = yield* SessionHistory.preview(db, sessionID, selected.instructions, model.ref)
                    return yield* compaction.compact({
                      reason: "manual",
                      inputID,
                      context: {
                        session: selected.session,
                        agent: selected.agent,
                        tools: selected.tools,
                        model,
                        initial: history.initial,
                        messages: history.messages,
                        video: selected.video,
                      },
                    })
                  }).pipe(
                    Effect.catch((error) =>
                      bus.publish(SessionEvent.Compaction.Failed, {
                        sessionID,
                        reason: "manual",
                        inputID,
                        error: toSessionError(error),
                      }),
                    ),
                  ),
                ).pipe(Effect.exit)
                if (Exit.isFailure(compacted)) {
                  yield* bus.publish(SessionEvent.Compaction.Failed, {
                    sessionID,
                    reason: "manual",
                    error: Cause.hasInterruptsOnly(compacted.cause)
                      ? { type: "aborted", message: "Compaction cancelled" }
                      : { type: "compaction.failed", message: Cause.pretty(compacted.cause) },
                    inputID,
                  })
                  return yield* Effect.failCause(compacted.cause)
                }
                if (at._tag === "Fresh") at = { _tag: "Fresh", forced: false }
                continue
              }
              if ((at._tag === "BetweenTurns" || (at._tag === "Fresh" && !at.forced)) && pending._tag !== "Promote") {
                // Control-only drains such as a manual compaction never ran the model, so they skip the hook.
                if (pending._tag === "Parked" || at._tag !== "BetweenTurns") return DrainResult.Complete()
                // The Session would go idle; a plugin may admit input to keep this execution working.
                yield* restore(
                  SessionBackground.outstanding(jobs, store, sessionID).pipe(
                    Effect.flatMap((background) =>
                      hooks.trigger("session", "experimental.idle", { sessionID, background }),
                    ),
                  ),
                )
                if (!(yield* SessionInbox.has(db, sessionID, "input"))) return DrainResult.Complete()
                continue
              }
              const ready = yield* restore(
                Effect.gen(function* () {
                  const selected = yield* prepareContext(sessionID)
                  // Delivery re-plans after preparation; only a fresh turn's entry may take a queued prompt.
                  const promoted = yield* inbox.promote(
                    sessionID,
                    entering && at._tag !== "Continue" ? promotable : "steer",
                  )
                  // A control admitted during context preparation owns this boundary.
                  if (promoted === undefined) return undefined
                  if (promoted > 0 && !selected.session.parentID && SessionTitle.isUntitled(selected.session))
                    yield* FiberMap.run(titles, sessionID, title.generate(sessionID), {
                      onlyIfMissing: true,
                    })
                  if (promoted > 0) step = 1
                  return { _tag: "Ready" as const, context: yield* context.load(selected) }
                }),
              )
              if (ready) return ready
            }
          }),
        ),
      )

      while (true) {
        const next = yield* advanceToStep()
        if (next._tag !== "Ready") return next
        const continuing = yield* runStep(next.context, step, input.interruption)
        step++
        at = continuing ? { _tag: "Continue", step } : { _tag: "BetweenTurns" }
        entering = false
      }
    })

    const prepareContext = Effect.fn("SessionRunner.prepareContext")(function* (sessionID: SessionSchema.ID) {
      // Plugins can reload mid-turn; each step and retry must read the settled agents, models and skills.
      yield* plugins.awaitActivation
      const selected = yield* context.select(sessionID)
      // A blocked initial instruction baseline must leave admitted input pending.
      yield* InstructionState.prepare(db, bus, selected.instructions, sessionID)
      return selected
    })

    /** Owns logical Step policy; each attempt owns its streaming, tools, and durable settlement. */
    const runStep = Effect.fn("SessionRunner.runStep")(function* (
      first: SessionContext.Loaded,
      step: number,
      interruption: DrainInput["interruption"],
    ) {
      const sessionID = first.session.id
      let assistantMessageID = SessionMessage.ID.create()
      const retry = yield* SessionRunnerRetry.make(bus, sessionID)
      let initial: SessionContext.Loaded | undefined = first
      let recoverOverflow = true
      let recoverContinuation = true
      let retryAttempt: number | undefined
      while (true) {
        // Reuse boundary preparation once; retries refresh context without delivering more input.
        const loaded = initial ?? (yield* prepareContext(sessionID).pipe(Effect.flatMap(context.load)))
        initial = undefined
        const estimate = SessionCompaction.estimatePrompt(loaded)
        const compacted = yield* compaction.compact({ reason: "auto", context: loaded, estimate })
        if (compacted.status === "failed") return yield* new StepFailedError({ error: compacted.error })
        if (compacted.status === "completed") {
          assistantMessageID = SessionMessage.ID.create()
          continue
        }
        yield* compaction.precompute(Effect.succeed(loaded), estimate)
        const stepLimitReached = loaded.agent.info.steps !== undefined && step >= loaded.agent.info.steps
        const transcript = SessionModelRequest.baseTranscript({
          agent: loaded.agent.info,
          model: loaded.model,
          tools: loaded.tools,
          initial: loaded.initial,
          messages: loaded.messages,
          video: loaded.video,
        })
        const prepared = yield* context.request
          .primary({
            session: loaded.session,
            agent: loaded.agent.id,
            model: loaded.model,
            tools: loaded.tools,
            system: transcript.system,
            messages: stepLimitReached
              ? [...transcript.messages, Message.assistant(MAX_STEPS_PROMPT)]
              : transcript.messages,
            // Keep tool definitions on the final Step to preserve the provider's cached prefix.
            toolChoice: stepLimitReached ? "none" : undefined,
            webSocket: "session",
            inputTokens: estimate,
          })
          .pipe(
            // The hook event holds every message from before images are bounded, screenshots included, and is a separate
            // copy once a plugin hook has rewritten it. The step and its tool callbacks live as long as the slowest tool,
            // so they keep only what they use.
            Effect.map((prepared) => ({
              request: prepared.request,
              options: prepared.options,
              retry: prepared.retry,
              executeTool: prepared.executeTool,
            })),
          )
        const activeCwd = yield* cwd.current(sessionID)
        const endsTurnTool =
          (yield* flags.enabled("codemode_agents")) &&
          CodeModeAgents.sessionMarker(loaded.session.id, loaded.session.metadata)?.structured === true
            ? CodeModeAgents.OUTPUT_TOOL
            : undefined
        const outcome = yield* steps
          .attempt({
            isLocationClosed: lifecycle.isClosed,
            interruption,
            handoffPrepared: pty.handoffPrepared,
            sessionID,
            assistantMessageID,
            agent: loaded.agent.id,
            model: loaded.model,
            prepared: {
              ...prepared,
              // A tool call can arrive during a reload; its permission check reads the session's agent.
              executeTool: (call) => plugins.awaitActivation.pipe(Effect.andThen(prepared.executeTool(call))),
            },
            ...(endsTurnTool === undefined ? {} : { endsTurnTool }),
            retryAttempt,
            retry: (cause, error, proposed) =>
              retry.decide({
                cause,
                error,
                agent: loaded.agent.id,
                model: loaded.model.ref,
                hook: prepared.retry,
                retry: proposed,
              }),
            recoverContinuation,
            recoverOverflow: Effect.suspend(() =>
              recoverOverflow
                ? compaction
                    .compact({ reason: "overflow", context: loaded, estimate })
                    .pipe(Effect.map((result) => result.status === "completed"))
                : Effect.succeed(false),
            ),
          })
          .pipe(Effect.provideService(Environment.CurrentWorkingDirectory, activeCwd))
        retryAttempt = undefined
        const completed = yield* SessionStep.Outcome.$match(outcome, {
          Completed: Effect.fnUntraced(function* (outcome) {
            // The Session is about to go idle, which leaves the background summary time to finish.
            if (!outcome.needsContinuation)
              yield* compaction.precompute(
                store.context(sessionID).pipe(Effect.map((messages) => ({ ...loaded, messages }))),
              )
            return outcome.needsContinuation
          }),
          Retry: Effect.fnUntraced(function* (outcome) {
            retryAttempt = outcome.decision.attempt
            yield* retry.wait({
              decision: outcome.decision,
              error: outcome.error,
              assistantMessageID,
            })
            if (outcome.freshAssistant) assistantMessageID = SessionMessage.ID.create()
          }),
          OutputLimit: Effect.fn("SessionRunner.continueOutputLimit")(function* (outcome) {
            // The current response is included. User input or any other finish breaks the streak.
            const recent = yield* db
              .select({
                type: SessionMessageTable.type,
                finish: sql<string | null>`json_extract(${SessionMessageTable.data}, '$.finish')`,
              })
              .from(SessionMessageTable)
              .where(
                and(
                  eq(SessionMessageTable.session_id, sessionID),
                  inArray(SessionMessageTable.type, ["user", "assistant"]),
                ),
              )
              .orderBy(desc(SessionMessageTable.seq))
              .limit(3)
              .all()
              .pipe(Effect.orDie)
            const exhausted =
              recent.length === 3 && recent.every((row) => row.type === "assistant" && row.finish === "length")
            if (exhausted)
              return yield* new StepFailedError({
                error: {
                  type: "output-limit",
                  message: "Response still truncated after two output token limit continuations",
                },
              })
            if (outcome.needsContinuation) return true
            yield* bus.publish(SessionEvent.Synthetic, { sessionID, text: CONTINUE_AFTER_OUTPUT_LIMIT })
            assistantMessageID = SessionMessage.ID.create()
          }),
          Compacted: Effect.fnUntraced(function* () {
            recoverOverflow = false
            assistantMessageID = SessionMessage.ID.create()
          }),
          RecoverFull: Effect.fnUntraced(function* () {
            recoverContinuation = false
          }),
        })
        if (completed !== undefined) return completed
      }
    })

    const settleStaleCompactions = Effect.fn("SessionRunner.settleStaleCompactions")(function* (
      sessionID: SessionSchema.ID,
    ) {
      // A process death skips compaction finalizers. Include orphans behind a
      // completed checkpoint, and settle newest first to match event projection.
      const rows = yield* db
        .select()
        .from(SessionMessageTable)
        .where(
          and(
            eq(SessionMessageTable.session_id, sessionID),
            eq(SessionMessageTable.type, "compaction"),
            sql`json_extract(${SessionMessageTable.data}, '$.status') = 'running'`,
          ),
        )
        .orderBy(desc(SessionMessageTable.seq))
        .all()
        .pipe(Effect.orDie)
      for (const row of rows) {
        const message = yield* SessionHistory.decodeMessageRow(row)
        if (message.type !== "compaction") continue
        yield* bus.publish(SessionEvent.Compaction.Failed, {
          sessionID,
          reason: message.reason,
          inputID: message.id,
          error: { type: "compaction.interrupted", message: "Compaction was interrupted" },
        })
      }
    })

    const settleStaleToolCalls = Effect.fn("SessionRunner.settleStaleToolCalls")(function* (
      sessionID: SessionSchema.ID,
    ) {
      for (const message of yield* SessionHistory.incompleteAssistants(db, sessionID)) {
        if (message.type !== "assistant") continue
        for (const tool of message.content) {
          if (tool.type !== "tool" || (tool.state.status !== "streaming" && tool.state.status !== "running")) continue
          const metadata = tool.state.status === "running" ? tool.state.metadata : undefined
          const childID =
            tool.name === "subagent" && typeof metadata?.sessionID === "string" ? metadata.sessionID : undefined
          yield* bus.publish(SessionEvent.Tool.Failed, {
            sessionID,
            assistantMessageID: message.id,
            id: tool.id,
            error: {
              type: "aborted",
              message: `Tool execution interrupted: ${tool.name}${childID ? ` (sessionID: ${childID})` : ""}`,
            },
            ...(metadata && Object.keys(metadata).length > 0 ? { metadata } : {}),
            executed: tool.executed === true,
          })
        }
      }
    })

    return Service.of({
      drain: (input) => drain(input).pipe(Effect.annotateSpans("session.id", input.sessionID)),
    })
  }),
)

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [
    Bus.node,
    Environment.node,
    Flag.node,
    LocationLifecycle.node,
    Environments.node,
    llmClient,
    SessionContext.node,
    SessionModelTransport.node,
    SessionStore.node,
    SessionInbox.node,
    SessionCompaction.node,
    Plugin.node,
    PluginHooks.node,
    Job.node,
    SessionTitle.node,
    Snapshot.node,
    PersistentPty.node,
    ToolOutput.node,
    Database.node,
  ],
})
