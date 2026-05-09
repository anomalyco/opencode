import { z } from "zod"

// Per-session deterministic metrics (computed without LLM).
export const SessionMeta = z.object({
  session_id: z.string(),
  project_id: z.string(),
  project_path: z.string(),
  start_time: z.number(), // ms since epoch (session.time.created)
  end_time: z.number(), // ms since epoch (session.time.updated)
  duration_minutes: z.number(),
  user_message_count: z.number(),
  assistant_message_count: z.number(),
  tool_counts: z.record(z.string(), z.number()),
  languages: z.record(z.string(), z.number()),
  git_commits: z.number(),
  git_pushes: z.number(),
  input_tokens: z.number(),
  output_tokens: z.number(),
  reasoning_tokens: z.number(),
  cache_read_tokens: z.number(),
  cache_write_tokens: z.number(),
  total_cost: z.number(),
  user_interruptions: z.number(),
  user_response_times_sec: z.array(z.number()),
  tool_errors: z.number(),
  tool_error_categories: z.record(z.string(), z.number()),
  uses_task_agent: z.boolean(),
  uses_mcp: z.boolean(),
  uses_web_search: z.boolean(),
  uses_web_fetch: z.boolean(),
  lines_added: z.number(),
  lines_removed: z.number(),
  files_modified: z.number(),
  message_hours: z.array(z.number().int().min(0).max(23)),
  user_message_timestamps_ms: z.array(z.number()),
  agents_used: z.array(z.string()),
  models_used: z.array(z.string()),
  first_user_prompt: z.string(), // up to 500 chars, plain text
})
export type SessionMeta = z.infer<typeof SessionMeta>

/**
 * Storage shape for a single session's LLM-extracted facets. **Never pass
 * this schema to `generateObject`** — `z.record` translates to JSON Schema
 * with `propertyNames` + `additionalProperties: false`, which Anthropic
 * (and other providers) reject as malformed. Use `SessionFacetsInput` at
 * the LLM boundary and convert back with `fromSessionFacetsInput`.
 */
export const SessionFacets = z.object({
  session_id: z.string(),
  underlying_goal: z.string(),
  goal_categories: z.record(z.string(), z.number()),
  outcome: z.enum(["fully_achieved", "mostly_achieved", "partially_achieved", "not_achieved", "unclear_from_transcript"]),
  user_satisfaction_counts: z.record(z.string(), z.number()),
  claude_helpfulness: z.enum(["unhelpful", "slightly_helpful", "moderately_helpful", "very_helpful", "essential"]),
  session_type: z.enum(["single_task", "multi_task", "iterative_refinement", "exploration", "quick_question"]),
  friction_counts: z.record(z.string(), z.number()),
  friction_detail: z.string(),
  primary_success: z.string(), // free-form key, validated against LABEL_MAP downstream
  brief_summary: z.string(),
  user_instructions_to_claude: z.array(z.string()).optional(),
})
export type SessionFacets = z.infer<typeof SessionFacets>

// Wire-format for LLM `generateObject` calls. Mirrors `SessionFacets` but
// expresses every `Record<string, number>` field as an array of `{key, value}`
// pairs because `z.record` translates to JSON Schema with `propertyNames` +
// `additionalProperties: false` — which Anthropic and other providers reject
// as malformed (the schema accepts no keys). Arrays serialise cleanly on every
// provider we target. Convert with `fromSessionFacetsInput` before use.
// `.int().nonnegative()` enforces real frequency-count semantics: some models
// occasionally emit `value: "3"` (string) or `value: 1.5` (float) which would
// silently corrupt downstream sums; let the schema reject them and Effect
// will fall back via `orElseSucceed(() => null)`. `.describe()` coaches the
// model on the intended shape.
const KeyNumber = z
  .array(
    z.object({
      key: z.string().describe("category label, snake_case"),
      value: z.number().int().nonnegative().describe("count of occurrences (non-negative integer)"),
    }),
  )
  .describe("array-of-pairs encoding of a frequency map (Anthropic-safe; do not emit object/record)")

export const SessionFacetsInput = z.object({
  underlying_goal: z.string(),
  goal_categories: KeyNumber,
  outcome: z.enum(["fully_achieved", "mostly_achieved", "partially_achieved", "not_achieved", "unclear_from_transcript"]),
  user_satisfaction_counts: KeyNumber,
  claude_helpfulness: z.enum(["unhelpful", "slightly_helpful", "moderately_helpful", "very_helpful", "essential"]),
  session_type: z.enum(["single_task", "multi_task", "iterative_refinement", "exploration", "quick_question"]),
  friction_counts: KeyNumber,
  friction_detail: z.string(),
  primary_success: z.string(),
  brief_summary: z.string(),
  user_instructions_to_claude: z.array(z.string()).optional(),
})
export type SessionFacetsInput = z.infer<typeof SessionFacetsInput>

// LLMs occasionally emit two pairs with the same key (the schema can't forbid
// it because it's an array, not a record). Sum duplicates rather than letting
// the last write silently overwrite — losing a count is worse than over-
// counting on the rare malformed response, and the downstream aggregator
// already treats these as additive frequencies.
const kvToRecord = (pairs: Array<{ key: string; value: number }>): Record<string, number> => {
  const acc: Record<string, number> = {}
  for (const p of pairs) {
    acc[p.key] = (acc[p.key] ?? 0) + p.value
  }
  return acc
}

