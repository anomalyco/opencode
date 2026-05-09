import type { SessionMeta } from "@/insights/schema"

/**
 * Shared `SessionMeta` factory for insights tests.
 *
 * The schema is wide and almost every field is required. Tests that exercise
 * `estimateLLMCost`, `extractFacet`, and other consumers of `SessionMeta`
 * generally only care about a handful of fields (`session_id`, `end_time`,
 * `input_tokens`, …) — this factory supplies sane zero-valued defaults so
 * each test can override only the fields under test.
 */
export const sessionMeta = (overrides: Partial<SessionMeta> = {}): SessionMeta => ({
  session_id: "s",
  project_id: "p",
  project_path: "/p",
  start_time: 0,
  end_time: 1_000,
  duration_minutes: 1,
  user_message_count: 1,
  assistant_message_count: 1,
  tool_counts: {},
  languages: {},
  git_commits: 0,
  git_pushes: 0,
  input_tokens: 0,
  output_tokens: 0,
  reasoning_tokens: 0,
  cache_read_tokens: 0,
  cache_write_tokens: 0,
  total_cost: 0,
  user_interruptions: 0,
  user_response_times_sec: [],
  tool_errors: 0,
  tool_error_categories: {},
  uses_task_agent: false,
  uses_mcp: false,
  uses_web_search: false,
  uses_web_fetch: false,
  lines_added: 0,
  lines_removed: 0,
  files_modified: 0,
  message_hours: [],
  user_message_timestamps_ms: [],
  agents_used: [],
  models_used: [],
  first_user_prompt: "",
  ...overrides,
})
