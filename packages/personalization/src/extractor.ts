export * as Extractor from "./extractor"

import { Schema, Effect } from "effect"
import { LLM } from "@opencode-ai/llm"
import type { ProfileDelta, UserProfileData } from "./profile"
import type { MemoryItem } from "./memory"

export const ExtractedMemorySchema = Schema.Struct({
  category: Schema.String.annotate({
    description: "Category of memory: language, framework, style, testing, tool, tech_stack, active_task",
  }),
  content: Schema.String.annotate({
    description: "Clear, concise fact or rule representing developer preference or project context",
  }),
  confidence: Schema.Number.annotate({ description: "Confidence score between 0.0 and 1.0" }),
})

export const ExtractedStyleDeltaSchema = Schema.Struct({
  explicitness: Schema.optional(Schema.Number).annotate({
    description: "0.0 for high abstraction/magic, 1.0 for very explicit/no-magic code",
  }),
  abstraction_tolerance: Schema.optional(Schema.Number).annotate({
    description: "0.0 for flat code, 1.0 for high indirection/layers",
  }),
  verbosity: Schema.optional(Schema.Number).annotate({
    description: "0.0 for concise code-only responses, 1.0 for verbose explanations",
  }),
  testing_style: Schema.optional(Schema.String).annotate({
    description: "Testing framework or convention preferred by developer",
  }),
  typing_rigor: Schema.optional(Schema.Number).annotate({
    description: "0.0 for dynamic/loose typing, 1.0 for strict typing without any",
  }),
})

export const ExtractedProfileDeltaSchema = Schema.Struct({
  languages: Schema.optional(Schema.Array(Schema.String)).annotate({
    description: "List of programming languages explicitly preferred or targeted",
  }),
  frameworks: Schema.optional(Schema.Array(Schema.String)).annotate({
    description: "List of frameworks or libraries explicitly preferred or targeted",
  }),
  style: Schema.optional(ExtractedStyleDeltaSchema),
  architecture_preference: Schema.optional(Schema.String).annotate({
    description: "High-level architectural style rule (e.g. 'explicit functions > classes')",
  }),
  tool_preference: Schema.optional(
    Schema.Struct({
      prefer_cli: Schema.optional(Schema.Boolean),
      prefer_direct_edits: Schema.optional(Schema.Boolean),
      autonomous_level: Schema.optional(Schema.String),
    }),
  ),
  database_style: Schema.optional(Schema.String),
})

export const ExtractedSignalsSchema = Schema.Struct({
  hasUpdates: Schema.Boolean,
  profileDelta: Schema.optional(ExtractedProfileDeltaSchema),
  preferenceMemories: Schema.Array(ExtractedMemorySchema),
  semanticMemories: Schema.Array(ExtractedMemorySchema),
  workingMemories: Schema.Array(ExtractedMemorySchema),
})

export type ExtractedSignalsSchema = typeof ExtractedSignalsSchema.Type

export interface ExtractedSignals {
  profileDelta?: ProfileDelta
  preferenceMemories: Array<Omit<MemoryItem, "id" | "userId" | "createdAt" | "updatedAt" | "accessCount">>
  semanticMemories: Array<Omit<MemoryItem, "id" | "userId" | "createdAt" | "updatedAt" | "accessCount">>
  workingMemories: Array<Omit<MemoryItem, "id" | "userId" | "createdAt" | "updatedAt" | "accessCount">>
}

export function transformToSignals(schemaOutput: ExtractedSignalsSchema): ExtractedSignals {
  return {
    profileDelta: schemaOutput.profileDelta,
    preferenceMemories: schemaOutput.preferenceMemories.map((m) => ({
      tier: "preference" as const,
      category: m.category,
      content: m.content,
      confidence: m.confidence,
    })),
    semanticMemories: schemaOutput.semanticMemories.map((m) => ({
      tier: "semantic" as const,
      category: m.category,
      content: m.content,
      confidence: m.confidence,
    })),
    workingMemories: schemaOutput.workingMemories.map((m) => ({
      tier: "working" as const,
      category: m.category,
      content: m.content,
      confidence: m.confidence,
    })),
  }
}

/**
 * Extracts developer preferences, conventions, and memory updates using structured LLM schema generation.
 * Eliminates all manual regex and hardcoded keywords.
 */
export function extractSignalsWithLLM(input: {
  message: string
  model: unknown
  currentProfile?: UserProfileData
}): Effect.Effect<ExtractedSignals> {
  return Effect.gen(function* () {
    const res = yield* LLM.generateObject({
      model: input.model as Parameters<typeof LLM.generateObject>[0]["model"],
      system:
        "You are a Personalization and Developer Preference Extraction Specialist. " +
        "Analyze developer input to discover style preferences, testing choices, technology stack facts, " +
        "or active debugging context. Output valid structured data matching the schema. " +
        "If no preferences are stated, set hasUpdates to false.",
      prompt: `
Developer Input:
${input.message}

Current Profile:
${JSON.stringify(input.currentProfile ?? {}, null, 2)}
      `.trim(),
      schema: ExtractedSignalsSchema,
      generation: { temperature: 0 },
    }).pipe(
      Effect.map((r) => r.object),
      Effect.orElseSucceed(() => ({
        hasUpdates: false,
        preferenceMemories: [],
        semanticMemories: [],
        workingMemories: [],
      })),
    )

    return transformToSignals(res)
  })
}

/**
 * Parses structured JSON signals into valid ExtractedSignals.
 */
export function parseStructuredSignals(data: unknown): ExtractedSignals {
  const decode = Schema.decodeUnknownOption(ExtractedSignalsSchema)
  const option = decode(data)
  if (option._tag === "Some") {
    return transformToSignals(option.value)
  }
  return {
    preferenceMemories: [],
    semanticMemories: [],
    workingMemories: [],
  }
}
