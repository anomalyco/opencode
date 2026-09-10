import * as Tool from "./tool"
import DESCRIPTION from "./task.txt"
import { ToolJsonSchema } from "./json-schema"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { BackgroundJob } from "@/background/job"
import { Session } from "@/session/session"
import { SessionID, MessageID } from "../session/schema"
import { MessageV2 } from "../session/message-v2"
import { Agent } from "../agent/agent"
import { deriveSubagentSessionPermission } from "../agent/subagent-permissions"
import type { SessionPrompt } from "../session/prompt"
import type { SessionClosure } from "../session/closure/coordinator"
import type { SessionMutation } from "../session/closure/mutation"
import type { SessionPhysical } from "../session/physical-interrupt"
import { SessionAdmission } from "../session/closure/admission"
import { AttachmentCoordinator } from "@/session/attachment/coordinator"
import {
  controllingAssistant,
  renderCancelledTask,
  renderNotices,
  renderOutput,
  renderSelectedTask,
  type TaskSelectedReturn,
} from "@/session/task-return"
import { Config } from "@/config/config"
import { Cause, Deferred, Effect, Exit, Schema, Scope } from "effect"
import { EffectBridge } from "@/effect/bridge"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { Database } from "@opencode-ai/core/database/database"
import { ASYNC_TASK_PROTOCOL } from "./task-protocol"

type AdmissionError = SessionClosure.AdmissionRefused | SessionMutation.MutationRefused | SessionPrompt.ScopeOwnRefused

export interface TaskPromptOps {
  cancel(sessionID: SessionID): Effect.Effect<void>
  resolvePromptParts(template: string): Effect.Effect<SessionPrompt.PromptInput["parts"]>
  /**
   * A refusal survives this boundary as a typed failure rather than becoming a defect. Once a
   * branch is closing, an internal prompt has to be able to reject and be accounted for; the tool
   * boundary's `orDie` then treats it exactly as it treats any other task failure.
   */
  prompt(input: SessionPrompt.TaskPromptInput): Effect.Effect<SessionV1.WithParts, AdmissionError>
  wake?(
    sessionID: SessionID,
    attachment: AttachmentCoordinator.Scope,
  ): Effect.Effect<SessionV1.WithParts, AdmissionError>
  /**
   * Required, not optional. This tool is constructed inside the tool registry's layer, which
   * consumes the coordinator without publishing it, so resolving one from ambient context would
   * yield nothing in production — and a coordinator that resolves to nothing degrades toward
   * permitting more, which inverts the property it exists to enforce. Handed in, it is a compile
   * error to omit rather than a runtime discovery.
   */
  attachments: AttachmentCoordinator.TaskInterface
  /** The lease covering an async result delivered after this tool call has already returned. */
  acquireContinuation(
    input: SessionAdmission.ContinuationInput,
  ): Effect.Effect<SessionAdmission.HeldContinuation, SessionClosure.AdmissionRefused>
  /**
   * The caller's own lease, distinct from the target's. Two admissions on two sessions: this one
   * covers the invocation this tool call performs, the target's covers the child's execution.
   */
  admitScoped(
    input: SessionAdmission.ScopedInput,
  ): Effect.Effect<SessionAdmission.Interface, SessionClosure.AdmissionRefused, Scope.Scope>
  /**
   * The finalizer-safe counterpart to `cancel`, and the two are not interchangeable.
   *
   * `cancel` means full branch closure: it sweeps background jobs recursively and then interrupts
   * the runner. A task finalizer is awaited by the very fiber or job scope that closure has to
   * quiesce, so calling `cancel` from one closes a loop in which every await is locally reasonable.
   * A physical interrupt performs one exact interrupt with no discovery, no view, no record, and no
   * wait on an owning closure operation.
   *
   * `cancel` stays, and is still correct for a direct user abort of the child session.
   */
  physical: SessionPhysical.Interface
}

const id = "task"
const ASYNC_STARTED = "The task is running asynchronously. Follow the Async Task Protocol."
const ASYNC_UPDATED =
  "Supplemental prompt registered for the running async task and queued for admission. Follow the Async Task Protocol."
const TASK_UPDATED =
  "Supplemental prompt registered for the running task and queued for admission. The task session remains addressable by task_id."
// Outstanding-work notices. The observer string rides a published answer, so it is only ever used
// on the asynchronous route; the inline string rides the terminal notes when a success disposition
// retains a second answer, so it is only ever used on the synchronous one. Each states what is true
// of its own path: the observer will deliver a further answer if one is produced, whereas the
// synchronous path pushes nothing and names the route back to it instead.
const OUTSTANDING_ASYNC_NOTE =
  "Supplemental work was still registered when this answer completed. Any further answer it produces will be delivered separately."
const OUTSTANDING_SYNC_NOTE =
  "A supplemental prompt was still registered when this answer completed. Its outcome remains in this task's session and is addressable by task_id."
// Admission-failure notice: facts only - what happened, what was not affected, and the one
// uncertainty the caller has to reason from, since the prompt is persisted before the scope join
// that can fail. The interpolated reason is sanitized when the notice is rendered.
const supplementalAdmissionNote = (reason: string) =>
  `A supplemental prompt could not be admitted: ${reason}. The task's in-flight turn was not interrupted. The prompt may already be recorded in the task transcript.`
const ASYNC_PARAMETER_DESCRIPTION =
  "Start the agent asynchronously; Task produces a running receipt without waiting for the agent's A2A return"
const BACKGROUND_PARAMETER_DESCRIPTION =
  "Deprecated alias for `async`, still accepted so existing callers keep working. Use `async` instead."

const BaseParameterFields = {
  description: Schema.String.annotate({ description: "A short (3-5 words) description of the task" }),
  prompt: Schema.String.annotate({ description: "The task for the agent to perform" }),
  subagent_type: Schema.String.annotate({ description: "The type of specialized agent to use for this task" }),
  task_id: Schema.optional(Schema.String).annotate({
    description:
      "Continue a previous Task session. If task_id names a task this caller owns, a running task takes your prompt as a supplemental prompt in the same conversation, and a finished task resumes the same subagent session in a new turn. An unrecognized task_id starts a fresh Task; a task_id owned by another caller is rejected.",
  }),
  command: Schema.optional(Schema.String).annotate({ description: "The command that triggered this task" }),
}

const BaseParameters = Schema.Struct(BaseParameterFields)

const AsyncParameterFields = {
  ...BaseParameterFields,
  async: Schema.optional(Schema.Boolean).annotate({ description: ASYNC_PARAMETER_DESCRIPTION }),
}

/** What the model is offered once async execution is enabled: one input with one meaning. */
const AsyncParameters = Schema.Struct(AsyncParameterFields)

/**
 * What the tool accepts. `background` is no longer advertised, but it is still decoded and still
 * selects async execution, so callers written against the previous input keep working.
 */
export const Parameters = Schema.Struct({
  ...AsyncParameterFields,
  background: Schema.optional(Schema.Boolean).annotate({ description: BACKGROUND_PARAMETER_DESCRIPTION }),
})

