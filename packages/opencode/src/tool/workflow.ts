import { BackgroundJob } from "@/background/job"
import { Config } from "@/config/config"
import { InstanceState } from "@/effect/instance-state"
import { EventV2Bridge } from "@/event-v2-bridge"
import { Format } from "@/format"
import { LSP } from "@/lsp/lsp"
import { Session } from "@/session/session"
import { FileSystem } from "@opencode-ai/core/filesystem"
import { Watcher } from "@opencode-ai/core/filesystem/watcher"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Global } from "@opencode-ai/core/global"
import { createTwoFilesPatch } from "diff"
import path from "path"
import { Cause, Effect, Schema, SchemaGetter, Scope } from "effect"
import { assertExternalDirectoryEffect } from "./external-directory"
import * as Tool from "./tool"
import { trimDiff } from "./edit"
import { Workflow } from "@/workflow/workflow"
import { MetaReader } from "@/workflow/meta-reader"
import { SourceLint } from "@/workflow/source-lint"
import type { TurnBudget } from "@/session/turn-budget"
import { Agent } from "@/agent/agent"
import AUTHORING_GUIDE from "./workflow.txt"

const WORKFLOW_NAME_PATTERN = /^[A-Za-z0-9_-]+$/
const DEFAULT_TIMEOUT = 60 * 60 * 1000
// Item 8: how long a DEFAULT start (no explicit background/timeout) stays in the
// foreground before the run is switched to the background. Overridable via
// config workflows.foreground_grace_ms.
const FOREGROUND_GRACE = 45_000

const Action = Schema.Literals(["read", "start", "wait", "inspect", "create", "cancel", "pause"])
const InspectView = Schema.Literals(["summary", "logs", "agents", "agent", "result", "all"])

// LLMs routinely emit a boolean tool argument as the JSON STRING "true"/"false"
// instead of a boolean. A bare Schema.Boolean rejects that with an
// InvalidArgumentsError; the model then re-emits the same stringified value,
// loops on the identical invalid call, and the session eventually aborts. Accept
// either form and decode to a real boolean. (Mirrors QueryBoolean in the HTTP
// query helpers, but also passes a native boolean through unchanged.)
const LooseBoolean = Schema.Union([Schema.Boolean, Schema.Literals(["true", "false"])]).pipe(
  Schema.decodeTo(Schema.Boolean, {
    decode: SchemaGetter.transform((value) => value === true || value === "true"),
    encode: SchemaGetter.transform((value) => value),
  }),
)

// The numeric-string branch of LooseNonNegativeFinite. NOT Schema.NumberFromString:
// that uses Number(), and Number("")/Number(" ")/Number("\t") === 0, so a
// blank/whitespace-only string would silently coerce to a ZERO cap (budget 0 =
// nothing can run; timeout 0 = instant timeout) instead of being flagged. Require
// at least one non-whitespace character first, so a blank string is rejected at
// the boundary and the model gets corrective feedback rather than a surprise zero.
const NonBlankNumberFromString = Schema.String.check(Schema.isPattern(/\S/)).pipe(
  Schema.decodeTo(Schema.Number, {
    decode: SchemaGetter.transform((value) => Number(value)),
    encode: SchemaGetter.transform((value) => String(value)),
  }),
)

// Same stringified-arg failure class for the numeric caps (budget/timeout):
// accept either a native number or a (non-blank) numeric string, then re-apply
// the SAME finite + non-negative refinement to the decoded value. The string
// branch parses "abc"/"Infinity"/"NaN" to NaN/±Infinity, which the trailing
// Finite.check(isGreaterThanOrEqualTo(0)) still rejects — so a stringified "5"
// succeeds while ""/" "/"abc"/"Infinity"/"NaN"/"-1" (and the native -1/NaN/
// Infinity) STILL fail validation and surface corrective feedback to the model.
// This keeps the budget/timeout guards (which rely on a finite, >=0 cap) honest,
// exactly as the bare Finite schema did.
const LooseNonNegativeFinite = Schema.Union([Schema.Number, NonBlankNumberFromString]).pipe(
  Schema.decodeTo(Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0)), {
    decode: SchemaGetter.transform((value) => value),
    encode: SchemaGetter.transform((value) => value),
  }),
)

const Parameters = Schema.Struct({
  action: Action.annotate({
    description: "Workflow operation to perform: read, start, wait, inspect, create, cancel, or pause",
  }),
  name: Schema.optional(Schema.String).annotate({
    description:
      "Workflow name for read/start/create. For create, this is the file name without extension. Omit on read to get the workflow authoring guide.",
  }),
  args: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)).annotate({
    description: "Workflow input arguments as a JSON object",
  }),
  // Non-negative finite, mirroring the engine/HTTP budget schema: a plain
  // Schema.Number would accept NaN/±Infinity, and a NaN cap makes the gate
  // (budgetRemaining <= 0) silently never trip — i.e. unlimited spend.
  budget: Schema.optional(LooseNonNegativeFinite).annotate({
    description:
      "Optional cost cap in USD for the whole run. Checked before each agent step; once cumulative cost reaches the cap, the next step fails with a budget error. This is a soft cap — agent steps already running in parallel can push total spend past it. Omit for unlimited.",
  }),
  budget_tokens: Schema.optional(LooseNonNegativeFinite).annotate({
    description:
      "Optional output-token cap for the whole run; soft cap like budget (counts each step's output+reasoning tokens). Combinable with budget — whichever cap exhausts first gates the next step. Omit for unlimited.",
  }),
  background: Schema.optional(LooseBoolean).annotate({
    description:
      "true starts the workflow asynchronously and notifies this session when it finishes; false opts out of the default grace window and keeps the old long foreground wait",
  }),
  // Non-negative finite, mirroring the budget field above: a plain Schema.Number
  // accepts NaN/±Infinity. timeout:Infinity would override the 1h DEFAULT_TIMEOUT
  // cap (wait hangs forever); NaN slips past the engine's `<=0` guard (NaN<=0 is
  // false) so wait times out at once yet still reports "still running". Rejecting
  // both at the argument boundary keeps the wait bound honest.
  timeout: Schema.optional(LooseNonNegativeFinite).annotate({
    description:
      "Maximum milliseconds to wait for foreground start/wait before returning the running state. Setting it on start implies an explicit foreground wait (no background switch).",
  }),
  run_id: Schema.optional(Schema.String).annotate({
    description: "Workflow run id for wait/inspect/cancel/pause",
  }),
  view: Schema.optional(InspectView).annotate({
    description: "Which part of the run to inspect: summary, logs, agents, agent, result, or all",
  }),
  agent_id: Schema.optional(Schema.String).annotate({
    description: "Agent run id to inspect when view is agent",
  }),
  source: Schema.optional(Schema.String).annotate({
    description: "Complete TypeScript workflow source for create",
  }),
  script_path: Schema.optional(Schema.String).annotate({
    description:
      "Absolute or project-relative path to a workflow script file to start directly (alternative to name/source). The file is read fresh at start — edit and re-invoke to iterate; combine with resume_of to replay completed steps.",
  }),
  overwrite: Schema.optional(LooseBoolean).annotate({ description: "Overwrite an existing workflow file" }),
  resume_of: Schema.optional(Schema.String).annotate({
    description:
      "Resume a previous (paused, interrupted, failed, or completed) workflow run by its run id; the engine replays that run's completed agent journal instead of re-running them. Works with name, source, and script_path starts.",
  }),
  invalidate_agents: Schema.optional(Schema.Array(Schema.Int)).annotate({
    description:
      "Agent indices (0-based, in the source run's order) to force live re-execution of during a resume. Only meaningful with resume_of. In prefix mode (the default), everything after the first invalidated agent re-runs live.",
  }),
  replay: Schema.optional(Schema.Literals(["prefix", "keyed"])).annotate({
    description:
      "Journal replay strategy for a resume (only meaningful with resume_of). 'prefix' (default): replay the source run's steps in order and stop permanently at the first changed/invalidated step — everything after re-runs live. 'keyed': match steps by call shape, so unchanged later steps replay even after an earlier change (use for read-only or heavily parallel workflows).",
  }),
})

