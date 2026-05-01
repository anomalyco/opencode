import path from "path"
import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { Question } from "../question"
import { Session } from "@/session/session"
import { MessageV2 } from "../session/message-v2"
import { Provider } from "../provider"
import { Instance } from "../project/instance"
import { AppFileSystem } from "@opencode-ai/shared/filesystem"
import { type SessionID, MessageID, PartID } from "../session/schema"
import { diffLines } from "diff"
import EXIT_DESCRIPTION from "./plan-exit.txt"

const PLAN_VERSION_KEY = "plan_version"
const PLAN_CONTENT_KEY = "plan_content"

interface PlanValidation {
  valid: boolean
  errors: string[]
  warnings: string[]
}

function countPlanSections(content: string): { steps: number; files: number; verification: boolean } {
  const stepsMatch = content.match(/(?:^|\n)(\d+[\.\)]\s|\-\s|step\s*\d+)/gi)
  const filesMatch = content.match(/(?:file|path|modify|create|edit):?\s*/gi)
  const verification = /test|verify|run|check/i.test(content)

  return {
    steps: stepsMatch?.length ?? 0,
    files: filesMatch?.length ?? 0,
    verification,
  }
}

function validatePlan(content: string): PlanValidation {
  const errors: string[] = []
  const warnings: string[] = []

  if (!content || content.trim().length === 0) {
    errors.push("Plan file is empty")
    return { valid: false, errors, warnings }
  }

  const trimmed = content.trim()
  if (trimmed.length < 50) {
    errors.push("Plan is too short (less than 50 characters)")
  }

  const sections = countPlanSections(trimmed)

  if (sections.steps === 0) {
    errors.push("Plan must contain at least one step (numbered list or bullet points)")
  }

  if (sections.steps > 0 && sections.steps < 2) {
    warnings.push("Consider breaking down the plan into more detailed steps")
  }

  if (!sections.verification) {
    warnings.push("Consider adding a verification/testing section")
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  }
}

function getPlanVersion(sessionID: SessionID): number {
  const parts = MessageV2.stream(sessionID).flatMap((m) => m.parts)
  const versionParts = parts.filter((p) => p.type === "text" && p.text.includes(PLAN_VERSION_KEY))

  if (versionParts.length === 0) return 0

  const lastVersionPart = versionParts[versionParts.length - 1] as MessageV2.TextPart
  const match = lastVersionPart.text.match(/plan_version[=:]?\s*(\d+)/i)
  return match ? parseInt(match[1], 10) : 0
}

function generatePlanDiff(oldContent: string, newContent: string): string {
  const changes = diffLines(oldContent, newContent)
  const lines: string[] = []

  let additions = 0
  let deletions = 0

  for (const change of changes) {
    if (change.added) {
      additions += change.count || 0
      for (const line of change.value.split("\n").filter((l) => l.trim())) {
        lines.push(`+ ${line}`)
      }
    } else if (change.removed) {
      deletions += change.count || 0
      for (const line of change.value.split("\n").filter((l) => l.trim())) {
        lines.push(`- ${line}`)
      }
    }
  }

  return [
    `Plan changes: +${additions} lines, -${deletions} lines`,
    "",
    lines.slice(0, 20).join("\n"),
    lines.length > 20 ? `\n... and ${lines.length - 20} more changes` : "",
  ]
    .filter(Boolean)
    .join("\n")
}

function getLastModel(sessionID: SessionID) {
  for (const item of MessageV2.stream(sessionID)) {
    if (item.info.role === "user" && item.info.model) return item.info.model
  }
  return undefined
}

export const Parameters = Schema.Struct({})

export const PlanExitTool = Tool.define(
  "plan_exit",
  Effect.gen(function* () {
    const session = yield* Session.Service
    const question = yield* Question.Service
    const provider = yield* Provider.Service
    const fs = yield* AppFileSystem.Service

    return {
      description: EXIT_DESCRIPTION,
      parameters: Parameters,
      execute: (_params: {}, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const instance = yield* InstanceState.context
          const info = yield* session.get(ctx.sessionID)
          const planPath = Session.plan(info)
          const plan = path.relative(Instance.worktree, planPath)

          const exists = yield* fs.existsSafe(planPath)
          if (!exists) {
            return {
              title: "Plan validation failed",
              output: "No plan file exists yet. Please create a plan before calling plan_exit.",
              metadata: { validation: { valid: false, errors: ["No plan file exists"] } },
            }
          }

          const content = yield* fs.readFileText(planPath)
          const validation = validatePlan(content)

          const currentVersion = getPlanVersion(ctx.sessionID)
          const previousContent = ctx.extra?.[PLAN_CONTENT_KEY] as string | undefined

          if (previousContent && previousContent !== content) {
            const diff = generatePlanDiff(previousContent, content)
            yield* ctx.metadata({
              metadata: {
                plan_diff: diff,
                plan_version: currentVersion + 1,
              },
            })
          }

          if (!validation.valid) {
            const errorMsg = [
              "Plan validation failed:",
              ...validation.errors.map((e) => `  - ${e}`),
              "",
              "Please fix these issues before exiting plan mode.",
            ].join("\n")

            return {
              title: "Plan validation failed",
              output: errorMsg,
              metadata: { validation },
            }
          }

          const warningMsg =
            validation.warnings.length > 0
              ? ["", "Warnings:", ...validation.warnings.map((w) => `  - ${w}`)].join("\n")
              : ""

          const answers = yield* question.ask({
            sessionID: ctx.sessionID,
            questions: [
              {
                question: warningMsg
                  ? `Plan at ${plan} is complete (with warnings). Would you like to switch to the build agent and start implementing?\n${warningMsg}`
                  : `Plan at ${plan} is complete. Would you like to switch to the build agent and start implementing?`,
                header: "Build Agent",
                custom: false,
                options: [
                  { label: "Yes", description: "Switch to build agent and start implementing the plan" },
                  { label: "No", description: "Stay with plan agent to continue refining the plan" },
                  { label: "View Plan", description: "View the current plan content" },
                ],
              },
            ],
            tool: ctx.callID ? { messageID: ctx.messageID, callID: ctx.callID } : undefined,
          })

          const answer = answers[0]?.[0]

          if (answer === "No" || !answer) yield* new Question.RejectedError()

          if (answer === "View Plan") {
            const preview = content.slice(0, 1000) + (content.length > 1000 ? "\n\n...(truncated)" : "")
            return {
              title: "Current Plan",
              output: `<plan>\n${preview}\n</plan>`,
              metadata: { validation, plan_version: currentVersion + 1 },
            }
          }

          const model = getLastModel(ctx.sessionID) ?? (yield* provider.defaultModel())

          const msg: MessageV2.User = {
            id: MessageID.ascending(),
            sessionID: ctx.sessionID,
            role: "user",
            time: { created: Date.now() },
            agent: "build",
            model,
          }
          yield* session.updateMessage(msg)
          yield* session.updatePart({
            id: PartID.ascending(),
            messageID: msg.id,
            sessionID: ctx.sessionID,
            type: "text",
            text: `The plan at ${plan} has been approved (version ${currentVersion + 1}), you can now edit files. Execute the plan`,
            synthetic: true,
          } satisfies MessageV2.TextPart)

          return {
            title: "Switching to build agent",
            output: `User approved switching to build agent (plan version ${currentVersion + 1}). Wait for further instructions.`,
            metadata: { validation, plan_version: currentVersion + 1 },
          }
        }).pipe(Effect.orDie),
    }
  }),
)
