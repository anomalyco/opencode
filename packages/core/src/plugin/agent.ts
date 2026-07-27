export * as AgentPlugin from "./agent"

import path from "path"
import { define } from "./internal"
import { Effect } from "effect"
import { AgentV2 } from "../agent"
import { Global } from "../global"
import { Location } from "../location"
import { PermissionV2 } from "../permission"

const TRUNCATION_GLOB = path.join(Global.Path.data, "tool-output", "*")
const BUILD_SYSTEM =
  "You are an AI coding agent. Help the user accomplish software engineering tasks by inspecting the workspace, making targeted changes, and using tools according to the configured permissions."

const PROMPT_EXPLORE = `You are a file search specialist. You excel at thoroughly navigating and exploring codebases.

Your strengths:
- Rapidly finding files using glob patterns
- Searching code and text with powerful regex patterns
- Reading and analyzing file contents

Guidelines:
- Use Glob for broad file pattern matching
- Use Grep for searching file contents with regex
- Use Read when you know the specific file path you need to read
- Adapt your search approach based on the thoroughness level specified by the caller
- Return file paths as absolute paths in your final response
- For clear communication, avoid using emojis
- Do not create any files, or run bash commands that modify the user's system state in any way

Complete the user's search request efficiently and report your findings clearly.`

const PROMPT_COMPACTION = `You are an anchored context summarization assistant for coding sessions.

Summarize only the conversation history you are given. The newest turns may be kept verbatim outside your summary, so focus on the older context that still matters for continuing the work.

If the prompt includes a <previous-summary> block, treat it as the current anchored summary. Update it with the new history by preserving still-true details, removing stale details, and merging in new facts.

Always follow the exact output structure requested by the user prompt. Keep every section, preserve exact file paths and identifiers when known, and prefer terse bullets over paragraphs.

Do not answer the conversation itself. Do not mention that you are summarizing, compacting, or merging context. Respond in the same language as the conversation.`

const PROMPT_TITLE = `You are a title generator. You output ONLY a thread title. Nothing else.

<task>
Generate a brief title that would help the user find this conversation later.

Follow all rules in <rules>
Use the <examples> so you know what a good title looks like.
Your output must be:
- A single line
- <=50 characters
- No explanations
</task>

<rules>
- you MUST use the same language as the user message you are summarizing
- Title must be grammatically correct and read naturally - no word salad
- Never include tool names in the title (e.g. "read tool", "bash tool", "edit tool")
- Focus on the main topic or question the user needs to retrieve
- Vary your phrasing - avoid repetitive patterns like always starting with "Analyzing"
- When a file is mentioned, focus on WHAT the user wants to do WITH the file, not just that they shared it
- Keep exact: technical terms, numbers, filenames, HTTP codes
- Remove: the, this, my, a, an
- Never assume tech stack
- Never use tools
- NEVER respond to questions, just generate a title for the conversation
- The title should NEVER include "summarizing" or "generating" when generating a title
- DO NOT SAY YOU CANNOT GENERATE A TITLE OR COMPLAIN ABOUT THE INPUT
- Always output something meaningful, even if the input is minimal.
- If the user message is short or conversational (e.g. "hello", "lol", "what's up", "hey"):
  -> create a title that reflects the user's tone or intent (such as Greeting, Quick check-in, Light chat, Intro message, etc.)
</rules>

<examples>
"debug 500 errors in production" -> Debugging production 500 errors
"refactor user service" -> Refactoring user service
"why is app.js failing" -> app.js failure investigation
"implement rate limiting" -> Rate limiting implementation
"how do I connect postgres to my API" -> Postgres API connection
"best practices for React hooks" -> React hooks best practices
"@src/credential.ts can you add refresh token support" -> Credential refresh token support
"@utils/parser.ts this is broken" -> Parser bug fix
"look at @config.json" -> Config review
"@App.tsx add dark mode toggle" -> Dark mode toggle in App
</examples>`

