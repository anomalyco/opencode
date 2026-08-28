export * as HarnessPlugin from "./plugin"

import type { Hooks } from "@opencode-ai/plugin"
import { Context, Effect, Layer, Schema } from "effect"
import { LLM } from "@opencode-ai/llm"
import { HarnessVersion } from "./version"
import { PromptFinalizer } from "./improving_prompt_finalizer"
import { JudgeAgent } from "./judge"
import { Database } from "../database/database"
import { makeLocationNode } from "../effect/app-node"
import { harness_task, harness_subtask_feedback } from "./schema"
import { SessionTable } from "../session/sql"
import { SessionSchema } from "../session/schema"
import { eq, desc } from "drizzle-orm"

export const FeedbackClassification = Schema.Struct({
  isFeedback: Schema.Boolean,
  isSatisfied: Schema.Boolean,
  feedbackSummary: Schema.String,
}).annotate({ identifier: "HarnessPlugin.FeedbackClassification" })

export type FeedbackClassification = typeof FeedbackClassification.Type

export interface Interface {
  readonly createHooks: (domainCategory: string) => Effect.Effect<Hooks>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/HarnessPlugin") {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function parseRecord(text: string | null | undefined): Record<string, unknown> {
  if (!text || !text.trim()) return {}

  try {
    const parsed: unknown = JSON.parse(text)
    return isRecord(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

function isClearlyActionableTask(text: string): boolean {
  const normalized = text.trim()

  if (!normalized) return false

  return /^(?:please\s+)?(?:write|create|build|add|modify|change|update|fix|debug|refactor|run|test|implement|generate|solve|complete|develop|make)\b/i.test(
    normalized,
  )
}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const versionSvc = yield* HarnessVersion.Service
    const finalizerSvc = yield* PromptFinalizer.Service
    const judge = yield* JudgeAgent.Service
    const { db } = yield* Database.Service

    const createHooks = Effect.fn("HarnessPlugin.createHooks")(function* (domainCategory: string) {
      const activeVersion = yield* versionSvc
        .getActiveVersion(domainCategory)
        .pipe(Effect.orElseSucceed(() => undefined))

      const taskDecisions = new Map<string, boolean>()

      const resolveActiveVersion = async (sessionID?: string) => {
        if (!sessionID) return activeVersion

        const task = await Effect.runPromise(
          db
            .select()
            .from(harness_task)
            .where(eq(harness_task.session_id, sessionID))
            .orderBy(desc(harness_task.task_id))
            .get()
            .pipe(Effect.orElseSucceed(() => undefined)),
        ).catch(() => undefined)

        if (task?.task_type && task.task_type !== domainCategory) {
          const specificVer = await Effect.runPromise(
            versionSvc
              .getActiveVersion(task.task_type)
              .pipe(Effect.orElseSucceed(() => null)),
          ).catch(() => null)

          if (specificVer) return specificVer
        }

        return activeVersion
      }

      const hooks: Hooks = {
        "chat.params": async (input, output) => {
          const currentVersion = await resolveActiveVersion(input.sessionID)

          if (!currentVersion) return

          if (typeof currentVersion.temperature === "number") {
            output.temperature = currentVersion.temperature
          }

          if (typeof currentVersion.maxOutputTokens === "number") {
            output.maxOutputTokens = currentVersion.maxOutputTokens
          }

          const extraOptions = parseRecord(currentVersion.modelOptions)
          Object.assign(output.options, extraOptions)
        },

        "experimental.chat.system.transform": async (input, output) => {
          const currentVersion = await resolveActiveVersion(input.sessionID)

          if (!currentVersion) return

          if (currentVersion.systemPrompt) {
            output.system.push(currentVersion.systemPrompt)
          }

          const rules = Array.isArray(currentVersion.extractedRules)
            ? currentVersion.extractedRules
                .filter((r): r is string => typeof r === "string")
                .map((r) => `- ${r}`)
                .join("\n")
            : ""

          if (rules) {
            output.system.push(
              `EXTRACTED LESSONS (${currentVersion.domainCategory}):\n${rules}`,
            )
          }
        },

        "experimental.text.complete": async (input, output) => {
          const isTask = taskDecisions.get(input.sessionID)

          taskDecisions.delete(input.sessionID)

          if (!isTask) return

          if (
            output.text &&
            !output.text.includes("Harness Quality & Evolution Feedback")
          ) {
            const auditBanner =
              `\n\n---\n` +
              `### 📊 Harness Quality & Evolution Feedback\n` +
              `**Are you satisfied with this subtask result? (Yes/No)**\n` +
              `*Reply ` +
              "`Yes`" +
              ` to confirm or ` +
              "`No: <your explanation of how you expected it>`" +
              ` so the Harness can learn and extract rules for future runs.*`

            output.text += auditBanner
          }
        },

        "tool.execute.before": async (input, output) => {
          const currentVersion = await resolveActiveVersion(input.sessionID)

          if (!currentVersion) return

          const toolArgRules = parseRecord(currentVersion.toolOverrides)
          const toolRule = toolArgRules[input.tool]

          if (
            isRecord(toolRule) &&
            isRecord(toolRule._args) &&
            isRecord(output.args)
          ) {
            Object.assign(output.args, toolRule._args)
          }
        },

        "tool.execute.after": async (input, output) => {
          const currentVersion = await resolveActiveVersion(input.sessionID)

          if (!currentVersion) return

          const toolNotes = parseRecord(currentVersion.toolOverrides)
          const toolNote = toolNotes[input.tool]

          if (
            isRecord(toolNote) &&
            typeof toolNote.note === "string" &&
            output.output
          ) {
            output.output = `${output.output}\n\n[HARNESS LESSON: ${toolNote.note}]`
          }
        },

        "permission.ask": async (input, output) => {
          const currentVersion = activeVersion

          if (!currentVersion) return

          const permRules = parseRecord(currentVersion.toolOverrides)
          const rawInput = input as Record<string, unknown>

          const permissionKey =
            typeof input === "string"
              ? input
              : isRecord(input) && typeof rawInput.permission === "string"
                ? rawInput.permission
                : isRecord(input) && typeof rawInput.type === "string"
                  ? rawInput.type
                  : undefined

          if (
            permissionKey &&
            typeof permRules[permissionKey] === "string"
          ) {
            const status = permRules[permissionKey]

            if (
              status === "allow" ||
              status === "deny" ||
              status === "ask"
            ) {
              output.status = status
            }
          }
        },

        "shell.env": async (input, output) => {
          const currentVersion = await resolveActiveVersion(input.sessionID)

          if (!currentVersion) return

          output.env["HARNESS_DOMAIN"] = currentVersion.domainCategory
          output.env["HARNESS_VERSION_ID"] = currentVersion.versionID
        },

        "chat.message": async (input, output) => {
          try {
            const text = output.parts
              .map((p) => {
                if (p.type === "text" && typeof p.text === "string") {
                  return p.text
                }

                return ""
              })
              .filter(Boolean)
              .join("\n")
              .trim()

            if (!text) return

            const classification = await Effect.runPromise(
              judge.classify(text, input.model),
            ).catch(() => undefined)

            const llmIsTask = classification?.isTask === true
            const deterministicIsTask = isClearlyActionableTask(text)

            const isTask =
              llmIsTask || deterministicIsTask

            taskDecisions.set(
              input.sessionID,
              isTask,
            )

            const lower = text.toLowerCase()

            const isYes =
              /^(?:yes|y|looks good|perfect|satisfied|confirmed|approved|great|good)\b/i.test(
                lower,
              )

            const isNo =
              /^(?:no|n|not good|unsatisfied|wrong|different|dislike|failed|needs work)\b/i.test(
                lower,
              )

            if (!isYes && !isNo) return

            const isSatisfied = isYes

            const explanation = isNo
              ? text
                  .replace(
                    /^(?:no|n|not good|unsatisfied|wrong|different|dislike|failed|needs work)\s*[:\s-]*/i,
                    "",
                  )
                  .trim() || "User reported dissatisfaction."
              : "User confirmed satisfaction."

            const selectedModel = input.model
              ? `${input.model.providerID}/${input.model.modelID}`
              : "local-tpu/zai-org/GLM-5.2"

            // 1. Fetch or auto-provision harness_task for interactive session
            let recentTask = await Effect.runPromise(
              db
                .select()
                .from(harness_task)
                .where(eq(harness_task.session_id, input.sessionID))
                .orderBy(desc(harness_task.task_id))
                .get()
                .pipe(Effect.orElseSucceed(() => undefined)),
            ).catch(() => undefined)

            if (!recentTask) {
              const autoTaskID = `task_${Date.now()}_${Math.random()
                .toString(36)
                .slice(2, 7)}`

              await Effect.runPromise(
                db
                  .insert(harness_task)
                  .values({
                    task_id: autoTaskID,
                    task_prompt: "Interactive session task",
                    task_type: domainCategory || "general",
                    task_model: selectedModel,
                    task_status: "running",
                    task_sub_status: "in_progress",
                    session_id: input.sessionID,
                  })
                  .run(),
              ).catch(() => {})

              recentTask = await Effect.runPromise(
                db
                  .select()
                  .from(harness_task)
                  .where(eq(harness_task.task_id, autoTaskID))
                  .get()
                  .pipe(Effect.orElseSucceed(() => undefined)),
              ).catch(() => undefined)
            }

            if (!recentTask) return

            // 2. Save feedback into harness_subtask_feedback
            const feedbackID = `feedback_${Date.now()}_${Math.random()
              .toString(36)
              .slice(2, 7)}`

            await Effect.runPromise(
              db
                .insert(harness_subtask_feedback)
                .values({
                  id: feedbackID,
                  task_id: recentTask.task_id,
                  subtask_content: "Overall task completion",
                  subtask_prompt: recentTask.task_prompt ?? "",
                  subtask_output: isSatisfied
                    ? "User confirmed satisfaction."
                    : explanation,
                  is_reiterated: false,
                  is_prompt_changed: false,
                  prompt_iteration_count: 1,
                  quality_score: isSatisfied ? 5 : 1,
                  is_satisfied: isSatisfied,
                  user_feedback: isSatisfied ? "Yes" : "No",
                  changes_requested: isSatisfied ? null : explanation,
                  created_at: Date.now(),
                })
                .run(),
            ).catch(() => {})

            // 3. Update task status and satisfaction
            await Effect.runPromise(
              db
                .update(harness_task)
                .set({
                  task_status: isSatisfied ? "completed" : "failed",
                  task_sub_status: isSatisfied
                    ? "satisfied"
                    : "unsatisfied",
                })
                .where(eq(harness_task.task_id, recentTask.task_id))
                .run(),
            ).catch(() => {})

            // 4. Update SessionTable.metadata with key feedback info
            const typedSessionID = SessionSchema.ID.make(input.sessionID)

            const sessionRow = await Effect.runPromise(
              db
                .select({ metadata: SessionTable.metadata })
                .from(SessionTable)
                .where(eq(SessionTable.id, typedSessionID))
                .get()
                .pipe(Effect.orElseSucceed(() => undefined)),
            ).catch(() => undefined)

            if (sessionRow) {
              const harnessFeedback = {
                taskID: recentTask.task_id,
                feedbackID,
                isSatisfied,
                score: isSatisfied ? 5 : 1,
                status: isSatisfied ? "satisfied" : "unsatisfied",
                userFeedback: isSatisfied ? "Yes" : "No",
                critique: explanation,
                evaluatedAt: Date.now(),
              }

              await Effect.runPromise(
                db
                  .update(SessionTable)
                  .set({
                    metadata: {
                      ...(sessionRow.metadata ?? {}),
                      harnessFeedback,
                    },
                  })
                  .where(eq(SessionTable.id, typedSessionID))
                  .run(),
              ).catch(() => {})
            }

            // 5. Trigger asynchronous background evolution and regression testing
            const targetModel = recentTask.task_model || selectedModel

            Effect.runPromise(
              finalizerSvc
                .finalizeAndEvolve(
                  recentTask.task_id,
                  targetModel,
                )
                .pipe(
                  Effect.orElseSucceed(() => undefined),
                ),
            ).catch(() => {})

            // 6. Instruct the assistant to acknowledge the feedback cleanly
            for (const part of output.parts) {
              if (part.type === "text") {
                part.text =
                  `[Harness Feedback System]: The user provided evaluation feedback on the previous task: "${explanation}". Please briefly acknowledge this feedback in 1-2 sentences, confirm that it has been logged into the Harness Evolution pipeline to extract rules for future runs, and state that you are ready for the next task.`
              }
            }
          } catch (error) {
            console.error(
              "[HarnessPlugin] Error processing chat.message:",
              error,
            )
          }
        },

        "experimental.session.compacting": async (_input, output) => {
          if (!activeVersion) return

          if (activeVersion.systemPrompt) {
            output.context.push(
              `Harness Domain Context (${domainCategory}): ${activeVersion.systemPrompt}`,
            )
          }
        },
      }

      return hooks
    })

    return Service.of({ createHooks })
  }),
)

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [
    HarnessVersion.node,
    Database.node,
    PromptFinalizer.node,
    JudgeAgent.node,
  ],
})