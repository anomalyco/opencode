export * as Extractor from "./extractor"

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
 * Parses structured JSON signals or natural language developer directives into valid ExtractedSignals.
 */
export function parseStructuredSignals(data: unknown): ExtractedSignals {
  if (typeof data === "string") {
    // If input is a JSON string, try to parse it
    try {
      const parsed = JSON.parse(data)
      const decode = Schema.decodeUnknownOption(ExtractedSignalsSchema)
      const option = decode(parsed)
      if (option._tag === "Some") {
        return transformToSignals(option.value)
      }
    } catch {
      // Continue to natural directive parsing
    }

    // Natural Language Directive Heuristic Extraction
    return parseNaturalDirectives(data)
  }

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

/**
 * Extracts developer preferences directly from natural conversational directives
 * (e.g. "Always use Bun.file()", "Never use any", "Keep responses very concise", etc.)
 */
export function parseNaturalDirectives(text: string): ExtractedSignals {
  const normalized = text.trim()
  const lower = normalized.toLowerCase()

  const prefMemories: Array<Omit<MemoryItem, "id" | "userId" | "createdAt" | "updatedAt" | "accessCount">> = []
  const profileDelta: any = {}

  // 1. Strict Typing / Any ban
  if (/never\s+use\s+any|avoid\s+any|no\s+any\b|strict\s+typ(?:ing|ed)/i.test(lower)) {
    profileDelta.style = { ...(profileDelta.style ?? {}), typing_rigor: 1.0, explicitness: 1.0 }
    prefMemories.push({
      tier: "preference",
      category: "style",
      content: "Strict typing: Avoid the 'any' type in TypeScript; use exact types or type inference.",
      confidence: 1.0,
    })
  }

  // 2. Bun APIs / Package Manager
  if (/bun\.file|use\s+bun\b/i.test(lower)) {
    profileDelta.tooling = { ...(profileDelta.tooling ?? {}), preferred_package_manager: "bun" }
    prefMemories.push({
      tier: "preference",
      category: "tooling",
      content: "Prefer Bun runtime APIs such as Bun.file() for file operations.",
      confidence: 1.0,
    })
  }

  // 3. Effect-TS
  if (/effect-ts|use\s+effect\b/i.test(lower)) {
    profileDelta.architecture = { ...(profileDelta.architecture ?? {}), paradigm: "functional" }
    prefMemories.push({
      tier: "preference",
      category: "architecture",
      content: "Use Effect-TS functional paradigms and services.",
      confidence: 1.0,
    })
  }

  // 4. Verbosity / Concision
  if (/concise|brief|short\s+responses|no\s+filler|to\s+the\s+point/i.test(lower)) {
    profileDelta.style = { ...(profileDelta.style ?? {}), verbosity: 0.1 }
    profileDelta.documentation = { ...(profileDelta.documentation ?? {}), comment_density: "minimal" }
    prefMemories.push({
      tier: "preference",
      category: "style",
      content: "Keep responses concise without unnecessary pleasantries or filler.",
      confidence: 1.0,
    })
  }

  // 5. In-Chat Delivery
  if (/in-chat|deliver\s+in\s+chat|no\s+file\s+pointers/i.test(lower)) {
    profileDelta.documentation = { ...(profileDelta.documentation ?? {}), in_chat_full_delivery: true }
    prefMemories.push({
      tier: "preference",
      category: "documentation",
      content: "Deliver complete code and responses directly in chat.",
      confidence: 1.0,
    })
  }

  // 6. Drizzle / SQLite
  if (/drizzle|snake_case/i.test(lower)) {
    profileDelta.architecture = { ...(profileDelta.architecture ?? {}), dependency_pattern: "dependency_injection" }
    prefMemories.push({
      tier: "preference",
      category: "architecture",
      content: "Use Drizzle ORM with snake_case column names for database schemas.",
      confidence: 1.0,
    })
  }

  // If any directive or memory was matched, return the signals
  if (prefMemories.length > 0 || Object.keys(profileDelta).length > 0) {
    return {
      profileDelta: Object.keys(profileDelta).length > 0 ? profileDelta : undefined,
      preferenceMemories: prefMemories,
      semanticMemories: [],
      workingMemories: [],
    }
  }

  return {
    preferenceMemories: [],
    semanticMemories: [],
    workingMemories: [],
  }
}