type Params = Schema.Schema.Type<typeof Parameters>
type Metadata = Record<string, unknown>

// Item 13: the gate sentence is the ONLY conditional piece of the description.
// Default sessions keep the anti-default gate; an ultracode session
// (session.metadata.ultracode === true) swaps it for the standing opt-in below.
// ToolRegistry.tools() performs the swap per prompt — tool descriptions are
// baked into InstanceState at Tool.init, so there is no per-execute ctx here.
export const WORKFLOW_GATE_DEFAULT =
  "Do not use workflows by default. Use this only when the user explicitly asks for a workflow, asks to create one, or confirms workflow automation."

export const WORKFLOW_GATE_ULTRACODE =
  "Ultracode session mode is ON for this session: quality over cost. Author and run workflows by default for every substantial task (create + start, chain understand → change → verify runs); skip only trivial or conversational turns."

// Item 13: the systemprompt counterpart of WORKFLOW_GATE_ULTRACODE (single
// source of truth — session/system.ts imports this instead of duplicating the
// wording). Appended after the workflow section when the session flag is on.
export const ULTRACODE_SYSTEM_SECTION = [
  WORKFLOW_GATE_ULTRACODE,
  "This is a standing opt-in for the whole session; you do not need a per-message trigger.",
].join("\n")

// Item 3: trigger list, offer path (with cost mention), and hybrid-scout
// recommendation. Shared verbatim between this DESCRIPTION and the workflow
// section of the system prompt (session/system.ts imports it — single source,
// no drift). UNCONDITIONAL: present in both gate variants; workflowDescription
// swaps ONLY the gate sentence, never these.
export const WORKFLOW_TRIGGER_GUIDANCE: string[] = [
  "Use a workflow when one of these triggers applies: the user writes the keyword 'ultracode'; ultracode session mode is on; the user literally asks to run, create, or automate a workflow; a skill or AGENTS.md file instructs you to use one; or the user invokes a workflow by name. Otherwise do not start workflows on your own.",
  "If no trigger applies but a task would clearly benefit from parallel fan-out across many independent items, OFFER a workflow and mention the extra cost (every agent step is a separate subagent session) — do not start one unasked.",
  "Hybrid scouting: discover the work list inline first (grep/glob/read in this session), then write a workflow that receives that list as args and fans out — do not burn agent steps on discovery a single grep can do.",
]

export function workflowDescription(ultracode: boolean): string {
  return [
    "Manage workflows (project .opencode/workflows, global config workflows, and built-in workflows) through one action-based tool.",
    ultracode ? WORKFLOW_GATE_ULTRACODE : WORKFLOW_GATE_DEFAULT,
    ...WORKFLOW_TRIGGER_GUIDANCE,
    // Item 3: one-line authoring doctrine (the full version lives in the
    // action=read guide, workflow.txt) so 'pipeline' shows up here too.
    "Inside workflow source, default to per-item ctx.pipeline chains; insert a parallel barrier only when a step must see all items at once.",
    "Actions:",
    "- read: with name, return one workflow's metadata, arguments, phases, and path; WITHOUT name, return the workflow AUTHORING GUIDE (module shape, ctx API, patterns, copyable examples) plus all available workflows. Read the guide before writing or editing any workflow source.",
    "- start: start a workflow (project, global, or built-in). Waits a short grace window (default 45s); a run still going then continues in the background and notifies this session on completion. background=true returns immediately; background=false or an explicit timeout keeps the old foreground wait. script_path starts a script file directly (edit + re-invoke to iterate).",
    "- wait: wait for a running workflow by run_id.",
    "- inspect: inspect workflow history, logs, agents, a specific agent, result, or all details (all also includes the workflow source).",
    "- create: write a persistent project-local .opencode/workflows/<name>.ts workflow file.",
    "- cancel: stop a running workflow run by run_id (terminal; already-finished runs are returned as-is).",
    "- pause: suspend a running run, keeping its completed-agent journal; resume later by starting the same workflow with resume_of=<run_id>.",
  ].join("\n")
}

const DESCRIPTION = workflowDescription(false)

function promptOps(ctx: Tool.Context) {
  const ops = ctx.extra?.promptOps
  if (typeof ops === "object" && ops !== null && typeof Reflect.get(ops, "prompt") === "function") {
    return ops as Workflow.PromptOps
  }
  throw new Error("Workflow tools require prompt operations in the current session")
}

// Item 24: the shared turn pool, threaded by SessionTools into ctx.extra
// (exactly the promptOps pattern above). Optional — a turn without a budget
// directive has none, and the run then keeps its per-run budget only.
function turnPool(ctx: Tool.Context) {
  const pool = ctx.extra?.turnBudget
  if (typeof pool === "object" && pool !== null && typeof Reflect.get(pool, "id") === "string") {
    return pool as TurnBudget.Pool
  }
  return undefined
}

function workflowError(error: Workflow.InvalidError | Workflow.NotFoundError) {
  if (error._tag === "WorkflowInvalidError") return new Error(`Invalid workflow ${error.path}: ${error.message}`)
  return new Error(`Workflow not found: ${error.name}`)
}

// Fund 56: the inspect/result/agents/logs output is a pseudo-XML envelope built
// by string interpolation, and several interpolated fields are model- or
// attacker-controlled (a subagent's prompt/output/error, the workflow result,
// run args, log messages, the workflow source). Without escaping, a crafted
// value containing literal `</output></agents><result>…` could forge the
// envelope structure (prompt-injection of the reader).
//
// TEXT content only needs `& < >` escaped — the forging vector relies on `<`/`>`
// to open/close tags, and `&` is escaped so the escaping itself is unambiguous.
// `"`/`'` are deliberately left intact in text so embedded JSON (args/result)
// stays readable.
function escapeXmlText(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
}

// ATTRIBUTE values additionally escape the quote characters so an untrusted value
// can never break out of the `="…"` it sits in.
function escapeXmlAttr(value: string) {
  return escapeXmlText(value).replaceAll('"', "&quot;").replaceAll("'", "&apos;")
}

// Item 23 (Stufe 2): renders lint findings as a <lint> block for the tool
// output. The findings' source snippets are untrusted (LLM/attacker-authored
// script text), so they are escaped like every other interpolated field.
function formatLintFindings(findings: readonly SourceLint.Finding[]) {
  if (findings.length === 0) return undefined
  return [
    "<lint>",
    ...findings.map(
      (finding) =>
        `  <finding line="${finding.line}" rule="${escapeXmlAttr(finding.rule)}">${escapeXmlText(finding.text)}</finding>`,
    ),
    "</lint>",
  ].join("\n")
}

