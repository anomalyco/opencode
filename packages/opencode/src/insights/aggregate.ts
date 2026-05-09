import { extname } from "node:path"
import { diffLines } from "diff"
import { MessageV2 } from "@/session/message-v2"
import { detectMultiClauding } from "./multi-clauding"
import type { Aggregate, SessionFacets, SessionMeta } from "./schema"

const EXTENSION_TO_LANGUAGE: Record<string, string> = {
  ".ts": "TypeScript",
  ".tsx": "TypeScript",
  ".js": "JavaScript",
  ".jsx": "JavaScript",
  ".py": "Python",
  ".rb": "Ruby",
  ".go": "Go",
  ".rs": "Rust",
  ".java": "Java",
  ".md": "Markdown",
  ".json": "JSON",
  ".yaml": "YAML",
  ".yml": "YAML",
  ".sh": "Shell",
  ".css": "CSS",
  ".html": "HTML",
}

const langOf = (filePath: string) => EXTENSION_TO_LANGUAGE[extname(filePath).toLowerCase()] ?? null

const categorizeToolError = (output: string): string => {
  const s = output.toLowerCase()
  if (s.includes("exit code")) return "Command Failed"
  if (s.includes("rejected") || s.includes("doesn't want")) return "User Rejected"
  if (s.includes("string to replace not found") || s.includes("no changes")) return "Edit Failed"
  if (s.includes("modified since read")) return "File Changed"
  if (s.includes("exceeds maximum") || s.includes("too large")) return "File Too Large"
  if (s.includes("file not found") || s.includes("does not exist")) return "File Not Found"
  return "Other"
}

const bump = (record: Record<string, number>, key: string, by = 1) => {
  record[key] = (record[key] ?? 0) + by
}

