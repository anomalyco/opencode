import * as Tool from "./tool"
import DESCRIPTION from "./task.txt"
import { ToolJsonSchema } from "./json-schema"
import { SessionV1 } from "@daemon-protocol/core/v1/session"
import { BackgroundJob } from "@/background/job"
import { Session } from "@/session/session"
import { Criticality } from "@/session/criticality"
import { SessionID, MessageID } from "../session/schema"
import { MessageV2 } from "../session/message-v2"
import { Agent } from "../agent/agent"
import { deriveSubagentSessionPermission } from "../agent/subagent-permissions"
import type { SessionPrompt } from "../session/prompt"
import { Config } from "@/config/config"
import { Effect, Exit, Schema, Scope } from "effect"
import { EffectBridge } from "@/effect/bridge"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { ACE, Headless, Profiles } from "@/ace"
import { EventV2Bridge } from "@/event-v2-bridge"
import { Database } from "@daemon-protocol/core/database/database"

export interface TaskPromptOps {
  cancel(sessionID: SessionID): Effect.Effect<void>
  resolvePromptParts(template: string): Effect.Effect<SessionPrompt.PromptInput["parts"]>
  prompt(input: SessionPrompt.PromptInput): Effect.Effect<SessionV1.WithParts>
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
  profile: Schema.optional(Schema.Literals(Profiles.PROFILE_IDS)).annotate({
    description:
      "ACE headless task profile (create-file, refactor, bugfix, unit-tests). When set, the task prompt is assembled from the profile template in docs/ace-headless-subagent-profiles.md",
  }),
  target_path: Schema.optional(Schema.String).annotate({
    description: "Primary file path for profile placeholders (TARGET_FILE_PATH / SOURCE_FILE_PATH)",
  }),
  target_paths: Schema.optional(Schema.String).annotate({
    description: "One or more paths for bugfix profile (TARGET_PATHS); defaults to target_path",
  }),
  test_path: Schema.optional(Schema.String).annotate({
    description: "Destination test file path for unit-tests profile (TEST_FILE_PATH)",
  }),
  tech_stack: Schema.optional(Schema.String).annotate({
    description: "Language or framework hint for create-file profile (TECH_STACK)",
  }),
  test_framework: Schema.optional(Schema.String).annotate({
    description: "Test runner label for unit-tests profile (TEST_FRAMEWORK); default bun test",
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

const CASCADE_DOCS_URL = "https://daemonprotocol.com/docs/cascade-control"

// Build an operator-friendly explanation for a blocked sub-agent spawn. Plain
// language first, then contextualized metrics, then concrete next steps. The
// machine-readable metrics still travel in `metadata.criticality`.
function criticalityRejectionText(m: Criticality.Metrics): string {
  const dMax = Number.isFinite(m.dMax) ? String(m.dMax) : "unbounded"
  const headline: Record<string, string> = {
    cascade_depth_limit: "Too many nested sub-agents: this delegation is deeper than the safe limit.",
    supercritical_agent_state: "Sub-agents are spawning faster than they finish (runaway cascade risk).",
    budget_absorption: "This cascade has reached its cost budget.",
  }
  const lines = [
    headline[m.reason ?? ""] ?? "The orchestrator blocked this sub-agent spawn to keep the cascade bounded.",
    "",
    "Where things stand:",
    `  • cascade depth: ${m.depth} (limit ${dMax})`,
    `  • active sub-agents: ${m.nActive}`,
    `  • growth factor k_eff: ${m.kEff.toFixed(2)} (1.0 = stable, >1 = growing)`,
    "",
    "What to do next:",
    "  • Do this work directly in the current session instead of delegating.",
    "  • Or fold it into a sub-agent that is already running.",
    "  • Or reduce how many sub-agents you spawn at once, then try again.",
    `  • If this depth/fan-out is expected, raise the limits in experimental.criticality. See ${CASCADE_DOCS_URL}.`,
    "",
    "Do not retry the same spawn unchanged — it will be blocked again.",
  ]
  return lines.join("\n")
}

type TaskModel = {
  modelID: string
  providerID: string
}

type TaskMetadata = {
  parentSessionId: SessionID
  sessionId: SessionID
  model: TaskModel
  background?: boolean
  jobId?: string
  ace?: { blocked: boolean }
}

export const TaskTool = Tool.define<
  typeof Parameters,
  TaskMetadata,
  | Agent.Service
  | BackgroundJob.Service
  | Config.Service
  | Session.Service
  | Criticality.Service
  | Scope.Scope
  | RuntimeFlags.Service
  | Database.Service
  | EventV2Bridge.Service
>(
  id,
  Effect.gen(function* () {
    const agent = yield* Agent.Service
    const background = yield* BackgroundJob.Service
    const config = yield* Config.Service
    const sessions = yield* Session.Service
    const criticality = yield* Criticality.Service
    const scope = yield* Scope.Scope
    const flags = yield* RuntimeFlags.Service
    const database = yield* Database.Service
    const events = yield* EventV2Bridge.Service

    const spawnDepth = (sessionID: SessionID): Effect.Effect<number> =>
      Effect.gen(function* () {
        const current = yield* sessions.get(sessionID).pipe(Effect.orDie)
        if (!current.parentID) return 1
        return 1 + (yield* spawnDepth(current.parentID))
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
      const parent = yield* sessions.get(ctx.sessionID)
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
      const spawn = yield* ACE.Middleware.gateSpawn({
        events,
        config: cfg.ace,
        sessionID: ctx.sessionID,
        subagent: next.name,
        depth: yield* spawnDepth(ctx.sessionID),
        skip: !!session,
        ask: (req) => ctx.ask(req),
      })
      if (spawn.blocked) {
        return {
          title: params.description,
          output: spawn.blocked,
          metadata: {
            parentSessionId: ctx.sessionID,
            sessionId: ctx.sessionID,
            model,
            ...(runInBackground ? { background: true } : {}),
            ace: { blocked: true },
          },
        }
      }
      const spawnTracked = spawn.tracked

      // Fission-inspired Agent Criticality circuit breaker. Only fresh spawns
      // (not task_id resumes) feed the branching-process estimate and are
      // subject to the depth / k_eff / budget gate.
      let criticalityMetrics: Criticality.Metrics | undefined
      if (!session) {
        criticalityMetrics = yield* criticality.evaluate(ctx.sessionID)
        if (criticalityMetrics.decision !== "spawn") {
          yield* criticality.recordAbsorption(ctx.sessionID)
          return {
            title: params.description,
            metadata: {
              parentSessionId: ctx.sessionID,
              sessionId: ctx.sessionID,
              model,
              criticality: {
                k_eff_agent: criticalityMetrics.kEff,
                depth: criticalityMetrics.depth,
                d_max: criticalityMetrics.dMax,
                n_active: criticalityMetrics.nActive,
                decision: criticalityMetrics.decision,
              },
            },
            output: renderOutput({
              sessionID: ctx.sessionID,
              state: "error",
              summary: `Sub-agent spawn blocked by criticality circuit breaker (${criticalityMetrics.reason})`,
              text: criticalityRejectionText(criticalityMetrics),
            }),
          }
        }
        yield* criticality.recordSpawn(ctx.sessionID)
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

      const metadata = {
        parentSessionId: ctx.sessionID,
        sessionId: nextSession.id,
        model,
        ...(runInBackground ? { background: true } : {}),
        ...(criticalityMetrics
          ? {
              criticality: {
                k_eff_agent: criticalityMetrics.kEff,
                depth: criticalityMetrics.depth,
                d_max: criticalityMetrics.dMax,
                n_active: criticalityMetrics.nActive,
              },
            }
          : {}),
      }

      yield* ctx.metadata({
        title: params.description,
        metadata,
      })

      const ops = ctx.extra?.promptOps as TaskPromptOps
      if (!ops) return yield* Effect.fail(new Error("TaskTool requires promptOps in ctx.extra"))

      const finishTrackedSpawn = Effect.fn("TaskTool.finishTrackedSpawn")(function* () {
        if (!spawnTracked) return
        const policy = ACE.policy(cfg.ace)
        yield* ACE.emitPressure(events, policy, ACE.finishSpawn(ctx.sessionID), ctx.sessionID)
      })

      const runTaskBody = Effect.fn("TaskTool.runTask")(function* () {
        const prefix = Headless.promptPrefix(cfg.ace)
        const body = Profiles.taskPromptBody(params, cfg.ace)
        const prompt = prefix ? prefix + body : body
        const parts = yield* ops.resolvePromptParts(prompt)
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
        })
        return result.parts.findLast((item) => item.type === "text")?.text ?? ""
      })
      const runTask = () => runTaskBody().pipe(Effect.ensuring(finishTrackedSpawn()))

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
        run: runTask().pipe(Effect.onInterrupt(() => ops.cancel(nextSession.id))),
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
            const result = yield* Effect.raceFirst(
              background.wait({ id: nextSession.id }).pipe(Effect.map((waited) => waited.info)),
              background.waitForPromotion(nextSession.id),
            )
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
