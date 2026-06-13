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
import { SubagentLimits } from "../session/subagent-limits"
import { TurnBudget } from "../session/turn-budget"
import { Config } from "@/config/config"
import { Effect, Exit, Option, Schema, Scope } from "effect"
import { EffectBridge } from "@/effect/bridge"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { Database } from "@opencode-ai/core/database/database"

export interface TaskPromptOps {
  cancel(sessionID: SessionID): Effect.Effect<void>
  resolvePromptParts(template: string): Effect.Effect<SessionPrompt.PromptInput["parts"]>
  /**
   * design-final §4.6: `turnBudgetPool` is the root turn's live TurnBudget.Pool,
   * shared BY REFERENCE through every nesting level (the non-serializable
   * intersection follows the LoopOptions pattern — the pool must never ride a
   * schema). The receiving side (SessionPrompt.prompt) prefers the pool over
   * creating a fresh one from `turnBudget`, so the child loop charges the same
   * headroom as the root turn.
   */
  prompt(input: SessionPrompt.PromptInput & { turnBudgetPool?: TurnBudget.Pool }): Effect.Effect<SessionV1.WithParts>
  /**
   * The session's currently RESOLVED model (session.model → last user message's
   * model → provider default) — the same chain the prompt loop uses for a turn
   * with no explicit model. Lets a tool (e.g. workflow start) capture the
   * caller's effective model so subagents without an explicit override can
   * inherit it (Item 12). Optional so existing prompt-ops stubs keep compiling;
   * consumers read it defensively.
   */
  currentModel?(sessionID: SessionID): Effect.Effect<{ providerID: string; modelID: string; variant?: string }>
}

const id = "task"
const BACKGROUND_DESCRIPTION = [
  "Background mode: background=true launches the subagent asynchronously and returns immediately.",
  "Foreground is the default; use it when you need the result before continuing.",
  "Use background only for independent work that can run while you continue elsewhere.",
  "You will be notified automatically when it finishes.",
].join(" ")
const BACKGROUND_STARTED = [
  "The task is working in the background. You will be notified automatically when it finishes.",
  "DO NOT sleep, poll for progress, ask the task for status, or duplicate this task's work — avoid working with the same files or topics it is using.",
  "Work on non-overlapping tasks, or briefly tell the user what you launched and end your response.",
].join("\n")
const BACKGROUND_UPDATED = [
  "Additional context sent to the running background task.",
  "The task is still working in the background. You will be notified automatically when it finishes.",
  "DO NOT sleep, poll for progress, ask the task for status, or duplicate this task's work — avoid working with the same files or topics it is using.",
  "Work on non-overlapping tasks, or briefly tell the user what you sent and end your response.",
].join("\n")

const BaseParameterFields = {
  description: Schema.String.annotate({ description: "A short (3-5 words) description of the task" }),
  prompt: Schema.String.annotate({ description: "The task for the agent to perform" }),
  subagent_type: Schema.String.annotate({ description: "The type of specialized agent to use for this task" }),
  task_id: Schema.optional(Schema.String).annotate({
    description:
      "This should only be set if you mean to resume a previous task (you can pass a prior task_id and the task will continue the same subagent session as before instead of creating a fresh one)",
  }),
  command: Schema.optional(Schema.String).annotate({ description: "The command that triggered this task" }),
  timeout: Schema.optional(Schema.Number).annotate({
    description:
      "Optional timeout in milliseconds for this foreground task. When it elapses the subagent (and its whole subtree) is aborted and this call fails with a timeout error; do the work yourself or retry with a larger value. Overrides experimental.subagent_task_timeout. Ignored for background tasks.",
  }),
}

const BaseParameters = Schema.Struct(BaseParameterFields)

export const Parameters = Schema.Struct({
  ...BaseParameterFields,
  background: Schema.optional(Schema.Boolean).annotate({
    description:
      "Run the agent in the background. You will be notified when it completes. DO NOT sleep, poll, or proactively check on its progress",
  }),
})