// Untrusted structured values (args/result/tokens) are JSON-stringified, then the
// rendering is escaped as text so the serialized output cannot break the envelope
// while keeping its quotes readable.
function formatUnknown(value: unknown) {
  if (value === undefined) return ""
  const text = typeof value === "string" ? value : (JSON.stringify(value, null, 2) ?? String(value))
  return escapeXmlText(text)
}

function formatWorkflow(info: Workflow.Info) {
  return [
    `<workflow name="${escapeXmlAttr(info.name)}">`,
    `<path>${escapeXmlText(info.path)}</path>`,
    `<display_name>${escapeXmlText(info.meta.name)}</display_name>`,
    info.meta.description ? `<description>${escapeXmlText(info.meta.description)}</description>` : undefined,
    info.meta.whenToUse ? `<when_to_use>${escapeXmlText(info.meta.whenToUse)}</when_to_use>` : undefined,
    info.meta.phases?.length
      ? `<phases>${escapeXmlText(info.meta.phases.map((phase) => phase.title).join(", "))}</phases>`
      : undefined,
    "<arguments>",
    ...Object.entries(info.meta.arguments ?? {}).map(
      ([name, arg]) =>
        `  <argument name="${escapeXmlAttr(name)}" type="${escapeXmlAttr(arg.type ?? "string")}"${arg.default === undefined ? "" : ` default=${escapeXmlAttr(JSON.stringify(arg.default))}`}>${escapeXmlText(arg.description ?? "")}</argument>`,
    ),
    "</arguments>",
    "</workflow>",
  ]
    .filter((line): line is string => line !== undefined)
    .join("\n")
}

// QW7: the live agent roster the engine can dispatch as workflow steps. Surfaced
// in read/create output so the model authors `ctx.agent({ agent })` steps against
// agents that actually exist, instead of guessing builtin names.
function formatAgentRoster(list: Agent.Info[]) {
  // Only subagents the engine can dispatch via ctx.agent({agent}) — hidden and
  // primary-only agents are not selectable as workflow steps. Sorted for a
  // stable, scannable list.
  const usable = list
    .filter((agent) => agent.hidden !== true && agent.mode !== "primary")
    .toSorted((a, b) => a.name.localeCompare(b.name))
  if (usable.length === 0) return "<available_agents>No dispatchable agents are available.</available_agents>"
  return [
    "<available_agents>",
    ...usable.map(
      (agent) => `  <agent name="${escapeXmlAttr(agent.name)}">${escapeXmlText(agent.description ?? "")}</agent>`,
    ),
    "</available_agents>",
  ].join("\n")
}

function formatRunSummary(run: Workflow.Run) {
  return [
    `<workflow_run id="${escapeXmlAttr(run.id)}" state="${run.status}">`,
    `<workflow>${escapeXmlText(run.workflow)}</workflow>`,
    run.definition ? `<path>${escapeXmlText(run.definition.path)}</path>` : undefined,
    run.definition?.temporary ? "<temporary>true</temporary>" : undefined,
    `<started_at>${new Date(run.started_at).toISOString()}</started_at>`,
    run.completed_at ? `<completed_at>${new Date(run.completed_at).toISOString()}</completed_at>` : undefined,
    run.current_phase ? `<current_phase>${escapeXmlText(run.current_phase)}</current_phase>` : undefined,
    run.args ? `<args>${formatUnknown(run.args)}</args>` : undefined,
    run.error ? `<error>${escapeXmlText(run.error)}</error>` : undefined,
    "</workflow_run>",
  ]
    .filter((line): line is string => line !== undefined)
    .join("\n")
}

function formatLogs(run: Workflow.Run) {
  if (run.logs.length === 0) return "<logs>No logs recorded.</logs>"
  return [
    "<logs>",
    ...run.logs.map((log) => {
      const phase = log.phase ? ` phase="${escapeXmlAttr(log.phase)}"` : ""
      return `  <log time="${new Date(log.time).toISOString()}"${phase}>${escapeXmlText(log.message)}</log>`
    }),
    "</logs>",
  ].join("\n")
}

function formatAgents(run: Workflow.Run, includeOutput: boolean) {
  if (run.agents.length === 0) return "<agents>No agents were run.</agents>"
  return [
    "<agents>",
    ...run.agents.flatMap((agent) => [
      `  <agent id="${escapeXmlAttr(agent.id)}" state="${agent.status}"${agent.agent ? ` name="${escapeXmlAttr(agent.agent)}"` : ""}>`,
      agent.phase ? `    <phase>${escapeXmlText(agent.phase)}</phase>` : undefined,
      agent.session_id ? `    <session_id>${escapeXmlText(agent.session_id)}</session_id>` : undefined,
      agent.model ? `    <model>${escapeXmlText(agent.model)}</model>` : undefined,
      agent.tokens?.total ? `    <tokens>${agent.tokens.total}</tokens>` : undefined,
      agent.cost ? `    <cost>${agent.cost}</cost>` : undefined,
      includeOutput ? `    <prompt>${escapeXmlText(agent.prompt)}</prompt>` : undefined,
      includeOutput && agent.output ? `    <output>${escapeXmlText(agent.output)}</output>` : undefined,
      agent.error ? `    <error>${escapeXmlText(agent.error)}</error>` : undefined,
      "  </agent>",
    ]),
    "</agents>",
  ]
    .filter((line): line is string => line !== undefined)
    .join("\n")
}

function formatAgent(run: Workflow.Run, id?: string) {
  if (!id) throw new Error("agent_id is required when view is agent")
  const agent = run.agents.find((item) => item.id === id)
  if (!agent) throw new Error(`Workflow agent run not found: ${id}`)
  return [
    `<workflow_agent run_id="${escapeXmlAttr(run.id)}" id="${escapeXmlAttr(agent.id)}" state="${agent.status}">`,
    agent.phase ? `<phase>${escapeXmlText(agent.phase)}</phase>` : undefined,
    agent.agent ? `<agent>${escapeXmlText(agent.agent)}</agent>` : undefined,
    agent.session_id ? `<session_id>${escapeXmlText(agent.session_id)}</session_id>` : undefined,
    agent.message_id ? `<message_id>${escapeXmlText(agent.message_id)}</message_id>` : undefined,
    agent.model ? `<model>${escapeXmlText(agent.model)}</model>` : undefined,
    agent.tokens ? `<tokens>${formatUnknown(agent.tokens)}</tokens>` : undefined,
    agent.cost ? `<cost>${agent.cost}</cost>` : undefined,
    `<prompt>${escapeXmlText(agent.prompt)}</prompt>`,
    agent.output ? `<output>${escapeXmlText(agent.output)}</output>` : undefined,
    agent.error ? `<error>${escapeXmlText(agent.error)}</error>` : undefined,
    "</workflow_agent>",
  ]
    .filter((line): line is string => line !== undefined)
    .join("\n")
}

function formatResult(run: Workflow.Run) {
  return run.result === undefined
    ? "<result>No result recorded.</result>"
    : `<result>${formatUnknown(run.result)}</result>`
}

function formatSource(run: Workflow.Run) {
  if (!run.definition?.source) return "<source>No source recorded.</source>"
  return `<source path="${escapeXmlAttr(run.definition.path)}">${escapeXmlText(run.definition.source)}</source>`
}

