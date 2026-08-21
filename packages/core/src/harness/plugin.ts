export * as HarnessPlugin from "./plugin"

import type { Hooks } from "@opencode-ai/plugin"
import { Context, Effect, Layer } from "effect"
import { HarnessVersion } from "./version"
import { PromptFinalizer } from "./improving_prompt_finalizer"
import { Database } from "../database/database"
import { makeLocationNode } from "../effect/app-node"
import { harness_task, harness_subtask_feedback } from "./schema"
import { eq, desc } from "drizzle-orm"

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

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const versionSvc = yield* HarnessVersion.Service
    const finalizerSvc = yield* PromptFinalizer.Service
    const { db } = yield* Database.Service

    const createHooks = Effect.fn("HarnessPlugin.createHooks")(function* (domainCategory: string) {
      const activeVersion = yield* versionSvc.getActiveVersion(domainCategory).pipe(Effect.orElseSucceed(() => undefined))

      const hooks: Hooks = {
        "chat.params": async (_input, output) => {
          if (!activeVersion) return
          if (typeof activeVersion.temperature === "number") output.temperature = activeVersion.temperature
          if (typeof activeVersion.maxOutputTokens === "number") output.maxOutputTokens = activeVersion.maxOutputTokens
          const extraOptions = parseRecord(activeVersion.modelOptions)
          Object.assign(output.options, extraOptions)
        },

        "experimental.chat.system.transform": async (_input, output) => {
          if (!activeVersion) return
          if (activeVersion.systemPrompt) output.system.push(activeVersion.systemPrompt)
          const rules = Array.isArray(activeVersion.extractedRules)
            ? activeVersion.extractedRules
                .filter((r): r is string => typeof r === "string")
                .map((r) => `- ${r}`)
                .join("\n")
            : ""
          if (rules) output.system.push(`EXTRACTED LESSONS:\n${rules}`)
        },

        "experimental.text.complete": async (input, output) => {
          if (output.text && !output.text.includes("Harness Quality & Evolution Feedback")) {
            const auditBanner = `\n\n---\n### 📊 Harness Quality & Evolution Feedback\n**Are you satisfied with this subtask result? (Yes/No)**\n*Reply ` + "`Yes`" + ` to confirm or ` + "`No: <your explanation of how you expected it>`" + ` so the Harness can learn and extract rules for future runs.*`
            output.text += auditBanner
          }
        },

        "tool.definition": async (input, output) => {
          if (!activeVersion) return
          const toolOverrides = parseRecord(activeVersion.toolOverrides)
          const override = toolOverrides[input.toolID]
          if (isRecord(override) && typeof override.description === "string") {
            output.description = override.description
          }
        },

        "tool.execute.before": async (input, output) => {
          if (!activeVersion) return
          const toolArgRules = parseRecord(activeVersion.toolOverrides)
          const toolRule = toolArgRules[input.tool]
          if (isRecord(toolRule) && isRecord(toolRule._args) && isRecord(output.args)) {
            Object.assign(output.args, toolRule._args)
          }
        },

        "tool.execute.after": async (input, output) => {
          if (!activeVersion) return
          const toolNotes = parseRecord(activeVersion.toolOverrides)
          const toolNote = toolNotes[input.tool]
          if (isRecord(toolNote) && typeof toolNote.note === "string" && output.output) {
            output.output = `${output.output}\n\n[HARNESS LESSON: ${toolNote.note}]`
          }
        },

        "permission.ask": async (input, output) => {
          if (!activeVersion) return
          const permRules = parseRecord(activeVersion.toolOverrides)
          const rawInput = input as Record<string, unknown>
          const permissionKey = typeof input === "string"
            ? input
            : isRecord(input) && typeof rawInput.permission === "string"
            ? rawInput.permission
            : isRecord(input) && typeof rawInput.type === "string"
            ? rawInput.type
            : undefined
          if (permissionKey && typeof permRules[permissionKey] === "string") {
            const status = permRules[permissionKey]
            if (status === "allow" || status === "deny" || status === "ask") {
              output.status = status
            }
          }
        },

        "shell.env": async (_input, output) => {
          if (!activeVersion) return
          output.env["HARNESS_DOMAIN"] = domainCategory
          output.env["HARNESS_VERSION_ID"] = activeVersion.versionID
        },

        "chat.message": async (input, output) => {
          const text = output.parts
            .map((p) => {
              if (p.type === "text" && typeof p.text === "string") return p.text
              return ""
            })
            .filter(Boolean)
            .join("\n")
            .trim()

          if (!text) return

          const yesMatch = /^(?:yes|y)\b/i.test(text)
          const noMatch = /^(?:no|n)\s*:\s*(.+)/i.test(text)

          if (!yesMatch && !noMatch) return

          const recentTask = await Effect.runPromise(
            db
              .select()
              .from(harness_task)
              .where(eq(harness_task.session_id, input.sessionID))
              .orderBy(desc(harness_task.task_id))
              .get()
              .pipe(Effect.orElseSucceed(() => undefined)),
          ).catch(() => undefined)

          if (!recentTask) return

          const feedbackID = `feedback_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
          const isYes = yesMatch
          const explanation = noMatch ? text.replace(/^no\s*:\s*/i, "").trim() || "User reported dissatisfaction." : ""

          await Effect.runPromise(
            db
              .insert(harness_subtask_feedback)
              .values({
                id: feedbackID,
                task_id: recentTask.task_id,
                subtask_content: "Overall task completion",
                subtask_prompt: recentTask.task_prompt ?? "",
                subtask_output: isYes ? "User confirmed satisfaction." : "User reported dissatisfaction.",
                is_reiterated: false,
                is_prompt_changed: false,
                prompt_iteration_count: 1,
                quality_score: isYes ? 5 : 1,
                is_satisfied: isYes,
                user_feedback: isYes ? "Yes" : "No",
                changes_requested: isYes ? null : explanation,
                created_at: Date.now(),
              })
              .run(),
          ).catch(() => {})

          // Update task status and satisfaction
          await Effect.runPromise(
            db
              .update(harness_task)
              .set({
                task_status: isYes ? "completed" : "failed",
                task_sub_status: isYes ? "satisfied" : "unsatisfied",
              })
              .where(eq(harness_task.task_id, recentTask.task_id))
              .run(),
          ).catch(() => {})

          // Trigger asynchronous background evolution and regression testing
          const targetModel = recentTask.task_model || "local-tpu/zai-org/GLM-5.2"
          Effect.runPromise(
            finalizerSvc.finalizeAndEvolve(recentTask.task_id, targetModel).pipe(
              Effect.orElseSucceed(() => undefined),
            ),
          ).catch(() => {})
        },

        "experimental.session.compacting": async (_input, output) => {
          if (!activeVersion) return
          if (activeVersion.systemPrompt) {
            output.context.push(`Harness Domain Context (${domainCategory}): ${activeVersion.systemPrompt}`)
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
  deps: [HarnessVersion.node, Database.node, PromptFinalizer.node],
})