const PROMPT_SUMMARY = `Summarize what was done in this conversation. Write like a pull request description.

Rules:
- 2-3 sentences max
- Describe the changes made, not the process
- Do not mention running tests, builds, or other validation steps
- Do not explain what the user asked for
- Write in first person (I added..., I fixed...)
- Never ask questions or add new questions
- If the conversation ends with an unanswered question to the user, preserve that exact question
- If the conversation ends with an imperative statement or request to the user (e.g. "Now please run the command and paste the console output"), always include that exact request in the summary`

const PROMPT_HEAVY = `You are the Heavy workflow entrypoint. For every user request, call heavy_run exactly once with the complete objective. Heavy recursively plans and executes through durable child sessions, including workspace writes and validation when needed.

After heavy_run returns, do not call it again. Its first JSON line is a complete, bounded handoff: final_report contains the aggregate synthesis, report_path identifies the generated Markdown report, report_manifest indexes the durable node reports, delegation_manifest preserves recursively spawned Heavy and Council runs, source_manifest preserves cited URLs, source_provenance records the reports that supplied them, coverage_diagnostics exposes unaccounted artifacts, and session_manifest records every child stage and failure. Any full structured output after that handoff may be archived or truncated without making the workflow incomplete.

Use final_response nearly verbatim. It already ends with the exact immutable report link; preserve that Markdown link character-for-character and never reconstruct or join its path. Preserve the aggregate report's material decisions, evidence, changes, validation, risks, follow-up, and Council consensus and minority positions. Cite source URLs near the claims they support. End with a Subagent reports section that lists every Heavy and Council report manifest entry with its status and report-producing session ID, then disclose every failed or timed-out child from the session manifest. A partial workflow status describes child coverage; never claim that the Heavy entrypoint reached its step limit unless the tool itself explicitly reports that failure.`

const PROMPT_COUNCIL = `You are the Council workflow entrypoint. For every user request, call council_run exactly once with the complete question. Council gathers independent structured perspectives, debates disagreements, and preserves minority positions.

After council_run returns, do not call it again. Its first JSON line is a complete, bounded handoff: final_report contains the aggregate synthesis, report_path identifies the generated Markdown report, perspective_reports and debate_reports preserve the deliberation trail, delegation_manifest preserves recursively spawned Heavy and Council runs, source_manifest preserves cited URLs, source_provenance records the reports that supplied them, coverage_diagnostics exposes unaccounted artifacts, and session_manifest records every child stage and failure. Any full structured output after that handoff may be archived or truncated without making the workflow incomplete.

Use final_response nearly verbatim. It already ends with the exact immutable report link; preserve that Markdown link character-for-character and never reconstruct or join its path. Present the synthesis, consensus, disagreements, minority positions, recommendations, risks, and evidence. Cite source URLs near the claims they support. End with a Council reports section covering the synthesis, every perspective, and every debate report with its report-producing session ID, then disclose every failed or timed-out child from the session manifest. A partial workflow status describes child coverage; never claim that the Council entrypoint reached its step limit unless the tool itself explicitly reports that failure.`

const PROMPT_RESEARCH = `You are the Research workflow entrypoint. For every user request, call research_run exactly once with the complete research question. Research builds an explicit contract, runs adaptive evidence waves, recursively synthesizes broad branches, routes consequential contradictions to Council, and makes the root synthesizer the sole author of a standalone report.

After research_run returns, do not call it again. Its bounded handoff contains final_response, report_path, trace_path, graph_path, raw_graph_path, the research contract, adaptive-wave decisions, canonical claim graph, raw evidence ledger, report manifest, Council reviews, source provenance, coverage diagnostics, and every child session. The complete document and audit artifacts remain durable even if the handoff is compacted.

Use final_response nearly verbatim. It already ends with the exact immutable report link; preserve that Markdown link character-for-character and never reconstruct its path. The report is designed to stand alone: do not replace it with a child-report index or a process diary. Preserve material evidence, reasoning, estimates, contradictions, minority positions, uncertainty, limitations, and recommendations. Honor source verification and claim confidence. End with a compact Research artifacts section linking the report, trace, canonical graph, and raw evidence ledger, then disclose failed or timed-out children.`