function formatInspect(run: Workflow.Run, view: Schema.Schema.Type<typeof InspectView>, agentID?: string) {
  if (view === "logs") return [formatRunSummary(run), formatLogs(run)].join("\n")
  if (view === "agents") return [formatRunSummary(run), formatAgents(run, false)].join("\n")
  if (view === "agent") return formatAgent(run, agentID)
  if (view === "result") return [formatRunSummary(run), formatResult(run)].join("\n")
  if (view === "all") {
    return [formatRunSummary(run), formatLogs(run), formatAgents(run, true), formatResult(run), formatSource(run)].join(
      "\n",
    )
  }
  return [formatRunSummary(run), formatAgents(run, false), formatResult(run)].join("\n")
}

// Item 18: the editable script location for this run — the durable per-run copy
// for a temporary (inline/script_path) start, the real on-disk file for a named
// one. The instruction line teaches the edit + re-invoke iteration loop.
function scriptPathBlock(scriptPath: string | undefined) {
  if (!scriptPath) return undefined
  return [
    `<script_path>${escapeXmlText(scriptPath)}</script_path>`,
    '<instructions>Edit this file and re-invoke action="start" with script_path (add resume_of=<run_id> after pausing the original run) to iterate without resending the source.</instructions>',
  ].join("\n")
}

// Item 8: rich enough that the model can keep working without an immediate
// follow-up call — names the run, its definition path, the session executing it,
// and the inspect/wait affordances (instead of the old bare id + two lines).
function backgroundStarted(run: Workflow.Run, scriptPath?: string) {
  return [
    `<workflow_run id="${escapeXmlAttr(run.id)}" state="running">`,
    `<workflow>${escapeXmlText(run.workflow)}</workflow>`,
    run.definition ? `<path>${escapeXmlText(run.definition.path)}</path>` : undefined,
    run.session_id ? `<session_id>${escapeXmlText(run.session_id)}</session_id>` : undefined,
    run.current_phase ? `<current_phase>${escapeXmlText(run.current_phase)}</current_phase>` : undefined,
    scriptPathBlock(scriptPath),
    "<summary>Workflow is running in the background.</summary>",
    '<instructions>You will be notified automatically when it finishes. Use action="inspect" with this run_id for progress, or action="wait" to block on the result; do not poll unless the user asks.</instructions>',
    "</workflow_run>",
  ]
    .filter((line): line is string => line !== undefined)
    .join("\n")
}

// `text` is intentionally NOT escaped: on the completed path it is the already-
// built (and already-escaped) terminalOutput envelope, and on the error path it
// is a Cause.pretty diagnostic — both belong verbatim inside the result/error tag.
function backgroundMessage(run: Workflow.Run, state: "completed" | "error", text: string) {
  return [
    `<workflow_run id="${escapeXmlAttr(run.id)}" state="${state}">`,
    `<summary>Background workflow ${state}: ${escapeXmlText(run.workflow)}</summary>`,
    state === "completed" ? "<workflow_result>" : "<workflow_error>",
    text,
    state === "completed" ? "</workflow_result>" : "</workflow_error>",
    "</workflow_run>",
  ].join("\n")
}

function sanitizeWorkflowName(name: string) {
  if (!WORKFLOW_NAME_PATTERN.test(name)) {
    throw new Error("Workflow names may only contain letters, numbers, underscores, and dashes")
  }
  return name
}

function workflowPath(directory: string, name: string) {
  return path.join(directory, ".opencode", "workflows", `${sanitizeWorkflowName(name)}.ts`)
}

function projectRoot(instance: { directory: string; worktree: string }) {
  return instance.worktree === "/" ? instance.directory : instance.worktree
}

function terminalOutput(run: Workflow.Run) {
  return [formatRunSummary(run), formatLogs(run), formatAgents(run, false), formatResult(run)].join("\n")
}

// Any non-"completed" TERMINAL status is a failure the tool must surface — not
// only failed/cancelled but also "interrupted" (a crashed/orphaned run swept on
// restart). Returning undefined only for the genuinely-completed run keeps every
// path (foreground/wait/background) from cheerfully reporting "completed" for a
// run that did not actually succeed.
function runFailure(run: Workflow.Run) {
  if (run.status === "completed") return undefined
  return new Error(run.error ?? `Workflow ${run.status}: ${run.id}`)
}

// Fund 7: `run_id` is unconstrained LLM input (Schema.optional(Schema.String)),
// but `Workflow.RunID.make` runs the brand's `isStartsWith("job")` check and
// THROWS synchronously for any id without the "job" prefix. With the trailing
// `.pipe(Effect.orDie)` on the execute body that throw became an unrecoverable
// defect carrying a cryptic Schema message instead of the intended clean
// `Effect.fail("Workflow run not found: <id>")`. Guarding on the prefix first
// keeps a malformed id on the not-found path (every non-existent run reads the
// same regardless of shape).
function decodeRunId(raw: string) {
  return raw.startsWith("job") ? Workflow.RunID.make(raw) : undefined
}

function waitForWorkflow(workflow: Workflow.Interface, run: Workflow.Run, timeout?: number) {
  return workflow
    .wait({ id: run.id, timeout })
    .pipe(Effect.map((waited) => ({ run: waited.run ?? run, timedOut: waited.timedOut })))
}

// Resolves the moment `ctx.abort` fires (or immediately if already aborted).
// Mirrors the shell tool's abort observer (tool/shell.ts).
function awaitAbort(abort: AbortSignal) {
  return Effect.callback<void>((resume) => {
    if (abort.aborted) return resume(Effect.void)
    const handler = () => resume(Effect.void)
    abort.addEventListener("abort", handler, { once: true })
    return Effect.sync(() => abort.removeEventListener("abort", handler))
  })
}

// N10: a FOREGROUND wait must honor the parent turn's abort signal. Without this
// a TUI Esc / `POST /:id/abort` during a foreground workflow would leave the tool
// blocked (up to the 1h wait timeout) AND the run executing (model cost keeps
// burning). We race the wait against the abort: when abort wins, cancel the run
// (stopping its agent spend) and return the cancelled state so the tool unblocks
// immediately. The wait branch is unchanged when no abort fires.
function waitForWorkflowHonoringAbort(
  workflow: Workflow.Interface,
  run: Workflow.Run,
  abort: AbortSignal,
  timeout?: number,
) {
  return Effect.raceFirst(
    waitForWorkflow(workflow, run, timeout),
    awaitAbort(abort).pipe(
      Effect.andThen(
        workflow.cancel(run.id).pipe(Effect.map((cancelled) => ({ run: cancelled ?? run, timedOut: false }))),
      ),
    ),
  )
}

function workflowMetadata(run: Workflow.Run, background: boolean, scriptPath?: string) {
  return {
    runId: run.id,
    sessionId: run.session_id,
    workflow: run.workflow,
    background,
    // Item 18: the editable script file for this run (omitted when no script
    // location is known, e.g. inspect of a foreign run or a failed persist).
    ...(scriptPath ? { scriptPath } : {}),
  }
}