export function fromSessionFacetsInput(session_id: string, input: SessionFacetsInput): SessionFacets {
  return {
    session_id,
    underlying_goal: input.underlying_goal,
    goal_categories: kvToRecord(input.goal_categories),
    outcome: input.outcome,
    user_satisfaction_counts: kvToRecord(input.user_satisfaction_counts),
    claude_helpfulness: input.claude_helpfulness,
    session_type: input.session_type,
    friction_counts: kvToRecord(input.friction_counts),
    friction_detail: input.friction_detail,
    primary_success: input.primary_success,
    brief_summary: input.brief_summary,
    user_instructions_to_claude: input.user_instructions_to_claude,
  }
}

export const MultiClauding = z.object({
  overlap_events: z.number(),
  sessions_involved: z.number(),
  user_messages_during: z.number(),
})
export type MultiClauding = z.infer<typeof MultiClauding>

export const Aggregate = z.object({
  total_sessions: z.number(),
  sessions_with_facets: z.number(),
  date_range: z.object({ start_ms: z.number(), end_ms: z.number() }),
  total_user_messages: z.number(),
  total_assistant_messages: z.number(),
  total_duration_hours: z.number(),
  total_cost: z.number(),
  totals_tokens: z.object({
    input: z.number(),
    output: z.number(),
    reasoning: z.number(),
    cache_read: z.number(),
    cache_write: z.number(),
  }),
  tool_counts: z.record(z.string(), z.number()),
  languages: z.record(z.string(), z.number()),
  git_commits: z.number(),
  git_pushes: z.number(),
  projects: z.record(
    z.string(),
    z.object({
      id: z.string(),
      path: z.string(),
      sessions: z.number(),
    }),
  ),
  goal_categories: z.record(z.string(), z.number()),
  outcomes: z.record(z.string(), z.number()),
  satisfaction: z.record(z.string(), z.number()),
  helpfulness: z.record(z.string(), z.number()),
  session_types: z.record(z.string(), z.number()),
  friction: z.record(z.string(), z.number()),
  success: z.record(z.string(), z.number()),
  total_interruptions: z.number(),
  total_tool_errors: z.number(),
  tool_error_categories: z.record(z.string(), z.number()),
  user_response_times_sec: z.array(z.number()),
  median_response_time_sec: z.number(),
  avg_response_time_sec: z.number(),
  sessions_using_task_agent: z.number(),
  sessions_using_mcp: z.number(),
  sessions_using_web_search: z.number(),
  sessions_using_web_fetch: z.number(),
  total_lines_added: z.number(),
  total_lines_removed: z.number(),
  total_files_modified: z.number(),
  days_active: z.number(),
  messages_per_day: z.number(),
  message_hours: z.array(z.number().int().min(0).max(23)),
  multi_clauding: MultiClauding,
  models_used: z.record(z.string(), z.number()),
  agents_used: z.record(z.string(), z.number()),
  session_summaries: z.array(
    z.object({
      id: z.string(),
      started_iso: z.string(),
      project_path: z.string(),
      summary: z.string(),
      goal: z.string().optional(),
      outcome: z.string().optional(),
    }),
  ),
})
export type Aggregate = z.infer<typeof Aggregate>

// Section schemas (one per narrative pass).
export const ProjectAreasSection = z.object({
  areas: z.array(
    z.object({
      name: z.string(),
      session_count: z.number(),
      description: z.string(),
    }),
  ),
})

export const InteractionStyleSection = z.object({
  narrative: z.string(),
  key_pattern: z.string(),
})

export const WhatWorksSection = z.object({
  intro: z.string(),
  impressive_workflows: z.array(
    z.object({
      title: z.string(),
      description: z.string(),
    }),
  ),
})

export const FrictionAnalysisSection = z.object({
  intro: z.string(),
  categories: z.array(
    z.object({
      category: z.string(),
      description: z.string(),
      examples: z.array(z.string()),
    }),
  ),
})

export const SuggestionsSection = z.object({
  agents_md_additions: z.array(
    z.object({
      addition: z.string(),
      why: z.string(),
      prompt_scaffold: z.string(),
    }),
  ),
  features_to_try: z.array(
    z.object({
      feature: z.string(),
      one_liner: z.string(),
      why_for_you: z.string(),
      example_code: z.string(),
    }),
  ),
  usage_patterns: z.array(
    z.object({
      title: z.string(),
      suggestion: z.string(),
      detail: z.string(),
      copyable_prompt: z.string(),
    }),
  ),
})

export const OnTheHorizonSection = z.object({
  intro: z.string(),
  opportunities: z.array(
    z.object({
      title: z.string(),
      whats_possible: z.string(),
      how_to_try: z.string(),
      copyable_prompt: z.string(),
    }),
  ),
})

export const FunEndingSection = z.object({
  headline: z.string(),
  detail: z.string(),
})

export const Sections = z.object({
  project_areas: ProjectAreasSection.optional(),
  interaction_style: InteractionStyleSection.optional(),
  what_works: WhatWorksSection.optional(),
  friction_analysis: FrictionAnalysisSection.optional(),
  suggestions: SuggestionsSection.optional(),
  on_the_horizon: OnTheHorizonSection.optional(),
  fun_ending: FunEndingSection.optional(),
})
export type Sections = z.infer<typeof Sections>

export * as InsightsSchema from "./schema"