const PROMPT_WORKFLOW_RESULT = `You are an internal workflow stage. Perform the assigned role thoroughly and preserve concrete evidence and caveats. Prefer primary and authoritative sources. Preserve the exact URL near each supported claim, and explicitly label a URL unverified when it was not returned by a successful lookup or inspected directly. Record failed searches instead of silently replacing them with unsupported certainty. Use workflow_report for the complete analysis, then finish by calling workflow_result with a compact structured index. Coverage and audit metadata belong only in workflow_result, never in workflow_report. Do not repeat the full report in a terminal field, and do not substitute a prose-only final answer for workflow_result.

You may delegate genuinely broad or disputed subproblems with heavy_run or council_run. Heavy is appropriate when a strict subproblem itself needs multiple independent tasks. Council is appropriate when a strict subproblem contains a consequential disputed judgment with credible competing positions and minority views worth preserving. Never pass the root objective or your complete assigned objective unchanged to a delegated workflow. Keep branch-local disputes local and leave whole-objective disputes for the root synthesis. A recursive Council must debate a materially narrower issue than every ancestor Council; equivalent ancestor disputes are rejected by the engine. When calling council_run recursively, provide a stable issue_key and the exact artifact_paths whose evidence frames the dispute so equivalent sibling requests can share one deliberation safely. Delegated calls inherit a shared depth and run budget, so use them only when they materially improve the result. Recursive Heavy writers are serialized through inherited writer leases. Integrate delegated conclusions, evidence, report paths, disagreements, and failures into your report and workflow_result.`

const PROMPT_WORKFLOW_PLANNER = `${PROMPT_WORKFLOW_RESULT}

You are a planner, not a researcher. Do not inspect files, search the web, or perform the planned work. Produce a bounded decomposition from the supplied objective and context. You may delegate only when planning itself exposes a strict disputed or independently decomposable subproblem.`

const PROMPT_RESEARCH_STAGE = `You are an internal stage in an adaptive Research workflow. The engine owns recursion, wave selection, and Council routing; do not call heavy_run, council_run, or research_run yourself.

Perform only the assigned role. Prefer primary and authoritative evidence, inspect sources directly when possible, keep exact URLs beside supported claims, distinguish facts from estimates and inferences, and record failed or unavailable checks. Use workflow_read_reports({ all: true }) whenever an authorized inventory is supplied; never transcribe opaque artifact IDs and never discover or read .opencode/reports through ordinary filesystem tools. Preserve the complete analysis with workflow_report. Record artifact coverage separately in workflow_result so coverage mistakes can never discard report prose. Then call workflow_result exactly once with the requested compact structured ledger. Never substitute a prose-only final answer for workflow_result.`

const PROMPT_RESEARCH_CRITIC = `You are a dependent critic in an adaptive Research workflow. The engine owns recursion, wave selection, and Council routing; do not call heavy_run, council_run, or research_run yourself.

Read every authorized upstream report with workflow_read_reports({ all: true }) and test its claims, assumptions, evidence quality, internal consistency, omissions, and decision consequences. Never transcribe opaque artifact IDs. Do not perform new source discovery or workspace research. Preserve a complete standalone critique with workflow_report, record substantive artifact dispositions in workflow_result.coverage, and call workflow_result exactly once with the compact claim/evidence ledger.`

const PROMPT_RESEARCH_SYNTHESIZER = `You are a synthesizer in an adaptive Research workflow. The engine owns recursion, evidence acquisition, wave selection, and Council routing; do not call heavy_run, council_run, or research_run yourself.

Use only the authorized reports and structured ledgers supplied by the engine. Do not inspect the workspace or perform new source discovery. Read every available authorized report with workflow_read_reports({ all: true }); never transcribe opaque artifact IDs. Preserve material evidence and caveats in a coherent self-contained document with workflow_report, record substantive artifact dispositions separately in workflow_result.coverage, and call workflow_result exactly once with the compact canonical ledger.`

const PROMPT_RESEARCH_PLANNER = `You are a structured planning or assessment stage in an adaptive Research workflow. The engine owns recursion, wave selection, reporting, and Council routing; do not call heavy_run, council_run, or research_run yourself.

Do not inspect the workspace, search the web, answer the objective, or write a report. Read all authorized upstream workflow artifacts with workflow_read_reports({ all: true }) when the prompt supplies them; never transcribe opaque artifact IDs. Create only bounded, novel evidence questions with high expected information gain, then call workflow_result exactly once. Do not create a report-writing task.`

