export * as AutomationClassifier from "./classifier"

import { Context, Effect, Layer, Schema } from "effect"
import { makeGlobalNode } from "../effect/app-node"

export const Complexity = Schema.Literals(["low", "medium", "high"])
export type Complexity = typeof Complexity.Type

export const TaskType = Schema.Literals(["recon", "refactor", "plan", "build", "verify"])
export type TaskType = typeof TaskType.Type

export const Classification = Schema.Struct({
  complexity: Complexity,
  taskType: TaskType,
  reason: Schema.String,
})
export type Classification = typeof Classification.Type

export interface ClassifierConfig {
  readonly endpoint: string
  readonly model: string
  readonly apiKey?: string
}

export const ClassifierConfigRef = Context.Reference<ClassifierConfig>(
  "@opencode/v2/AutomationClassifierConfig",
  {
    defaultValue: () => ({
      endpoint: "http://localhost:11434/v1",
      model: "llama3.2:1b",
    }),
  },
)

export interface Interface {
  readonly classify: (prompt: string) => Effect.Effect<Classification, ClassifierError>
}

export class ClassifierError extends Schema.TaggedErrorClass<ClassifierError>()(
  "Automation.ClassifierError",
  {
    message: Schema.String,
  },
) {}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/AutomationClassifier") {}

const CLASSIFICATION_SYSTEM_PROMPT = `You classify automation prompts by complexity and task type for agent routing.

Return a JSON object with exactly these fields:
- "complexity": "low" | "medium" | "high"
- "taskType": "recon" | "refactor" | "plan" | "build" | "verify"
- "reason": brief explanation (1 sentence)

Guidelines:
- "complexity":
  - "low": short, factual, single-step tasks (summarize, list, format, simple lookup)
  - "medium": multi-step reasoning, code review, planning, moderate debugging
  - "high": complex architecture, multi-file refactors, deep debugging, novel problem-solving
- "taskType":
  - "recon": exploration, searching symbols/files, reading code, gathering context
  - "refactor": well-bounded bulk or repetitive edits, boilerplate, type fixes across isolated modules
  - "plan": designing features, architecture, schema or protocol changes, no side effects yet
  - "build": intricate implementation, state machines, service wiring, migrations, SDK generation
  - "verify": review, testing, validating existing work, checking convergence

Respond with ONLY the JSON object, no markdown, no explanation.`

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const config = yield* ClassifierConfigRef

    const classify: Interface["classify"] = Effect.fn("AutomationClassifier.classify")(function* (prompt) {
      const url = `${config.endpoint.replace(/\/$/, "")}/chat/completions`
      const body = {
        model: config.model,
        messages: [
          { role: "system", content: CLASSIFICATION_SYSTEM_PROMPT },
          { role: "user", content: prompt },
        ],
        temperature: 0,
        max_tokens: 100,
        response_format: { type: "json_object" },
      }

      const response = yield* Effect.tryPromise({
        try: async () => {
          const res = await fetch(url, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
            },
            body: JSON.stringify(body),
          })
          if (!res.ok) {
            const text = await res.text().catch(() => "")
            throw new ClassifierError({ message: `Classifier API error ${res.status}: ${text}` })
          }
          return res.json() as Promise<{
            choices: Array<{ message: { content: string } }>
          }>
        },
        catch: (e) =>
          e instanceof ClassifierError
            ? e
            : new ClassifierError({ message: e instanceof Error ? e.message : String(e) }),
      })

      const content = response.choices[0]?.message?.content
      if (!content) {
        return yield* new ClassifierError({ message: "Empty classifier response" })
      }

      const parsed = yield* Effect.try({
        try: () => JSON.parse(content) as unknown,
        catch: (e) =>
          new ClassifierError({
            message: `Invalid classifier JSON: ${e instanceof Error ? e.message : String(e)}`,
          }),
      })

      const validated = yield* Schema.decodeUnknownExit(Classification)(parsed).pipe(
        Effect.mapError(
          (e) =>
            new ClassifierError({
              message: `Classifier schema validation failed: ${JSON.stringify(e)}`,
            }),
        ),
      )

      return validated
    })

    return Service.of({ classify })
  }),
)

export const node = makeGlobalNode({ service: Service, layer, deps: [] })
