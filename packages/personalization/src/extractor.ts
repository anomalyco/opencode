import { Schema, Effect } from "effect"
import { LLM } from "@opencode-ai/llm"
import type { ProfileDelta, UserProfileData } from "./profile"
import type { MemoryItem } from "./memory"

export const ExtractedMemorySchema = Schema.Struct({
  category: Schema.String.annotate({
    description: "Category of memory: language, framework, style, testing, tool, tech_stack, security, automation, workflow, active_task",
  }),
  content: Schema.String.annotate({
    description: "Clear, concise fact or rule representing developer preference or project context",
  }),
  confidence: Schema.Number.annotate({ description: "Confidence score between 0.0 and 1.0" }),
})

export const ExtractedStyleDeltaSchema = Schema.Struct({
  explicitness: Schema.optional(Schema.Number).annotate({ description: "0.0 for magical/decorators, 1.0 for explicit dataflow" }),
  abstraction_tolerance: Schema.optional(Schema.Number).annotate({ description: "0.0 for flat code, 1.0 for deep OOP indirection" }),
  verbosity: Schema.optional(Schema.Number).annotate({ description: "0.0 for concise code-only, 1.0 for verbose explanations" }),
  typing_rigor: Schema.optional(Schema.Number).annotate({ description: "0.0 for loose typing, 1.0 for strict typing without any" }),
  inlining_preference: Schema.optional(Schema.Number).annotate({ description: "0.0 for multi-var, 1.0 for inlining single-use vars" }),
})

export const ExtractedArchitectureDeltaSchema = Schema.Struct({
  paradigm: Schema.optional(Schema.String).annotate({ description: "e.g. 'functional_composable', 'object_oriented'" }),
  modularity: Schema.optional(Schema.String).annotate({ description: "e.g. 'flat_modules', 'clean_hexagonal'" }),
  immutability: Schema.optional(Schema.Boolean),
  dependency_pattern: Schema.optional(Schema.String),
})

export const ExtractedSecurityDeltaSchema = Schema.Struct({
  mask_secrets_and_ips: Schema.optional(Schema.Boolean),
  restricted_paths: Schema.optional(Schema.Array(Schema.String)),
  allow_external_telemetry: Schema.optional(Schema.Boolean),
  local_first_execution: Schema.optional(Schema.Boolean),
})

export const ExtractedAutomationDeltaSchema = Schema.Struct({
  allow_browser_automation: Schema.optional(Schema.Boolean),
  allow_sleep_wait_loops: Schema.optional(Schema.Boolean),
  auto_test_verification: Schema.optional(Schema.Boolean),
  max_autonomous_depth: Schema.optional(Schema.Number),
  confirmation_prompts: Schema.optional(Schema.Boolean),
})

export const ExtractedTestingDeltaSchema = Schema.Struct({
  testing_framework: Schema.optional(Schema.String),
  table_driven_tests: Schema.optional(Schema.Boolean),
  property_based_testing: Schema.optional(Schema.Boolean),
  mock_preference: Schema.optional(Schema.String),
  benchmark_testing: Schema.optional(Schema.Boolean),
})

export const ExtractedErrorHandlingDeltaSchema = Schema.Struct({
  concurrency_pattern: Schema.optional(Schema.String),
  error_handling_pattern: Schema.optional(Schema.String),
  graceful_shutdown: Schema.optional(Schema.Boolean),
  fail_fast: Schema.optional(Schema.Boolean),
})

export const ExtractedToolingDeltaSchema = Schema.Struct({
  preferred_package_manager: Schema.optional(Schema.String),
  prefer_cli: Schema.optional(Schema.Boolean),
  prefer_direct_edits: Schema.optional(Schema.Boolean),
  linter_formatter: Schema.optional(Schema.String),
})

export const ExtractedWorkspaceUIDeltaSchema = Schema.Struct({
  theme_aesthetics: Schema.optional(Schema.String),
  output_presentation: Schema.optional(Schema.String),
  conversational_filler_tolerance: Schema.optional(Schema.Number),
  prefer_dense_tables: Schema.optional(Schema.Boolean),
})

export const ExtractedGitVcsDeltaSchema = Schema.Struct({
  branch_naming_convention: Schema.optional(Schema.String),
  commit_message_format: Schema.optional(Schema.String),
  default_branch: Schema.optional(Schema.String),
  pr_workflow: Schema.optional(Schema.String),
})

export const ExtractedDocumentationDeltaSchema = Schema.Struct({
  docstring_standard: Schema.optional(Schema.String),
  comment_density: Schema.optional(Schema.String),
  in_chat_full_delivery: Schema.optional(Schema.Boolean),
  clickable_links: Schema.optional(Schema.Boolean),
})

export const ExtractedPlaybookSchema = Schema.Struct({
  routine_name: Schema.String,
  trigger_pattern: Schema.String,
  action_sequence: Schema.Array(Schema.String),
  preferred_commands: Schema.Array(Schema.String),
  frequency: Schema.Number,
})

export const ExtractedProfileDeltaSchema = Schema.Struct({
  languages: Schema.optional(Schema.Array(Schema.String)),
  frameworks: Schema.optional(Schema.Array(Schema.String)),
  style: Schema.optional(ExtractedStyleDeltaSchema),
  architecture: Schema.optional(ExtractedArchitectureDeltaSchema),
  security: Schema.optional(ExtractedSecurityDeltaSchema),
  automation: Schema.optional(ExtractedAutomationDeltaSchema),
  testing: Schema.optional(ExtractedTestingDeltaSchema),
  error_handling: Schema.optional(ExtractedErrorHandlingDeltaSchema),
  tooling: Schema.optional(ExtractedToolingDeltaSchema),
  workspace_ui: Schema.optional(ExtractedWorkspaceUIDeltaSchema),
  git_vcs: Schema.optional(ExtractedGitVcsDeltaSchema),
  documentation: Schema.optional(ExtractedDocumentationDeltaSchema),
  playbooks: Schema.optional(Schema.Array(ExtractedPlaybookSchema)),
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
 * Eliminates all manual regex, scratch parsers, and hardcoded keywords.
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

const decodeJson = Schema.decodeUnknownOption(Schema.UnknownFromJsonString)
const decodeSignals = Schema.decodeUnknownOption(ExtractedSignalsSchema)

/**
 * Parses structured JSON signals into valid ExtractedSignals using Effect Schema codecs.
 */
export function parseStructuredSignals(data: unknown): ExtractedSignals {
  const target =
    typeof data === "string"
      ? decodeJson(data).pipe((opt) => (opt._tag === "Some" ? opt.value : undefined))
      : data

  if (target !== undefined) {
    const opt = decodeSignals(target)
    if (opt._tag === "Some") {
      return transformToSignals(opt.value)
    }
  }

  return {
    preferenceMemories: [],
    semanticMemories: [],
    workingMemories: [],
  }
}
