import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core"
import { Timestamps } from "../database/schema.sql"

// The workflow_run table lives in core (not in the opencode engine that owns the
// runtime logic) because migrations are applied by core: every Drizzle table must
// be declared here so the schema/migration pipeline sees it (cf. AGENTS.md,
// "migrations live in packages/core and are applied by core"). The engine in
// `packages/opencode/src/workflow/workflow.ts` re-exports the table via a one-line
// bridge and owns the Effect schemas that validate these shapes at runtime.
//
// These row types are the SINGLE SOURCE OF TRUTH for the JSON column payloads:
// they are the persistence contract that defines the columns. The engine's Effect
// schemas (the runtime validators) are asserted assignable to/from these row types
// at compile time, so the two can never silently drift again — a field added,
// removed, or retyped on either side fails the engine build. The dependency law
// (core must not import the engine) means the canonical declaration has to live
// here in core; the assertion lives in the engine, which legally imports core.

export type WorkflowDefinitionRow = {
  name: string
  path: string
  meta: {
    name: string
    description?: string
    // Phases are persisted in their NORMALIZED (decoded) shape — always objects
    // (`{ title, detail?, model? }`), never bare strings. The engine normalizes a
    // workflow's authored phases (which may be strings OR objects on the public
    // contract) the moment meta is decoded, and `mutableMeta` writes that decoded
    // form into the definition JSON, so the row only ever holds objects.
    phases?: { title: string; detail?: string; model?: string }[]
    arguments?: Record<string, { type?: string; default?: unknown; description?: string }>
  }
  source?: string
  temporary?: boolean
}

export type WorkflowLogRow = {
  time: number
  phase?: string
  message: string
}

export type WorkflowAgentRow = {
  id: string
  // Agent NODES only ever carry these four ("skipped" = a human skipped the step
  // via skipAgent, Item 15). The run-level `status` column below is widened to
  // also include "cancelled"/"interrupted", but those are RUN lifecycle states
  // only: on cancel/interrupt the engine rewrites a still-running agent node to
  // "failed" (with an explanatory error), and the orphan sweep touches only the
  // run row, never the agents JSON. Keep this union in lockstep with the
  // engine's `AgentRun` schema (asserted at compile time over there).
  status: "running" | "completed" | "failed" | "skipped"
  started_at: number
  completed_at?: number
  phase?: string
  agent?: string
  // Per-call display name (Item 16), set from `ctx.agent({ label })`. Display-only
  // (never part of the resume journal key). Keep in lockstep with the engine's
  // `AgentRun` schema (asserted at compile time over there).
  label?: string
  model?: string
  session_id?: string
  message_id?: string
  // Item 7: the isolated `git worktree` base directory this step ran in (only
  // for isolation:"worktree" steps; preserved worktrees stay inspectable here).
  // Keep in lockstep with the engine's `AgentRun` schema (asserted at compile
  // time over there).
  worktree?: string
  prompt: string
  output?: string
  cost?: number
  tokens?: {
    total?: number
    input: number
    output: number
    reasoning: number
    cache: {
      read: number
      write: number
    }
  }
  error?: string
  // `true` when this agent node was replayed from a resumed run's persisted
  // journal rather than executed live. Omitted for a live step. Keep this in
  // lockstep with the engine's `AgentRun` schema (asserted at compile time).
  cached?: boolean
  // The journal node KIND (Tasks 12/13). `"agent"` (or undefined, for rows
  // written before this field existed) is a normal LLM agent step; `"question"`
  // is a human-in-the-loop `ctx.question` step whose `prompt` holds the question
  // text and whose `answer` (below) is filled in once the user replies. Old rows
  // decode with `kind` absent, which the engine reads as `"agent"`. Keep this in
  // lockstep with the engine's `AgentRun` schema (asserted at compile time).
  kind?: "agent" | "question"
  // The answer recorded on a `kind:"question"` node once the question was
  // answered (live) or replayed from a resumed run's journal. Omitted while the
  // question is still open / for non-question nodes. Keep in lockstep with the
  // engine's `AgentRun` schema.
  answer?: string
}