export function extractSessionMeta(
  session: { id: string; projectID: string; directory: string; time: { created: number; updated: number } },
  messages: MessageV2.WithParts[],
): SessionMeta {
  const tool_counts: Record<string, number> = {}
  const languages: Record<string, number> = {}
  const tool_error_categories: Record<string, number> = {}
  const filesModified = new Set<string>()
  const message_hours: number[] = []
  const user_message_timestamps_ms: number[] = []
  const user_response_times_sec: number[] = []
  const agents_used = new Set<string>()
  const models_used = new Set<string>()

  let user_message_count = 0
  let assistant_message_count = 0
  let input_tokens = 0
  let output_tokens = 0
  let reasoning_tokens = 0
  let cache_read_tokens = 0
  let cache_write_tokens = 0
  let total_cost = 0
  let user_interruptions = 0
  let tool_errors = 0
  let lines_added = 0
  let lines_removed = 0
  let git_commits = 0
  let git_pushes = 0
  let uses_task_agent = false
  let uses_mcp = false
  let uses_web_search = false
  let uses_web_fetch = false
  let first_user_prompt = ""
  let lastAssistantMs: number | null = null

  for (const m of messages) {
    const info = m.info
    if (info.role === "assistant") {
      assistant_message_count++
      total_cost += info.cost
      input_tokens += info.tokens.input
      output_tokens += info.tokens.output
      reasoning_tokens += info.tokens.reasoning
      cache_read_tokens += info.tokens.cache.read
      cache_write_tokens += info.tokens.cache.write
      if (info.modelID) models_used.add(`${info.providerID}/${info.modelID}`)
      if (info.agent) agents_used.add(info.agent)
      // Use completion time, not start time — otherwise user_response_times_sec
      // includes the assistant's full generation duration (tens of seconds for
      // long replies) and is silently inflated. Fallback to created for
      // in-flight assistant messages whose `completed` is still undefined.
      lastAssistantMs = info.time.completed ?? info.time.created

      for (const part of m.parts) {
        if (part.type !== "tool" || !part.tool) continue
        bump(tool_counts, part.tool)
        if (part.tool.startsWith("mcp__")) uses_mcp = true
        if (part.tool === "task") uses_task_agent = true
        if (part.tool === "webfetch") uses_web_fetch = true
        if (part.tool === "websearch") uses_web_search = true

        // ToolStatePending/Running/Completed/Error all carry `input`; only
        // ToolStateCompleted has `output`, only ToolStateError has `error`.
        // `input` is `Record<string, Any>` — narrow each access via `typeof`
        // rather than `as string` so a malformed model response (number, null)
        // can't crash later string ops like `extname` or `match`.
        const input = part.state.input
        const asStr = (v: unknown) => (typeof v === "string" ? v : "")
        const filePath = asStr(input.file_path) || asStr(input.path)
        if (filePath) {
          const lang = langOf(filePath)
          if (lang) bump(languages, lang)
          if (part.tool === "edit" || part.tool === "write") filesModified.add(filePath)
        }
        if (part.tool === "edit") {
          const oldS = asStr(input.old_string)
          const newS = asStr(input.new_string)
          for (const c of diffLines(oldS, newS)) {
            if (c.added) lines_added += c.count ?? 0
            if (c.removed) lines_removed += c.count ?? 0
          }
        }
        if (part.tool === "write") {
          const content = asStr(input.content)
          // Count lines as the number of newline-separated segments. A file
          // ending in `\n` has N lines and N newlines (don't add 1 — the old
          // formula over-counted trailing newline). Empty content = 0 lines.
          if (content) {
            const newlines = content.match(/\n/g)?.length ?? 0
            lines_added += content.endsWith("\n") ? newlines : newlines + 1
          }
        }
        if (part.tool === "apply_patch") {
          // OpenCode's apply_patch envelope (NOT unified diff):
          //   *** Begin Patch
          //   *** Update File: <path>      ← also Add File / Delete File / Move File
          //   @@                            ← optional context anchor
          //   <space|+|->...                ← context, added, removed
          //   *** End Patch
          // We extract per-file modifications and per-line +/- counts.
          // `*** ` envelope lines are control, not content — skip them.
          const patchText = asStr(input.patchText)
          for (const raw of patchText.split("\n")) {
            // Capture target paths for Update / Add / Delete / Move headers.
            const headerMatch = raw.match(/^\*\*\* (Update|Add|Delete|Move) File: (.+)$/)
            if (headerMatch) {
              filesModified.add(headerMatch[2]!.trim())
              continue
            }
            if (raw.startsWith("*** ")) continue // Begin/End Patch
            if (raw.startsWith("@@")) continue // hunk anchor
            if (raw.startsWith("+")) {
              lines_added++
              continue
            }
            if (raw.startsWith("-")) lines_removed++
          }
        }
        const cmd = asStr(input.command)
        if (cmd.includes("git commit")) git_commits++
        if (cmd.includes("git push")) git_pushes++

        if (part.state.status === "error") {
          tool_errors++
          bump(tool_error_categories, categorizeToolError(part.state.error))
        }
      }
      continue
    }

    if (info.role === "user") {
      const textParts = m.parts.filter((p): p is MessageV2.TextPart => p.type === "text")
      const hasText = textParts.some((p) => p.text.trim())
      if (!hasText) continue
      user_message_count++

      const created = info.time.created
      message_hours.push(new Date(created).getHours())
      user_message_timestamps_ms.push(created)
      if (lastAssistantMs !== null) {
        const dt = (created - lastAssistantMs) / 1000
        if (dt > 2 && dt < 3600) user_response_times_sec.push(dt)
      }
      if (!first_user_prompt) {
        const t = textParts[0]
        if (t?.text) first_user_prompt = t.text.slice(0, 500)
      }
      const fullText = textParts.map((p) => p.text).join("\n")
      if (fullText.includes("[Request interrupted by user")) user_interruptions++
    }
  }

  return {
    session_id: session.id,
    project_id: session.projectID,
    project_path: session.directory,
    start_time: session.time.created,
    end_time: session.time.updated,
    duration_minutes: Math.max(0, Math.round((session.time.updated - session.time.created) / 60_000)),
    user_message_count,
    assistant_message_count,
    tool_counts,
    languages,
    git_commits,
    git_pushes,
    input_tokens,
    output_tokens,
    reasoning_tokens,
    cache_read_tokens,
    cache_write_tokens,
    total_cost,
    user_interruptions,
    user_response_times_sec,
    tool_errors,
    tool_error_categories,
    uses_task_agent,
    uses_mcp,
    uses_web_search,
    uses_web_fetch,
    lines_added,
    lines_removed,
    files_modified: filesModified.size,
    message_hours,
    user_message_timestamps_ms,
    agents_used: [...agents_used],
    models_used: [...models_used],
    first_user_prompt,
  }
}

const median = (xs: number[]): number => {
  if (xs.length === 0) return 0
  const sorted = [...xs].sort((a, b) => a - b)
  const mid = sorted.length >> 1
  return sorted.length % 2 === 0 ? ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2 : (sorted[mid] ?? 0)
}

const mean = (xs: number[]): number => (xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length)

const dateKey = (ms: number) => new Date(ms).toISOString().slice(0, 10)