function startWorkflow(input: {
  workflow: Workflow.Interface
  background: BackgroundJob.Interface
  sessions: Session.Interface
  fs: FSUtil.Interface
  config: Config.Interface
  scope: Scope.Scope
  params: Params
  // The named workflow to start. OMITTED for a P3 inline-source start: the engine
  // keys its inline source-string load path on `name === undefined` (+ `source`
  // set), deriving the run's name from the source's meta. A NAMED start (incl. a
  // named temporary start) always supplies it to select a discovered workflow.
  name?: string
  source?: string
  temporary?: boolean
  resumeOf?: Workflow.RunID
  invalidateAgents?: number[]
  ctx: Tool.Context
}) {
  return Effect.gen(function* () {
    const ops = promptOps(input.ctx)
    // Item 12: capture the CALLER session's resolved model so default-agent steps
    // can inherit it. Best-effort — a model-lookup failure must never kill the
    // start, the run merely loses the inheritance tier.
    const callerModel = ops.currentModel
      ? yield* ops.currentModel(input.ctx.sessionID).pipe(
          Effect.map((model) => ({ providerID: model.providerID, modelID: model.modelID })),
          Effect.catchCause(() => Effect.succeed(undefined)),
        )
      : undefined
    // Finding C (design-final §4.3): permission asks raised by the run must
    // surface on the session-tree ROOT — a start from a nested subagent would
    // otherwise park its asks on a session no UI watches. Mirrors task.ts:
    // root via Session.lineage. The walk is best-effort: a missing or corrupt
    // chain falls back to the caller session itself (an ask must never fail on
    // attribution), which is also the depth-≤-1 case — there rootID equals
    // ctx.sessionID and everything stays byte-identical to before.
    const lineage = yield* input.sessions
      .lineage(input.ctx.sessionID)
      .pipe(Effect.catchCause(() => Effect.succeed<Session.Info[]>([])))
    const rootID = lineage.at(-1)?.id ?? input.ctx.sessionID
    // Origin attribution (Ü3): attached only when the asks are routed AWAY
    // from the asking session, so UIs can render "asked by @agent (depth N)" —
    // the same convention SessionTools.resolve uses for routed tool asks.
    const origin =
      rootID === input.ctx.sessionID
        ? undefined
        : {
            originSessionID: input.ctx.sessionID,
            originAgent: input.ctx.agent,
            originDepth: lineage.length,
          }
    const run = yield* input.workflow
      .start({
        name: input.name,
        args: input.params.args,
        // Item 17: either cap present ⇒ the struct form; both absent ⇒ unlimited
        // (the engine also accepts a naked USD number for back-compat).
        budget:
          input.params.budget !== undefined || input.params.budget_tokens !== undefined
            ? { usd: input.params.budget, tokens: input.params.budget_tokens }
            : undefined,
        prompt: ops,
        // Finding C: asks bubble to the tree root (computed above), exactly
        // like the task tool's `permissionSessionID: rootID`.
        permissionSessionID: rootID,
        // Origin attribution for the engine's direct asks (ctx.shell gate);
        // undefined when the caller IS the root (nothing was routed away).
        origin,
        // Pass the caller's identity so every subagent the run spawns inherits
        // this session's deny/external_directory rules and this agent's edit-class
        // denies (Plan Mode) — the same ruleset the task tool derives (#26514).
        // Deliberately the SPAWNER session (not the root): rules derive from the
        // actual caller, only the ask ROUTING targets the root.
        caller: { sessionID: input.ctx.sessionID, agent: input.ctx.agent },
        caller_model: callerModel,
        source: input.source,
        temporary: input.temporary,
        resume_of: input.resumeOf,
        invalidate_agents: input.invalidateAgents,
        // Item 20: replay strategy for the resume journal (prefix default in
        // the engine; only meaningful with resume_of).
        replay: input.params.replay,
        // Item 24: the turn's shared budget pool (when the turn set one) — the
        // run's agent steps reserve/settle against it, so multiple runs of one
        // turn share a single cap.
        pool: turnPool(input.ctx),
      })
      .pipe(Effect.mapError(workflowError))

    // Item 18: every temporary (inline/script_path) start leaves an EDITABLE,
    // durable copy of its script under the global data dir, keyed by run id —
    // the engine's loadModule temp copy is deleted right after import, and the
    // DB row's definition.source is not a file the user can edit + restart.
    // Named/on-disk workflows need no copy: their real file IS the edit point.
    // The run directory is deliberately left in place as an iteration artifact
    // (a future DELETE /workflow/run/:id could sweep it along).
    let scriptPath = run.definition?.temporary ? undefined : run.definition?.path
    if (run.definition?.temporary && input.source) {
      const persisted = path.join(Global.Path.data, "workflow", run.id, "script.ts")
      // Best-effort: a write failure (full disk, permissions) must never fail
      // the start — the result merely lacks the iteration path.
      const wrote = yield* input.fs.writeWithDirs(persisted, input.source).pipe(
        Effect.as(true),
        Effect.catch(() => Effect.succeed(false)),
      )
      if (wrote) scriptPath = persisted
    }

    yield* input.ctx.metadata({
      title: run.definition?.meta.name ?? run.workflow,
      metadata: workflowMetadata(run, input.params.background === true, scriptPath),
    })

    // Item 8: the background registration is shared by BOTH async paths — the
    // explicit background=true start (immediate) and the grace-window switch
    // below (after the foreground grace elapses). Registering exactly once per
    // run is guaranteed structurally: the two call sites are disjoint branches.
    const registerBackground = input.background.start({
      id: run.id,
      type: "workflow",
      title: run.workflow,
      metadata: {
        ...workflowMetadata(run, true, scriptPath),
        parentSessionId: input.ctx.sessionID,
      },
      run: waitForWorkflow(input.workflow, run).pipe(
        Effect.flatMap((waited) => {
          const error = runFailure(waited.run)
          return error ? Effect.fail(error) : Effect.succeed(terminalOutput(waited.run))
        }),
        Effect.tap((output) =>
          input.sessions.get(input.ctx.sessionID).pipe(
            Effect.flatMap((session) =>
              ops.prompt({
                sessionID: input.ctx.sessionID,
                agent: session.agent ?? input.ctx.agent,
                parts: [
                  {
                    type: "text",
                    synthetic: true,
                    text: backgroundMessage(run, "completed", output),
                  },
                ],
              }),
            ),
            Effect.ignore,
            Effect.forkIn(input.scope, { startImmediately: true }),
          ),
        ),
        Effect.catchCause((cause) =>
          input.sessions.get(input.ctx.sessionID).pipe(
            Effect.flatMap((session) =>
              ops.prompt({
                sessionID: input.ctx.sessionID,
                agent: session.agent ?? input.ctx.agent,
                parts: [
                  {
                    type: "text",
                    synthetic: true,
                    text: backgroundMessage(run, "error", Cause.pretty(cause)),
                  },
                ],
              }),
            ),
            Effect.ignore,
            Effect.forkIn(input.scope, { startImmediately: true }),
            Effect.andThen(Effect.failCause(cause)),
          ),
        ),
      ),
    })

    if (input.params.background) {
      const job = yield* registerBackground
      return {
        title: `Workflow started: ${run.workflow}`,
        metadata: { ...workflowMetadata(run, true, scriptPath), jobId: job.id, timedOut: false },
        output: backgroundStarted(run, scriptPath),
      }
    }

    // Item 8 semantics matrix:
    // - background=true → immediate background (handled above, unchanged)
    // - background=false → old long foreground wait (explicit opt-out)
    // - timeout set → explicit foreground wait with the still-running result
    //   (back-compat for existing callers)
    // - all unset (default) → short grace window, then auto-switch to background
    const explicitForeground = input.params.background === false || input.params.timeout !== undefined
    const grace = (yield* input.config.get()).workflows?.foreground_grace_ms ?? FOREGROUND_GRACE
    const bound = explicitForeground ? (input.params.timeout ?? DEFAULT_TIMEOUT) : grace
    const waited = yield* waitForWorkflowHonoringAbort(input.workflow, run, input.ctx.abort, bound)
    if (!waited.timedOut) {
      // Fund 30: a TERMINAL non-completed run (failed/cancelled/interrupted) must fail
      // the tool here too, consistent with the background path — never report
      // "Workflow finished" for a run that did not succeed. A timed-out run is still
      // running, so it is reported as such, not failed.
      //
      // N10 carve-out: when the PARENT TURN aborted (ctx.abort), the run was cancelled
      // as the deliberate, graceful response to that abort — not a workflow failure.
      // Returning the cancelled state as success (rather than failing) keeps the abort
      // flow clean; failing here would surface a spurious "Workflow cancelled" error
      // for a user-initiated stop. A run that failed/cancelled/interrupted on its own
      // (no abort) still fails the tool.
      if (!input.ctx.abort.aborted) {
        const failure = runFailure(waited.run)
        if (failure) return yield* Effect.fail(failure)
      }
      return {
        title: `Workflow finished: ${run.workflow}`,
        metadata: { ...workflowMetadata(run, false, scriptPath), jobId: "", timedOut: false },
        output: [scriptPathBlock(scriptPath), terminalOutput(waited.run)]
          .filter((line): line is string => line !== undefined)
          .join("\n"),
      }
    }
    if (explicitForeground) {
      return {
        title: `Workflow still running: ${run.workflow}`,
        metadata: { ...workflowMetadata(run, false, scriptPath), jobId: "", timedOut: true },
        output: [
          formatRunSummary(waited.run),
          scriptPathBlock(scriptPath),
          '<instructions>Use the workflow tool with action="wait" and this run_id to wait for completion.</instructions>',
        ]
          .filter((line): line is string => line !== undefined)
          .join("\n"),
      }
    }
    // Grace elapsed, run still alive → continue in the background and notify
    // this session on completion, exactly like an explicit background start.
    const job = yield* registerBackground
    return {
      title: `Workflow running in background: ${run.workflow}`,
      metadata: { ...workflowMetadata(run, true, scriptPath), jobId: job.id, timedOut: false },
      output: backgroundStarted(waited.run, scriptPath),
    }
  })
}