export const WorkflowRunTable = sqliteTable(
  "workflow_run",
  {
    id: text().primaryKey(),
    session_id: text(),
    // The workspace directory the run was started in (InstanceState.directory).
    // The DB is process-global (one opencode.db under Global.Path.data) but the
    // workflow endpoints are per-directory (WorkspaceRoutingMiddleware), so every
    // read/delete/sweep is scoped to this column — a run started in directory A
    // must never leak into / be deleted from directory B (Fund 6/17). Legacy rows
    // written before this column existed get the `""` default and stay visible as
    // "global/legacy" (no crash on old DBs); never NULL so the scoping equality
    // comparison is total.
    directory: text().notNull().default(""),
    workflow: text().notNull(),
    // `paused` is a non-terminal status: a run the user explicitly suspended via
    // pause() (sessions aborted, scope closed, fiber interrupted — like cancel),
    // but whose persisted agent journal is kept intact so a later resume can
    // replay the completed agents instead of re-running them. Distinct from
    // `cancelled`/`interrupted` (both terminal): a paused run is neither finished
    // nor lost, it is parked. Keep this union in lockstep with the engine's
    // `Status` schema (asserted assignable at compile time over there).
    status: text().$type<"running" | "completed" | "failed" | "cancelled" | "interrupted" | "paused">().notNull(),
    started_at: integer().notNull(),
    completed_at: integer(),
    current_phase: text(),
    args: text({ mode: "json" }).$type<Record<string, unknown>>(),
    definition: text({ mode: "json" }).$type<WorkflowDefinitionRow>(),
    logs: text({ mode: "json" }).notNull().$type<WorkflowLogRow[]>(),
    agents: text({ mode: "json" }).notNull().$type<WorkflowAgentRow[]>(),
    // Plain `text` (NOT `mode: "json"`) on purpose (Fund 42): Drizzle's JSON mode
    // decodes BOTH the SQL value NULL and the literal JSON text `"null"` to JS
    // `null`, collapsing two distinct states — a result that was never recorded
    // (column empty) vs. a workflow that genuinely returned `null`. The engine
    // must tell them apart (empty → reported `undefined` / "No result recorded.";
    // real null → reported `null`), so it owns the JSON serialization explicitly:
    // it writes SQL NULL for an unset result and the text `"null"` for a real one,
    // and parses the text back in `fromRow`. The on-disk type is unchanged (`text`
    // either way), so no migration is required. JSON mode stays on logs/agents,
    // which never carry that null/undefined ambiguity.
    result: text(),
    error: text(),
    // Nullable back-reference to the run this run was resumed FROM (a previous
    // paused/interrupted run id). When set, start() loaded the source run's
    // persisted agent journal and replayed every completed agent it could match
    // instead of re-prompting them — so a resume is cheap and cross-restart
    // (the journal lives in the DB, not in memory). NULL for an ordinary
    // (non-resume) start. Purely a provenance/audit field on the row; the engine
    // reads it back as `resume_of` on the public Run.
    resume_of: text(),
    // The open human-in-the-loop question a running run is currently waiting on
    // (Tasks 12/13). Set when `ctx.question` is awaited and the answer has not yet
    // arrived; cleared the moment the answer lands (live) or the question node is
    // replayed during a resume. A JSON object `{ question, options?, asked_at }` so
    // a paused run that timed out keeps the open question persisted across restarts
    // (the journal also keeps the matching `kind:"question"` agent node). NULL when
    // no question is pending — the common case. Distinct from the agent journal:
    // this is the SINGLE in-flight question, the journal is the audit trail.
    pending_question: text({ mode: "json" }).$type<{ question: string; options?: string[]; asked_at: number }>(),
    ...Timestamps,
  },
  (table) => [
    index("workflow_run_started_at_idx").on(table.started_at),
    index("workflow_run_status_started_at_idx").on(table.status, table.started_at),
  ],
)
