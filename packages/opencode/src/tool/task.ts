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
import { renderCancelledTask, renderOutput, renderSelectedTask } from "@/session/task-return"
import { Config } from "@/config/config"
import { Cause, Deferred, Effect, Exit, Schema, Scope } from "effect"
import { EffectBridge } from "@/effect/bridge"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { Database } from "@opencode-ai/core/database/database"
import { ASYNC_TASK_PROTOCOL } from "./task-protocol"

type AdmissionError = SessionClosure.AdmissionRefused | SessionMutation.MutationRefused

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
const ASYNC_UPDATED = "Additional context queued for the running async task. Follow the Async Task Protocol."
const TASK_UPDATED =
  "Additional context queued for the running task. You will be notified automatically when it finishes."
const ASYNC_PARAMETER_DESCRIPTION =
  "Start the subagent asynchronously; Task returns a running receipt instead of waiting for the subagent's result"
const BACKGROUND_PARAMETER_DESCRIPTION =
  "Deprecated alias for `async`, still accepted so existing callers keep working. Use `async` instead."

const BaseParameterFields = {
  description: Schema.String.annotate({ description: "A short (3-5 words) description of the task" }),
  prompt: Schema.String.annotate({ description: "The task for the agent to perform" }),
  subagent_type: Schema.String.annotate({ description: "The type of specialized agent to use for this task" }),
  task_id: Schema.optional(Schema.String).annotate({
    description:
      "This should only be set if you mean to resume a previous task (you can pass a prior task_id and the task will continue the same subagent session as before instead of creating a fresh one)",
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
        if (AttachmentCoordinator.isScope(located)) yield* located.degrade()
        return yield* Effect.fail(new Error(`Attachment scope mismatch for Task ${nextSession.id}`))
      }
      const reservation = parentScope ? yield* parentScope.reserve(nextSession.id) : undefined

      // A successful replacement overwrites the terminal entry during registration, before the
      // replacement run starts. Capture the earlier successful output while it is still addressable;
      // an empty string is meaningful prior output and must not collapse into absence.
      const previous = yield* background.get(nextSession.id)
      const priorOutput = previous && Object.hasOwn(previous, "output") ? (previous.output ?? "") : undefined

      const runTask = Effect.fn("TaskTool.runTask")(function* () {
        const invoke = (invocation?: AttachmentCoordinator.Scope) =>
          Effect.gen(function* () {
            const parts = yield* ops.resolvePromptParts(params.prompt)
            const result = yield* ops.prompt({
              messageID: MessageID.ascending(),
              sessionID: nextSession.id,
              model: {
                modelID: model.modelID,
                providerID: model.providerID,
              },
              variant: next.model ? undefined : variant,
              agent: next.name,
              parts,
              ...(invocation ? { attachmentScope: invocation } : {}),
            })
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
            // The return gate. `result()` releases only once the async children this call started
            // have settled, so a subagent cannot answer its caller before their results arrive.
            const selected = invocation
              ? yield* invocation.result(result)
              : ({ type: "evidence", fallback: result, degraded: false } as const)
            // Classified here, once, so the synchronous return and the async callback carry the
            // same structured result rather than each deriving their own.
            return renderSelectedTask({ sessionID: nextSession.id, selected, priorOutput })
          })

        if (!flags.experimentalBackgroundSubagents) return yield* invoke()
        const invocation = yield* attachments.open(nextSession.id)
        return yield* Effect.acquireUseRelease(
          Effect.succeed(invocation),
          (current) => invoke(current),
          (current, exit) => AttachmentCoordinator.finalizeScope(current, exit),
        )
      })

      // This finalizer runs inside the delegated execution being torn down, and it targets the very
      // session whose runner that execution is using. A full `cancel` here would close a loop:
      // cancelling the job awaits this fiber, while the recursive sweep `cancel` performs can reach
      // back to the lifetime whose teardown is doing the awaiting.
      //
      // `reportExact` rather than `interruptExact`, because this caller is the target. If an
      // interrupt for this identity is already in flight, awaiting it would block on a signal that
      // cannot complete until this finalizer returns. Reporting returns immediately and lets the
      // in-flight interrupt finish.
      const executeTask = () =>
        runTask().pipe(Effect.onInterrupt(() => ops.physical.reportExact({ type: "session", session: nextSession.id })))

      // Public job ids are reusable, so this call keeps the physical lifetime for its own exact
      // wait and cancellation, and the opaque invocation handle for the one async observer. The
      // deferred closes the promotion race: `onPromote` can run before `startExact` returns, so its
      // observer has to await publication rather than read a cell that may still be empty.
      const armed = yield* Deferred.make<
        { readonly lifetime: BackgroundJob.Lifetime; readonly handle: BackgroundJob.InvocationHandle } | undefined
      >()

      // The observer waits on the exact accepted invocation. A wait by public id could attach to a
      // replacement lifetime and report another invocation's outcome as this one's result.
      const exactObservation = Deferred.await(armed).pipe(
        Effect.flatMap((current) =>
          current
            ? background.waitHandle({ handle: current.handle })
            : // Nothing was armed for this attempt, so there is no invocation of ours to observe.
              // Never fall back to the reusable public id.
              Effect.succeed<BackgroundJob.WaitResult>({ timedOut: false }),
        ),
      )

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

      /**
       * Output retained from a terminal run that a later invocation replaced. A completed run has
       * no prior output to report — its own output is the result — and an empty string is real
       * output, so absence and emptiness stay distinct.
       */
      const prior = (info: BackgroundJob.Info): string | undefined => {
        if (info.status === "completed") return undefined
        if (!Object.hasOwn(info, "output")) return undefined
        return info.output ?? ""
      }

      const injectResult = Effect.fn("TaskTool.injectObservedResult")(function* (
        info: BackgroundJob.Info,
        attachment: AttachmentCoordinator.Scope | undefined,
        allowCancelled: boolean,
      ) {
        if (info.status === "completed") {
          yield* inject(info.output ?? "", attachment)
          return true
        }
        if (info.status === "error") {
          yield* inject(
            renderOutput({
              sessionID: nextSession.id,
              state: "error",
              priorOutput: prior(info),
              text: info.error ?? "Task failed",
            }),
            attachment,
          )
          return true
        }
        if (info.status === "cancelled" && allowCancelled) {
          yield* inject(
            renderCancelledTask({ sessionID: nextSession.id, status: "cancelled", priorOutput: prior(info) }),
            attachment,
          )
          return true
        }
        return false
      })

      /** One continuation lease, one wait, and at most one parent prompt. */
      const notify = Effect.fn("TaskTool.notifyBackgroundResult")(function* (
        observation: Effect.Effect<BackgroundJob.WaitResult>,
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
          }).pipe(Effect.ensuring(target?.owner ? target.attachment.finishContinuation() : Effect.void))
        }
        const held = acquired.value

        const observe = Effect.gen(function* () {
          const result = yield* observation
          const info = result.info
          if (!info) {
            if (target?.owner) yield* target.attachment.absent(target.reservation)
            return
          }
          if (target?.attachment.current().cancelled) return

          // No attachment, or a scope that has already degraded: use the ordinary parent ingress
          // exactly once, without claiming the stronger delivery guarantee an owned scope carries.
          // A cancelled child still keeps its envelope when this invocation was attached; ordinary
          // root notification continues to suppress cancellation.
          if (!target || !target.owner) {
            yield* injectResult(info, undefined, target !== undefined)
            return
          }

          const attachment = target.attachment
          if (attachment.current().failed) {
            yield* injectResult(info, undefined, true)
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
          const delivered = yield* injectResult(info, current.failed ? undefined : attachment, true)
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
          Effect.ensuring(target?.owner ? target.attachment.finishContinuation() : Effect.void),
        )
        yield* handled.pipe(Effect.forkIn(scope, { startImmediately: true }))
      })

      /** Elects at most one observer per reservation, and never silently shares delivery ownership. */
      const attachObservation = Effect.fn("TaskTool.attachObservation")(function* (
        observation: Effect.Effect<BackgroundJob.WaitResult>,
      ) {
        if (!parentScope || !reservation) {
          yield* notify(observation)
          return
        }
        const claim = yield* parentScope.claimObserver(reservation)
        if (claim.type === "owner") {
          yield* notify(observation, { attachment: parentScope, reservation, owner: true })
          return
        }
        if (claim.type === "fallback") {
          yield* Effect.logWarning("attached task degraded before observer ownership; routing ordinarily", {
            "session.id": ctx.sessionID,
            "task.id": nextSession.id,
          })
          yield* notify(observation, { attachment: parentScope, reservation, owner: false })
          return
        }
        if (claim.type !== "unavailable") return
        if (claim.reason !== "invalid") return
        const current = parentScope.current()
        if (!current.failed || current.cancelled) return
        yield* Effect.logWarning("attached task unavailable before observer ownership; routing ordinarily", {
          "session.id": ctx.sessionID,
          "task.id": nextSession.id,
          reason: claim.reason,
        })
        yield* notify(observation, { attachment: parentScope, reservation, owner: false })
      })

      const attach = Effect.fn("TaskTool.attach")(function* () {
        yield* attachObservation(exactObservation)
      })

      const attachExtension = Effect.fn("TaskTool.attachExtension")(function* (
        handle: BackgroundJob.InvocationHandle,
      ) {
        // A root extension already belongs either to the original synchronous waiter or to the one
        // observer installed when that lifetime became async. Installing another notifier here would
        // duplicate the result and every later extension. Only a distinct parent reservation can own
        // a new observer cohort.
        if (!parentScope || !reservation) return
        yield* attachObservation(background.waitHandle({ handle }))
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

      // One call owns the initial start. A second call aimed at the same task_id either becomes an
      // ordered extension of the run that start produced, or is told it collided — it never creates
      // a second lifetime, and it never shares delivery ownership ambiguously.
      const claim = flags.experimentalBackgroundSubagents ? yield* attachments.claim(nextSession.id) : undefined
      if (claim && !claim.owner) {
        if (!(yield* attachments.awaitClaim(claim))) {
          if (parentScope && reservation) yield* parentScope.reject(reservation)
          return yield* collision()
        }
        if (parentScope) yield* background.promote(nextSession.id)
        const handle = yield* background.extendWithHandle({
          id: nextSession.id,
          run: executeTask(),
          admission: jobAdmission,
        })
        if (!handle) {
          if (parentScope && reservation) yield* parentScope.reject(reservation)
          return yield* collision()
        }
        yield* attachExtension(handle)
        return runningResult("Async task updated", flags.experimentalBackgroundSubagents ? ASYNC_UPDATED : TASK_UPDATED)
      }

      const admission = yield* Effect.gen(function* () {
        if (parentScope) yield* background.promote(nextSession.id)
        const extended = yield* background
          .extendWithHandle({ id: nextSession.id, run: executeTask(), admission: jobAdmission })
          .pipe(Effect.exit)
        if (Exit.isFailure(extended)) {
          if (parentScope && reservation) yield* parentScope.reject(reservation)
          return yield* Effect.failCause(extended.cause)
        }
        if (extended.value) {
          yield* attachExtension(extended.value)
          if (claim) yield* attachments.settleClaim(claim, true)
          return { type: "extended" as const }
        }

        // The previous lifetime may have terminalized while its sole observer still owns this
        // reservation. Starting a replacement under it would let that observer consume the wrong
        // lifetime's result.
        if (parentScope && reservation && !reservation.fresh) {
          yield* parentScope.reject(reservation)
          return yield* collision()
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
              ctx.metadata({
                title: params.description,
                metadata: { ...metadata, background: true, jobId: nextSession.id },
              }),
              attach(),
            ]),
            run: executeTask(),
            admission: jobAdmission,
          })
          .pipe(Effect.exit)
        if (Exit.isFailure(started)) {
          // An observer can already be waiting on the handle: `onPromote` is live from registration
          // onward, which is inside `startExact`. Publishing the absence releases it, and `undefined`
          // is the honest value — a start that failed armed no lifetime for anyone to observe.
          yield* Deferred.succeed(armed, undefined)
          if (parentScope && reservation) yield* parentScope.reject(reservation)
          return yield* Effect.failCause(started.cause)
        }
        // Published before `attach()`, so the common async path never parks. The lifetime is absent
        // only when this attempt joined an arm already in progress that then terminalized; passing
        // that absence through unchanged is deliberate, because it is the one fact observers need.
        yield* Deferred.succeed(
          armed,
          started.value.lifetime && started.value.handle
            ? { lifetime: started.value.lifetime, handle: started.value.handle }
            : undefined,
        )
        if (runAsync) yield* attach()
        if (claim) yield* attachments.settleClaim(claim, true)
        return { type: "started" as const, result: started.value }
      }).pipe(Effect.ensuring(claim ? attachments.settleClaim(claim, false) : Effect.void))

      if (admission.type === "extended") {
        return runningResult("Async task updated", flags.experimentalBackgroundSubagents ? ASYNC_UPDATED : TASK_UPDATED)
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
            if (result?.metadata?.background === true) return backgroundResult()
            // Settled synchronously, so no async observer will ever consume this reservation.
            if (parentScope && reservation) yield* parentScope.reject(reservation)
            if (result?.status === "error") {
              const reason = result.error ?? "Task failed"
              const output = prior(result)
              const body =
                output === undefined
                  ? reason
                  : ["<task_prior_output>", output, "</task_prior_output>", reason].join("\n")
              return yield* Effect.fail(new Error(body))
            }
            // A cancelled child is reported as a result rather than a tool failure: the task session
            // is still addressable, and the caller needs to be able to tell "the child was stopped"
            // from "the task tool could not run".
            if (result?.status === "cancelled") {
              return {
                title: params.description,
                metadata,
                output: renderCancelledTask({
                  sessionID: nextSession.id,
                  status: "cancelled",
                  priorOutput: prior(result),
                }),
              }
            }
            // Already the structured result the classifier produced inside `runTask`; re-wrapping it
            // here is what made a failed child look like an empty successful task.
            return {
              title: params.description,
              metadata,
              output: result?.output ?? "",
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