export const TaskTool = Tool.define(
  id,
  Effect.gen(function* () {
    const agent = yield* Agent.Service
    const background = yield* BackgroundJob.Service
    const config = yield* Config.Service
    const sessions = yield* Session.Service
    const scope = yield* Scope.Scope
    const flags = yield* RuntimeFlags.Service
    const database = yield* Database.Service

    const run = Effect.fn("TaskTool.execute")(function* (
      params: Schema.Schema.Type<typeof Parameters>,
      ctx: Tool.Context,
    ) {
      const cfg = yield* config.get()
      if (params.background !== undefined) {
        yield* Effect.logWarning("task called with the deprecated `background` input; use `async`", {
          "session.id": ctx.sessionID,
        })
      }
      const runAsync = params.async === true || params.background === true
      if (runAsync && !flags.experimentalBackgroundSubagents) {
        return yield* Effect.fail(new Error("Async subagents require OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS=true"))
      }

      const parent = yield* sessions.get(ctx.sessionID)
      let current = parent
      let depth = 0
      while (current.parentID) {
        depth++
        current = yield* sessions.get(current.parentID)
      }
      if (depth >= (cfg.subagent_depth ?? 1)) {
        return yield* Effect.fail(
          new Error(
            `Subagent depth limit reached (${cfg.subagent_depth ?? 1}). Increase "subagent_depth" to allow nested subagents.`,
          ),
        )
      }

      if (!ctx.extra?.bypassAgentCheck) {
        yield* ctx.ask({
          permission: id,
          patterns: [params.subagent_type],
          always: ["*"],
          metadata: {
            description: params.description,
            subagent_type: params.subagent_type,
          },
        })
      }

      const next = yield* agent.get(params.subagent_type)
      if (!next) {
        return yield* Effect.fail(new Error(`Unknown agent type: ${params.subagent_type} is not a valid agent type`))
      }

      const session = params.task_id
        ? yield* sessions.get(SessionID.make(params.task_id)).pipe(Effect.catchCause(() => Effect.succeed(undefined)))
        : undefined

      // (A) Resume-ownership guard — a resumed task_id must be the caller's own child.
      if (params.task_id && session && session.parentID !== ctx.sessionID) {
        return yield* Effect.fail(new Error(`Cannot resume session: "${params.task_id}" is not owned by this caller.`))
      }
      if (session && session.agent !== next.name) {
        return yield* Effect.fail(
          new Error(`Cannot resume session: "${params.task_id}" belongs to a different target agent.`),
        )
      }
      const childPermission = deriveSubagentSessionPermission({
        parentSessionPermission: parent.permission ?? [],
        subagent: next,
      })
      const childToolDenies = [
        ...(next.permission.some((rule) => rule.permission === "todowrite")
          ? []
          : [{ permission: "todowrite" as const, pattern: "*" as const, action: "deny" as const }]),
        ...(next.permission.some((rule) => rule.permission === id)
          ? []
          : [{ permission: id, pattern: "*" as const, action: "deny" as const }]),
        ...(cfg.experimental?.primary_tools?.map((permission) => ({
          permission,
          pattern: "*" as const,
          action: "deny" as const,
        })) ?? []),
      ]
      const nextSession =
        session ??
        (yield* sessions.create({
          parentID: ctx.sessionID,
          title: params.description + ` (@${next.name} subagent)`,
          agent: next.name,
          permission: [
            ...childPermission,
            ...childToolDenies.filter(
              (deny) =>
                !childPermission.some(
                  (rule) =>
                    rule.permission === deny.permission && rule.pattern === deny.pattern && rule.action === deny.action,
                ),
            ),
          ],
        }))

      const msg = yield* MessageV2.get({ sessionID: ctx.sessionID, messageID: ctx.messageID }).pipe(
        Effect.provideService(Database.Service, database),
        Effect.orDie,
      )
      if (msg.info.role !== "assistant") return yield* Effect.fail(new Error("Not an assistant message"))
      const variant = msg.info.variant

      const model = next.model ?? {
        modelID: msg.info.modelID,
        providerID: msg.info.providerID,
      }
      const metadata = {
        parentSessionId: ctx.sessionID,
        sessionId: nextSession.id,
        model,
        ...(runAsync ? { background: true } : {}),
      }

      yield* ctx.metadata({
        title: params.description,
        metadata,
      })

      const ops = ctx.extra?.promptOps as TaskPromptOps
      if (!ops) return yield* Effect.fail(new Error("TaskTool requires promptOps in ctx.extra"))

      // The caller's own admission lease. Everything below it — locating the parent scope,
      // reserving, claiming, and every background start or extend — runs inside the scope this
      // admission opens, so a branch already closing refuses here rather than part-way through.
      //
      // The refusal propagates as a typed failure instead of being caught: an internal admission
      // taken after a fence has to reject, and the tool boundary's `orDie` treats it exactly as it
      // treats any other task failure. Settlement is structural, because the lease is bound to the
      // scope `execute` opens around `run` and so settles on return, failure and interrupt alike.
      const caller = yield* ops.admitScoped({
        session: ctx.sessionID,
        origin: "internal",
        source: "TaskTool.caller",
      })
      // Fail closed: a context carrying no lease cannot admit anything, and treating that as
      // permission would reintroduce exactly the silent-permissive shape the fence removes.
      const callerLease = caller.leases[0]
      if (!callerLease) return yield* Effect.fail(new Error("TaskTool caller admission carries no lease"))
      const jobAdmission = { lease: callerLease, epoch: caller.epoch }

      const attachments = ops.attachments

      // The scope this call is itself running inside, when it is a delegated call. Carried in
      // through `ctx.extra` rather than looked up, so a task can only extend the scope it was
      // actually invoked under; a carried scope that disagrees with the registry is a coordination
      // fault rather than something to reconcile.
      const carried = ctx.extra?.attachment
      const located = yield* attachments.locate(ctx.sessionID)
      const parentScope =
        flags.experimentalBackgroundSubagents &&
        AttachmentCoordinator.isScope(carried) &&
        carried === located &&
        carried.sessionID === ctx.sessionID
          ? carried
          : undefined
      if (flags.experimentalBackgroundSubagents && (carried || located) && !parentScope) {
        // Degrade the generation AT FAULT, which is the carried one whenever it is a scope at all.
        // Before CP-032 R-08 a session held at most one generation, so degrading the registry
        // occupant was the same thing. Atomic replacement makes two generations coexist: a resolved
        // predecessor still referenced by an in-flight delegated call, and the live successor now
        // registered. A stale call carrying the predecessor samples the successor here, and
        // degrading `located` would punish an innocent generation that is correctly serving a
        // different run. With no carried scope there is no faulting generation to name, so the
        // registry occupant remains the only thing to degrade — the original behaviour. Either way
        // the delegated call still fails closed.
        const faulting = AttachmentCoordinator.isScope(carried) ? carried : located
        if (AttachmentCoordinator.isScope(faulting)) yield* faulting.degrade()
        return yield* Effect.fail(new Error(`Attachment scope mismatch for Task ${nextSession.id}`))
      }
      const reservation = parentScope ? yield* parentScope.reserve(nextSession.id) : undefined

      // One prompt-input constructor shared by the owner's run and every supplemental one: a fresh
      // messageID per call, the same child session, agent, model, variant and parts.
      const constructPromptInput = (input: {
        parts: SessionPrompt.PromptInput["parts"]
        attachmentScope?: AttachmentCoordinator.Scope
        onAdmitted?: Effect.Effect<void>
      }): SessionPrompt.TaskPromptInput => ({
        messageID: MessageID.ascending(),
        sessionID: nextSession.id,
        model: {
          modelID: model.modelID,
          providerID: model.providerID,
        },
        variant: next.model ? undefined : variant,
        agent: next.name,
        parts: input.parts,
        ...(input.attachmentScope ? { attachmentScope: input.attachmentScope } : {}),
        ...(input.onAdmitted ? { onAdmitted: input.onAdmitted } : {}),
      })

      /**
       * The filed value is the SELECTED structural result, because that is what each delivery
       * surface needs in order to classify and render at the moment it delivers — and both surfaces
       * now consume the same one rather than the observer rebuilding fallback-only evidence.
       *
       * `position` and `at` come from the CONTROLLING selected assistant, not from the run-final
       * message. Eligibility can select an earlier one: a degraded resolution falls through to the
       * retained fallback, and an observed non-clean turn outranks a later candidate. `at` is still
       * the creation-time chronology key that keeps `(at, position)` ordering correct across the
       * message-id wrap.
       *
       * ORDERING NO LONGER RESTS ON THAT KEY ALONE. `eligible` below puts a real await into the
       * detect-to-file span, which is exactly the condition recorded for reinstating an ordering
       * mechanism. It is reinstated: a scoped run announces its unresolved sequence before parking,
       * and the answer log withholds later sequences until that announcement clears.
       */
      const toDetected = (selected: TaskSelectedReturn, controlling: SessionV1.WithParts) =>
        ({
          position: controlling.info.id,
          at: controlling.info.time.created,
          detected: selected,
        }) satisfies BackgroundJob.Detected

      /**
       * RETURN ELIGIBILITY — the one gate every run shape passes through (CP-032 B-1).
       *
       * A run-final assistant is turn evidence, not by itself an answer. With no attachment scope it
       * is immediately eligible. With one — owner or supplemental alike — the scope decides, and
       * while it is parked this run files NOTHING. That parked turn is the CP-021 yield, and filing
       * it is what lost a child's real return while its attached grandchildren were still running:
       * the yield was published as a completed answer, the lifetime terminalized on it, and the
       * answer that actually came back had no observer left to reach.
       *
       * The announcement is ordering authority only and never becomes output. It is taken
       * immediately after detection with NO await in between, which is what keeps the delivery floor
       * sound: runs of one child session are runner-serialized, so an earlier sequence has always
       * detected — and therefore announced — before a later one can resolve and try to deliver.
       *
       * A cancelled resolution files nothing. Cancellation carries no answer payload and travels the
       * terminal route; filing it merely to satisfy the log shape would hand the caller a completed
       * envelope for a cancelled task.
       */
      const eligible = (invocation: AttachmentCoordinator.Scope | undefined, result: SessionV1.WithParts) =>
        Effect.gen(function* () {
          // Scope-less: nothing can be pending on this turn, so the run-final Assistant IS the
          // answer. This is the only place Task constructs evidence itself, and it is safe precisely
          // because there is no coordinator to disagree with.
          if (!invocation) {
            return toDetected({ type: "evidence", fallback: result, degraded: false }, result)
          }
          // Scoped: announce, then exactly ONE atomic `Scope.result(result)`. Task deliberately does
          // not sample scope resolution and pick a result from that sample (CP-032 R-13). A sample
          // cannot bind its observation to the later call — the scope can resolve in between — and it
          // cannot tell a resolution published FOR THIS TURN from one latched for an earlier turn, so
          // acting on it either discards CP-028 structural selection or swallows a distinct answer.
          // Both questions are answerable only inside the coordinator transition, which is where
          // §3.3.2 now decides them.
          const announce = yield* BackgroundJob.Announce
          yield* announce()
          const selected = yield* invocation.result(result)
          const controlling = controllingAssistant(selected)
          if (!controlling) return undefined
          return toDetected(selected, controlling)
        })

      // A run detects its turn result, then passes it through return eligibility before handing back
      // anything fileable. No rendering and no comparison happen here.
      const detect = (input: { invocation?: AttachmentCoordinator.Scope; onAdmitted?: Effect.Effect<void> }) =>
        Effect.gen(function* () {
          const parts = yield* ops.resolvePromptParts(params.prompt)
          const result = yield* ops.prompt(
            constructPromptInput({ parts, attachmentScope: input.invocation, onAdmitted: input.onAdmitted }),
          )
          // A child that stopped on its own error, or on a failed tool call, fails this call rather
          // than being filed as an answer: the task session stays addressable by `task_id`, so the
          // caller can still inspect or resume it.
          if (result.info.role === "assistant" && result.info.error) {
            const message =
              "message" in result.info.error.data && typeof result.info.error.data.message === "string"
                ? result.info.error.data.message
                : result.info.error.name
            return yield* Effect.fail(new Error(`Subagent failed (task_id: ${nextSession.id}): ${message}`))
          }
          const failed = result.parts.findLast((item) => item.type === "tool" && item.state.status === "error")
          if (failed?.type === "tool" && failed.state.status === "error") {
            return yield* Effect.fail(new Error(`Subagent failed (task_id: ${nextSession.id}): ${failed.state.error}`))
          }
          // Eligibility runs AFTER the owner error checks, so those exits announce nothing and leave
          // no floor to clear. `executeSupplement` deliberately has no equivalent checks and reaches
          // the same gate directly; that asymmetry is preserved, not copied.
          return yield* eligible(input.invocation, result)
        })

      const causeReason = (cause: Cause.Cause<unknown>) => {
        const squashed = Cause.squash(cause)
        // A typed refusal carries its meaning in a structured `reason` while its message is empty,
        // so read that field first and let the notice name what actually happened.
        if (squashed !== null && typeof squashed === "object" && "reason" in squashed) {
          const reason = (squashed as { reason?: unknown }).reason
          if (typeof reason === "string" && reason.length > 0) return reason
        }
        if (squashed instanceof Error) return squashed.message.length > 0 ? squashed.message : "unspecified"
        return String(squashed)
      }

      // This finalizer runs inside the delegated execution being torn down, and it targets the very
      // session whose runner that execution is using. A full `cancel` here would close a loop:
      // cancelling the job awaits this fiber, while the recursive sweep `cancel` performs can reach
      // back to the lifetime whose teardown is doing the awaiting.
      //
      // `reportExact` rather than `interruptExact`, because this caller is the target. If an
      // interrupt for this identity is already in flight, awaiting it would block on a signal that
      // cannot complete until this finalizer returns. Reporting returns immediately and lets the
      // in-flight interrupt finish.
      const interruptReported = <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
        effect.pipe(Effect.onInterrupt(() => ops.physical.reportExact({ type: "session", session: nextSession.id })))

      /**
       * A supplemental prompt: a second call naming a running task's `task_id` joins that task's
       * conversation rather than starting another one.
       *
       * With the feature on it resolves the child scope once - borrowing a live UNRESOLVED scope so
       * claiming the message invalidates the turn's evidence, or opening and finalizing its own when
       * there is no live unresolved scope. A registered scope that has already published its
       * resolution is not borrowable (CP-032 R-08): the open atomically replaces it. With the
       * feature off no scope exists and it prompts without one.
       *
       * Classification consults an `admitted` flag set by its own hook, which fires after the prompt
       * is durably persisted and the conditional claim succeeds. An interrupt rethrows; a failure
       * after admission follows ordinary failure accounting rather than being laundered into an
       * admission notice; and a failure before that flag becomes a notice carried back on this run's
       * own return - no filing, no terminalization, and no interruption of the in-flight run.
       *
       * "Before the flag" is not "before anything happened": the scope-join refusal added by
       * CP-032 R-08 lands after the User message and its Parts are durably persisted. That is the
       * disclosed cost carried by `supplementalAdmissionNote`, not a silently dropped prompt.
       */
      const executeSupplement = () =>
        Effect.gen(function* () {
          const admitted = { value: false }
          const onAdmitted = Effect.sync(() => {
            admitted.value = true
          })
          // Only these three typed refusals become notices. Everything else rethrows: interrupts are
          // owned by cancellation, anything after admission is ordinary failure, and every defect -
          // inside the prompt or outside it - stays a defect.
          const ADMISSION_REFUSAL_TAGS = [
            "SessionClosureAdmissionRefused",
            "SessionClosureMutationRefused",
            "SessionScopeOwnRefused",
          ] as const
          const attempt = (invocation?: AttachmentCoordinator.Scope) =>
            Effect.gen(function* () {
              const parts = yield* ops.resolvePromptParts(params.prompt)
              const outcome = yield* ops
                .prompt(constructPromptInput({ parts, attachmentScope: invocation, onAdmitted }))
                .pipe(
                  Effect.map((result) => ({ _tag: "detected" as const, result })),
                  Effect.catchCause(
                    (
                      cause: Cause.Cause<unknown>,
                    ): Effect.Effect<
                      | { readonly _tag: "detected"; readonly result: SessionV1.WithParts }
                      | { readonly _tag: "note"; readonly note: string },
                      unknown
                    > => {
                      if (Cause.hasInterrupts(cause)) return Effect.failCause(cause)
                      if (admitted.value) return Effect.failCause(cause)
                      if (Cause.hasDies(cause)) return Effect.failCause(cause)
                      const squashed = Cause.squash(cause)
                      const tag =
                        squashed !== null && typeof squashed === "object" && "_tag" in squashed
                          ? (squashed as { readonly _tag?: string })._tag
                          : undefined
                      if (!tag || !ADMISSION_REFUSAL_TAGS.includes(tag as (typeof ADMISSION_REFUSAL_TAGS)[number])) {
                        return Effect.failCause(cause)
                      }
                      return Effect.succeed({
                        _tag: "note" as const,
                        note: supplementalAdmissionNote(causeReason(cause)),
                      })
                    },
                  ),
                )
              if (outcome._tag === "note") return { note: outcome.note } satisfies BackgroundJob.SequenceOutcome
              // Same gate as the owner path. A supplement borrowing a live scope shares its
              // resolution, so both waiters select one answer and the filing guard makes the second
              // a no-op; a supplement that opened its own scope holds it through its descendants.
              return yield* eligible(invocation, outcome.result)
            })
          if (!flags.experimentalBackgroundSubagents) return yield* attempt()
          // CP-032 R-08: BORROW, so this asks `locateBorrowable`, not raw `locate`. A scope that has
          // published its resolution stays registered until its finalizer unregisters it, and once
          // eligibility parks the owner run inside `Scope.result()` that window covers every
          // concurrent sequence. Borrowing one is silent loss: `own()` returns on the `closed` guard
          // without minting a refusal, and `result()` replays the earlier resolution, so this run
          // files the earlier position the guard already holds and its own answer disappears.
          // Raw `locate` keeps registry truth for the parent identity check above and for closure
          // participant discovery; only the borrow is qualified.
          const located = yield* attachments.locateBorrowable(nextSession.id)
          if (located) return yield* attempt(located)
          const opened = yield* attachments.open(nextSession.id).pipe(Effect.exit)
          if (Exit.isFailure(opened)) {
            // Only the exclusive open losing is an admission failure. An interrupted or defective
            // open rethrows - `Effect.exit` captures every cause, so the guards that live inside the
            // prompt's catch have to be restated here.
            if (Cause.hasInterrupts(opened.cause) || Cause.hasDies(opened.cause)) {
              return yield* Effect.failCause(opened.cause)
            }
            return { note: supplementalAdmissionNote(causeReason(opened.cause)) }
          }
          return yield* Effect.acquireUseRelease(
            Effect.succeed(opened.value),
            (scope) => attempt(scope),
            (scope, exit) => AttachmentCoordinator.finalizeScope(scope, exit),
          )
        }).pipe(interruptReported)

      // Public job ids are reusable, so this call keeps the physical lifetime for its own exact
      // wait and cancellation, and the opaque invocation handle for the one async observer. The
      // deferred closes the promotion race: `onPromote` can run before `startExact` returns, so its
      // observer has to await publication rather than read a cell that may still be empty.
      const armed = yield* Deferred.make<
        { readonly lifetime: BackgroundJob.Lifetime; readonly handle: BackgroundJob.InvocationHandle } | undefined
      >()

      // The observer waits on the exact accepted invocation. A wait by public id could attach to a
      // replacement lifetime and report another invocation's outcome as this one's result.
      const armedHandle = Deferred.await(armed).pipe(Effect.map((current) => current?.handle))

      /**
       * The owner's child attachment scope now outlives its run, because the run only detects and
       * returns while the owner's render moment happens later at the delivery surface. Finalizing it
       * therefore belongs to whichever consumer takes the terminal: the synchronous inline path, the
       * observer's completion, or the caller's teardown.
       *
       * The holder makes that exactly-once across those consumers. `observerOwned` records that
       * delivery ownership moved to the observer - a task started asynchronously, or one that was
       * promoted - so a blocked caller's teardown leaves the scope to it.
       */
      const ownerScopeHolder: { scope: AttachmentCoordinator.Scope | undefined; finalized: boolean } = {
        scope: undefined,
        finalized: false,
      }
      const observerOwned = { value: false }
      const finalizeOwnerScope = (exit: Exit.Exit<unknown, unknown>) =>
        Effect.gen(function* () {
          if (!ownerScopeHolder.scope || ownerScopeHolder.finalized) return
          ownerScopeHolder.finalized = true
          yield* AttachmentCoordinator.finalizeScope(ownerScopeHolder.scope, exit)
        })

      // Takes already-rendered text: a completed run carries the structured result the classifier
      // produced inside `runTask`, and re-wrapping it here would give the async path a different
      // shape from the synchronous one.
      const inject = Effect.fn("TaskTool.injectBackgroundResult")(function* (
        text: string,
        attachment?: AttachmentCoordinator.Scope,
      ) {
        const currentParent = yield* sessions.get(ctx.sessionID)
        return yield* ops.prompt({
          sessionID: ctx.sessionID,
          agent: currentParent.agent ?? ctx.agent,
          variant,
          parts: [{ type: "text", synthetic: true, text }],
          ...(attachment ? { attachmentScope: attachment } : {}),
        })
      })

      type AttachedObserver = {
        readonly attachment: AttachmentCoordinator.Scope
        readonly reservation: AttachmentCoordinator.Reservation
        readonly owner: boolean
      }

      // Each delivery is rendered from the retained answer at the moment it is delivered: the filed
      // position carries the selected structural result, never a rendered form.
      //
      // A-1: this used to REBUILD evidence as `{ fallback: <the message>, degraded: false }`, which
      // discarded whatever the coordinator had actually resolved. Candidate/observed selection and
      // the degraded warning were therefore unreachable on every observer route — an async child
      // that degraded, or whose clean final turn followed an earlier observed error, was delivered
      // fallback-only and silently lost that evidence. The filed record is now the selected result
      // itself, so both delivery surfaces render the same facts.
      const renderAnswer = (answer: BackgroundJob.Answer) =>
        renderSelectedTask({
          sessionID: nextSession.id,
          selected: answer.detected as TaskSelectedReturn,
          notes: answer.notes,
        })

      // What the terminal itself adds, per status: the error or cancelled envelope, or a notice-only
      // delivery when a completed terminal still carries undelivered notices. Undefined when the
      // terminal adds nothing.
      const renderTerminal = (info: BackgroundJob.Info): string | undefined => {
        if (info.status === "error") {
          return renderOutput({
            sessionID: nextSession.id,
            state: "error",
            text: info.error ?? "Task failed",
            notes: info.notes,
          })
        }
        if (info.status === "cancelled") {
          return renderCancelledTask({ sessionID: nextSession.id, notes: info.notes })
        }
        if (info.status === "completed" && info.notes?.length) {
          return renderNotices({ sessionID: nextSession.id, notes: info.notes })
        }
        return undefined
      }

      // Drains this lifetime's retained answers in conversation order through the given ingress,
      // then the terminal content, and reports whether anything was delivered. This serves the
      // attached-owner path, whose delivery stays terminal-scoped even though the answers within it
      // are still delivered in order.
      const deliverRetained = Effect.fn("TaskTool.deliverRetained")(function* (
        handle: BackgroundJob.InvocationHandle,
        via: AttachmentCoordinator.Scope | undefined,
      ) {
        const cursor = { value: 0 }
        const state = { injected: false }
        while (true) {
          const step = yield* background.waitAnswer({ handle, after: cursor.value })
          if (step.answer) {
            yield* inject(renderAnswer(step.answer), via)
            state.injected = true
            cursor.value = step.answer.index + 1
            continue
          }
          const info = step.info
          if (!info) return state.injected
          const text = renderTerminal(info)
          if (text !== undefined) {
            yield* inject(text, via)
            state.injected = true
          }
          return state.injected
        }
      })

      /** One continuation lease, one wait, and at most one parent prompt. */
      const notify = Effect.fn("TaskTool.notifyBackgroundResult")(function* (
        handleSource: Effect.Effect<BackgroundJob.InvocationHandle | undefined>,
        target?: AttachedObserver,
      ) {
        // Acquired before the waiter is scheduled, so the lease exists for the whole time the
        // result is outstanding rather than being taken when the result finally lands.
        const acquired = yield* ops
          .acquireContinuation({
            session: ctx.sessionID,
            caller: ctx.sessionID,
            target: nextSession.id,
            source: "TaskTool.notifyBackgroundResult",
          })
          .pipe(Effect.exit)

        if (Exit.isFailure(acquired)) {
          return yield* Effect.gen(function* () {
            // An orderly refusal is expected while a branch is closing and is not a fault.
            if (SessionAdmission.isAdmissionRefusal(acquired.cause)) {
              yield* Effect.logInfo("task continuation refused before scheduling", {
                "session.id": ctx.sessionID,
                "task.id": nextSession.id,
              })
              return
            }
            if (target?.owner) yield* target.attachment.degrade()
            yield* Effect.logError("task continuation acquisition failed before scheduling", {
              "session.id": ctx.sessionID,
              "task.id": nextSession.id,
              cause: Cause.pretty(acquired.cause),
            })
          }).pipe(
            // No observer will ever consume this lifetime's terminal from this invocation, so the
            // owner scope's finalization cannot ride the observation. Without this the child scope
            // stays registered and a later terminal resume fails its exclusive open, leaving a task
            // that cannot be resumed at all.
            Effect.ensuring(finalizeOwnerScope(Exit.void)),
            Effect.ensuring(target?.owner ? target.attachment.finishContinuation() : Effect.void),
          )
        }
        const held = acquired.value

        const observe = Effect.gen(function* () {
          const handle = yield* handleSource
          if (!handle) {
            // Nothing was armed for this attempt, so there is no invocation of ours to observe.
            // Never fall back to the reusable public id.
            if (target?.owner) yield* target.attachment.absent(target.reservation)
            return
          }

          // No attachment, or a scope that has already degraded: deliver each answer through the
          // ordinary parent ingress as it publishes, in conversation order, then the terminal -
          // without claiming the stronger delivery guarantee an owned scope carries. A cancelled
          // child keeps its envelope on both attached and ordinary root notification routes.
          if (!target || !target.owner) {
            const cursor = { value: 0 }
            while (true) {
              const step = yield* background.waitAnswer({ handle, after: cursor.value })
              if (step.answer) {
                if (target?.attachment.current().cancelled) return
                yield* inject(renderAnswer(step.answer))
                cursor.value = step.answer.index + 1
                continue
              }
              const info = step.info
              if (!info) return
              if (target?.attachment.current().cancelled) return
              const text = renderTerminal(info)
              if (text !== undefined) yield* inject(text)
              return
            }
          }

          // Attached owner. Its delivery contract stays terminal-scoped, so wait for the terminal
          // and then deliver the retained answers in order, and the terminal content, inside the
          // window the attachment dance holds open.
          const attachment = target.attachment
          const waited = yield* background.waitHandle({ handle })
          const info = waited.info
          if (!info) {
            yield* attachment.absent(target.reservation)
            return
          }
          if (attachment.current().cancelled) return
          if (attachment.current().failed) {
            yield* deliverRetained(handle, undefined)
            return
          }
          if (info.status === "running") {
            yield* attachment.degrade()
            return
          }

          // The terminal marker is taken before the prompt and cleared only after it succeeds, so a
          // result that was never delivered cannot look delivered.
          const terminal = yield* attachment.terminal(target.reservation)
          if (!terminal) return
          const current = attachment.current()
          if (current.cancelled) return
          const delivered = yield* deliverRetained(handle, current.failed ? undefined : attachment)
          if (!delivered) {
            yield* attachment.degrade()
            return
          }
          yield* attachment.settleTerminal(terminal)

          // The caller may be parked at its return gate with no turn left to observe. One wake gives
          // it a provider turn in which to take the result into account.
          if (yield* attachment.beginWake()) {
            if (ops.wake) yield* ops.wake(ctx.sessionID, attachment).pipe(Effect.ensuring(attachment.endWake()))
            if (!ops.wake) yield* attachment.endWake()
          }
          if (attachment.needsWake()) yield* attachment.exhaustWake()
        })

        const handled = held.observe(observe).pipe(
          Effect.catchCause((cause) => {
            if (!target?.owner) return Effect.void
            if (Cause.hasInterruptsOnly(cause)) return target.attachment.claimCancellation("cancelled")
            return target.attachment.degrade()
          }),
          // BACKSTOP ONLY. The owner scope is released by the lifetime-bound fork in
          // `attachObservation`, because liveness — not delivery — is what the registration
          // describes. This covers the exits where that fork can never fire: no invocation was ever
          // armed, so there is no handle to wait on. `finalizeOwnerScope` dedupes, so it is a no-op
          // after a normal release, and a no-op for extension observers, which hold none.
          Effect.ensuring(finalizeOwnerScope(Exit.void)),
          Effect.ensuring(target?.owner ? target.attachment.finishContinuation() : Effect.void),
        )
        yield* handled.pipe(Effect.forkIn(scope, { startImmediately: true }))
      })

      /** Elects at most one observer per reservation, and never silently shares delivery ownership. */
      const attachObservation = Effect.fn("TaskTool.attachObservation")(function* (
        handleSource: Effect.Effect<BackgroundJob.InvocationHandle | undefined>,
      ) {
        // THE CHILD'S REGISTRATION MEANS ONE THING: THIS CHILD IS LIVE.
        //
        // So it is released when the child's LIFETIME ends, on its own fiber, and nothing about
        // delivery may gate that. Delivery is `inject` — a prompt into the PARENT — and a
        // reply-required prompt into a running session publishes a FIFO entry that cannot run until
        // the active head ends (`prompt` reaches `SessionRunState.publish`). While the release
        // rode the observation's `ensuring`, a finished child stayed registered for the length of a
        // whole parent run, and every `Task(task_id=child)` in that window died on the coordinator's
        // exclusive open.
        //
        // Releasing at a later point INSIDE the delivery does not fix it: the ordinary route injects
        // each filed answer before it ever reaches the terminal branch, and `waitAnswer` reports an
        // answer with no terminal info, so the observer is parked in the parent long before it can
        // learn the child is done. That placement keeps the mismatch and only shrinks the window.
        //
        // Reading the lifetime is what makes registration and liveness the same fact. The exact
        // handle, never the public id: after same-id replacement the id names another lifetime. This
        // waits only — it consumes no answer, so delivery is untouched. Forked here, above the
        // claim, so it is gated on neither the observer's election nor its continuation lease.
        // `finalizeOwnerScope` dedupes, so the no-observer exits below and the backstop still race
        // safely with it.
        //
        // OWNER-SCOPE INVOCATIONS ONLY. Extensions never open one, and a synchronous non-promoted
        // caller still needs its scope after the terminal for the render moment at its delivery
        // surface — that window contains no parent turn, so it does not gate resumption.
        // THE TERMINAL IS PROJECTED, NOT DISCARDED (CP-032 B-3).
        //
        // The lifetime waiter holds the one authoritative statement of how this child ended, so it
        // finalizes the owner scope WITH that outcome. Finalizing every terminal as `Exit.void`
        // closed a cancelled child as a mere degradation, and a degraded close resolves through the
        // evidence gate: `complete()` then reattaches the retained `state.fallback` — an earlier
        // successful turn — and `select()` returns it. A cancelled task would answer with stale text
        // from before its cancellation (CP-023 K14).
        //
        // The Exit IS the carrier, because `AttachmentCoordinator.finalizeScope` already maps one:
        // interrupts claim cancellation, other failures degrade, success closes normally. So this
        // needs no new coordinator entry point (§3.4 allows either) and cannot drift from the
        // mapping every other finalization site already obeys.
        //
        // No authoritative terminal means exactly that: `Exit.void` leaves an unresolved scope to
        // degrade through `closeNow`, and never infers completion or cancellation.
        if (ownerScopeHolder.scope) {
          yield* Effect.gen(function* () {
            const handle = yield* handleSource
            const waited = handle ? yield* background.waitHandle({ handle }) : undefined
            const status = waited?.info?.status
            yield* finalizeOwnerScope(
              status === "cancelled"
                ? Exit.failCause(Cause.interrupt())
                : status === "error"
                  ? Exit.fail(new Error(`Task lifetime ended in error (task_id: ${nextSession.id})`))
                  : Exit.void,
            )
          }).pipe(Effect.forkIn(scope, { startImmediately: true }))
        }
        if (!parentScope || !reservation) {
          yield* notify(handleSource)
          return
        }
        const claim = yield* parentScope.claimObserver(reservation)
        if (claim.type === "owner") {
          yield* notify(handleSource, { attachment: parentScope, reservation, owner: true })
          return
        }
        if (claim.type === "fallback") {
          yield* Effect.logWarning("attached task degraded before observer ownership; routing ordinarily", {
            "session.id": ctx.sessionID,
            "task.id": nextSession.id,
          })
          yield* notify(handleSource, { attachment: parentScope, reservation, owner: false })
          return
        }
        // Every exit below installs no observer, so the owner scope has to be finalized here or it
        // would leak past a no-observer outcome. Exactly-once; extensions never hold one.
        if (claim.type !== "unavailable") {
          yield* finalizeOwnerScope(Exit.void)
          return
        }
        if (claim.reason !== "invalid") {
          yield* finalizeOwnerScope(Exit.void)
          return
        }
        const current = parentScope.current()
        if (!current.failed || current.cancelled) {
          yield* finalizeOwnerScope(Exit.void)
          return
        }
        yield* Effect.logWarning("attached task unavailable before observer ownership; routing ordinarily", {
          "session.id": ctx.sessionID,
          "task.id": nextSession.id,
          reason: claim.reason,
        })
        yield* notify(handleSource, { attachment: parentScope, reservation, owner: false })
      })

      const attach = Effect.fn("TaskTool.attach")(function* () {
        yield* attachObservation(armedHandle)
      })

      const attachExtension = Effect.fn("TaskTool.attachExtension")(function* (handle: BackgroundJob.InvocationHandle) {
        // A root extension already belongs either to the original synchronous waiter or to the one
        // observer installed when that lifetime became async. Installing another notifier here would
        // duplicate the result and every later extension. Only a distinct parent reservation can own
        // a new observer cohort.
        if (!parentScope || !reservation) return
        yield* attachObservation(Effect.succeed(handle))
      })

      const runningResult = (summary: "Async task started" | "Async task updated", text: string) => ({
        title: params.description,
        metadata: {
          ...metadata,
          background: true,
          jobId: nextSession.id,
        },
        output: renderOutput({
          sessionID: nextSession.id,
          state: "running" as const,
          summary,
          text,
        }),
      })

      const collision = Effect.fn("TaskTool.collision")(function* () {
        const current = yield* background.get(nextSession.id)
        if (parentScope) yield* parentScope.degrade()
        return yield* Effect.fail(
          new Error(
            `Task ${nextSession.id} collided with an incompatible background lifetime (status: ${current?.status ?? "unknown"})`,
          ),
        )
      })

      // One call owns the initial start. A second call aimed at the same task_id either becomes a
      // supplemental prompt joining the run that start produced, or is told it collided — it never
      // creates a second lifetime, and it never shares delivery ownership ambiguously.
      //
      // The claim is taken in both feature modes, because a supplemental prompt is possible in both:
      // an extension carries different content joining the same conversation, so which prompt is
      // admitted first is a question that exists whether or not attachment machinery does.
      const claim = yield* attachments.claim(nextSession.id)

      // Owner-first ordering: the owner's claim settles true at its own admission - after its prompt
      // is durably persisted and the conditional claim succeeds - so a racing same-id call cannot
      // register ahead of the owner's first message. The run's `ensuring` settles false as the net
      // for every exit that never admits; settling dedupes, so a late false after a true admission
      // does nothing.
      const executeOwner = (invocation?: AttachmentCoordinator.Scope) =>
        detect({
          invocation,
          onAdmitted: attachments.settleClaim(claim, true),
        }).pipe(interruptReported, Effect.ensuring(attachments.settleClaim(claim, false)))

      /**
       * The receipt for a supplemental prompt is keyed on the accepted lifetime's actual delivery
       * mode, never on the feature flag and never on a re-read by public id.
       *
       * Public ids are reusable: between acceptance and this read the accepted lifetime can
       * terminalize and a same-id replacement can install, so reading by id could describe the wrong
       * lifetime. The exact invocation handle reads the accepted lifetime's own record, which
       * survives replacement. Directing the caller to the async protocol is only true of a lifetime
       * that has an observer; a foreground one has none, and neither does an unreadable record.
       */
      const supplementReceipt = (handle: BackgroundJob.InvocationHandle) =>
        Effect.gen(function* () {
          const current = yield* background.waitHandle({ handle, timeout: 0 })
          return runningResult(
            "Async task updated",
            current.info?.metadata?.background === true ? ASYNC_UPDATED : TASK_UPDATED,
          )
        })

      if (claim && !claim.owner) {
        if (!(yield* attachments.awaitClaim(claim))) {
          if (parentScope && reservation) yield* parentScope.reject(reservation)
          return yield* collision()
        }
        if (parentScope) yield* background.promote(nextSession.id)
        const handle = yield* background.extendWithHandle({
          id: nextSession.id,
          run: executeSupplement(),
          admission: jobAdmission,
        })
        if (!handle) {
          if (parentScope && reservation) yield* parentScope.reject(reservation)
          return yield* collision()
        }
        yield* attachExtension(handle)
        return yield* supplementReceipt(handle)
      }

      const admission = yield* Effect.gen(function* () {
        if (parentScope) yield* background.promote(nextSession.id)
        const extended = yield* background
          .extendWithHandle({ id: nextSession.id, run: executeSupplement(), admission: jobAdmission })
          .pipe(Effect.exit)
        if (Exit.isFailure(extended)) {
          if (parentScope && reservation) yield* parentScope.reject(reservation)
          return yield* Effect.failCause(extended.cause)
        }
        if (extended.value) {
          yield* attachExtension(extended.value)
          if (claim) yield* attachments.settleClaim(claim, true)
          return { type: "extended" as const, handle: extended.value }
        }

        // The previous lifetime may have terminalized while its sole observer still owns this
        // reservation. Starting a replacement under it would let that observer consume the wrong
        // lifetime's result.
        if (parentScope && reservation && !reservation.fresh) {
          yield* parentScope.reject(reservation)
          return yield* collision()
        }

        // The owner's child attachment scope is opened before registration and outlives its run: the
        // run detects and returns, while the owner's render moment - the selection that may park for
        // attached children - happens later at the synchronous delivery surface. Whichever consumer
        // takes the terminal finalizes it.
        ownerScopeHolder.scope = flags.experimentalBackgroundSubagents
          ? yield* attachments.open(nextSession.id)
          : undefined
        const ownerScope = ownerScopeHolder.scope

        // The observer forks above `startExact`. It awaits the armed handle, and answers stay
        // retained until observed, so nothing can be missed by starting it early. Forked rather than
        // awaited because acquiring the continuation lease can park, and a parked acquisition must
        // never gate the lifetime's registration.
        if (runAsync) {
          observerOwned.value = true
          yield* attach().pipe(Effect.forkIn(scope, { startImmediately: true }))
        }

        const started = yield* background
          .startExact({
            id: nextSession.id,
            type: id,
            title: params.description,
            /**
             * The Task-edge coordinates, added to the job's metadata only.
             *
             * The bare `metadata` object is shared with the ToolPart: `ctx.metadata({ metadata })`
             * writes it as product-visible part bytes, and `onPromote` below rewrites it. Spreading
             * the coordinates here rather than into `metadata` itself is what keeps them off that
             * surface — `startExact` takes its own metadata argument, so the job carries two extra
             * keys while the ToolPart's bytes stay unchanged.
             *
             * A message and a call, because that is all `Tool.Context` carries. There is no `partID`
             * on it; the durable triple lives only in the processor's process-local `ctx.toolcalls`,
             * which is gone by the time closure proves quiescence. `Ports.ToolPartCapability`
             * resolves the part from these coordinates downstream, after the proof.
             *
             * `taskCallId` is omitted rather than written `undefined` when absent, so the shape
             * check in `closure/discovery.ts` reports "no coordinate" instead of coercing one.
             * Missing evidence must not widen cancellation authority, and an invented coordinate is
             * how a branch walk would widen it.
             */
            metadata: {
              ...metadata,
              taskMessageId: ctx.messageID,
              ...(ctx.callID ? { taskCallId: ctx.callID } : {}),
            },
            onPromote: Effect.all([
              Effect.sync(() => {
                observerOwned.value = true
              }),
              ctx.metadata({
                title: params.description,
                metadata: { ...metadata, background: true, jobId: nextSession.id },
              }),
              attach(),
            ]),
            outstanding: { observer: OUTSTANDING_ASYNC_NOTE, inline: OUTSTANDING_SYNC_NOTE },
            run: executeOwner(ownerScope),
            admission: jobAdmission,
          })
          .pipe(Effect.exit)
        if (Exit.isFailure(started)) {
          // An observer can already be waiting on the handle: `onPromote` is live from registration
          // onward, which is inside `startExact`. Publishing the absence releases it, and `undefined`
          // is the honest value — a start that failed armed no lifetime for anyone to observe.
          yield* Deferred.succeed(armed, undefined)
          yield* finalizeOwnerScope(started)
          if (parentScope && reservation) yield* parentScope.reject(reservation)
          return yield* Effect.failCause(started.cause)
        }
        // Published before any observer can need it. The lifetime is absent only when this attempt
        // joined an arm already in progress that then terminalized; passing that absence through
        // unchanged is deliberate, because it is the one fact observers need.
        yield* Deferred.succeed(
          armed,
          started.value.lifetime && started.value.handle
            ? { lifetime: started.value.lifetime, handle: started.value.handle }
            : undefined,
        )
        return { type: "started" as const, result: started.value }
      }).pipe(
        // Settle false only when this block armed no run at all. An armed run settles its own claim,
        // true at its admission or false in its `ensuring`, so settling here as well would race it.
        Effect.onExit((exit) => {
          const armedRun =
            Exit.isSuccess(exit) &&
            (exit.value.type === "extended" ||
              (exit.value.result.lifetime !== undefined && exit.value.result.handle !== undefined))
          return armedRun ? Effect.void : attachments.settleClaim(claim, false)
        }),
      )

      if (admission.type === "extended") {
        return yield* supplementReceipt(admission.handle)
      }
      const info = admission.result.info
      // The exact lifetime the synchronous consumers below are entitled to act on.
      const lifetime = admission.result.lifetime

      function backgroundResult() {
        return {
          title: params.description,
          metadata: {
            ...metadata,
            background: true,
            jobId: info.id,
          },
          output: renderOutput({
            sessionID: nextSession.id,
            state: "running",
            summary: "Async task started",
            text: ASYNC_STARTED,
          }),
        }
      }

      if (runAsync) {
        return backgroundResult()
      }

      const runCancel = yield* EffectBridge.make()
      const cancel = ops.cancel(nextSession.id)

      function onAbort() {
        runCancel.fork(cancel)
      }

      return yield* Effect.acquireUseRelease(
        Effect.sync(() => {
          ctx.abort.addEventListener("abort", onAbort)
          // A signal that already fired before the listener was attached would otherwise be missed
          // entirely, leaving the child running after the caller was aborted.
          if (ctx.abort.aborted) onAbort()
        }),
        () =>
          Effect.gen(function* () {
            const result = yield* Effect.raceFirst(
              // The exact handle, never the public id. A wait by id here could return a replacement
              // lifetime's terminal info and report it as this task's own result.
              lifetime
                ? background.waitExact({ lifetime }).pipe(Effect.map((waited) => waited.info))
                : // Nothing was armed for this invocation: it joined an arm already in progress that
                  // then terminalized, and the `info` already in hand is that attempt's own terminal
                  // snapshot. Re-reading by id could only find a successor. Resolving rather than
                  // parking also keeps this racer live, which the promotion racer below relies on.
                  Effect.succeed(info),
              // `waitForPromotionExact` reports `undefined` for a stale or already-terminal lifetime
              // where the id-based method blocks forever. That is honest for a direct caller but
              // wrong inside this race: a non-promotion resolving first would win, and the terminal
              // outcome the other racer holds would read as "no result" — a completed task with
              // empty output. So only an actual promotion may win, and a non-answer parks. It cannot
              // hang the race, because the racer above always resolves.
              lifetime
                ? background
                    .waitForPromotionExact(lifetime)
                    .pipe(Effect.flatMap((promoted) => (promoted ? Effect.succeed(promoted) : Effect.never)))
                : Effect.never,
            )
            if (result?.metadata?.background === true) {
              // Delivery ownership moved to the observer, so the owner scope is now its to finalize.
              observerOwned.value = true
              return backgroundResult()
            }
            // Settled synchronously, so no async observer will ever consume this reservation.
            if (parentScope && reservation) yield* parentScope.reject(reservation)
            if (result?.status === "error") {
              // A failure carries the terminal's own reason. Any answer this lifetime filed stays
              // retained rather than being joined into the error text, and the caller necessarily
              // holds the task_id that reaches it.
              return yield* Effect.fail(new Error(result.error ?? "Task failed"))
            }
            // A cancelled child is reported as a result rather than a tool failure: the task session
            // is still addressable, and the caller needs to be able to tell "the child was stopped"
            // from "the task tool could not run".
            if (result?.status === "cancelled") {
              yield* finalizeOwnerScope(Exit.failCause(Cause.interrupt()))
              return {
                title: params.description,
                metadata,
                output: renderCancelledTask({
                  sessionID: nextSession.id,
                  notes: result.notes,
                }),
              }
            }
            // The success slot carries the first answer in conversation order - the one this blocked
            // call's own prompt produced - and it is rendered here, at the moment of delivery, in
            // owner context: the selection that may park for attached children, then classification.
            // Presence is the check rather than truthiness, because an empty answer is a real one.
            // Eligibility and CP-028 selection already happened INSIDE the run, before filing
            // (CP-032 B-1), so this consumes the selected record rather than resolving the scope a
            // second time. Resolving again here would also be actively wrong now: `Scope.result`
            // latches its argument as the retained fallback, and the argument available here is no
            // longer a message.
            const selected =
              result && Object.hasOwn(result, "output") ? (result.output as TaskSelectedReturn) : undefined
            const rendered = selected
              ? renderSelectedTask({ sessionID: nextSession.id, selected, notes: result?.notes })
              : ""
            yield* finalizeOwnerScope(Exit.void)
            return {
              title: params.description,
              metadata,
              output: rendered,
            }
          }),
        (_, exit) =>
          Effect.gen(function* () {
            if (Exit.hasInterrupts(exit)) {
              if (parentScope) yield* parentScope.claimCancellation("cancelled")
              // The exact lifetime this invocation started, never the public id. After a
              // replacement, a cancel by id lands on a lifetime this task never started — and unlike
              // the sweeps, that one is currently being run by another live invocation. With no
              // lifetime there is nothing of ours to cancel: the attempt we joined had already
              // terminalized.
              yield* Effect.all(
                [
                  // Synchronous teardown is finalizer-safe territory too, so it takes the exact
                  // physical interrupt rather than `cancel`'s full sweep. `interruptExact` rather
                  // than `reportExact` because this runs in the caller's tool fiber, not inside the
                  // child execution — an independent caller, free to adopt an in-flight interrupt
                  // and take its result.
                  ops.physical.interruptExact({ type: "session", session: nextSession.id }),
                  // The exact lifetime this invocation started, never the public id. Routed through
                  // the registry so it dedupes against an interrupt already tearing this same
                  // lifetime down. With no lifetime there is nothing of ours to cancel: the attempt
                  // we joined had already terminalized.
                  lifetime ? ops.physical.interruptExact({ type: "lifetime", lifetime }) : Effect.void,
                ],
                { discard: true },
              )
            }
            // Teardown is the owner scope's last consumer unless delivery ownership moved to the
            // observer. On interrupt the exit is carried through so the scope claims cancellation;
            // after an inline return this is a no-op backstop.
            if (!observerOwned.value) yield* finalizeOwnerScope(exit)
          }).pipe(
            Effect.ensuring(
              Effect.sync(() => {
                ctx.abort.removeEventListener("abort", onAbort)
              }),
            ),
          ),
      )
    })

    return {
      description: flags.experimentalBackgroundSubagents
        ? [DESCRIPTION, ASYNC_TASK_PROTOCOL].join("\n\n")
        : DESCRIPTION,
      parameters: Parameters,
      // The advertised schema never carries `background`: a deprecated alias should stay decodable
      // without being offered as a second way to say the same thing.
      jsonSchema: ToolJsonSchema.fromSchema(flags.experimentalBackgroundSubagents ? AsyncParameters : BaseParameters),
      // `Effect.scoped` is what makes the caller lease settle structurally: it opens a scope for
      // exactly one invocation and closes it on every exit, so the finalizer `admitScoped`
      // registered runs whether `run` returns, fails, is interrupted or dies. It sits inside
      // `orDie` so the lease settles before a failure becomes a defect.
      //
      // The observer forked for an async result uses the service scope captured at construction, so
      // it is unaffected by this boundary — correctly, since it holds its own continuation lease
      // with its own settlement.
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.scoped(run(params, ctx)).pipe(Effect.orDie),
    }
  }),
)
