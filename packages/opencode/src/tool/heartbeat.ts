import { BackgroundJob } from "@/background/job"
import { Config } from "@/config/config"
import { InstanceState } from "@/effect/instance-state"
import { HeartbeatScheduler } from "@/heartbeat/scheduler"
import { HeartbeatStore } from "@/heartbeat/store"
import { PositiveInt } from "@opencode-ai/core/schema"
import { Clock, Effect, Schema, Scope } from "effect"
import type { TaskPromptOps } from "./task"
import { Tool } from "./tool"
import DESCRIPTION from "./heartbeat.txt"

const MAX_DELAY_SECONDS = 60 * 60
const MAX_CHECKS = 1000
const DEFAULT_INITIAL_DELAY_SECONDS = 5
const DEFAULT_INTERVAL_SECONDS = 10
const DEFAULT_MAX_INTERVAL_SECONDS = 60
const DEFAULT_MAX_CHECKS = 60

const Backoff = Schema.Literals(["fixed", "linear", "exponential"])

export const Parameters = Schema.Struct({
  action: Schema.optional(Schema.Literals(["schedule", "status", "cancel"])).annotate({
    description: "Operation to perform (default: schedule)",
  }),
  task: Schema.String.annotate({
    description: "Stable short name for the ongoing task. Reuse it for status, rescheduling, and cancellation.",
  }),
  delay_seconds: Schema.optional(
    PositiveInt.check(Schema.isBetween({ minimum: 1, maximum: MAX_DELAY_SECONDS })),
  ).annotate({
    description: "Exact delay before this next check. Omit to use the configured initial/next interval.",
  }),
  interval_seconds: Schema.optional(
    PositiveInt.check(Schema.isBetween({ minimum: 1, maximum: MAX_DELAY_SECONDS })),
  ).annotate({
    description: "Base interval retained for later checks in this same task chain.",
  }),
  backoff: Schema.optional(Backoff).annotate({
    description: "Interval policy retained for later checks: fixed, linear, or exponential.",
  }),
  max_interval_seconds: Schema.optional(
    PositiveInt.check(Schema.isBetween({ minimum: 1, maximum: MAX_DELAY_SECONDS })),
  ).annotate({
    description: "Upper bound for automatically calculated intervals.",
  }),
  max_checks: Schema.optional(PositiveInt.check(Schema.isBetween({ minimum: 1, maximum: MAX_CHECKS }))).annotate({
    description: "Safety limit for checks in this task chain.",
  }),
})

