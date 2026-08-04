export * as FeedbackAgent from "./feedback"

import { Context, Effect, Layer, Schema } from "effect"
import type { LLMError } from "@opencode-ai/llm"
import { Database } from "../database/database"
import { SessionTodo } from "../session/todo"
import { PartTable, SessionInputTable } from "../session/sql"
import { makeLocationNode } from "../effect/app-node"
import { harness_subtask_feedback } from "../../../opencode/src/config/db"
import { asc, eq } from "drizzle-orm"

export const SubtaskFeedbackItem = Schema.Struct({
  subtaskContent: Schema.String,
  subtaskPrompt: Schema.optional(Schema.String),
  subtaskOutput: Schema.optional(Schema.String),
  isReiterated: Schema.optional(Schema.Boolean),
  isPromptChanged: Schema.optional(Schema.Boolean),
  promptIterationCount: Schema.optional(Schema.Number),
  quality_score: Schema.Number,
  isSatisfied: Schema.Boolean,
  userFeedback: Schema.optional(Schema.String),
  changesRequested: Schema.optional(Schema.String),
}).annotate({ identifier: "FeedbackAgent.SubtaskFeedbackItem" })

export type SubtaskFeedbackItem = typeof SubtaskFeedbackItem.Type

export const SubtaskFeedbackPromptItem = Schema.Struct({
  content: Schema.String,
  status: Schema.String,
  subtaskPrompt: Schema.String,
  subtaskOutputSummary: Schema.String,
  isReiterated: Schema.Boolean,
  isPromptChanged: Schema.Boolean,
  promptIterationCount: Schema.Number,
}).annotate({ identifier: "FeedbackAgent.SubtaskFeedbackPromptItem" })

export type SubtaskFeedbackPromptItem = typeof SubtaskFeedbackPromptItem.Type

export const CollectFeedbackInput = Schema.Struct({
  taskID: Schema.String,
  sessionID: Schema.String,
  feedbacks: Schema.Array(SubtaskFeedbackItem),
}).annotate({ identifier: "FeedbackAgent.CollectFeedbackInput" })
export type CollectFeedbackInput = typeof CollectFeedbackInput.Type

export interface Interface {
  readonly getSubtasksForFeedback: (sessionID: string, _model?: unknown) => Effect.Effect<ReadonlyArray<SubtaskFeedbackPromptItem>, LLMError>
  readonly recordFeedback: (input: CollectFeedbackInput) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/FeedbackAgent") {}

import { SessionSchema } from "../session/schema"

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    const todosSvc = yield* SessionTodo.Service

    // Query Opencode's native SessionInputTable and PartTable to inspect prompt admission & turn history
    const getSubtasksForFeedback = Effect.fn("FeedbackAgent.getSubtasksForFeedback")(function* (sessionID: string, _model?: unknown) {
      const typedSessionID = SessionSchema.ID.make(sessionID)
      const todos = yield* todosSvc.get(typedSessionID).pipe(Effect.orElseSucceed(() => []))
      if (!todos.length) return []

      // 1. Query Opencode's native SessionInputTable to get exact prompt admissions & steer events
      const admittedInputs = yield* db
        .select()
        .from(SessionInputTable)
        .where(eq(SessionInputTable.session_id, typedSessionID))
        .orderBy(asc(SessionInputTable.admitted_seq))
        .all()
        .pipe(Effect.orElseSucceed(() => []))

      const hasSteerPrompts = admittedInputs.some((row) => row.delivery === "steer")
      const totalPromptCount = admittedInputs.length
      const isReiterated = totalPromptCount > 1 || admittedInputs.some((row) => row.promoted_seq !== null)

      // 2. Query PartTable for recorded tool execution steps
      const parts = yield* db
        .select()
        .from(PartTable)
        .where(eq(PartTable.session_id, typedSessionID))
        .orderBy(asc(PartTable.id))
        .all()
        .pipe(Effect.orElseSucceed(() => []))

      const stepList = parts
        .map((part) => {
          const data = part.data
          if (!isRecord(data) || data.type !== "tool") return null
          const toolName = typeof data.tool === "string" ? data.tool : typeof data.name === "string" ? data.name : "tool"
          const stateObj = isRecord(data.state) ? data.state : {}
          const status = typeof stateObj.status === "string" ? stateObj.status : "completed"
          const inputObj = isRecord(stateObj.input) ? stateObj.input : isRecord(data.input) ? data.input : {}
          const target = typeof inputObj.targetFile === "string"
            ? inputObj.targetFile
            : typeof inputObj.path === "string"
            ? inputObj.path
            : typeof inputObj.command === "string"
            ? inputObj.command
            : ""
          return `- Step: ${toolName} ${target ? `[${target}]` : ""} (${status})`
        })
        .filter(Boolean)

      // 3. Process subtasks cyclically matching native Opencode prompt history
      return todos.map((todo, index): SubtaskFeedbackPromptItem => {
        const windowSize = Math.max(3, Math.ceil(stepList.length / todos.length))
        const startIndex = index * windowSize
        const relevantSteps = stepList.slice(startIndex, startIndex + windowSize)
        const stepsText = relevantSteps.length ? relevantSteps.join("\n") : "Standard execution steps completed."

        // Exact prompt used for this subtask from admittedInputs or todo content
        const matchingInput = admittedInputs[index] ?? admittedInputs[0]
        const exactSubtaskPrompt = matchingInput?.prompt?.text ?? `Subtask Requirement: ${todo.content}`

        return {
          content: todo.content,
          status: todo.status,
          subtaskPrompt: exactSubtaskPrompt,
          subtaskOutputSummary: `Status: [${todo.status.toUpperCase()}]\n${stepsText}`,
          isReiterated,
          isPromptChanged: hasSteerPrompts,
          promptIterationCount: Math.max(1, totalPromptCount),
        }
      })
    })

    const recordFeedback = Effect.fn("FeedbackAgent.recordFeedback")(function* (input: CollectFeedbackInput) {
      if (!input.feedbacks.length) return

      yield* db
        .insert(harness_subtask_feedback)
        .values(
          input.feedbacks.map((fb) => ({
            id: `feedback_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
            task_id: input.taskID,
            subtask_content: fb.subtaskContent,
            subtask_prompt: fb.subtaskPrompt ?? `Subtask Requirement: ${fb.subtaskContent}`,
            subtask_output: fb.subtaskOutput ?? "Multi-step tool execution completed.",
            is_reiterated: fb.isReiterated ?? false,
            is_prompt_changed: fb.isPromptChanged ?? false,
            prompt_iteration_count: fb.promptIterationCount ?? 1,
            quality_score: fb.quality_score,
            is_satisfied: fb.isSatisfied,
            user_feedback: fb.userFeedback,
            changes_requested: fb.changesRequested,
            created_at: Date.now(),
          })),
        )
        .run()
        .pipe(Effect.orDie)
    })

    return Service.of({ getSubtasksForFeedback, recordFeedback })
  }),
)

export const node = makeLocationNode({ service: Service, layer, deps: [Database.node, SessionTodo.node] })