export function aggregate(metas: SessionMeta[], facets: Map<string, SessionFacets>): Aggregate {
  const agg: Aggregate = {
    total_sessions: metas.length,
    sessions_with_facets: 0,
    date_range: { start_ms: 0, end_ms: 0 },
    total_user_messages: 0,
    total_assistant_messages: 0,
    total_duration_hours: 0,
    total_cost: 0,
    totals_tokens: { input: 0, output: 0, reasoning: 0, cache_read: 0, cache_write: 0 },
    tool_counts: {},
    languages: {},
    git_commits: 0,
    git_pushes: 0,
    projects: {},
    goal_categories: {},
    outcomes: {},
    satisfaction: {},
    helpfulness: {},
    session_types: {},
    friction: {},
    success: {},
    total_interruptions: 0,
    total_tool_errors: 0,
    tool_error_categories: {},
    user_response_times_sec: [],
    median_response_time_sec: 0,
    avg_response_time_sec: 0,
    sessions_using_task_agent: 0,
    sessions_using_mcp: 0,
    sessions_using_web_search: 0,
    sessions_using_web_fetch: 0,
    total_lines_added: 0,
    total_lines_removed: 0,
    total_files_modified: 0,
    days_active: 0,
    messages_per_day: 0,
    message_hours: [],
    multi_clauding: { overlap_events: 0, sessions_involved: 0, user_messages_during: 0 },
    models_used: {},
    agents_used: {},
    session_summaries: [],
  }

  let totalDurationMinutes = 0
  let startMs = Number.POSITIVE_INFINITY
  let endMs = Number.NEGATIVE_INFINITY
  const dayKeys = new Set<string>()

  for (const meta of metas) {
    agg.total_user_messages += meta.user_message_count
    agg.total_assistant_messages += meta.assistant_message_count
    totalDurationMinutes += meta.duration_minutes
    agg.total_cost += meta.total_cost
    agg.totals_tokens.input += meta.input_tokens
    agg.totals_tokens.output += meta.output_tokens
    agg.totals_tokens.reasoning += meta.reasoning_tokens
    agg.totals_tokens.cache_read += meta.cache_read_tokens
    agg.totals_tokens.cache_write += meta.cache_write_tokens
    agg.git_commits += meta.git_commits
    agg.git_pushes += meta.git_pushes
    agg.total_interruptions += meta.user_interruptions
    agg.total_tool_errors += meta.tool_errors
    agg.total_lines_added += meta.lines_added
    agg.total_lines_removed += meta.lines_removed
    agg.total_files_modified += meta.files_modified

    if (meta.uses_task_agent) agg.sessions_using_task_agent++
    if (meta.uses_mcp) agg.sessions_using_mcp++
    if (meta.uses_web_search) agg.sessions_using_web_search++
    if (meta.uses_web_fetch) agg.sessions_using_web_fetch++

    for (const [k, v] of Object.entries(meta.tool_counts)) bump(agg.tool_counts, k, v)
    for (const [k, v] of Object.entries(meta.languages)) bump(agg.languages, k, v)
    for (const [k, v] of Object.entries(meta.tool_error_categories)) bump(agg.tool_error_categories, k, v)

    agg.user_response_times_sec.push(...meta.user_response_times_sec)
    agg.message_hours.push(...meta.message_hours)

    const project = agg.projects[meta.project_id] ?? { id: meta.project_id, path: meta.project_path, sessions: 0 }
    project.sessions++
    agg.projects[meta.project_id] = project

    for (const model of meta.models_used) bump(agg.models_used, model)
    for (const agent of meta.agents_used) bump(agg.agents_used, agent)

    if (meta.start_time < startMs) startMs = meta.start_time
    if (meta.end_time > endMs) endMs = meta.end_time
    dayKeys.add(dateKey(meta.start_time))
  }

  agg.total_duration_hours = totalDurationMinutes / 60
  agg.date_range = {
    start_ms: startMs === Number.POSITIVE_INFINITY ? 0 : startMs,
    end_ms: endMs === Number.NEGATIVE_INFINITY ? 0 : endMs,
  }

  for (const f of facets.values()) {
    agg.sessions_with_facets++
    for (const [k, v] of Object.entries(f.goal_categories)) bump(agg.goal_categories, k, v)
    for (const [k, v] of Object.entries(f.user_satisfaction_counts)) bump(agg.satisfaction, k, v)
    for (const [k, v] of Object.entries(f.friction_counts)) bump(agg.friction, k, v)
    bump(agg.outcomes, f.outcome)
    bump(agg.helpfulness, f.claude_helpfulness)
    bump(agg.session_types, f.session_type)
    if (f.primary_success && f.primary_success !== "none") bump(agg.success, f.primary_success)
  }

  agg.session_summaries = [...metas]
    .sort((a, b) => b.start_time - a.start_time)
    .slice(0, 50)
    .map((meta) => {
      const f = facets.get(meta.session_id)
      return {
        id: meta.session_id,
        started_iso: new Date(meta.start_time).toISOString(),
        project_path: meta.project_path,
        summary: meta.first_user_prompt.slice(0, 100),
        ...(f?.underlying_goal ? { goal: f.underlying_goal } : {}),
        ...(f?.outcome ? { outcome: f.outcome } : {}),
      }
    })

  agg.days_active = dayKeys.size
  agg.messages_per_day =
    agg.days_active === 0 ? 0 : Math.round((agg.total_user_messages / agg.days_active) * 10) / 10
  agg.median_response_time_sec = median(agg.user_response_times_sec)
  agg.avg_response_time_sec = mean(agg.user_response_times_sec)
  agg.multi_clauding = detectMultiClauding(
    metas.map((s) => ({ session_id: s.session_id, user_message_timestamps_ms: s.user_message_timestamps_ms })),
  )

  return agg
}

export * as InsightsAggregate from "./aggregate"