export const HeartbeatTool = Tool.define(
  "heartbeat",
  Effect.gen(function* () {
    const background = yield* BackgroundJob.Service
    const config = yield* Config.Service
    const store = yield* HeartbeatStore.Service
    const scope = yield* Scope.Scope

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const jobID = `heartbeat:${ctx.sessionID}:${params.task}`
          const action = params.action ?? "schedule"
          const existing = yield* store.get(jobID)

          if (action === "status") {
            const now = yield* Clock.currentTimeMillis
            if (!existing) {
              return {
                title: `Heartbeat status: ${params.task}`,
                metadata: heartbeatMetadata({ jobID, task: params.task }),
                output: `No heartbeat history found for ${JSON.stringify(params.task)} in this session.`,
              }
            }
            const remainingSeconds =
              existing.status === "scheduled" && existing.firesAt > now ? Math.ceil((existing.firesAt - now) / 1000) : 0
            return {
              title: `Heartbeat status: ${params.task}`,
              metadata: heartbeatMetadata({ heartbeat: existing, remainingSeconds }),
              output: [
                `Heartbeat ${JSON.stringify(params.task)} is ${publicStatus(existing.status)}.`,
                `Durable state: ${existing.status}; revision: ${existing.revision}.`,
                `Check: ${existing.checkNumber}/${existing.maxChecks}.`,
                existing.firesAt > 0
                  ? `Scheduled fire time: ${new Date(existing.firesAt).toISOString()} (${remainingSeconds} seconds remaining).`
                  : "No future fire time is recorded.",
                `Next default interval: ${existing.nextDelaySeconds} seconds.`,
              ].join("\n"),
            }
          }

          if (action === "cancel") {
            yield* background.cancel(jobID)
            const cancelled = yield* store.cancel(jobID)
            return {
              title: `Heartbeat cancelled: ${params.task}`,
              metadata: cancelled
                ? heartbeatMetadata({ heartbeat: cancelled, remainingSeconds: 0 })
                : heartbeatMetadata({ jobID, task: params.task }),
              output: cancelled
                ? `Heartbeat ${JSON.stringify(params.task)} is cancelled; no new check was scheduled.`
                : `No heartbeat history found for ${JSON.stringify(params.task)} in this session.`,
            }
          }

          const ops = ctx.extra?.promptOps as TaskPromptOps | undefined
          if (!ops) return yield* Effect.fail(new Error("Heartbeat requires session prompt operations"))
          const settings = (yield* config.get()).experimental?.heartbeat
          if (settings?.enabled === false) return yield* Effect.fail(new Error("Heartbeat scheduling is disabled"))

          const initialDelaySeconds =
            existing?.initialDelaySeconds ?? settings?.initial_delay_seconds ?? DEFAULT_INITIAL_DELAY_SECONDS
          const intervalSeconds =
            params.interval_seconds ??
            existing?.intervalSeconds ??
            settings?.interval_seconds ??
            DEFAULT_INTERVAL_SECONDS
          const backoff = params.backoff ?? existing?.backoff ?? settings?.backoff ?? "exponential"
          const maxIntervalSeconds =
            params.max_interval_seconds ??
            existing?.maxIntervalSeconds ??
            settings?.max_interval_seconds ??
            DEFAULT_MAX_INTERVAL_SECONDS
          const maxChecks = params.max_checks ?? existing?.maxChecks ?? settings?.max_checks ?? DEFAULT_MAX_CHECKS
          const checkNumber =
            existing?.status === "scheduled"
              ? existing.checkNumber
              : existing?.status === "firing" || existing?.status === "fired"
                ? existing.checkNumber + 1
                : 1
          if (checkNumber > maxChecks) {
            return yield* Effect.fail(
              new Error(`Heartbeat ${JSON.stringify(params.task)} reached its ${maxChecks}-check safety limit`),
            )
          }

          const delaySeconds =
            params.delay_seconds ??
            delayForCheck({
              checkNumber,
              initialDelaySeconds,
              intervalSeconds,
              backoff,
              maxIntervalSeconds,
            })
          const nextDelaySeconds = delayForCheck({
            checkNumber: checkNumber + 1,
            initialDelaySeconds,
            intervalSeconds,
            backoff,
            maxIntervalSeconds,
          })
          const scheduledAt = yield* Clock.currentTimeMillis
          const directory = yield* InstanceState.directory
          const heartbeat = yield* store.schedule({
            jobID,
            sessionID: ctx.sessionID,
            task: params.task,
            directory,
            agent: ctx.agent,
            checkNumber,
            maxChecks,
            delaySeconds,
            initialDelaySeconds,
            intervalSeconds,
            backoff,
            maxIntervalSeconds,
            nextDelaySeconds,
            scheduledAt,
            firesAt: scheduledAt + delaySeconds * 1000,
          })

          yield* HeartbeatScheduler.arm({
            background,
            store,
            scope,
            heartbeat,
            deliver: (current) =>
              ops
                .prompt({
                  sessionID: ctx.sessionID,
                  agent: current.agent,
                  parts: [
                    {
                      type: "text",
                      synthetic: true,
                      text: HeartbeatScheduler.promptText(current),
                    },
                  ],
                })
                .pipe(Effect.asVoid),
          })

          return {
            title: `Heartbeat ${heartbeat.checkNumber}/${heartbeat.maxChecks}: ${heartbeat.task}`,
            metadata: heartbeatMetadata({ heartbeat, remainingSeconds: delaySeconds }),
            output: [
              `Scheduled durable no-thinking heartbeat ${heartbeat.checkNumber}/${heartbeat.maxChecks} for ${JSON.stringify(
                heartbeat.task,
              )}.`,
              `Fires at ${new Date(heartbeat.firesAt).toISOString()} (in ${delaySeconds} seconds).`,
              `If still running, the next default interval is ${nextDelaySeconds} seconds (${backoff} backoff, maximum ${maxIntervalSeconds} seconds).`,
              "This schedule survives OpenCode restarts.",
              "Call action=status to inspect it, action=cancel to stop it, or action=schedule with the same task to replace it.",
            ].join("\n"),
          }
        }).pipe(Effect.orDie),
    }
  }),
)

function publicStatus(status: HeartbeatStore.Info["status"]) {
  if (status === "scheduled" || status === "firing") return "running"
  if (status === "fired") return "completed"
  return status
}

function heartbeatMetadata(
  input: { heartbeat: HeartbeatStore.Info; remainingSeconds: number } | { jobID: string; task: string },
) {
  if ("heartbeat" in input) {
    const heartbeat = input.heartbeat
    return {
      jobId: heartbeat.jobID,
      task: heartbeat.task,
      status: publicStatus(heartbeat.status),
      durableStatus: heartbeat.status,
      revision: heartbeat.revision,
      checkNumber: heartbeat.checkNumber,
      maxChecks: heartbeat.maxChecks,
      delaySeconds: heartbeat.delaySeconds,
      initialDelaySeconds: heartbeat.initialDelaySeconds,
      intervalSeconds: heartbeat.intervalSeconds,
      backoff: heartbeat.backoff,
      maxIntervalSeconds: heartbeat.maxIntervalSeconds,
      nextDelaySeconds: heartbeat.nextDelaySeconds,
      scheduledAt: heartbeat.scheduledAt,
      firesAt: heartbeat.firesAt,
      remainingSeconds: input.remainingSeconds,
    }
  }
  return {
    jobId: input.jobID,
    task: input.task,
    status: "missing",
    durableStatus: "missing",
    revision: 0,
    checkNumber: 0,
    maxChecks: 0,
    delaySeconds: 0,
    initialDelaySeconds: 0,
    intervalSeconds: 0,
    backoff: "exponential" as const,
    maxIntervalSeconds: 0,
    nextDelaySeconds: 0,
    scheduledAt: 0,
    firesAt: 0,
    remainingSeconds: 0,
  }
}

function delayForCheck(input: {
  checkNumber: number
  initialDelaySeconds: number
  intervalSeconds: number
  backoff: "fixed" | "linear" | "exponential"
  maxIntervalSeconds: number
}) {
  if (input.checkNumber <= 1) return Math.min(input.initialDelaySeconds, MAX_DELAY_SECONDS)
  const step = input.checkNumber - 2
  const multiplier = input.backoff === "fixed" ? 1 : input.backoff === "linear" ? step + 1 : 2 ** Math.min(step, 52)
  return Math.min(input.intervalSeconds * multiplier, input.maxIntervalSeconds, MAX_DELAY_SECONDS)
}
