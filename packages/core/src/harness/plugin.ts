export * as HarnessPlugin from "./plugin"

import type { Hooks } from "@opencode-ai/plugin"
import { Context, Effect, Layer } from "effect"
import { HarnessVersion } from "./version"
import { makeLocationNode } from "../effect/app-node"

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

import { Database } from "../database/database"
import { harness_task, harness_subtask_feedback } from "../../../opencode/src/config/db"
import { eq } from "drizzle-orm"

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const versionSvc = yield* HarnessVersion.Service
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
          if (!activeVersion) return
          const rawInput = input as Record<string, unknown>
          const sessionID = typeof rawInput.sessionID === "string" ? rawInput.sessionID : undefined
          if (!sessionID) return

          const taskID = `task_${sessionID}`
          try {
            const taskRow = Effect.runSync(
              db
                .select()
                .from(harness_task)
                .where(eq(harness_task.task_id, taskID))
                .pipe(Effect.orElseSucceed(() => [])),
            )

            if (taskRow.length && taskRow[0]?.task_error) {
              const feedbackRows = Effect.runSync(
                db
                  .select()
                  .from(harness_subtask_feedback)
                  .where(eq(harness_subtask_feedback.task_id, taskID))
                  .pipe(Effect.orElseSucceed(() => [])),
              )

              const subFiveFeedback = feedbackRows.find((f) => f.user_feedback || f.changes_requested)
              if (subFiveFeedback && subFiveFeedback.user_feedback) {
                const auditBanner = `\n\n---\n### 📊 Harness Quality Audit & User Feedback Request\n- **Evaluation**: ${taskRow[0].task_error}\n- **Feedback**: ${subFiveFeedback.user_feedback}\n- **Refinement Recommendation**: ${subFiveFeedback.changes_requested || "N/A"}`
                if (!output.text.includes("Harness Quality Audit")) {
                  output.text += auditBanner
                }
              }
            }
          } catch {}
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

export const node = makeLocationNode({ service: Service, layer, deps: [HarnessVersion.node, Database.node] })
