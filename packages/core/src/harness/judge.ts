export * as JudgeAgent from "./judge"

import { Context, Effect, Layer, Option, Schema } from "effect"
import { LLM, LLMError } from "@opencode-ai/llm"
import { Database } from "../database/database"
import { SessionTodo } from "../session/todo"
import { PartTable } from "../session/sql"
import { SessionSchema } from "../session/schema"
import { Config } from "../config"
import { makeLocationNode } from "../effect/app-node"
import { harness_task, harness_subtask_feedback } from "./schema"
import { eq } from "drizzle-orm"

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

export const Classification = Schema.Struct({
  isTask: Schema.Boolean,
  taskType: Schema.optional(Schema.String),
  taskSubType: Schema.optional(Schema.String),
  taskSubTypes: Schema.optional(Schema.Array(Schema.String)),
  summary: Schema.optional(Schema.String),
}).annotate({ identifier: "JudgeAgent.Classification" })
export type Classification = typeof Classification.Type

export const Evaluation = Schema.Struct({
  isSatisfied: Schema.Boolean,
  score: Schema.Number,
  codeQualityScore: Schema.optional(Schema.Number),
  originalityScore: Schema.optional(Schema.Number),
  completenessScore: Schema.optional(Schema.Number),
  efficiencyScore: Schema.optional(Schema.Number),
  robustnessScore: Schema.optional(Schema.Number),
  reasoning: Schema.String,
  critique: Schema.optional(Schema.String),
  flawsIdentified: Schema.optional(Schema.Array(Schema.String)),
  originalityHighlights: Schema.optional(Schema.Array(Schema.String)),
  reflections: Schema.optional(Schema.Array(Schema.String)),
}).annotate({ identifier: "JudgeAgent.Evaluation" })
export type Evaluation = typeof Evaluation.Type

export const SubtaskItem = Schema.Struct({
  content: Schema.String,
  status: Schema.String,
}).annotate({ identifier: "JudgeAgent.SubtaskItem" })
export type SubtaskItem = typeof SubtaskItem.Type

export const RegisterTaskInput = Schema.Struct({
  prompt: Schema.String,
  taskType: Schema.optional(Schema.String),
  taskSubType: Schema.optional(Schema.Union([Schema.String, Schema.Array(Schema.String)])),
  taskSubTypes: Schema.optional(Schema.Array(Schema.String)),
  taskModel: Schema.optional(Schema.String),
  embedding: Schema.optional(Schema.Unknown),
  sessionID: Schema.optional(Schema.String),
}).annotate({ identifier: "JudgeAgent.RegisterTaskInput" })
export type RegisterTaskInput = typeof RegisterTaskInput.Type

export const EvaluateInput = Schema.Struct({
  taskID: Schema.String,
  sessionID: Schema.optional(Schema.String),
  originalPrompt: Schema.String,
  subtasks: Schema.optional(Schema.Array(SubtaskItem)),
  toolTraceSummary: Schema.optional(Schema.String),
  userResponse: Schema.optional(Schema.String),
}).annotate({ identifier: "JudgeAgent.EvaluateInput" })
export type EvaluateInput = typeof EvaluateInput.Type