function renderOutput(input: {
  sessionID: SessionID
  state: "running" | "completed" | "error"
  summary?: string
  text: string
}) {
  const tag = input.state === "error" ? "task_error" : "task_result"
  return [
    `<task id="${input.sessionID}" state="${input.state}">`,
    ...(input.summary ? [`<summary>${input.summary}</summary>`] : []),
    `<${tag}>`,
    input.text,
    `</${tag}>`,
    "</task>",
  ].join("\n")
}

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

    // In-memory lifetime counter of subagents started per session TREE, keyed
    // by the root session id (design-final §2.2). A safety ceiling against
    // runaway delegation within one process run — deliberately not persisted;
    // resumes/extends do not count and workflow dispatches keep their own cap.
    const treeSpawnCounts = new Map<SessionID, number>()

    // In-memory counter of subagents CURRENTLY RUNNING per SPAWNING session
    // (Phase-2 Issue 1, design-final §10 variant (b)). Keyed by the spawner,
    // NOT the tree root: a tree-wide semaphore over foreground chains deadlocks
    // (two parallel L2 foreground parents each hold a permit and wait on an L3
    // child that can never get one). Per-spawner keying gives every level its
    // own independent budget, so a foreground parent never competes with its
    // own descendants. Incremented synchronously at the spawn gate and
    // decremented via Effect.ensuring around the child run (robust against
    // success, error and abort) — no leak on any exit path.
    const concurrentChildCounts = new Map<SessionID, number>()
    // Aggregates the cost/tokens of a finished subagent's whole subtree (the
    // session itself + every transitive child) for the completed task part's
    // metadata. Pure read over Session.descendants — design-final §4.6 /
    // Phase-2 Issue 6 — no write, no effect on the per-session bill.
    const rollupSubtreeCost = Effect.fn("TaskTool.rollupSubtreeCost")(function* (sessionID: SessionID) {
      const root = yield* sessions.get(sessionID)
      const descendants = yield* sessions.descendants(sessionID)
      return SubagentLimits.aggregateCost([root, ...descendants])
    })

    const run = Effect.fn("TaskTool.execute")(function* (
      params: Schema.Schema.Type<typeof Parameters>,
      ctx: Tool.Context,
    ) {
      const cfg = yield* config.get()
      const runInBackground = params.background === true
      if (runInBackground && !flags.experimentalBackgroundSubagents) {
        return yield* Effect.fail(
          new Error("Background subagents require OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS=true"),
        )
      }

      // Runtime depth guard (defense line 3, design-final §4.1): depth is
      // derived from the real parent chain at spawn time, so resumed sessions
      // keep their stored depth and a lineage failure (cyclic parents) refuses
      // the spawn with its own typed error. Deliberately BEFORE ctx.ask — the
      // subtask path calls execute with bypassAgentCheck and skips the ask.
      const chain = yield* sessions.lineage(ctx.sessionID)
      const spawnerDepth = chain.length
      const rootID = chain.at(-1)!.id
      const depthLimit = SubagentLimits.maxDepth(cfg)
      if (spawnerDepth >= depthLimit) {
        return yield* Effect.fail(SubagentLimits.depthError({ depth: spawnerDepth, limit: depthLimit }))
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
      // task_id may only resume DIRECT children (design-final §4.4): resuming
      // an ancestor or a foreign session was silently adopted before and could
      // deadlock (child waiting on its own ancestor's runner). Unknown ids
      // still fall through to a fresh session below.
      if (session !== undefined && session.parentID !== ctx.sessionID) {
        return yield* Effect.fail(SubagentLimits.resumeError({ taskID: session.id }))
      }
      const parent = yield* sessions.get(ctx.sessionID)
      // The task/todowrite/workflow auto-denies live in ONE place
      // (deriveSubagentSessionPermission, design-final §4.2) and are depth
      // gated there: only a child AT maxDepth gets them. This call keeps only
      // the `experimental.primary_tools` denies.
      const childPermission = deriveSubagentSessionPermission({
        parentSessionPermission: parent.permission ?? [],
        subagent: next,
        childDepth: spawnerDepth + 1,
        maxDepth: depthLimit,
      })
      const childToolDenies =
        cfg.experimental?.primary_tools?.map((permission) => ({
          permission,
          pattern: "*" as const,
          action: "deny" as const,
        })) ?? []
      // `session` is set only on the resume/extend path; a fresh spawn (the
      // only path that creates a session) is what the breadth cap gates and
      // what its concurrency slot is bound to.
      const isNewSpawn = session === undefined
      const nextSession =
        session ??
        (yield* Effect.gen(function* () {
          // Tree lifetime cap (design-final §2.2): gates NEW spawns only —
          // the resume/extend path never reaches this branch. Counted against
          // the tree's root so every level shares one ceiling.
          const treeLimit = SubagentLimits.treeLimit(cfg)
          const started = treeSpawnCounts.get(rootID) ?? 0
          if (started >= treeLimit) {
            return yield* Effect.fail(SubagentLimits.treeLimitError({ started, limit: treeLimit }))
          }
          // Fail-fast breadth cap (design-final §10 variant (b)): how many
          // direct children THIS spawner already has running. Keyed by the
          // spawner (ctx.sessionID), independent of the tree-wide tree cap and
          // the depth limit. Over cap → typed error NOW, no queuing — that is
          // exactly what keeps the abort cascade from hanging on a permit.
          const concurrencyLimit =
            SubagentLimits.__testHooks.concurrency ?? SubagentLimits.DEFAULT_SUBAGENT_CONCURRENCY
          const running = concurrentChildCounts.get(ctx.sessionID) ?? 0
          if (running >= concurrencyLimit) {
            return yield* Effect.fail(SubagentLimits.concurrencyError({ running, limit: concurrencyLimit }))
          }
          // Budget spawn gate (design-final §4.6, soft cap): an exhausted
          // shared turn pool refuses NEW subagents while running ones finish.
          // No pool (the interactive default) means no gate. The cast narrows
          // the loosely-typed ctx.extra bag (false positive, see ops above).
          // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
          const pool = ctx.extra?.turnBudget as TurnBudget.Pool | undefined
          if (pool !== undefined) {
            const headroom = TurnBudget.remaining(pool)
            if (headroom.usd === 0 || headroom.tokens === 0) {
              return yield* Effect.fail(SubagentLimits.budgetError())
            }
          }
          // Reserve BOTH counters SYNCHRONOUSLY before the async create (the
          // TurnBudget.reserve pattern): Bun is single-threaded and there is
          // no yield between the reads above and these sets, so N parallel
          // spawns each observe the updated counts. Setting AFTER
          // `sessions.create` (the pre-fix order) was a lost-update race —
          // every racer wrote back its stale count and the caps were
          // systematically undercounted. Both are released again on create
          // failure or interrupt so a session that never existed cannot eat a
          // slot; the concurrency slot's success-path release is bound to the
          // child run below (Effect.ensuring), not to create.
          treeSpawnCounts.set(rootID, started + 1)
          concurrentChildCounts.set(ctx.sessionID, running + 1)
          const created = yield* sessions
            .create({
              parentID: ctx.sessionID,
              title: params.description + ` (@${next.name} subagent)`,
              agent: next.name,
              permission: [
                ...childPermission,
                ...childToolDenies.filter(
                  (deny) =>
                    !childPermission.some(
                      (rule) =>
                        rule.permission === deny.permission &&
                        rule.pattern === deny.pattern &&
                        rule.action === deny.action,
                    ),
                ),
              ],
            })
            .pipe(
              Effect.onExit((exit) =>
                Exit.isSuccess(exit)
                  ? Effect.void
                  : Effect.sync(() => {
                      const currentTree = treeSpawnCounts.get(rootID) ?? 0
                      treeSpawnCounts.set(rootID, Math.max(0, currentTree - 1))
                      const currentConcurrent = concurrentChildCounts.get(ctx.sessionID) ?? 0
                      concurrentChildCounts.set(ctx.sessionID, Math.max(0, currentConcurrent - 1))
                    }),
              ),
            )
          return created
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
        // Root of the session tree (design-final §4.5 Ü1): second cancel
        // source for cancelBackgroundJobs — root-level cancels match jobs by
        // rootSessionId even when the parentSessionId chain has a completed
        // (non-running) gap in the middle.
        rootSessionId: rootID,
        sessionId: nextSession.id,
        model,
        ...(runInBackground ? { background: true } : {}),
      }

      yield* ctx.metadata({
        title: params.description,
        metadata,
      })

      // ctx.extra is the loosely-typed `{ [key: string]: unknown }` tool bag, so
      // narrowing the promptOps it carries is required (removing the assertion
      // breaks the typecheck) — a false positive for no-unsafe-type-assertion.
      // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
      const ops = ctx.extra?.promptOps as TaskPromptOps
      if (!ops) return yield* Effect.fail(new Error("TaskTool requires promptOps in ctx.extra"))

      const runTask = Effect.fn("TaskTool.runTask")(function* () {
        const parts = yield* ops.resolvePromptParts(params.prompt)
        const result = yield* ops.prompt({
          messageID: MessageID.ascending(),
          sessionID: nextSession.id,
          // Permission asks bubble to the tree ROOT (design-final §4.3): every
          // level recomputes its own root, so the value is transitively the
          // same across the whole tree and depth ≤ 2 stays byte-identical to
          // the previous behavior (rootID === ctx.sessionID).
          permissionSessionID: rootID,
          // The shared turn pool travels BY REFERENCE into the child loop so
          // all nesting levels charge the root turn's budget (§4.6). The cast
          // narrows the loosely-typed ctx.extra bag (false positive, see above).
          // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
          turnBudgetPool: ctx.extra?.turnBudget as TurnBudget.Pool | undefined,
          model: {
            modelID: model.modelID,
            providerID: model.providerID,
          },
          variant: next.model ? undefined : variant,
          agent: next.name,
          parts,
        })
        return result.parts.findLast((item) => item.type === "text")?.text ?? ""
      })

      const inject = Effect.fn("TaskTool.injectBackgroundResult")(function* (
        state: "completed" | "error",
        text: string,
      ) {
        const currentParent = yield* sessions.get(ctx.sessionID)
        yield* ops
          .prompt({
            sessionID: ctx.sessionID,
            agent: currentParent.agent ?? ctx.agent,
            variant,
            parts: [
              {
                type: "text",
                synthetic: true,
                text: renderOutput({
                  sessionID: nextSession.id,
                  state,
                  summary:
                    state === "completed"
                      ? `Background task completed: ${params.description}`
                      : `Background task failed: ${params.description}`,
                  text,
                }),
              },
            ],
          })
          .pipe(Effect.ignore, Effect.forkIn(scope, { startImmediately: true }))
      })

      const notify = Effect.fn("TaskTool.notifyBackgroundResult")(function* (jobID: string) {
        yield* background.wait({ id: jobID }).pipe(
          Effect.flatMap((result) => {
            if (result.info?.status === "completed") return inject("completed", result.info.output ?? "")
            if (result.info?.status === "error") return inject("error", result.info.error ?? "")
            return Effect.void
          }),
          Effect.forkIn(scope, { startImmediately: true }),
        )
      })

      if (yield* background.extend({ id: nextSession.id, run: runTask() })) {
        return {
          title: params.description,
          metadata: {
            ...metadata,
            background: true,
            jobId: nextSession.id,
          },
          output: renderOutput({
            sessionID: nextSession.id,
            state: "running",
            summary: "Background task updated",
            text: BACKGROUND_UPDATED,
          }),
        }
      }

      // Release the concurrency slot exactly when the child RUN ends (success,
      // error or interrupt) — and only for a fresh spawn, the path that
      // reserved one above. Bound to the child run via Effect.ensuring so it
      // fires for every exit, including a foreground abort and a detached
      // background completion: the slot is freed whenever the child stops
      // running. The release is ONE-SHOT so it can never double-decrement; a
      // resume reused a still-running child whose original spawn still holds
      // the slot (slotReleased starts true on that path, making release inert).
      let slotReleased = !isNewSpawn
      const releaseConcurrencySlot = Effect.sync(() => {
        if (slotReleased) return
        slotReleased = true
        const current = concurrentChildCounts.get(ctx.sessionID) ?? 0
        concurrentChildCounts.set(ctx.sessionID, Math.max(0, current - 1))
      })
      const childRun = isNewSpawn ? runTask().pipe(Effect.ensuring(releaseConcurrencySlot)) : runTask()

      const info = yield* background.start({
        id: nextSession.id,
        type: id,
        title: params.description,
        metadata,
        onPromote: Effect.all([
          ctx.metadata({
            title: params.description,
            metadata: { ...metadata, background: true, jobId: nextSession.id },
          }),
          notify(nextSession.id),
        ]),
        run: childRun.pipe(Effect.onInterrupt(() => ops.cancel(nextSession.id))),
      })

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
            summary: "Background task started",
            text: BACKGROUND_STARTED,
          }),
        }
      }

      if (runInBackground) {
        yield* notify(info.id)
        return backgroundResult()
      }

      const runCancel = yield* EffectBridge.make()
      const cancel = ops.cancel(nextSession.id)

      function onAbort() {
        runCancel.fork(cancel)
      }

      // Per-task timeout (design-final §2.2 follow-up Issue 5): tool param wins
      // over experimental.subagent_task_timeout; only foreground tasks are
      // gated (background tasks are decoupled and notified out-of-band, so the
      // param is ignored there). The timeout arm only SLEEPS then fails — it
      // does NOT cancel inline: with raceFirst the loser is interrupted the
      // moment the winner settles, so failing first interrupts the wait arm
      // before background.cancel could flip the job to "cancelled" and let that
      // branch win the race (which would surface "Task cancelled" instead of
      // the typed timeout). The catchIf below runs the abort on the SAME cancel
      // path as an explicit cancel — ops.cancel seeds Session.descendants into
      // SessionRunState.cancel and background.cancel closes the job scope and
      // awaits its interrupt finalizers, so the release race (5582da5a8) stays
      // closed and no orphan job survives — then re-fails so the foreground
      // parent loop surfaces the error in its transcript instead of hanging.
      const timeoutMs = SubagentLimits.taskTimeout(cfg, params.timeout)
      const timeoutArm: Effect.Effect<never, SubagentLimits.SubagentTimeoutError> =
        timeoutMs === undefined
          ? Effect.never
          : Effect.sleep(`${timeoutMs} millis`).pipe(
              Effect.andThen(Effect.fail(SubagentLimits.timeoutError({ timeout: timeoutMs }))),
            )

      return yield* Effect.acquireUseRelease(
        Effect.sync(() => {
          ctx.abort.addEventListener("abort", onAbort)
        }),
        () =>
          Effect.gen(function* () {
            const result = yield* Effect.raceFirst(
              Effect.raceFirst(
                background.wait({ id: nextSession.id }).pipe(Effect.map((waited) => waited.info)),
                background.waitForPromotion(nextSession.id),
              ),
              timeoutArm,
            )
            if (result?.metadata?.background === true) return backgroundResult()
            if (result?.status === "error") return yield* Effect.fail(new Error(result.error ?? "Task failed"))
            if (result?.status === "cancelled") return yield* Effect.fail(new Error("Task cancelled"))
            // Display-only subtree cost rollup (design-final §4.6 / Phase-2
            // Issue 6): the spawned session plus its descendants. Each session
            // still bills its own spend separately — this aggregate never
            // double-charges, it only surfaces the teardown's total. Best-effort:
            // a descendants/get failure must not fail an otherwise-completed task,
            // so the rollup is simply omitted from the metadata.
            const costRollup = Option.getOrUndefined(yield* Effect.option(rollupSubtreeCost(nextSession.id)))
            return {
              title: params.description,
              metadata: costRollup ? { ...metadata, costRollup } : metadata,
              output: renderOutput({ sessionID: nextSession.id, state: "completed", text: result?.output ?? "" }),
            }
          }).pipe(
            Effect.catchIf(
              (error): error is SubagentLimits.SubagentTimeoutError =>
                error instanceof SubagentLimits.SubagentTimeoutError,
              (error) =>
                Effect.all([cancel, background.cancel(nextSession.id)], { discard: true }).pipe(
                  Effect.andThen(Effect.fail(error)),
                ),
            ),
          ),
        (_, exit) =>
          Effect.gen(function* () {
            if (Exit.hasInterrupts(exit))
              yield* Effect.all([cancel, background.cancel(nextSession.id)], { discard: true })
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
        ? [DESCRIPTION, BACKGROUND_DESCRIPTION].join("\n\n")
        : DESCRIPTION,
      parameters: Parameters,
      jsonSchema: flags.experimentalBackgroundSubagents ? undefined : ToolJsonSchema.fromSchema(BaseParameters),
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        run(params, ctx).pipe(Effect.orDie),
    }
  }),
)