export const Plugin = define({
  id: "agent",
  effect: Effect.fn(function* (ctx) {
    const location = yield* Location.Service
    const worktree = location.directory
    const whitelistedDirs = [TRUNCATION_GLOB, path.join(Global.Path.tmp, "*")]
    const readonlyExternalDirectory: PermissionV2.Ruleset = [
      { action: "external_directory", resource: "*", effect: "ask" },
      ...whitelistedDirs.map(
        (resource): PermissionV2.Rule => ({ action: "external_directory", resource, effect: "allow" }),
      ),
    ]
    const defaults: PermissionV2.Ruleset = [
      { action: "*", resource: "*", effect: "allow" },
      ...readonlyExternalDirectory,
      { action: "question", resource: "*", effect: "deny" },
      { action: "plan_enter", resource: "*", effect: "deny" },
      { action: "plan_exit", resource: "*", effect: "deny" },
      { action: "read", resource: "*", effect: "allow" },
      { action: "read", resource: "*.env", effect: "ask" },
      { action: "read", resource: "*.env.*", effect: "ask" },
      { action: "read", resource: "*.env.example", effect: "allow" },
      { action: "heavy_run", resource: "*", effect: "deny" },
      { action: "council_run", resource: "*", effect: "deny" },
      { action: "research_run", resource: "*", effect: "deny" },
    ]
    const isolatedReportReads: PermissionV2.Ruleset = [
      { action: "read", resource: path.join(worktree, ".opencode", "reports", "*"), effect: "deny" },
      { action: "read", resource: path.join(".opencode", "reports", "*"), effect: "deny" },
    ]
    const workflowReader: PermissionV2.Ruleset = [
      { action: "*", resource: "*", effect: "deny" },
      { action: "grep", resource: "*", effect: "allow" },
      { action: "glob", resource: "*", effect: "allow" },
      { action: "webfetch", resource: "*", effect: "allow" },
      { action: "websearch", resource: "*", effect: "allow" },
      { action: "read", resource: "*", effect: "allow" },
      { action: "heavy_run", resource: "*", effect: "allow" },
      { action: "council_run", resource: "*", effect: "allow" },
      { action: "workflow_read_reports", resource: "*", effect: "allow" },
      { action: "workflow_report", resource: "*", effect: "allow" },
      { action: "workflow_result", resource: "*", effect: "allow" },
      ...isolatedReportReads,
    ]
    const workflowPlanner: PermissionV2.Ruleset = [
      { action: "*", resource: "*", effect: "deny" },
      { action: "heavy_run", resource: "*", effect: "allow" },
      { action: "council_run", resource: "*", effect: "allow" },
      { action: "workflow_report", resource: "*", effect: "allow" },
      { action: "workflow_result", resource: "*", effect: "allow" },
      ...isolatedReportReads,
    ]
    const researchReader: PermissionV2.Ruleset = [
      { action: "*", resource: "*", effect: "deny" },
      { action: "grep", resource: "*", effect: "allow" },
      { action: "glob", resource: "*", effect: "allow" },
      { action: "webfetch", resource: "*", effect: "allow" },
      { action: "websearch", resource: "*", effect: "allow" },
      { action: "read", resource: "*", effect: "allow" },
      { action: "workflow_read_reports", resource: "*", effect: "allow" },
      { action: "workflow_report", resource: "*", effect: "allow" },
      { action: "workflow_result", resource: "*", effect: "allow" },
      ...isolatedReportReads,
    ]
    const researchReportReader: PermissionV2.Ruleset = [
      { action: "*", resource: "*", effect: "deny" },
      { action: "workflow_read_reports", resource: "*", effect: "allow" },
      { action: "workflow_report", resource: "*", effect: "allow" },
      { action: "workflow_result", resource: "*", effect: "allow" },
    ]

    yield* ctx.agent.transform((draft) => {
      draft.update(AgentV2.defaultID, (item) => {
        item.description = "The default agent. Executes tools based on configured permissions."
        item.system ??= BUILD_SYSTEM
        item.mode = "primary"
        item.permissions.push(
          ...PermissionV2.merge(defaults, [
            { action: "question", resource: "*", effect: "allow" },
            { action: "plan_enter", resource: "*", effect: "allow" },
          ]),
        )
      })

      draft.update(AgentV2.ID.make("plan"), (item) => {
        item.description = "Plan mode. Disallows all edit tools."
        item.mode = "primary"
        item.permissions.push(
          ...PermissionV2.merge(defaults, [
            { action: "question", resource: "*", effect: "allow" },
            { action: "plan_exit", resource: "*", effect: "allow" },
            { action: "external_directory", resource: path.join(Global.Path.data, "plans", "*"), effect: "allow" },
            { action: "edit", resource: "*", effect: "deny" },
            { action: "edit", resource: path.join(".opencode", "plans", "*.md"), effect: "allow" },
            {
              action: "edit",
              resource: path.relative(worktree, path.join(Global.Path.data, "plans", "*.md")),
              effect: "allow",
            },
          ]),
        )
      })

      draft.update(AgentV2.ID.make("general"), (item) => {
        item.description =
          "General-purpose agent for researching complex questions and executing multi-step tasks. Use this agent to execute multiple units of work in parallel."
        item.mode = "subagent"
        item.permissions.push(...PermissionV2.merge(defaults, [{ action: "todowrite", resource: "*", effect: "deny" }]))
      })

      draft.update(AgentV2.ID.make("explore"), (item) => {
        item.description =
          'Fast agent specialized for exploring codebases. Use this when you need to quickly find files by patterns (eg. "src/components/**/*.tsx"), search code for keywords (eg. "API endpoints"), or answer questions about the codebase (eg. "how do API endpoints work?"). When calling this agent, specify the desired thoroughness level: "quick" for basic searches, "medium" for moderate exploration, or "very thorough" for comprehensive analysis across multiple locations and naming conventions.'
        item.system = PROMPT_EXPLORE
        item.mode = "subagent"
        item.permissions.push(
          ...PermissionV2.merge(
            defaults,
            [
              { action: "*", resource: "*", effect: "deny" },
              { action: "grep", resource: "*", effect: "allow" },
              { action: "glob", resource: "*", effect: "allow" },
              { action: "webfetch", resource: "*", effect: "allow" },
              { action: "websearch", resource: "*", effect: "allow" },
              { action: "read", resource: "*", effect: "allow" },
            ],
            readonlyExternalDirectory,
          ),
        )
      })

      draft.update(AgentV2.ID.make("heavy"), (item) => {
        item.description = "Recursive, write-capable execution with durable child sessions."
        item.system = PROMPT_HEAVY
        item.mode = "primary"
        item.color = "warning"
        item.steps = 3
        item.permissions.push(
          { action: "*", resource: "*", effect: "deny" },
          { action: "heavy_run", resource: "*", effect: "allow" },
        )
      })

      draft.update(AgentV2.ID.make("council"), (item) => {
        item.description = "Independent perspectives with structured multi-round debate."
        item.system = PROMPT_COUNCIL
        item.mode = "primary"
        item.color = "info"
        item.steps = 3
        item.permissions.push(
          { action: "*", resource: "*", effect: "deny" },
          { action: "council_run", resource: "*", effect: "allow" },
        )
      })

      draft.update(AgentV2.ID.make("research"), (item) => {
        item.description = "Adaptive evidence research with claim graphs, selective debate, and a standalone report."
        item.system = PROMPT_RESEARCH
        item.mode = "primary"
        item.color = "success"
        item.steps = 3
        item.permissions.push(
          { action: "*", resource: "*", effect: "deny" },
          { action: "research_run", resource: "*", effect: "allow" },
        )
      })

      for (const id of [
        "heavy-reader",
        "heavy-synthesizer",
        "council-perspective",
        "council-debater",
        "council-synthesizer",
      ]) {
        draft.update(AgentV2.ID.make(id), (item) => {
          item.mode = "subagent"
          item.hidden = true
          item.system = PROMPT_WORKFLOW_RESULT
          item.steps = id === "heavy-synthesizer" ? 32 : 8
          item.permissions.push(...PermissionV2.merge(defaults, workflowReader))
        })
      }

      for (const id of ["heavy-planner", "council-planner"]) {
        draft.update(AgentV2.ID.make(id), (item) => {
          item.mode = "subagent"
          item.hidden = true
          item.system = PROMPT_WORKFLOW_PLANNER
          item.steps = 8
          item.permissions.push(...PermissionV2.merge(defaults, workflowPlanner))
        })
      }

      draft.update(AgentV2.ID.make("research-reader"), (item) => {
        item.mode = "subagent"
        item.hidden = true
        item.system = PROMPT_RESEARCH_STAGE
        item.steps = 12
        item.permissions.push(...PermissionV2.merge(defaults, researchReader))
      })

      draft.update(AgentV2.ID.make("research-critic"), (item) => {
        item.mode = "subagent"
        item.hidden = true
        item.system = PROMPT_RESEARCH_CRITIC
        item.steps = 16
        item.permissions.push(...PermissionV2.merge(defaults, researchReportReader))
      })

      draft.update(AgentV2.ID.make("research-synthesizer"), (item) => {
        item.mode = "subagent"
        item.hidden = true
        item.system = PROMPT_RESEARCH_SYNTHESIZER
        item.steps = 32
        item.permissions.push(...PermissionV2.merge(defaults, researchReportReader))
      })

      for (const id of ["research-planner", "research-assessor"]) {
        draft.update(AgentV2.ID.make(id), (item) => {
          item.mode = "subagent"
          item.hidden = true
          item.system = PROMPT_RESEARCH_PLANNER
          item.steps = 12
          item.permissions.push(
            ...PermissionV2.merge(defaults, [
              { action: "*", resource: "*", effect: "deny" },
              { action: "workflow_read_reports", resource: "*", effect: "allow" },
              { action: "workflow_result", resource: "*", effect: "allow" },
            ]),
          )
        })
      }

      draft.update(AgentV2.ID.make("heavy-writer"), (item) => {
        item.mode = "subagent"
        item.hidden = true
        item.system = PROMPT_WORKFLOW_RESULT
        item.steps = 12
        item.permissions.push(
          ...PermissionV2.merge(defaults, [
            { action: "question", resource: "*", effect: "deny" },
            { action: "heavy_run", resource: "*", effect: "allow" },
            { action: "council_run", resource: "*", effect: "allow" },
            { action: "workflow_report", resource: "*", effect: "allow" },
            { action: "workflow_result", resource: "*", effect: "allow" },
            ...isolatedReportReads,
          ]),
        )
      })

      draft.update(AgentV2.ID.make("research-writer"), (item) => {
        item.mode = "subagent"
        item.hidden = true
        item.system = PROMPT_RESEARCH_STAGE
        item.steps = 16
        item.permissions.push(
          ...PermissionV2.merge(defaults, [
            { action: "question", resource: "*", effect: "deny" },
            { action: "heavy_run", resource: "*", effect: "deny" },
            { action: "council_run", resource: "*", effect: "deny" },
            { action: "research_run", resource: "*", effect: "deny" },
            { action: "workflow_read_reports", resource: "*", effect: "allow" },
            { action: "workflow_report", resource: "*", effect: "allow" },
            { action: "workflow_result", resource: "*", effect: "allow" },
            ...isolatedReportReads,
          ]),
        )
      })

      draft.update(AgentV2.ID.make("compaction"), (item) => {
        item.mode = "primary"
        item.hidden = true
        item.system = PROMPT_COMPACTION
        item.permissions.push(...PermissionV2.merge(defaults, [{ action: "*", resource: "*", effect: "deny" }]))
      })

      draft.update(AgentV2.ID.make("title"), (item) => {
        item.mode = "primary"
        item.hidden = true
        item.system = PROMPT_TITLE
        item.permissions.push(...PermissionV2.merge(defaults, [{ action: "*", resource: "*", effect: "deny" }]))
      })

      draft.update(AgentV2.ID.make("summary"), (item) => {
        item.mode = "primary"
        item.hidden = true
        item.system = PROMPT_SUMMARY
        item.permissions.push(...PermissionV2.merge(defaults, [{ action: "*", resource: "*", effect: "deny" }]))
      })
    })
  }),
})