export interface Interface {
  readonly classify: (prompt: string, model: unknown) => Effect.Effect<Classification, LLMError>
  readonly registerTask: (input: RegisterTaskInput) => Effect.Effect<string>
  readonly evaluate: (input: EvaluateInput, model: unknown) => Effect.Effect<Evaluation, LLMError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/JudgeAgent") {}

function fetchEmbedding(
  text: string,
  options?: { baseURL?: string; model?: string; apiKey?: string }
): Effect.Effect<Float32Array | undefined> {
  const baseURL = options?.baseURL || "http://localhost:11434/api/embed"
  const model = options?.model || "nomic-embed-text"
  const apiKey = options?.apiKey

  return Effect.tryPromise({
    try: async () => {
      const headers: Record<string, string> = { "Content-Type": "application/json" }
      if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`

      const res = await fetch(baseURL, {
        method: "POST",
        headers,
        body: JSON.stringify({ model, input: text }),
        signal: AbortSignal.timeout(3000),
      })
      if (!res.ok) return undefined
      const data: unknown = await res.json()
      if (
        typeof data === "object" &&
        data !== null &&
        "embeddings" in data &&
        Array.isArray(data.embeddings) &&
        Array.isArray(data.embeddings[0])
      ) {
        const rawVec = data.embeddings[0] as number[]
        if (rawVec.every((v) => typeof v === "number")) {
          return new Float32Array(rawVec)
        }
      }
      return undefined
    },
    catch: () => undefined,
  }).pipe(Effect.orElseSucceed(() => undefined))
}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    const todosSvc = yield* SessionTodo.Service
    const configOption = yield* Effect.serviceOption(Config.Service)

    // Job 1: Classify prompt dynamically via LLM structured output without hardcoded fallbacks
    const classify = Effect.fn("JudgeAgent.classify")(function* (prompt: string, model: unknown) {
      const res = yield* LLM.generateObject({
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
        model: model as Parameters<typeof LLM.generateObject>[0]["model"],
        system: "You are a Judge Agent. Analyze the user prompt and determine if it is an actionable task. Output taskType (e.g., 'web', 'backend', 'devops', 'refactor', 'bugfix') and taskSubTypes as a list of sub-domain tags (e.g., ['css-theme', 'ui-component', 'type-check']).",
        prompt,
        schema: Classification,
        generation: { temperature: 0 },
      })

      return res.object
    })

    // Job 1 sub-step: Register task into harness_task table using official vector embedding input
    const registerTask = Effect.fn("JudgeAgent.registerTask")(function* (input: RegisterTaskInput) {
      const taskID = `task_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`

      const embeddingVec = input.embedding instanceof Float32Array
        ? input.embedding
        : Array.isArray(input.embedding) && input.embedding.every((v) => typeof v === "number")
        ? new Float32Array(input.embedding as number[])
        : yield* fetchEmbedding(input.prompt)

      const subTypes = Array.isArray(input.taskSubTypes)
        ? input.taskSubTypes
        : Array.isArray(input.taskSubType)
        ? input.taskSubType
        : typeof input.taskSubType === "string"
        ? [input.taskSubType]
        : ["general-task"]

      const taskSubTypeFormatted = JSON.stringify(subTypes)

      const configEntries = Option.isSome(configOption)
        ? yield* configOption.value.entries().pipe(Effect.orElseSucceed(() => [] as Config.Entry[]))
        : []
      const selectedModel = input.taskModel || Config.latest(configEntries, "model") || "local-tpu/zai-org/GLM-5.2"

      yield* db
        .insert(harness_task)
        .values({
          task_id: taskID,
          task_prompt: input.prompt,
          task_type: input.taskType || "general",
          task_model: selectedModel,
          task_sub_type: taskSubTypeFormatted,
          task_status: "running",
          task_sub_status: "in_progress",
          task_embeddings: embeddingVec,
          session_id: input.sessionID ?? null,
        })
        .run()
        .pipe(Effect.orDie)

      return taskID
    })

    // Job 2: Evaluate multi-step, multi-file output quality using subtask trace & tool summary
    const evaluate = Effect.fn("JudgeAgent.evaluate")(function* (input: EvaluateInput, model: unknown) {
      let subtasks = input.subtasks ?? []
      if (!subtasks.length && input.sessionID) {
        const fetchedTodos = yield* todosSvc
          .get(SessionSchema.ID.make(input.sessionID))
          .pipe(Effect.orElseSucceed(() => []))
        subtasks = fetchedTodos.map((todo) => ({ content: todo.content, status: todo.status }))
      }

      let toolTrace = input.toolTraceSummary ?? ""
      if (!toolTrace && input.sessionID) {
        const toolParts = yield* db
          .select()
          .from(PartTable)
          .where(eq(PartTable.session_id, SessionSchema.ID.make(input.sessionID)))
          .all()
          .pipe(Effect.orElseSucceed(() => []))

        toolTrace = toolParts
          .map((part) => {
            const data = part.data
            if (!data || data.type !== "tool") return null
            const toolData = data as { type: "tool"; tool: string; state: { status: string } }
            return `- Tool: ${toolData.tool} | Status: ${toolData.state.status}`
          })
          .filter(Boolean)
          .join("\n")
      }

      const subtaskSummary = subtasks.length
        ? subtasks.map((st) => `- [${st.status}] ${st.content}`).join("\n")
        : "No explicit subtasks recorded."

      const evalRes = yield* LLM.generateObject({
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
        model: model as Parameters<typeof LLM.generateObject>[0]["model"],
        system: `You are an uncompromising AI Code Judge & Software Auditor.
Evaluate the code generation trace across 5 Critical Dimensions of Quality & Originality, taking into account user feedback, preferences, and user bias:

1. User Alignment & Feedback Satisfaction (isSatisfied):
   - Prioritize explicit user feedback, user bias, and requested subtask behavior above default heuristics.
   - If the user reported dissatisfaction ("No: ..."), score the result as unsatisfied (isSatisfied: false) regardless of technical completion.
2. Code Quality & Architecture (codeQualityScore: 1-5):
   - Strict TypeScript typing, modular composition, clean file organization, zero lint warnings.
3. Originality & Design Excellence (originalityScore: 1-5):
   - Custom tailored component designs, bespoke SVG icons/graphics, cohesive color token palettes, no generic copy-paste templates.
4. Completeness & Correctness (completenessScore: 1-5):
   - All requested subtasks fulfilled according to user expectations.
5. Performance & Robustness (efficiencyScore: 1-5, robustnessScore: 1-5):
   - Clean DOM structures, minimal re-renders, graceful fallback handling, clean error states.

Scoring Rubric:
- 5 Stars (Flawless): Exceptional quality & originality, zero re-prompts needed, complete alignment with user expectations.
- 4 Stars (Good): Fully functional, but contains minor style non-conformities or derivative component structures.
- 3 Stars (Acceptable): Functional, but uses generic boilerplate templates, missing comments, or suboptimal performance.
- 2 Stars (Flawed): Partially completed; required user steering, contains type warnings, or diverged from user expectation.
- 1 Star (Failed): Unhandled runtime crashes, broken syntax, or failed user requirements.

Do NOT give 5/5 easily. Weight explicit user feedback heavily to ensure the Harness evolves according to the user's bias and standards.`,
        prompt: `
Original Task Prompt:
${input.originalPrompt}

Subtasks Progress:
${subtaskSummary}

Execution & Tool Trace Summary:
${toolTrace || "Standard execution trace"}

User Feedback:
${input.userResponse ?? "None"}
        `.trim(),
        schema: Evaluation,
        generation: { temperature: 0 },
      }).pipe(Effect.map((res) => res.object))

      const evalSummary = [
        `Overall: ${evalRes.score}/5`,
        `Quality: ${evalRes.codeQualityScore ?? evalRes.score}/5`,
        `Originality: ${evalRes.originalityScore ?? evalRes.score}/5`,
        `Completeness: ${evalRes.completenessScore ?? evalRes.score}/5`,
        `Efficiency: ${evalRes.efficiencyScore ?? evalRes.score}/5`,
        `Robustness: ${evalRes.robustnessScore ?? evalRes.score}/5`,
        evalRes.reasoning ? `Reasoning: ${evalRes.reasoning}` : "",
        evalRes.critique ? `Critique: ${evalRes.critique}` : "",
        evalRes.flawsIdentified?.length ? `Flaws: ${evalRes.flawsIdentified.join("; ")}` : "",
        evalRes.originalityHighlights?.length ? `Originality Highlights: ${evalRes.originalityHighlights.join("; ")}` : "",
      ].filter(Boolean).join(" | ")

      yield* db
        .update(harness_task)
        .set({
          task_status: evalRes.isSatisfied ? "completed" : "failed",
          task_sub_status: evalRes.isSatisfied ? "satisfied" : "unsatisfied",
          task_error: evalSummary,
        })
        .where(eq(harness_task.task_id, input.taskID))
        .run()
        .pipe(Effect.orDie)

      const hasSubFive =
        evalRes.score < 5 ||
        (evalRes.codeQualityScore ?? 5) < 5 ||
        (evalRes.originalityScore ?? 5) < 5 ||
        (evalRes.completenessScore ?? 5) < 5 ||
        (evalRes.efficiencyScore ?? 5) < 5 ||
        (evalRes.robustnessScore ?? 5) < 5

      if (hasSubFive) {
        const flawNote =
          evalRes.flawsIdentified?.join("; ") || evalRes.critique || evalRes.reasoning || "Sub-optimal score across quality dimensions."
        const subFiveDims = [
          (evalRes.codeQualityScore ?? 5) < 5 ? `Quality (${evalRes.codeQualityScore}/5)` : "",
          (evalRes.originalityScore ?? 5) < 5 ? `Originality (${evalRes.originalityScore}/5)` : "",
          (evalRes.completenessScore ?? 5) < 5 ? `Completeness (${evalRes.completenessScore}/5)` : "",
          (evalRes.efficiencyScore ?? 5) < 5 ? `Efficiency (${evalRes.efficiencyScore}/5)` : "",
          (evalRes.robustnessScore ?? 5) < 5 ? `Robustness (${evalRes.robustnessScore}/5)` : "",
        ].filter(Boolean).join(", ")

        const reqNote = `Refinement requested to reach 5/5: Improve ${subFiveDims || "general quality"} to meet 5-star rubric.`

        yield* db
          .update(harness_subtask_feedback)
          .set({
            user_feedback: flawNote,
            changes_requested: reqNote,
          })
          .where(eq(harness_subtask_feedback.task_id, input.taskID))
          .run()
          .pipe(Effect.orElseSucceed(() => undefined))
      }

      return evalRes
    })

    return Service.of({ classify, registerTask, evaluate })
  }),
)

export const node = makeLocationNode({ service: Service, layer, deps: [Database.node, SessionTodo.node] })