export const WorkflowTool = Tool.define(
  "workflow",
  Effect.gen(function* () {
    const workflow = yield* Workflow.Service
    const agents = yield* Agent.Service
    const background = yield* BackgroundJob.Service
    const sessions = yield* Session.Service
    const fs = yield* FSUtil.Service
    const config = yield* Config.Service
    const events = yield* EventV2Bridge.Service
    const format = yield* Format.Service
    const lsp = yield* LSP.Service
    const scope = yield* Scope.Scope
    // Item 23 (Stufe 2): the configured static source lint. AST-only (never
    // imports/executes the module), so it is safe BEFORE the permission ask.
    // 'off' ⇒ no findings; 'deny' ⇒ findings fail the create/start outright;
    // 'warn' (default) ⇒ findings are surfaced (create output / start ask
    // metadata) without blocking.
    const lintSource = (source: string, displayPath: string) =>
      Effect.gen(function* () {
        const mode = (yield* config.get()).workflows?.lint ?? "warn"
        const findings = mode === "off" ? [] : SourceLint.lint(source, displayPath).findings
        if (mode === "deny" && findings.length > 0) {
          return yield* Effect.fail(
            new Error(
              `Workflow source rejected by lint (workflows.lint="deny"): ` +
                findings.map((finding) => `line ${finding.line} [${finding.rule}] ${finding.text}`).join("; "),
            ),
          )
        }
        return findings
      })
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Params, ctx: Tool.Context<Metadata>): Effect.Effect<Tool.ExecuteResult<Metadata>> =>
        Effect.gen(function* () {
          if (params.action === "read") {
            // Item 1: read WITHOUT a name returns the authoring guide plus the
            // startable workflows and the dispatchable agent roster. The guide
            // lives ONLY here (on demand) — the tool DESCRIPTION just points at
            // it, keeping the always-loaded token cost flat. The guide is static,
            // trusted text (its code samples legitimately contain < >), so it is
            // not XML-escaped.
            if (!params.name)
              return {
                title: "Workflow authoring guide",
                metadata: { guide: true },
                output: [
                  AUTHORING_GUIDE,
                  Workflow.fmt(yield* workflow.list()),
                  formatAgentRoster(yield* agents.list()),
                ].join("\n\n"),
              }
            const workflows = yield* workflow.list()
            const info = workflows.find((item) => item.name === params.name)
            if (!info) return yield* Effect.fail(new Error(`Workflow not found: ${params.name}`))
            // A discovered-but-broken file must surface its load error, not a
            // misleadingly empty <workflow> block.
            if (info.valid === false) {
              return yield* Effect.fail(new Error(`Invalid workflow ${info.path}: ${info.error ?? "invalid workflow"}`))
            }
            return {
              title: `Workflow: ${info.name}`,
              metadata: { name: info.name, path: info.path },
              output: [formatWorkflow(info), formatAgentRoster(yield* agents.list())].join("\n"),
            }
          }

          if (params.action === "start") {
            // P3/Item 18: name, inline source, and script_path are mutually
            // exclusive — exactly one selects the workflow to start.
            const selectors = [params.name, params.source, params.script_path].filter((value) => value !== undefined)
            if (selectors.length !== 1)
              return yield* Effect.fail(
                new Error("Provide exactly one of name, source, or script_path for action=start"),
              )
            // QW3: a malformed resume_of is surfaced as a clean not-found (using the
            // same prefix guard wait/inspect use) rather than a Schema defect through
            // the trailing orDie.
            const resumeOf = params.resume_of ? decodeRunId(params.resume_of) : undefined
            if (params.resume_of && !resumeOf)
              return yield* Effect.fail(new Error(`Workflow run not found: ${params.resume_of}`))

            // P3/Item 18: a source-string start (inline or read from script_path)
            // runs as a TEMPORARY run. Statically validate the source via MetaReader
            // (AST-only, never executes the module) BEFORE the permission ask — same
            // gate order as create/named-start: a bad meta fails here, the module
            // LOAD (which runs code) happens later inside the engine, after the ask.
            const startFromSource = (source: string, displayPath: string) =>
              Effect.gen(function* () {
                const validated = MetaReader.read(source, displayPath)
                if (validated.valid === false)
                  return yield* Effect.fail(
                    new Error(
                      `Invalid workflow ${displayPath}: ${validated.error}` +
                        ' Call the workflow tool with action="read" and no name for the authoring guide (module shape, meta rules, examples).',
                    ),
                  )
                // The meta name keys the permission pattern/`always`, so an illegal name
                // (glob metacharacter/whitespace) is rejected here with a clean fail —
                // never sanitizeWorkflowName's synchronous throw (which orDie would turn
                // into a defect) and never an over-broad `always` rule (N15).
                if (!WORKFLOW_NAME_PATTERN.test(validated.meta.name))
                  return yield* Effect.fail(
                    new Error("Workflow names may only contain letters, numbers, underscores, and dashes"),
                  )
                const safeName = validated.meta.name
                // Item 23 (Stufe 2): static lint of the inline/script source.
                // 'deny' fails here (before the ask — nothing started); 'warn'
                // findings ride into the ask metadata so the approval dialog
                // ('View script') can highlight them.
                const lintFindings = yield* lintSource(source, displayPath)
                // Item 9: display_name/description feed the approval UI only —
                // patterns/`always` stay keyed on the sanitized name (N15).
                yield* ctx.ask({
                  permission: "workflow",
                  patterns: [safeName],
                  always: [safeName],
                  metadata: {
                    name: safeName,
                    display_name: validated.meta.name,
                    description: validated.meta.description,
                    path: displayPath,
                    action: "start",
                    args: params.args ?? {},
                    background: params.background === true,
                    ...(lintFindings.length > 0 ? { lint: lintFindings } : {}),
                  },
                })
                return yield* startWorkflow({
                  workflow,
                  background,
                  sessions,
                  fs,
                  config,
                  scope,
                  params,
                  // Omit name: the engine takes its inline source-string load path when
                  // name is undefined and source is set, deriving the run's name from
                  // the source's meta (validated above).
                  source,
                  temporary: true,
                  resumeOf,
                  invalidateAgents: params.invalidate_agents ? [...params.invalidate_agents] : undefined,
                  ctx,
                })
              })

            if (params.script_path) {
              const resolved = path.isAbsolute(params.script_path)
                ? params.script_path
                : path.join(projectRoot(yield* InstanceState.context), params.script_path)
              if (![".ts", ".js"].includes(path.extname(resolved)))
                return yield* Effect.fail(new Error(`Workflow scripts must be .ts or .js files: ${resolved}`))
              // Same gate as create: paths outside the allowed area go through the
              // external_directory permission before anything is read.
              yield* assertExternalDirectoryEffect(ctx, resolved)
              const source = yield* fs.readFileStringSafe(resolved)
              if (source === undefined) return yield* Effect.fail(new Error(`Workflow script not found: ${resolved}`))
              return yield* startFromSource(source, resolved)
            }

            if (params.source) return yield* startFromSource(params.source, "inline.ts")

            if (!params.name) return yield* Effect.fail(new Error("name is required for action=start"))
            // N15 (security, behavior change): the name reaching the permission
            // pattern/`always` MUST be glob-metacharacter-free. A discovered
            // workflow name is just a file basename (discover() does
            // path.basename without any charset limit), so a file like `*.ts`
            // would yield name `*`. The permission layer matches `always` rules
            // via Wildcard.match, where `*` expands to `.*` — so an unsanitized
            // `always: ["*"]` "allow" would silently grant EVERY future workflow.
            // We reuse create's sanitizer so start accepts exactly the same name
            // shape create writes; an illegal name fails here instead of becoming
            // an over-broad rule.
            const safeName = sanitizeWorkflowName(params.name)
            // Existence + validity pre-check via the static list. This is
            // side-effect-free (static meta extraction, NO module execution), so it
            // is safe to run BEFORE the permission ask: an unknown name fails with a
            // clear "not found", and — Fund 55 — a discovered-but-unloadable workflow
            // (bad meta / non-literal / schema-invalid) fails here exactly like read,
            // rather than firing the interactive workflow prompt only to fail deep
            // inside the engine afterwards. The actual module load (which DOES run
            // code) still happens later, AFTER the ask below.
            const workflows = yield* workflow.list()
            const info = workflows.find((item) => item.name === params.name)
            if (!info) return yield* Effect.fail(new Error(`Workflow not found: ${params.name}`))
            if (info.valid === false) {
              return yield* Effect.fail(new Error(`Invalid workflow ${info.path}: ${info.error ?? "invalid workflow"}`))
            }
            // Fund 54: populate definition.source from the workflow file so inspect
            // view="all" renders the real <source> (the engine persists it on the
            // run, and the TUI reads it too). Best-effort: a read failure just leaves
            // source unset, falling back to "No source recorded." rather than failing
            // the start. Read BEFORE the ask (Item 23) so the static lint findings
            // can ride into the approval metadata — a plain file read is as
            // side-effect-free as the static list pre-check above.
            const source = yield* fs.readFileStringSafe(info.path)
            // Item 23 (Stufe 2): static lint of the named workflow's source.
            // 'deny' fails before the ask; 'warn' findings feed the approval UI.
            const lintFindings = source !== undefined ? yield* lintSource(source, info.path) : []
            // Permission gate before any module LOAD/execution. The check above is
            // side-effect-free, so the ask still gates every line of foreign code: an
            // untrusted workspace can never drive any workflow execution ahead of the
            // user's consent. Item 9: display_name/description feed the approval UI
            // only — patterns/`always` stay keyed on the sanitized name (N15).
            yield* ctx.ask({
              permission: "workflow",
              patterns: [safeName],
              always: [safeName],
              metadata: {
                name: safeName,
                display_name: info.meta.name,
                description: info.meta.description,
                action: "start",
                args: params.args ?? {},
                background: params.background === true,
                ...(lintFindings.length > 0 ? { lint: lintFindings } : {}),
              },
            })
            return yield* startWorkflow({
              workflow,
              background,
              sessions,
              fs,
              config,
              scope,
              params,
              name: params.name,
              source: source ?? undefined,
              resumeOf,
              invalidateAgents: params.invalidate_agents ? [...params.invalidate_agents] : undefined,
              ctx,
            })
          }

          if (params.action === "wait") {
            if (!params.run_id) return yield* Effect.fail(new Error("run_id is required for action=wait"))
            const runId = decodeRunId(params.run_id)
            if (!runId) return yield* Effect.fail(new Error(`Workflow run not found: ${params.run_id}`))
            // N10: honor ctx.abort here too — a wait action that blocks during a
            // turn abort must unblock and cancel the run rather than hang.
            const waited = yield* Effect.raceFirst(
              workflow.wait({ id: runId, timeout: params.timeout ?? DEFAULT_TIMEOUT }),
              awaitAbort(ctx.abort).pipe(
                Effect.andThen(workflow.cancel(runId).pipe(Effect.map((run) => ({ run, timedOut: false })))),
              ),
            )
            if (!waited.run) return yield* Effect.fail(new Error(`Workflow run not found: ${params.run_id}`))
            // Fund 30: a terminal non-completed run (failed/cancelled/interrupted)
            // fails the wait too, consistent with foreground/background — never
            // report "Workflow finished" for a run that did not succeed. A timed-out
            // run is still running, so it is reported, not failed. N10 carve-out: a
            // cancellation caused by THIS turn's abort is the graceful abort response,
            // not a workflow failure, so it returns the cancelled state as success.
            if (!waited.timedOut && !ctx.abort.aborted) {
              const failure = runFailure(waited.run)
              if (failure) return yield* Effect.fail(failure)
            }
            return {
              title: waited.timedOut
                ? `Workflow still running: ${params.run_id}`
                : `Workflow finished: ${params.run_id}`,
              metadata: { runId: params.run_id, timedOut: waited.timedOut },
              output: waited.timedOut
                ? [
                    formatRunSummary(waited.run),
                    "<instructions>The workflow is still running. Wait again later if the user needs the final result.</instructions>",
                  ].join("\n")
                : terminalOutput(waited.run),
            }
          }

          if (params.action === "inspect") {
            if (!params.run_id) return yield* Effect.fail(new Error("run_id is required for action=inspect"))
            const runId = decodeRunId(params.run_id)
            if (!runId) return yield* Effect.fail(new Error(`Workflow run not found: ${params.run_id}`))
            const run = yield* workflow.get(runId)
            if (!run) return yield* Effect.fail(new Error(`Workflow run not found: ${params.run_id}`))
            const view = params.view ?? "summary"
            return {
              title: `Workflow run: ${run.id}`,
              metadata: { ...workflowMetadata(run, false), view },
              output: formatInspect(run, view, params.agent_id),
            }
          }

          if (params.action === "cancel" || params.action === "pause") {
            if (!params.run_id) return yield* Effect.fail(new Error(`run_id is required for action=${params.action}`))
            const runId = decodeRunId(params.run_id)
            if (!runId) return yield* Effect.fail(new Error(`Workflow run not found: ${params.run_id}`))
            // No ctx.ask gate here: cancel/pause are DE-escalating (they stop spend),
            // exactly like the auth-only HTTP cancel/pause handlers — never escalate
            // a stop behind a permission prompt.
            //
            // Agent-initiated stop is INTENTIONAL: cancel the BackgroundJob wait
            // fiber FIRST (job id === run.id) so the synthetic
            // backgroundMessage("error") prompt never fires for a deliberate stop.
            yield* background.cancel(runId).pipe(Effect.ignore)
            const run = yield* params.action === "cancel" ? workflow.cancel(runId) : workflow.pause(runId)
            if (!run) return yield* Effect.fail(new Error(`Workflow run not found: ${params.run_id}`))
            // Idempotency is reported honestly: cancel/pause of an already-terminal
            // run returns its real snapshot (e.g. "Workflow completed: …") as SUCCESS
            // — a stopped run is the wanted outcome here, never a runFailure()
            // (counterpart of the N10 carve-out on the foreground wait).
            return {
              title: `Workflow ${run.status}: ${run.workflow}`,
              metadata: { ...workflowMetadata(run, false), action: params.action },
              output: [
                formatRunSummary(run),
                params.action === "pause" && run.status === "paused"
                  ? "<instructions>Resume by starting this workflow again with resume_of set to this run_id; use invalidate_agents to force individual steps to re-run.</instructions>"
                  : undefined,
              ]
                .filter((line): line is string => line !== undefined)
                .join("\n"),
            }
          }

          if (params.action === "create") {
            if (!params.name) return yield* Effect.fail(new Error("name is required for action=create"))
            if (!params.source) return yield* Effect.fail(new Error("source is required for action=create"))
            // Fund 8 (security): the same name-sanitization start uses (N15/3b) gates
            // the workflow permission pattern below, so a glob-metacharacter name can
            // never produce an over-broad `always` rule. workflowPath sanitizes too,
            // so an illegal name fails identically on either path.
            const safeName = sanitizeWorkflowName(params.name)
            const instance = yield* InstanceState.context
            const filepath = workflowPath(projectRoot(instance), params.name)
            yield* assertExternalDirectoryEffect(ctx, filepath)
            const exists = yield* fs.existsSafe(filepath)
            if (exists && !params.overwrite) {
              return yield* Effect.fail(
                new Error(`Workflow already exists: ${params.name}. Set overwrite=true to replace it.`),
              )
            }
            // Fund 8 (security, behavior change): creating a workflow writes a
            // project-local module that a later start will LOAD and execute, so create
            // is itself a privileged operation. Gate it behind the SAME `workflow`
            // permission start uses (consistent pattern/`always` shape), in addition to
            // the `edit` gate for the write. The ask comes BEFORE any write, so a denial
            // dies before fs.writeWithDirs and the file is never created.
            //
            // Item 9: a tolerant static pre-parse enriches the approval display with
            // the workflow's display name/description. MetaReader is AST-only and
            // side-effect-free, so it is safe BEFORE the ask. Display only: an
            // invalid source still asks (without the display fields) and still runs
            // the unchanged post-write validation/error path below.
            const preview = MetaReader.read(params.source, filepath)
            // Item 23 (Stufe 2): static lint of the source about to be written.
            // 'deny' fails HERE — before the ask and before any write, so a
            // denied source never reaches disk; 'warn' findings ride into the
            // ask metadata and the success output below.
            const lintFindings = yield* lintSource(params.source, filepath)
            yield* ctx.ask({
              permission: "workflow",
              patterns: [safeName],
              always: [safeName],
              metadata: {
                name: safeName,
                ...(preview.valid !== false
                  ? { display_name: preview.meta.name, description: preview.meta.description }
                  : {}),
                action: "create",
                args: params.args ?? {},
                background: params.background === true,
                ...(lintFindings.length > 0 ? { lint: lintFindings } : {}),
              },
            })
            const previous = exists ? ((yield* fs.readFileStringSafe(filepath)) ?? "") : ""
            yield* ctx.ask({
              permission: "edit",
              patterns: [path.relative(instance.worktree, filepath)],
              always: ["*"],
              metadata: { filepath, diff: trimDiff(createTwoFilesPatch(filepath, filepath, previous, params.source)) },
            })
            yield* fs.writeWithDirs(filepath, params.source)
            yield* format.file(filepath).pipe(Effect.ignore)
            yield* events.publish(FileSystem.Event.Edited, { file: filepath })
            yield* events.publish(Watcher.Event.Updated, { file: filepath, event: exists ? "change" : "add" })
            yield* lsp.touchFile(filepath, "document")
            // Fund 8 (security): validate the freshly written source STATICALLY via the
            // meta-reader (AST-only meta extraction). This must never dynamically import
            // the file — importing would execute the LLM/attacker-authored top-level code
            // right after the write, the exact root cause Task 3a removed from discovery.
            // A bad meta (non-literal / schema-invalid / missing) is reported as a precise
            // load failure instead of claiming the file was "created and validated".
            const validated = MetaReader.read(params.source, filepath)
            if (validated.valid === false) {
              return yield* Effect.fail(
                new Error(
                  `Invalid workflow ${filepath}: ${validated.error}` +
                    ' Call the workflow tool with action="read" and no name for the authoring guide (module shape, meta rules, examples).',
                ),
              )
            }
            return {
              title: `Workflow created: ${params.name}`,
              metadata: { name: params.name, path: filepath, exists },
              output: [
                "Workflow file created and validated.",
                // Item 23 (Stufe 2): non-blocking lint findings as a <lint>
                // block, so the author sees which capabilities the script uses.
                ...(formatLintFindings(lintFindings) !== undefined
                  ? ["", formatLintFindings(lintFindings)!]
                  : []),
                "",
                formatWorkflow({ name: params.name, path: filepath, meta: validated.meta, valid: true }),
                formatAgentRoster(yield* agents.list()),
                // Item 1: a lean iteration footer (the author just wrote the file
                // — no need for the full guide here).
                "",
                `Next: start it with action="start", name="${params.name}";`,
                'inspect a run with action="inspect", view="all";',
                "edit the file and start again to iterate — the module is loaded fresh on every start (no cache).",
              ].join("\n"),
            }
          }
          return yield* Effect.fail(new Error(`Unsupported workflow action: ${params.action}`))
        }).pipe(Effect.orDie),
    }
  }),
)
