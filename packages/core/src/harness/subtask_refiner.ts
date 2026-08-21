export * as SubtaskRefinerAgent from "./subtask_refiner"

import { Context, Effect, Layer, Schema } from "effect"
import { LLM, LLMError } from "@opencode-ai/llm"
import { Database } from "../database/database"
import { PartTable } from "../session/sql"
import { SessionSchema } from "../session/schema"
import { makeLocationNode } from "../effect/app-node"
import { harness_subtask_feedback } from "./schema"
import { and, eq } from "drizzle-orm"

export const RefinementRequest = Schema.Struct({
  taskID: Schema.String,
  sessionID: Schema.optional(Schema.String),
  subtaskContent: Schema.String,
  originalPrompt: Schema.String,
  subtaskOutput: Schema.optional(Schema.String),
  userFeedback: Schema.optional(Schema.String),
  changesRequested: Schema.optional(Schema.String),
}).annotate({ identifier: "SubtaskRefinerAgent.RefinementRequest" })

export type RefinementRequest = typeof RefinementRequest.Type

export const RefinementResult = Schema.Struct({
  subtaskContent: Schema.String,
  originalPrompt: Schema.String,
  refinedPrompt: Schema.String,
  reasoning: Schema.String,
  keyAdjustments: Schema.Array(Schema.String),
}).annotate({ identifier: "SubtaskRefinerAgent.RefinementResult" })

export type RefinementResult = typeof RefinementResult.Type

export interface Interface {
  readonly refine: (input: RefinementRequest, model: unknown) => Effect.Effect<RefinementResult, LLMError>
  readonly recordRefinementSuccess: (taskID: string, subtaskContent: string, refinedPrompt: string) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/SubtaskRefinerAgent") {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const { db } = yield* Database.Service

    // Specialized Agent Job: Analyze failed subtask, summarize tool trace from PartTable, and generate refined prompt
    const refine = Effect.fn("SubtaskRefinerAgent.refine")(function* (input: RefinementRequest, model: unknown) {
      let toolTrace = input.subtaskOutput ?? ""

      // Auto-query PartTable from SQLite for tool call trace & prompt summaries if sessionID is provided
      if (!toolTrace && input.sessionID) {
        const parts = yield* db
          .select()
          .from(PartTable)
          .where(eq(PartTable.session_id, SessionSchema.ID.make(input.sessionID)))
          .all()
          .pipe(Effect.orElseSucceed(() => []))

        toolTrace = parts
          .map((part) => {
            const data = part.data
            if (!data) return null
            if (data.type === "tool") {
              const toolData = data as { type: "tool"; tool: string; state: { status: string } }
              return `- Tool Execution Step: ${toolData.tool} (${toolData.state.status})`
            }
            if (data.type === "text") {
              const textData = data as { type: "text"; text: string }
              return `- Summary Output: ${textData.text.slice(0, 150)}...`
            }
            return null
          })
          .filter(Boolean)
          .join("\n")
      }

      const res = yield* LLM.generateObject({
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
        model: model as Parameters<typeof LLM.generateObject>[0]["model"],
        system: "You are an Expert Subtask Prompt Refiner Agent. Analyze the failed subtask, original prompt, tool execution trace, and user requested changes to generate a modified, improved subtask prompt.",
        prompt: `
Target Subtask:
${input.subtaskContent}

Original Prompt Used:
${input.originalPrompt}

Summarized Tool Execution & Output Trace:
${toolTrace || "Standard execution trace"}

User Feedback:
${input.userFeedback ?? "Subtask output did not meet requirements."}

User Requested Changes:
${input.changesRequested ?? "Improve correctness and fulfill task criteria."}
        `.trim(),
        schema: RefinementResult,
        generation: { temperature: 0 },
      })

      return res.object
    })

    // Record successful prompt refinement outcome in SQLite
    const recordRefinementSuccess = Effect.fn("SubtaskRefinerAgent.recordRefinementSuccess")(function* (
      taskID: string,
      subtaskContent: string,
      refinedPrompt: string,
    ) {
      yield* db
        .update(harness_subtask_feedback)
        .set({
          subtask_prompt: refinedPrompt,
          is_prompt_changed: true,
          is_satisfied: true,
        })
        .where(and(eq(harness_subtask_feedback.task_id, taskID), eq(harness_subtask_feedback.subtask_content, subtaskContent)))
        .run()
        .pipe(Effect.orDie)
    })

    return Service.of({ refine, recordRefinementSuccess })
  }),
)

export const node = makeLocationNode({ service: Service, layer, deps: [Database.node] })
