import * as Tool from "./tool"
import DESCRIPTION from "./task.txt"
import { ToolJsonSchema } from "./json-schema"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { BackgroundJob } from "@/background/job"
import { Session } from "@/session/session"
import { SessionID, MessageID } from "../session/schema"
import { MessageV2 } from "../session/message-v2"
import { Agent } from "../agent/agent"
import { LocalPlacement } from "@/local/placement"
import { Provider } from "@/provider/provider"
import { deriveSubagentSessionPermission } from "../agent/subagent-permissions"
import type { SessionPrompt } from "../session/prompt"
import { Config } from "@/config/config"
import { Effect, Exit, Option, Schema, Scope } from "effect"
import { EffectBridge } from "@/effect/bridge"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { Database } from "@opencode-ai/core/database/database"

export interface TaskPromptOps {
  cancel(sessionID: SessionID): Effect.Effect<void>
  resolvePromptParts(template: string): Effect.Effect<SessionPrompt.PromptInput["parts"]>
  prompt(input: SessionPrompt.PromptInput): Effect.Effect<SessionV1.WithParts>
}

const id = "task"
// fork: total-duration backstop for a foreground subagent wait — see the
// acquireUseRelease block below for why. Deliberately well above the
// provider-layer header-timeout default (180s, provider.ts) since a
// legitimate subagent task may make several round trips (multiple tool
// calls, possibly more than one cold model load) before producing a final
// result; this only needs to catch a task that is genuinely stuck, not cap
// normal multi-step work. Reduced from 20min to 10min — with loop detection
// and chunk timeouts in place, 10min is a generous backstop for a stuck agent
// while still allowing legitimate multi-step subagent work to complete.
const SUBAGENT_TASK_TIMEOUT_MS = 10 * 60 * 1000
// fork: the original wording ("Foreground is the default; use background only
// for independent work") reliably produced all-foreground fan-out — the model
// took the stated default and blocked on every subagent in turn, which on a
// multi-host local fleet means one host works while the rest sit idle. State
// the preference the other way round: background is the norm, foreground is
// the exception you justify.
const BACKGROUND_DESCRIPTION = [
  "Background mode: background=true launches the subagent asynchronously and returns immediately,",
  "and you are notified automatically when it finishes.",
  "PREFER background=true whenever the work is independent of your very next step —",
  "several agents then run at once instead of one at a time, and you keep working meanwhile.",
  "Launching N independent agents in one message with background=true is the normal way to fan out.",
  "Foreground blocks this entire turn until the agent finishes; choose it only when you genuinely",
  "cannot take another step without that agent's result.",
].join(" ")
const BACKGROUND_STARTED = [
  "The task is working in the background. You will be notified automatically when it finishes.",
  "DO NOT sleep, poll for progress, ask the task for status, or duplicate this task's work — avoid working with the same files or topics it is using.",
  "Continue working on non-overlapping tasks. Do not end your response — keep making progress on other work.",
].join("\n")
const BACKGROUND_UPDATED = [
  "Additional context sent to the running background task.",
  "The task is still working in the background. You will be notified automatically when it finishes.",
  "DO NOT sleep, poll for progress, ask the task for status, or duplicate this task's work — avoid working with the same files or topics it is using.",
  "Continue working on non-overlapping tasks. Do not end your response — keep making progress on other work.",
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
  provider: Schema.optional(Schema.String).annotate({
    description:
      'Local provider (host) to run this subagent on, e.g. "rocky" or "m3". Use when the user names a host; copy the name exactly. Omit to auto-place on an idle host.',
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
    // Optional: absent in stripped-down environments (tests); placement is
    // simply skipped there.
    const provider = Option.getOrUndefined(yield* Effect.serviceOption(Provider.Service))
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
      const runInBackground = params.background === true
      if (runInBackground && !flags.experimentalBackgroundSubagents) {
        return yield* Effect.fail(
          new Error("Background subagents require OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS=true"),
        )
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

      // fork: publish the child session id as soon as it exists. The local
      // placement probing below adds `model` to this metadata, but it can take
      // a moment, and callers (the TUI, cancel propagation, and the upstream
      // contract tests) need `sessionId` on the running part immediately —
      // waiting until after placement leaves the part with no metadata at all.
      yield* ctx.metadata({
        title: params.description,
        metadata: {
          parentSessionId: ctx.sessionID,
          sessionId: nextSession.id,
          ...(runInBackground ? { background: true } : {}),
        },
      })

      const msg = yield* MessageV2.get({ sessionID: ctx.sessionID, messageID: ctx.messageID }).pipe(
        Effect.provideService(Database.Service, database),
        Effect.orDie,
      )
      if (msg.info.role !== "assistant") return yield* Effect.fail(new Error("Not an assistant message"))
      const variant = msg.info.variant

      const inherited = {
        modelID: msg.info.modelID,
        providerID: msg.info.providerID,
      }
      // fork: a subagent inheriting a local provider queues behind its parent
      // on the same (often single-slot) llama.cpp server — worse than useless.
      // Hop to an idle local peer instead. Resumed sessions keep the old
      // behavior so a running task isn't re-placed away from its warm cache.
      // A role that declares where it wants to run makes placement worth
      // attempting even from a cloud parent — see LocalPlacement.pick. The
      // kill-switch and an explicit host argument both still win.
      const rolePlacement = next.placement && next.placement !== "inherit" ? next.placement : undefined
      const outcome =
        !provider || next.model || session || (cfg.experimental?.local_subagent_placement === false && !params.provider)
          ? null
          : yield* provider.list().pipe(
              Effect.flatMap((providers) =>
                Effect.promise(() =>
                  LocalPlacement.pick({
                    parent: inherited,
                    providers,
                    allowedModels: cfg.experimental?.local_subagent_placement_models,
                    promptText: params.prompt,
                    target: params.provider,
                    prefer: rolePlacement,
                  }),
                ),
              ),
            )
      // pick() stays plain so its slot reservation is synchronous; it reports
      // the outcome and the logging happens here, in Effect context.
      if (outcome?.kind === "placed")
        yield* Effect.logInfo("placed subagent on idle local provider", {
          provider: outcome.placement.providerID,
          model: outcome.placement.modelID,
          parent: inherited.providerID,
          requiredCtx: outcome.requiredCtx,
          probed: outcome.probed,
        })
      else if (outcome?.kind === "none")
        yield* Effect.logInfo("no idle local provider, inheriting parent", {
          parent: inherited.providerID,
          probed: outcome.probed,
        })
      else if (outcome?.kind === "failed")
        yield* Effect.logError("placement failed, inheriting parent", { error: outcome.error })

      const placed = outcome?.kind === "placed" ? outcome : null
      // An explicitly requested host must be honored or refused loudly —
      // silently placing elsewhere (or inheriting) would do the opposite of
      // what the user asked for.
      if (params.provider && !placed && !next.model && !session) {
        const known = provider
          ? Object.values(yield* provider.list())
              .filter((info) => LocalPlacement.baseURLOf(info))
              .map((info) => info.id)
          : []
        return yield* Effect.fail(
          new Error(
            `Requested provider "${params.provider}" is not available for a subagent right now ` +
              `(unknown name, no free slot, or no eligible model). ` +
              (known.length ? `Known local providers: ${known.join(", ")}. ` : "") +
              `Retry later, pick another provider, or omit provider to auto-place.`,
          ),
        )
      }
      // Placement found no idle peer, so we are about to fall back to the
      // parent's own provider. On a single-slot llama.cpp server that queues
      // the subagent behind its parent, which never returns — the session
      // reads as hung. Refuse instead of queueing invisibly.
      //
      // Only checked when placement actually ran and came back empty: an
      // explicit model or a resumed session is a deliberate choice, not a
      // fallback.
      const willInherit = !next.model && !placed
      const placementRan = !!provider && !next.model && !session && cfg.experimental?.local_subagent_placement !== false
      if (willInherit && placementRan) {
        const capacity = yield* provider
          .list()
          .pipe(
            Effect.flatMap((providers) =>
              Effect.promise(() => LocalPlacement.parentCapacity({ parent: inherited, providers })),
            ),
          )
        // Block inheritance when the parent is busy OR unreachable. A probe
        // failure returns "unknown" — we cannot confirm the parent has a free
        // slot, so inheriting would risk queuing behind it on a single-slot
        // server and hanging forever.
        if (capacity !== "free") {
          return yield* Effect.fail(
            new Error(
              `No capacity for subagent: local provider "${inherited.providerID}" has no free slot ` +
                (capacity === "unknown" ? "(unreachable) " : "") +
                `and no idle local peer was available. It serves one session at a time, so running ` +
                `here would queue behind this session and never return. Retry when it frees up, or ` +
                `pass an explicit model on a different provider.`,
            ),
          )
        }
      }
      // Only the data half of the placement goes anywhere near metadata —
      // part metadata is structuredClone()d on every update event, and the
      // release() handle is a function (DataCloneError, dead subagent).
      const model = next.model ?? placed?.placement ?? inherited
      const metadata = {
        parentSessionId: ctx.sessionID,
        sessionId: nextSession.id,
        model,
        ...(runInBackground ? { background: true } : {}),
      }

      yield* ctx.metadata({
        title: params.description,
        metadata,
      })

      const ops = ctx.extra?.promptOps as TaskPromptOps
      if (!ops) return yield* Effect.fail(new Error("TaskTool requires promptOps in ctx.extra"))

      // Release the local-placement slot reservation (if we hopped to an idle
      // peer) when the subagent finishes, however it finishes — success,
      // error, or interrupt. release() is idempotent and a no-op when we
      // inherited the parent (placed === null).
      const releaseSlot = Effect.sync(() => placed?.release())

      const runTask = Effect.fn("TaskTool.runTask")(function* () {
        const parts = yield* ops.resolvePromptParts(params.prompt)
        const result = yield* ops.prompt({
          messageID: MessageID.ascending(),
          sessionID: nextSession.id,
          model: {
            modelID: model.modelID,
            providerID: model.providerID,
          },
          // A pinned or placed model differs from the parent's — its variant
          // set may not apply there.
          variant: next.model || placed ? undefined : variant,
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

      if (yield* background.extend({ id: nextSession.id, run: runTask().pipe(Effect.ensuring(releaseSlot)) })) {
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
        run: runTask().pipe(
          Effect.onInterrupt(() => ops.cancel(nextSession.id)),
          Effect.ensuring(releaseSlot),
        ),
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

      return yield* Effect.acquireUseRelease(
        Effect.sync(() => {
          ctx.abort.addEventListener("abort", onAbort)
        }),
        () =>
          Effect.gen(function* () {
            // fork: bound the whole foreground wait. Without this, a subagent
            // stuck on an unresponsive backend (a hung fetch the provider-layer
            // header timeout didn't catch, an infinite tool-call loop, etc.)
            // left the parent session waiting forever with no error and no way
            // to react. On timeout, cancel the subagent session outright
            // (background.cancel — the same interrupt/cleanup path used for
            // explicit user cancellation) rather than merely giving up on it:
            // leaving it running would keep occupying its assigned local model
            // slot indefinitely.
            const waited = yield* Effect.raceFirst(
              background.wait({ id: nextSession.id, timeout: SUBAGENT_TASK_TIMEOUT_MS }),
              background
                .waitForPromotion(nextSession.id)
                .pipe(Effect.map((info) => ({ info, timedOut: false as const }))),
            )
            if (waited.timedOut) {
              yield* background.cancel(nextSession.id)
              return yield* Effect.fail(
                new Error(
                  `Subagent timed out after ${SUBAGENT_TASK_TIMEOUT_MS / 1000}s waiting for a response — the assigned model or host may be unresponsive. The subagent session was cancelled.`,
                ),
              )
            }
            const result = waited.info
            if (result?.metadata?.background === true) return backgroundResult()
            if (result?.status === "error") return yield* Effect.fail(new Error(result.error ?? "Task failed"))
            if (result?.status === "cancelled") return yield* Effect.fail(new Error("Task cancelled"))
            return {
              title: params.description,
              metadata,
              output: renderOutput({ sessionID: nextSession.id, state: "completed", text: result?.output ?? "" }),
            }
          }),
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

    // Best-effort fleet visibility: list local providers by name so the model
    // can honor "run this on rocky". Discovery is async, so hosts appearing
    // later are still reachable via the provider parameter by name.
    // Must survive init contexts with no project instance loaded —
    // provider.list() can die there (defect, not typed failure), and a
    // defect at tool-init kills the whole server worker at startup.
    // Effect.exit captures failures and defects alike.
    const listExit = provider ? yield* provider.list().pipe(Effect.exit) : undefined
    const localProviders =
      listExit !== undefined && Exit.isSuccess(listExit)
        ? Object.values(listExit.value)
            .filter((info) => LocalPlacement.baseURLOf(info))
            .map((info) => info.id)
        : []
    const FLEET_DESCRIPTION = localProviders.length
      ? `Local providers available for the provider parameter: ${localProviders.join(", ")}.`
      : undefined

    return {
      description: [
        DESCRIPTION,
        ...(flags.experimentalBackgroundSubagents ? [BACKGROUND_DESCRIPTION] : []),
        ...(FLEET_DESCRIPTION ? [FLEET_DESCRIPTION] : []),
      ].join("\n\n"),
      parameters: Parameters,
      jsonSchema: flags.experimentalBackgroundSubagents ? undefined : ToolJsonSchema.fromSchema(BaseParameters),
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        run(params, ctx).pipe(Effect.orDie),
    }
  }),
)
