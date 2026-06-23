import { describe, expect, test } from "bun:test"
import { Workflow } from "@/workflow/workflow"
import { BUILTIN_WORKFLOWS } from "@/workflow/builtin"
import { EventV2Bridge } from "@/event-v2-bridge"
import { Session } from "@/session/session"
import { Permission } from "@/permission"
import { Agent } from "@/agent/agent"
import { SessionID } from "@/session/schema"
import type { SessionPrompt } from "@/session/prompt"
import { TurnBudget } from "@/session/turn-budget"
import type { SessionV1 } from "@opencode-ai/core/v1/session"
import { Database } from "@opencode-ai/core/database/database"
import { WorkflowRunTable } from "@opencode-ai/core/workflow/sql"
import { MessageTable } from "@opencode-ai/core/session/sql"
import { MessageID } from "@opencode-ai/core/v1/session"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { eq, sql } from "drizzle-orm"
import { TestInstance, provideInstance, tmpdirScoped, reloadInstance, testInstanceStoreLayer } from "../fixture/fixture"
import { InstanceState } from "@/effect/instance-state"
import { awaitWithTimeout, pollWithTimeout, testEffect } from "../lib/effect"
import { Cause, Deferred, Effect, Exit, Fiber, Layer, Schema } from "effect"
import { Global } from "@opencode-ai/core/global"
import { spawnSync } from "child_process"
import fs from "fs/promises"
import path from "path"
import { pathToFileURL } from "url"

// Database.defaultLayer is merged so the orphan-sweep tests can seed a row
// directly through the same in-memory SQLite connection the engine uses.
// Session/Agent.defaultLayer are merged so the subagent-permission-inheritance
// tests can create a caller session (with a deny ruleset) and read back the
// child session the engine spawns — through the SAME memoised services the
// engine resolves (Effect dedupes shared layer builds, exactly as for Database).
const it = testEffect(
  Layer.mergeAll(
    Workflow.defaultLayer,
    Database.defaultLayer,
    Session.defaultLayer,
    Agent.defaultLayer,
    CrossSpawnSpawner.defaultLayer,
    // EventV2Bridge.defaultLayer is merged so a test can subscribe to the SAME bus
    // instance the engine publishes run-lifecycle events on. It is the identical
    // exported const reference the Workflow layer provides internally, so Effect's
    // layer memoisation resolves both to ONE instance (exactly as for Database).
    EventV2Bridge.defaultLayer,
    // Item 23: Permission.defaultLayer is merged so the ctx.shell gate tests can
    // observe/reply to the SAME permission instance the engine asks through
    // (identical const reference ⇒ one memoised instance, as above).
    Permission.defaultLayer,
  ),
)

const HELLO_FIXTURE = "hello"

// Seeds a workflow_run row in status="running" with NO live registry entry,
// the exact shape an orphaned (crashed/restarted) run leaves behind. The row is
// owned by the calling workspace `directory` so the directory-scoped sweep/get
// (Fund 6/17) recognises it as a local zombie rather than a foreign run.
function seedRunningRow(id: string, directory: string) {
  return Effect.gen(function* () {
    const { db } = yield* Database.Service
    yield* db
      .insert(WorkflowRunTable)
      .values({
        id,
        workflow: HELLO_FIXTURE,
        status: "running",
        started_at: Date.now(),
        directory,
        logs: [],
        agents: [],
      })
      .run()
      .pipe(Effect.orDie)
  })
}

// Seeds a `running` row that ALSO carries a still-`running` agent node — the
// shape an orphaned run leaves behind once it had dispatched an agent. The sweep
// must normalise BOTH the run row (→ interrupted) and the zombie agent node
// (→ failed with completed_at + error), so the TUI never renders a live agent
// icon on a terminal run (Fund 15).
function seedRunningRowWithAgent(id: string, directory: string) {
  return Effect.gen(function* () {
    const { db } = yield* Database.Service
    const now = Date.now()
    yield* db
      .insert(WorkflowRunTable)
      .values({
        id,
        workflow: HELLO_FIXTURE,
        status: "running",
        started_at: now,
        directory,
        current_phase: "run",
        logs: [],
        agents: [
          { id: "1", status: "running", started_at: now, phase: "run", prompt: "hang" },
          { id: "2", status: "completed", started_at: now, completed_at: now, phase: "run", prompt: "done" },
        ],
      })
      .run()
      .pipe(Effect.orDie)
  })
}

function fetchRunRow(id: string) {
  return Effect.gen(function* () {
    const { db } = yield* Database.Service
    const row = yield* db.select().from(WorkflowRunTable).where(eq(WorkflowRunTable.id, id)).get().pipe(Effect.orDie)
    return row ?? (yield* Effect.fail(new Error(`row ${id} not found`)))
  })
}

// Reads the RAW `result` column text (bypassing any json decode) so a test can
// prove how the engine serialised it: SQL-NULL (never set) vs the literal JSON
// text `"null"` (a real null result) — the distinction Fund 42 turns on.
function fetchRawResult(id: string) {
  return Effect.gen(function* () {
    const { db } = yield* Database.Service
    const row = yield* db
      .select({ raw: sql<string | null>`${WorkflowRunTable.result}` })
      .from(WorkflowRunTable)
      .where(eq(WorkflowRunTable.id, id))
      .get()
      .pipe(Effect.orDie)
    return row?.raw ?? null
  })
}

// Seeds a completed run whose persisted `definition.meta` is supplied RAW —
// bypassing the engine so a test can pin EXACTLY how an older/foreign branch
// would have left the row's phases on disk (bare strings, malformed shapes,
// etc.). The `as never` casts thread an arbitrary on-disk JSON shape past the
// strongly-typed `WorkflowDefinitionRow` column type — the whole point is to
// reproduce a row the current row-type would never WRITE but might still READ.
function seedRowWithRawMeta(id: string, directory: string, meta: unknown) {
  return Effect.gen(function* () {
    const { db } = yield* Database.Service
    const now = Date.now()
    yield* db
      .insert(WorkflowRunTable)
      .values({
        id,
        workflow: HELLO_FIXTURE,
        status: "completed",
        started_at: now,
        completed_at: now,
        directory,
        logs: [],
        agents: [],
        definition: { name: HELLO_FIXTURE, path: "/p/.opencode/workflows/hello.js", meta } as never,
      })
      .run()
      .pipe(Effect.orDie)
  })
}

// Seeds a fully finished run (with log + agent telemetry) straight into the DB.
// Because it never went through start(), it has NO live registry entry, so
// get() is forced through the DB->fromRow path — no test-only seam required.
function seedCompletedRow(id: string, directory: string) {
  return Effect.gen(function* () {
    const { db } = yield* Database.Service
    const now = Date.now()
    yield* db
      .insert(WorkflowRunTable)
      .values({
        id,
        workflow: HELLO_FIXTURE,
        status: "completed",
        started_at: now,
        completed_at: now,
        directory,
        current_phase: "run",
        logs: [{ time: now, phase: "run", message: "running" }],
        agents: [
          {
            id: "1",
            status: "completed",
            started_at: now,
            completed_at: now,
            phase: "run",
            // Item 16: the per-call display label must survive the DB→fromRow
            // roundtrip like the rest of the node's telemetry.
            label: "seeded label",
            // Item 7: the isolated-worktree location must survive the roundtrip
            // so a preserved worktree stays inspectable.
            worktree: "/tmp/oc-wf-seeded",
            prompt: "do the thing",
            output: "did the thing",
            // Fund 51: per-agent telemetry (cost USD + tokens incl. `total`) must
            // survive the DB→fromRow roundtrip, not just status/output. Seeded with
            // non-zero values so a roundtrip that drops them would be observable.
            cost: 0.42,
            tokens: { total: 99, input: 11, output: 22, reasoning: 33, cache: { read: 44, write: 55 } },
          },
        ],
        // The `result` column is plain text and the engine owns its JSON codec
        // (Fund 42), so a seed must serialize exactly like persistRun does — a raw
        // object would fail the bind. The roundtrip test reads this back through
        // fromRow, which JSON-parses it.
        result: JSON.stringify({ ok: true }),
      })
      .run()
      .pipe(Effect.orDie)
  })
}

async function writeWorkflow(dir: string, name: string, body: string, ext = "js") {
  await Bun.write(path.join(dir, ".opencode", "workflows", `${name}.${ext}`), body)
}

import os from "os"

// A workflow whose TOP-LEVEL body writes a marker file the moment the module is
// imported and executed. list()/discover() must NEVER produce this marker
// (static meta extraction only); start() must, because it really imports the
// target module after the permission gate.
const SIDE_EFFECT_FIXTURE = "side-effect"
function sideEffectWorkflow(markerPath: string) {
  return `await Bun.write(${JSON.stringify(markerPath)}, "executed")
export const meta = { name: "SideEffect", description: "writes a marker on import" }
export async function run(args, ctx) { return { ok: true } }
`
}

const STEP2_MARKER = "step-2-reached"
const SLOW_FIXTURE = "slow"

// Fixture-Workflow: ein absichtlich blockierender Agent-Schritt, danach ein
// zweiter Schritt (STEP2_MARKER), der bei korrekter Cancellation NIE läuft.
const SLOW_WORKFLOW = `export const meta = { name: "${SLOW_FIXTURE}", phases: ["agent", "after"] }
export async function run(args, ctx) {
  ctx.setPhase("agent")
  ctx.log("step-1-started")
  await ctx.agent({ prompt: "hang" })
  ctx.setPhase("after")
  ctx.log("${STEP2_MARKER}")
  return { ok: true }
}
`

// Subagent-permission-inheritance fixture (#26514 regression / Fund N9): a
// single agent step that completes. The engine must spawn its child session
// with a derived `permission` ruleset when a `caller` context is supplied.
const SINGLE_AGENT_FIXTURE = "single-agent"
const SINGLE_AGENT_WORKFLOW = `export const meta = { name: "${SINGLE_AGENT_FIXTURE}", phases: ["run"] }
export async function run(args, ctx) {
  ctx.setPhase("run")
  await ctx.agent({ prompt: "do the thing" })
  return { ok: true }
}
`

// Per-step reasoning variant fixture (Task 6): a single agent step that passes a
// `variant` through to the engine. The engine must thread that variant into the
// underlying prompt run (PromptInput.variant) unchanged.
const VARIANT_FIXTURE = "variant-step"
const VARIANT_WORKFLOW = `export const meta = { name: "${VARIANT_FIXTURE}", phases: ["run"] }
export async function run(args, ctx) {
  ctx.setPhase("run")
  await ctx.agent({ prompt: "hi", variant: "max" })
  return { ok: true }
}
`

// model:"small" fixture (Task 7): a single agent step that requests the magic
// "small" model. The engine must resolve this to the configured small_model and
// dispatch the prompt against that provider/model.
const SMALL_MODEL_FIXTURE = "small-model-step"
const SMALL_MODEL_WORKFLOW = `export const meta = { name: "${SMALL_MODEL_FIXTURE}", phases: ["run"] }
export async function run(args, ctx) {
  ctx.setPhase("run")
  await ctx.agent({ prompt: "hi", model: "small" })
  return { ok: true }
}
`

// Per-phase default model fixture (Task 15): a structured phase declares a
// default `model`. The first ctx.agent call (no explicit model) must resolve to
// that phase default; the second call passes an EXPLICIT model that must win over
// the phase default.
const PHASE_MODEL_FIXTURE = "phase-model"
const PHASE_MODEL_WORKFLOW = `export const meta = {
  name: "${PHASE_MODEL_FIXTURE}",
  phases: ["plan", { title: "verify", model: "stub/mini" }]
}
export async function run(args, ctx) {
  ctx.setPhase("verify")
  await ctx.agent({ prompt: "hi" })
  await ctx.agent({ prompt: "hi", model: "other/explicit" })
  return { ok: true }
}
`

// Item 16 (a): a per-call `phase` pins the step's node to that phase regardless
// of where setPhase has moved the run's current phase in the meantime — the
// deterministic core of the parallel/pipeline race the option closes.
const PERCALL_PHASE_FIXTURE = "percall-phase"
const PERCALL_PHASE_WORKFLOW = `export const meta = { name: "${PERCALL_PHASE_FIXTURE}", phases: ["a", "b"] }
export async function run(args, ctx) {
  ctx.setPhase("a")
  ctx.setPhase("b")
  await ctx.agent({ prompt: "pinned", phase: "a" })
  await ctx.agent({ prompt: "unpinned" })
  return { ok: true }
}
`

// Item 16 (b): a per-call phase that is DECLARED with a model resolves that model
// as the call's default; an explicit model still wins; and a per-call phase
// WITHOUT a declared model never inherits the global current phase's model.
const PERCALL_PHASE_MODEL_FIXTURE = "percall-phase-model"
const PERCALL_PHASE_MODEL_WORKFLOW = `export const meta = {
  name: "${PERCALL_PHASE_MODEL_FIXTURE}",
  phases: ["x", { title: "y", model: "stub/mini" }]
}
export async function run(args, ctx) {
  await ctx.agent({ prompt: "a", phase: "y" })
  await ctx.agent({ prompt: "b", phase: "y", model: "other/explicit" })
  ctx.setPhase("y")
  await ctx.agent({ prompt: "c", phase: "x" })
  return { ok: true }
}
`

// Item 16 (c): `label` is a per-call display name persisted on the agent node.
const LABEL_FIXTURE = "label-step"
const LABEL_WORKFLOW = `export const meta = { name: "${LABEL_FIXTURE}", phases: ["run"] }
export async function run(args, ctx) {
  ctx.setPhase("run")
  await ctx.agent({ prompt: "hi", label: "Find the bug" })
  return { ok: true }
}
`

// Item 16 (d): a nested ctx.workflow child's per-call phase is logPrefix-ed
// exactly like its setPhase would be.
const PERCALL_CHILD_FIXTURE = "percall-child"
const PERCALL_CHILD_WORKFLOW = `export const meta = { name: "${PERCALL_CHILD_FIXTURE}", phases: ["p"] }
export async function run(args, ctx) {
  await ctx.agent({ prompt: "child step", phase: "p" })
  return { ok: true }
}
`
const PERCALL_PARENT_FIXTURE = "percall-parent"
const PERCALL_PARENT_WORKFLOW = `export const meta = { name: "${PERCALL_PARENT_FIXTURE}", description: "pp" }
export async function run(_a, ctx) {
  return await ctx.workflow("${PERCALL_CHILD_FIXTURE}", {})
}
`

// Item 12 fixtures: model inheritance from the caller session. A DEFAULT-agent
// step (no `agent:` override) with no explicit/phase model resolves to the
// run's caller_model; an explicitly chosen agent does NOT inherit it.
const CALLER_MODEL_FIXTURE = "caller-model"
const CALLER_MODEL_WORKFLOW = `export const meta = { name: "${CALLER_MODEL_FIXTURE}", phases: ["run"] }
export async function run(args, ctx) {
  ctx.setPhase("run")
  await ctx.agent({ prompt: "default-step" })
  await ctx.agent({ prompt: "explicit-agent-step", agent: "general" })
  return { ok: true }
}
`
// A declared phase model must still WIN over the caller model (the new tier
// sits between phase model and the agent's own model).
const CALLER_PHASE_FIXTURE = "caller-phase-model"
const CALLER_PHASE_WORKFLOW = `export const meta = {
  name: "${CALLER_PHASE_FIXTURE}",
  phases: [{ title: "verify", model: "stub/mini" }]
}
export async function run(args, ctx) {
  ctx.setPhase("verify")
  await ctx.agent({ prompt: "hi" })
  return { ok: true }
}
`

// Item 15 fixtures: a human skip resolves the in-flight ctx.agent call to null.
const SKIP_FIXTURE = "skip-step"
const SKIP_WORKFLOW = `export const meta = { name: "${SKIP_FIXTURE}", phases: ["run"] }
export async function run(args, ctx) {
  ctx.setPhase("run")
  const r = await ctx.agent({ prompt: "hang" })
  return { skipped: r === null }
}
`

// Item 15 (pre-dispatch skip): args.count parallel agent steps. With count =
// run-concurrency-cap + 1 the LAST step's node exists while its dispatch still
// waits for a semaphore permit — the deterministic window for a skip that lands
// BEFORE the step's prompt dispatches.
const SKIP_PARALLEL_FIXTURE = "skip-parallel"
const SKIP_PARALLEL_WORKFLOW = `export const meta = { name: "${SKIP_PARALLEL_FIXTURE}", phases: ["run"], arguments: { count: { type: "number" } } }
export async function run(args, ctx) {
  ctx.setPhase("run")
  const tasks = []
  for (let i = 0; i < args.count; i++) tasks.push(() => ctx.agent({ prompt: "hang " + i }))
  const results = await ctx.parallel(tasks)
  return { allNull: results.every((r) => r === null) }
}
`

// Item 15 (onError:"null"): a failing step resolves null; the body branches.
const ONERROR_NULL_FIXTURE = "onerror-null"
const ONERROR_NULL_WORKFLOW = `export const meta = { name: "${ONERROR_NULL_FIXTURE}", phases: ["run"] }
export async function run(args, ctx) {
  ctx.setPhase("run")
  const r = await ctx.agent({ prompt: "boom", onError: "null" })
  return { isNull: r === null }
}
`

// Item 15 (budget carve-out): onError:"null" must NOT swallow budget exhaustion.
const ONERROR_BUDGET_FIXTURE = "onerror-budget"
const ONERROR_BUDGET_WORKFLOW = `export const meta = { name: "${ONERROR_BUDGET_FIXTURE}", phases: ["run"] }
export async function run(args, ctx) {
  ctx.setPhase("run")
  await ctx.agent({ prompt: "gated", onError: "null" })
  return { ok: true }
}
`

// Undeclared-phase fixture (Task 15): setPhase on a phase NOT in meta.phases is
// allowed (no error) but logs a warning. The run still completes.
const UNDECLARED_PHASE_FIXTURE = "undeclared-phase"
const UNDECLARED_PHASE_WORKFLOW = `export const meta = { name: "${UNDECLARED_PHASE_FIXTURE}", phases: ["plan"] }
export async function run(args, ctx) {
  ctx.setPhase("undeclared")
  return { ok: true }
}
`

// Per-step tools-scoping fixture (Task 8): a single agent step that passes a
// `tools` whitelist/blacklist. The engine must thread that Record<string,boolean>
// through to the prompt run (PromptInput.tools) unchanged so the session scopes
// its tools accordingly.
const TOOLS_FIXTURE = "tools-step"
const TOOLS_WORKFLOW = `export const meta = { name: "${TOOLS_FIXTURE}", phases: ["run"] }
export async function run(args, ctx) {
  ctx.setPhase("run")
  await ctx.agent({ prompt: "hi", tools: { webfetch: false } })
  return { ok: true }
}
`

// Security-compose fixture: a single agent step that tries to RE-GRANT a tool
// (\`edit\`) the inherited caller permission denies (Plan Mode). The per-step
// grant must NOT override the inherited deny — the composed child-session
// ruleset must still deny \`edit\`.
const TOOLS_REGRANT_FIXTURE = "tools-regrant-step"
const TOOLS_REGRANT_WORKFLOW = `export const meta = { name: "${TOOLS_REGRANT_FIXTURE}", phases: ["run"] }
export async function run(args, ctx) {
  ctx.setPhase("run")
  await ctx.agent({ prompt: "hi", tools: { edit: true } })
  return { ok: true }
}
`

// Per-step skills fixture (Task 9): a single agent step that requests specific
// skills. opencode only loads skills via the runtime \`skill\` tool, so the engine
// prepends a load directive to the prompt and enables the skill tool for the step.
const SKILLS_FIXTURE = "skills-step"
const SKILLS_WORKFLOW = `export const meta = { name: "${SKILLS_FIXTURE}", phases: ["run"] }
export async function run(args, ctx) {
  ctx.setPhase("run")
  await ctx.agent({ prompt: "do it", skills: ["pdf", "xlsx"] })
  return { ok: true }
}
`

// Declarative file-attachments fixture (Task 10): a single agent step that
// attaches an existing file by path. The engine must resolve the path relative
// to the run's workspace directory and append a file part after the text part.
const FILES_FIXTURE = "files-step"
const FILES_WORKFLOW = `export const meta = { name: "${FILES_FIXTURE}", phases: ["run"] }
export async function run(args, ctx) {
  ctx.setPhase("run")
  await ctx.agent({ prompt: "hi", files: ["./ATTACH.md"] })
  return { ok: true }
}
`

// Missing-file variant of the Task 10 fixture: a non-existent attachment must
// fail the run with a WorkflowInvalidError naming the missing file.
const FILES_MISSING_FIXTURE = "files-missing-step"
const FILES_MISSING_WORKFLOW = `export const meta = { name: "${FILES_MISSING_FIXTURE}", phases: ["run"] }
export async function run(args, ctx) {
  ctx.setPhase("run")
  await ctx.agent({ prompt: "hi", files: ["./DOES_NOT_EXIST.md"] })
  return { ok: true }
}
`

// Directory variant of the Task 10 fixture: an attachment path that resolves to a
// DIRECTORY (not a regular file) must fail the run the same way a missing file
// does. This pins the corrected portable `exists` check (fs.stat().isFile()),
// which preserves the prior `Bun.file(dir).exists()` -> false semantics — a
// directory is never an attachable source.
const FILES_DIR_FIXTURE = "files-dir-step"
const FILES_DIR_WORKFLOW = `export const meta = { name: "${FILES_DIR_FIXTURE}", phases: ["run"] }
export async function run(args, ctx) {
  ctx.setPhase("run")
  await ctx.agent({ prompt: "hi", files: ["./ATTACH_DIR"] })
  return { ok: true }
}
`

// Task 11: a single agent step requesting worktree isolation. When the workspace
// is a git repository the engine runs the subagent inside a fresh `git worktree`
// (auto-cleaned on the run scope); a non-git workspace fails the step with a
// WorkflowInvalidError naming the missing git repository.
const ISOLATION_FIXTURE = "isolation-step"
const ISOLATION_WORKFLOW = `export const meta = { name: "${ISOLATION_FIXTURE}", phases: ["run"] }
export async function run(args, ctx) {
  ctx.setPhase("run")
  await ctx.agent({ prompt: "hi", isolation: "worktree" })
  return { ok: true }
}
`

// Task 11a (deterministic non-LLM shell step): ctx.shell runs a command in the
// run's workspace and returns { output, exitCode } WITHOUT consuming an LLM turn
// or budget. A non-zero exit is mapped to the return value (never thrown), and
// ctx.budget.spent() stays 0 because shell never touches the cost accumulator.
const SHELL_FIXTURE = "shell-step"
const SHELL_WORKFLOW = `export const meta = { name: "${SHELL_FIXTURE}", phases: ["run"] }
export async function run(_args, ctx) {
  ctx.setPhase("run")
  const ok = await ctx.shell("echo hello-workflow")
  const fail = await ctx.shell("exit 3")
  return { out: ok.output.trim(), okCode: ok.exitCode, failCode: fail.exitCode, spent: ctx.budget.spent() }
}
`

// Task 11a (real timeout): ctx.shell with a short timeout kills a hung command and
// resolves PROMPTLY with a non-zero exitCode (not a hang, not a throw). The fixture
// records elapsed wall-clock so the test can prove the timeout fired well before
// the command's natural duration.
const SHELL_TIMEOUT_FIXTURE = "shell-timeout-step"
const SHELL_TIMEOUT_WORKFLOW = `export const meta = { name: "${SHELL_TIMEOUT_FIXTURE}", phases: ["run"] }
export async function run(_args, ctx) {
  ctx.setPhase("run")
  const started = Date.now()
  const r = await ctx.shell("sleep 5", { timeout: 100 })
  const elapsed = Date.now() - started
  return { exitCode: r.exitCode, elapsed }
}
`

// Finding 5: a ctx.shell with NO timeout must have its OS child reaped when the
// run is cancelled/paused (the scope-close path). The shell command writes a
// "running" marker immediately so the test can synchronize on the child being
// live, then sleeps, then writes a "leaked" marker. If the child were orphaned on
// cancel (the bug), the leaked marker would appear ~after the sleep; with the fix
// the child is SIGTERMed on interruption so the leaked marker is NEVER written.
// The markers' paths come from args so the test controls them.
const SHELL_LEAK_FIXTURE = "shell-leak-step"
const SHELL_LEAK_WORKFLOW = `export const meta = { name: "${SHELL_LEAK_FIXTURE}", phases: ["run"], arguments: { running: { type: "string" }, leaked: { type: "string" } } }
export async function run(args, ctx) {
  ctx.setPhase("run")
  // No timeout: only a scope-close interrupt (cancel/pause) can stop this.
  await ctx.shell("touch '" + args.running + "'; sleep 3; touch '" + args.leaked + "'")
  return { ok: true }
}
`

// Item 23 (Stufe 1): ctx.shell under the permission gate. The command (`rm
// <target>`) targets a RELATIVE path inside the workspace so no
// external_directory ask fires — only the bash permission, evaluated against
// the caller session's ruleset.
const SHELL_GATE_FIXTURE = "shell-gate"
const SHELL_GATE_WORKFLOW = `export const meta = { name: "${SHELL_GATE_FIXTURE}", phases: ["run"], arguments: { command: { type: "string" } } }
export async function run(args, ctx) {
  ctx.setPhase("run")
  const r = await ctx.shell(args.command)
  return { code: r.exitCode, out: r.output.trim() }
}
`

// Task 11b (depth-1 nesting): a parent workflow runs a DISCOVERED child workflow
// inline via ctx.workflow under the SAME run (no second run row). The child's
// logs are prefixed (`child: ...`) and its result flows back to the parent.
const NEST_CHILD_FIXTURE = "child"
const NEST_CHILD_WORKFLOW = `export const meta = { name: "${NEST_CHILD_FIXTURE}", description: "c" }
export async function run(args, ctx) {
  ctx.log("child-ran")
  return { doubled: Number(args.n) * 2 }
}
`
const NEST_PARENT_FIXTURE = "parent"
const NEST_PARENT_WORKFLOW = `export const meta = { name: "${NEST_PARENT_FIXTURE}", description: "p" }
export async function run(_a, ctx) {
  const r = await ctx.workflow("child", { n: 21 })
  return { fromChild: r.doubled }
}
`

// Task 11b (phase restore): a child that sets its own phase must NOT leak it back
// to the parent. The parent sets "plan", runs a child that sets "research", then
// logs again — that final parent log must carry the parent's "plan" phase, not the
// child's leftover "child-phase: research".
const NEST_PHASE_CHILD_FIXTURE = "phase-child"
const NEST_PHASE_CHILD_WORKFLOW = `export const meta = { name: "${NEST_PHASE_CHILD_FIXTURE}", description: "pc" }
export async function run(args, ctx) {
  ctx.setPhase("research")
  ctx.log("inside-child")
  return { ok: true }
}
`
const NEST_PHASE_PARENT_FIXTURE = "phase-parent"
const NEST_PHASE_PARENT_WORKFLOW = `export const meta = { name: "${NEST_PHASE_PARENT_FIXTURE}", description: "pp" }
export async function run(_a, ctx) {
  ctx.setPhase("plan")
  await ctx.workflow("phase-child", {})
  ctx.log("after-nested")
  return { ok: true }
}
`

// Task 11b (depth guard): a child that ITSELF calls ctx.workflow must be refused —
// nesting is limited to depth 1, so the nested call throws a WorkflowInvalidError
// and the run fails with that error.
const NEST_GRANDCHILD_FIXTURE = "grandchild"
const NEST_GRANDCHILD_WORKFLOW = `export const meta = { name: "${NEST_GRANDCHILD_FIXTURE}", description: "gc" }
export async function run(args, ctx) { return { ok: true } }
`
const NEST_DEEP_CHILD_FIXTURE = "deep-child"
const NEST_DEEP_CHILD_WORKFLOW = `export const meta = { name: "${NEST_DEEP_CHILD_FIXTURE}", description: "dc" }
export async function run(args, ctx) {
  // depth-2 attempt: this nested ctx.workflow must throw.
  return await ctx.workflow("grandchild", {})
}
`
const NEST_DEEP_PARENT_FIXTURE = "deep-parent"
const NEST_DEEP_PARENT_WORKFLOW = `export const meta = { name: "${NEST_DEEP_PARENT_FIXTURE}", description: "dp" }
export async function run(_a, ctx) {
  return await ctx.workflow("deep-child", {})
}
`

// Task 11b (c) (shared agent-lifetime cap): a parent that dispatches one agent and
// then runs a child that dispatches more — collectively exceeding the run's
// (test-lowered) agent-lifetime cap. The cap is shared via the SAME run, so the
// over-cap dispatch (inside the child) fails the WHOLE run with AgentLimitError.
const NEST_AGENT_CHILD_FIXTURE = "agent-child"
const NEST_AGENT_CHILD_WORKFLOW = `export const meta = { name: "${NEST_AGENT_CHILD_FIXTURE}", description: "ac" }
export async function run(args, ctx) {
  for (let i = 0; i < args.count; i++) await ctx.agent({ prompt: "child step " + i })
  return { ok: true }
}
`
const NEST_AGENT_PARENT_FIXTURE = "agent-parent"
const NEST_AGENT_PARENT_WORKFLOW = `export const meta = { name: "${NEST_AGENT_PARENT_FIXTURE}", description: "ap" }
export async function run(_a, ctx) {
  await ctx.agent({ prompt: "parent step" })
  return await ctx.workflow("agent-child", { count: 10 })
}
`

// Prompt-ops that resolve every agent prompt immediately (no hang), so the run
// reaches `completed` and the child session is fully created/projected.
function immediatePromptOps() {
  const ops: { prompt: SessionPrompt.Interface["prompt"]; cancel: SessionPrompt.Interface["cancel"] } = {
    prompt: () => Effect.succeed(assistantReply()),
    cancel: () => Effect.void,
  }
  return ops
}

// Capturing prompt-ops: resolve every agent prompt immediately (like
// immediatePromptOps) but capture each real (non-noReply) PromptInput so a test
// can assert on what the engine actually dispatched (e.g. its resolved `variant`
// or `model`). The initial "Workflow started" noReply message is skipped so only
// genuine ctx.agent dispatches are recorded. Named distinctly from the journal
// `recordingPromptOps` below so the two never collide via function hoisting.
function capturingPromptOps() {
  const inputs: SessionPrompt.PromptInput[] = []
  const ops: { prompt: SessionPrompt.Interface["prompt"]; cancel: SessionPrompt.Interface["cancel"] } = {
    prompt: (input) =>
      Effect.sync(() => {
        if (!input.noReply) inputs.push(input)
        return assistantReply()
      }),
    cancel: () => Effect.void,
  }
  return { ops, inputs }
}

// Directory-capturing prompt-ops: like capturingPromptOps, but for each real
// (non-noReply) dispatch it ALSO records the EFFECTIVE instance directory the
// prompt runs under (`InstanceState.directory`). This is the directory the
// subagent's file tools (bash/edit/write/read) resolve their cwd against — so
// recording it from INSIDE the prompt-op Effect proves whether worktree
// isolation actually redirects the child (the assertion target for Task 11),
// not merely that a worktree was created.
function directoryCapturingPromptOps() {
  const inputs: SessionPrompt.PromptInput[] = []
  const directories: string[] = []
  // Whether the captured directory contained a `.git` entry AT DISPATCH TIME
  // (i.e. while the worktree was still live) — proving it was a real git
  // worktree, observed before the run-scope finalizer removes it.
  const wasGitWorktree: boolean[] = []
  // The directory's permission bits (mode & 0o777) AT DISPATCH TIME — used by
  // Finding 3 to prove the private worktree base is 0700, not world-readable.
  const modes: number[] = []
  const ops: { prompt: SessionPrompt.Interface["prompt"]; cancel: SessionPrompt.Interface["cancel"] } = {
    prompt: (input) =>
      Effect.gen(function* () {
        if (!input.noReply) {
          inputs.push(input)
          const dir = yield* InstanceState.directory
          directories.push(dir)
          wasGitWorktree.push(
            yield* Effect.promise(() =>
              fs
                .stat(path.join(dir, ".git"))
                .then(() => true)
                .catch(() => false),
            ),
          )
          modes.push(
            yield* Effect.promise(() =>
              fs
                .stat(dir)
                .then((s) => s.mode & 0o777)
                .catch(() => -1),
            ),
          )
        }
        return assistantReply()
      }),
    cancel: () => Effect.void,
  }
  return { ops, inputs, directories, wasGitWorktree, modes }
}

// Item 15: prompt-ops whose agent prompts FAIL (the noReply start banner still
// succeeds so the run gets going). Drives the onError:"null" settlement.
function failingPromptOps() {
  const ops: Workflow.PromptOps = {
    prompt: (input) => (input.noReply ? Effect.succeed(assistantReply()) : Effect.fail(new Error("boom"))),
    cancel: () => Effect.void,
  }
  return ops
}

// Item 7: like directoryCapturingPromptOps, but each real dispatch ALSO writes
// an (uncommitted) file into the effective directory — making an isolated
// worktree DIRTY so the run finalizer must preserve it instead of removing it.
function dirtyingPromptOps() {
  const directories: string[] = []
  const ops: { prompt: SessionPrompt.Interface["prompt"]; cancel: SessionPrompt.Interface["cancel"] } = {
    prompt: (input) =>
      Effect.gen(function* () {
        if (!input.noReply) {
          const dir = yield* InstanceState.directory
          directories.push(dir)
          yield* Effect.promise(() => fs.writeFile(path.join(dir, "UNCOMMITTED.txt"), "dirty"))
        }
        return assistantReply()
      }),
    cancel: () => Effect.void,
  }
  return { ops, directories }
}

// N11-Fixture: Der Body startet einen Agenten OHNE ihn zu awaiten (fire-and-
// forget) — der hängende ctx.agent-Promise settelt nie vor Body-Ende — und
// returnt sofort. Die Pause gibt dem dispatchten Agent-Fiber Zeit, seine
// Child-Session zu erzeugen/registrieren und am hängenden Prompt zu blockieren,
// BEVOR der Body zurückkehrt und der Run als `completed` finished. So bleibt ein
// Agent-Node beim Terminal-Übergang noch `running` OHNE Autor-Fehlverhalten.
//
// Die Session-Erzeugung läuft als geforkter Fiber im run-Scope (asynchron, NACH
// dem synchronen Node-Push). Unter Last (volle Suite parallel) kann ein zu
// kurzes Fenster diesen Fiber verhungern lassen, bevor node.session_id gesetzt
// ist — dann fände finish() den Node zwar noch `running`, aber ohne Session zum
// Abbrechen, und die Session-Assertion des Tests flackerte. 400ms gibt dem Fork
// auch unter Contention zuverlässig Zeit; der hängende Prompt (30s-Race im Fake)
// stellt sicher, dass der Node beim Body-Ende dennoch `running` ist.
const DETACHED_AGENT_FIXTURE = "detached-agent"
const DETACHED_AGENT_WORKFLOW = `export const meta = { name: "${DETACHED_AGENT_FIXTURE}", phases: ["run"] }
export async function run(args, ctx) {
  ctx.setPhase("run")
  // Bewusst NICHT awaiten: der Promise hängt am Prompt, der Body returnt davor.
  void ctx.agent({ prompt: "hang" }).catch(() => {})
  await new Promise((resolve) => setTimeout(resolve, 400))
  return { ok: true }
}
`

// Fund 42-Fixtures: ein Workflow, der explizit `null` returnt, und einer, der
// gar nichts returnt (undefined). Beide müssen den DB-Roundtrip unterscheidbar
// überleben: null bleibt null, undefined bleibt undefined.
const NULL_RESULT_FIXTURE = "null-result"
const NULL_RESULT_WORKFLOW = `export const meta = { name: "${NULL_RESULT_FIXTURE}", phases: ["run"] }
export async function run(args, ctx) { ctx.setPhase("run"); return null }
`
const VOID_RESULT_FIXTURE = "void-result"
const VOID_RESULT_WORKFLOW = `export const meta = { name: "${VOID_RESULT_FIXTURE}", phases: ["run"] }
export async function run(args, ctx) { ctx.setPhase("run") }
`

// A minimal single-phase, zero-agent workflow used by the bus-event test: it sets
// the phase and returns a value, so the run goes running -> completed through the
// same persistRun choke-point every state write uses — no provider stubbing needed.
const EVENTS_FIXTURE = "events"
const EVENTS_WORKFLOW = `export const meta = { name: "${EVENTS_FIXTURE}", phases: ["run"] }
export async function run(args, ctx) { ctx.setPhase("run"); return { ok: true } }
`

// Finding 15: a fixture that dispatches TWO agents — one that COMPLETES (plaintext)
// and one with a schema that FAILS (no structured output, caught by the body) — so
// the run still ends `completed` but with a NON-trivial agents split: total 2,
// failed 1, running 0. This makes the slim-payload `agents` COUNT object falsifiable
// (the zero-agent EVENTS fixture could not distinguish a swapped running/failed
// filter from the all-zero case).
const EVENTS_AGENTS_FIXTURE = "events-agents"
const EVENTS_AGENTS_WORKFLOW = `export const meta = { name: "${EVENTS_AGENTS_FIXTURE}", phases: ["run"] }
export async function run(args, ctx) {
  ctx.setPhase("run")
  await ctx.agent({ prompt: "completes" })
  try {
    await ctx.agent({ prompt: "fails", schema: { type: "object" } })
  } catch (e) {}
  return { ok: true }
}
`

// Finding 15 prompt-ops: a schema request (input.format set) returns a message
// with NO structured output → the engine fails that node (failed). A plain request
// returns a normal reply → that node completes. Net: one completed + one failed
// agent node on a run the body still completes.
function eventsAgentsPromptOps(db: Database.Interface["db"]) {
  const ops: { prompt: SessionPrompt.Interface["prompt"]; cancel: SessionPrompt.Interface["cancel"] } = {
    prompt: (input) =>
      Effect.gen(function* () {
        if (input.noReply) return assistantReply()
        const wantsSchema = input.format?.type === "json_schema"
        const last = yield* persistTurns(db, input.sessionID, [
          { cost: 0, tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } } },
        ])
        // Schema agent: no `structured` → engine marks the node failed. Plain agent:
        // a text part → node completes.
        const parts = wantsSchema ? [] : [{ type: "text", text: "done" }]
        return { info: last.info, parts } as unknown as SessionV1.WithParts
      }),
    cancel: () => Effect.void,
  }
  return ops
}

// N2/N13-Fixture: ein Workflow, dessen Rückgabewert NICHT strukturell klonbar ist
// (eine Funktion ist weder JSON-serialisierbar noch structuredClone-fähig). Der
// frühere structuredClone-Snapshot warf hier (DOMException) und strandete jeden
// no-timeout-wait() / verhinderte den Terminal-Persist. Der Engine normalisiert
// das result jetzt über denselben JSON-Codec wie der Persist: Funktionen werden
// (wie bei JSON.stringify) still verworfen, der Run schließt sauber ab, und
// Live-Snapshot wie DB-Row tragen dieselbe (entfunktionalisierte) Form.
const UNSERIALIZABLE_RESULT_FIXTURE = "unserializable-result"
const UNSERIALIZABLE_RESULT_WORKFLOW = `export const meta = { name: "${UNSERIALIZABLE_RESULT_FIXTURE}", phases: ["run"] }
export async function run(args, ctx) { ctx.setPhase("run"); return { kept: 1, cb: () => {} } }
`

// N2/N13-Fixture: ein Workflow, dessen Rückgabewert eine ZIRKULÄRE Referenz hat —
// JSON.stringify wirft darauf (TypeError). Der mit Effect.try abgesicherte
// Normalisierungspfad muss den Run dennoch terminal abschließen und das result
// auf den $unserializable-Platzhalter setzen, statt zu hängen.
const CIRCULAR_RESULT_FIXTURE = "circular-result"
const CIRCULAR_RESULT_WORKFLOW = `export const meta = { name: "${CIRCULAR_RESULT_FIXTURE}", phases: ["run"] }
export async function run(args, ctx) { ctx.setPhase("run"); const r = { a: 1 }; r.self = r; return r }
`

function assistantReply(): SessionV1.WithParts {
  return { info: { role: "assistant" }, parts: [] } as unknown as SessionV1.WithParts
}

// Deterministic concurrency barrier shared with a workflow module's body.
// `loadModule` imports the workflow into the SAME process, and Bun shares
// `globalThis` across dynamically imported modules (verified), so a barrier
// registered here under a unique token is reachable from the workflow body via
// `globalThis.__workflowTestBarriers[token]`. Every task entering the barrier
// bumps a live `active` counter (tracking `peak`) and then parks on a single
// shared gate Promise until the test releases it. This replaces wall-clock
// `setTimeout` windows (Fund 48): a task's overlap is observed by polling the
// `active` counter for a CONDITION (e.g. "20 tasks parked"), never by sleeping a
// fixed duration and hoping the tasks happened to overlap. The gate keeps every
// in-flight task suspended until the test has observed the peak, so the measured
// concurrency is exactly the engine's scheduling decision, not a timing artifact.
type TestBarrier = {
  active: number
  peak: number
  /** Resolves when the test releases the gate; tasks await this before exiting. */
  gate: Promise<void>
  release: () => void
  /** Per-key ordered markers a task can push (used by the no-barrier pipeline proof). */
  order: string[]
}

declare global {
  // `var` (not `const`) is required for a writable global so the body and the
  // test can assign `globalThis.__workflowTestBarriers`.
  var __workflowTestBarriers: Record<string, TestBarrier> | undefined
}

// Installs a fresh barrier under a unique token and returns the token plus an
// Effect that polls until at least `count` tasks are simultaneously parked on the
// gate (the deterministic "tasks have overlapped" condition) and reports the peak.
function installBarrier() {
  const token = `barrier_${Math.random().toString(16).slice(2)}`
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const barrier: TestBarrier = { active: 0, peak: 0, gate, release, order: [] }
  ;(globalThis.__workflowTestBarriers ??= {})[token] = barrier
  return {
    token,
    barrier,
    // Waits until `peak` has reached `count` (i.e. that many tasks have been
    // simultaneously parked at the gate at some point), then yields the barrier.
    awaitPeak: (count: number) =>
      pollWithTimeout(
        Effect.sync(() => (barrier.peak >= count ? barrier : undefined)),
        `barrier never reached peak ${count}`,
      ),
    // Waits until an exact ordered marker has been recorded by a task.
    awaitOrder: (marker: string) =>
      pollWithTimeout(
        Effect.sync(() => (barrier.order.includes(marker) ? barrier : undefined)),
        `barrier never recorded order marker ${marker}`,
      ),
  }
}

// The body-side latch helper, inlined as source text into every barrier fixture
// (the workflow module runs in its own import; it cannot import test helpers).
// A task: bumps active/peak, parks on the gate, then decrements active on the way
// out. `enter`/`leave` are split so a pipeline stage can record order between them.
const BARRIER_PRELUDE = `
  const __b = globalThis.__workflowTestBarriers[args.__barrier]
  const __enter = () => { __b.active++; __b.peak = Math.max(__b.peak, __b.active) }
  const __leave = () => { __b.active-- }
  const __park = async () => { await __b.gate }
`

// Parallel barrier fixture: N tasks (count from args), each parks on the shared
// gate so the test can observe the true peak concurrency deterministically. The
// concurrencyLimit is passed through from args (omitted ⇒ engine default).
const PARALLEL_BARRIER_FIXTURE = "parallel-barrier"
const PARALLEL_BARRIER_WORKFLOW = `export const meta = { name: "${PARALLEL_BARRIER_FIXTURE}", phases: ["parallel"] }
export async function run(args, ctx) {
  ctx.setPhase("parallel")${BARRIER_PRELUDE}
  const tasks = Array.from({ length: args.count }, (_, i) => async () => {
    __enter()
    await __park()
    __leave()
    return i
  })
  const options = args.concurrencyLimit === undefined ? undefined : { concurrencyLimit: args.concurrencyLimit }
  const result = await ctx.parallel(tasks, options)
  return { peak: __b.peak, result }
}
`

// P1 (Claude parity): a rejecting task in ctx.parallel must NOT kill the whole
// batch — it resolves to `null` at its position, the surviving tasks keep their
// values, and the drop is LOGGED (never silent). Module uses `export default`
// so the resolved-object load path is exercised too.
const PARALLEL_ERROR_FIXTURE = "par-err"
const PARALLEL_ERROR_WORKFLOW = `export default {
  meta: { name: "${PARALLEL_ERROR_FIXTURE}", description: "parallel error tolerance" },
  async run(_args, ctx) {
    const out = await ctx.parallel([
      () => Promise.resolve("ok-1"),
      () => Promise.reject(new Error("boom")),
      () => Promise.resolve("ok-3"),
    ])
    return { out }
  },
}
`

// P2 (Claude parity): a throwing stage in ctx.pipeline must NOT kill the whole
// pipeline — it drops ONLY that item to `null` at its position and skips that
// item's remaining stages, while the other items run every stage to completion;
// the drop is LOGGED (never silent). Module uses `export default` so the
// resolved-object load path is exercised too.
const PIPELINE_ERROR_FIXTURE = "pipe-err"
const PIPELINE_ERROR_WORKFLOW = `export default {
  meta: { name: "${PIPELINE_ERROR_FIXTURE}", description: "pipeline per-item drop" },
  async run(_args, ctx) {
    const calls: string[] = []
    const out = await ctx.pipeline(
      [1, 2, 3],
      async (prev) => { if (prev === 2) throw new Error("stage1-boom"); calls.push("s1:" + prev); return prev * 10 },
      async (prev, item) => { calls.push("s2:" + item); return prev + 1 },
    )
    return { out, calls }
  },
}
`

// Item-cap fixtures (MAX_BATCH_ITEMS = 4096): trivial non-agent thunks/items so
// the boundary tests stay fast. `count` is an argument so one fixture covers both
// the rejection (4097) and the boundary (4096) case.
const PARALLEL_CAP_FIXTURE = "par-cap"
const PARALLEL_CAP_WORKFLOW = `export const meta = { name: "${PARALLEL_CAP_FIXTURE}", description: "parallel item cap", arguments: { count: { type: "number" } } }
export async function run(args, ctx) {
  const tasks = Array.from({ length: args.count }, (_, i) => () => Promise.resolve(i))
  const out = await ctx.parallel(tasks)
  return { length: out.length }
}
`
const PIPELINE_CAP_FIXTURE = "pipe-cap"
const PIPELINE_CAP_WORKFLOW = `export const meta = { name: "${PIPELINE_CAP_FIXTURE}", description: "pipeline item cap", arguments: { count: { type: "number" } } }
export async function run(args, ctx) {
  const items = Array.from({ length: args.count }, (_, i) => i)
  const out = await ctx.pipeline(items, async (prev) => prev)
  return { length: out.length }
}
`

// Pipeline index fixtures (stage third parameter): stage 1 returns its `index`,
// stage 2 proves it sees the SAME index for the item (prev === index from stage 1).
const PIPELINE_INDEX_FIXTURE = "pipe-index"
const PIPELINE_INDEX_WORKFLOW = `export const meta = { name: "${PIPELINE_INDEX_FIXTURE}", description: "pipeline stage index" }
export async function run(_args, ctx) {
  const out = await ctx.pipeline(
    ["x", "y"],
    async (_prev, _item, i) => i,
    async (prev, _item, i) => ({ first: prev, second: i }),
  )
  return { out }
}
`
// Duplicate items: the stage throws ONLY for the second occurrence (told apart by
// index, the items are identical), so the drop log must name item 2 — the old
// items.indexOf(item) logging always reported the FIRST occurrence (item 1).
const PIPELINE_DUP_FIXTURE = "pipe-dup"
const PIPELINE_DUP_WORKFLOW = `export const meta = { name: "${PIPELINE_DUP_FIXTURE}", description: "pipeline duplicate-item drop index" }
export async function run(_args, ctx) {
  const out = await ctx.pipeline(["a", "a"], async (prev, _item, i) => {
    if (i === 1) throw new Error("dup-boom")
    return prev
  })
  return { out }
}
`

// Pipeline barrier fixture: N items, ONE stage that parks every item on the gate,
// so the test can observe how many items run that stage concurrently (the
// pipeline concurrency default / clamp).
const PIPELINE_BARRIER_FIXTURE = "pipeline-barrier"
const PIPELINE_BARRIER_WORKFLOW = `export const meta = { name: "${PIPELINE_BARRIER_FIXTURE}", phases: ["pipeline"] }
export async function run(args, ctx) {
  ctx.setPhase("pipeline")${BARRIER_PRELUDE}
  const items = Array.from({ length: args.count }, (_, i) => i)
  const stage = async (item) => { __enter(); await __park(); __leave(); return item }
  // Pass the options object ONLY when a limit is set: the engine treats a trailing
  // object as { concurrencyLimit }, so a trailing undefined would be parsed as a
  // (missing) stage. No-options ⇒ pipeline runs items unbounded.
  const result = args.concurrencyLimit === undefined
    ? await ctx.pipeline(items, stage)
    : await ctx.pipeline(items, stage, { concurrencyLimit: args.concurrencyLimit })
  return { peak: __b.peak, result }
}
`

// No-barrier pipeline ordering fixture (deterministic replacement for the
// setTimeout-based PIPELINE_WORKFLOW ordering proof, Fund 48): item "A" parks in
// stage 1 on the shared gate; item "B" passes stage 1 unparked and records that it
// REACHED stage 2 while A is still held in stage 1. Stage 2 also changes the type
// (string -> { a, b }), proving heterogeneous stages. The test waits for B's
// stage-2 marker (a condition, no wall clock) BEFORE releasing A, so the ordering
// claim "B reaches stage 2 before A leaves stage 1" is guaranteed, not timed.
const PIPELINE_ORDER_FIXTURE = "pipeline-order"
const PIPELINE_ORDER_WORKFLOW = `export const meta = { name: "${PIPELINE_ORDER_FIXTURE}", phases: ["pipeline"] }
export async function run(args, ctx) {
  ctx.setPhase("pipeline")${BARRIER_PRELUDE}
  const result = await ctx.pipeline(
    ["A", "B"],
    async (item) => {
      __b.order.push(item + ":stage1:start")
      // Item A is held in stage 1 on the gate until the test releases it; item B
      // proceeds immediately, so B can reach stage 2 before A leaves stage 1.
      if (item === "A") await __park()
      __b.order.push(item + ":stage1:done")
      return { item, n: item === "A" ? 1 : 2 }
    },
    async (prev, item) => {
      __b.order.push(item + ":stage2")
      return { a: prev.n, b: prev.item === "A" ? "x" : "y" }
    },
  )
  return { order: __b.order, result }
}
`

// Telemetry shape of a single assistant turn — exactly the fields the engine reads
// off a persisted assistant message when it sums per-agent cost/tokens.
type AssistantTurn = {
  cost: number
  tokens: { total?: number; input: number; output: number; reasoning: number; cache: { read: number; write: number } }
  structured?: unknown
  error?: unknown
}

// Faithfully mirrors the production session layer: SessionPrompt.runLoop is a
// while(true) loop that PERSISTS one assistant message per turn (queryable via
// Session.messages) and RETURNS only the last one. The prompt fakes are given the
// engine's child sessionID, so they write each turn into the SAME MessageTable the
// engine's `sessions.messages(sessionID)` sum reads from, then resolve with a
// WithParts carrying the LAST turn's info (the engine still uses that single
// message for message_id / output / abort + structured-output detection). A fake
// with a single turn persists exactly one row ⇒ the summed result equals that row,
// identical to the previous single-message behaviour. The captured Database.Service
// is the same in-memory connection the engine uses (memoised in the merged layer).
function persistTurns(db: Database.Interface["db"], sessionID: string, turns: AssistantTurn[]) {
  return Effect.gen(function* () {
    let last: SessionV1.WithParts | undefined
    for (const turn of turns) {
      const id = MessageID.ascending()
      const data = {
        role: "assistant",
        providerID: "test",
        modelID: "test-model",
        cost: turn.cost,
        tokens: turn.tokens,
        ...("structured" in turn ? { structured: turn.structured } : {}),
        ...(turn.error ? { error: turn.error } : {}),
      }
      yield* db
        .insert(MessageTable)
        .values({
          id,
          session_id: sessionID,
          time_created: Date.now(),
          time_updated: Date.now(),
          data,
        } as unknown as typeof MessageTable.$inferInsert)
        .run()
        .pipe(Effect.orDie)
      last = {
        info: { id, sessionID, ...data },
        parts: [{ type: "text", text: "ok" }],
      } as unknown as SessionV1.WithParts
    }
    return last!
  })
}

// Startup-Fenster-Fixture: schreibt eine Marker-Datei, SOBALD der Body läuft.
// Wird der Run im Startup-Fenster (vor dem Body-Fork) gecancelt, darf dieser
// Marker NIE erscheinen — der Body läuft dann nie.
const STARTUP_FIXTURE = "startup-window"
function startupWorkflow(markerPath: string) {
  return `export const meta = { name: "${STARTUP_FIXTURE}", phases: ["run"] }
export async function run(args, ctx) {
  await Bun.write(${JSON.stringify(markerPath)}, "body-ran")
  ctx.setPhase("run")
  await ctx.agent({ prompt: "hang" })
  return { ok: true }
}
`
}

// Parallel-Hang-Fixture: drei parallele Agent-Tasks, jede startet einen Agenten
// (eigene Child-Session). Ein vierter, SEQUENTIELLER Step nach dem Batch
// schreibt einen Marker, der bei korrektem Cancel nie laufen darf.
const PARALLEL_HANG_FIXTURE = "parallel-hang"
const PARALLEL_HANG_MARKER = "parallel-after-reached"
const PARALLEL_HANG_WORKFLOW = `export const meta = { name: "${PARALLEL_HANG_FIXTURE}", phases: ["fan-out", "after"] }
export async function run(args, ctx) {
  ctx.setPhase("fan-out")
  ctx.log("fan-out-started")
  await ctx.parallel([
    () => ctx.agent({ prompt: "task A" }),
    () => ctx.agent({ prompt: "task B" }),
    () => ctx.agent({ prompt: "task C" }),
  ])
  ctx.setPhase("after")
  ctx.log("${PARALLEL_HANG_MARKER}")
  return { ok: true }
}
`

// Test-Prompt-Ops, die das echte Session-Abort-Verhalten nachbilden:
// - die initiale "Workflow started"-Nachricht (noReply) wird sofort beantwortet,
//   damit start() zurückkehrt;
// - jeder Agent-Prompt blockiert (langer, unterbrechbarer Lauf), bis cancel()
//   die Session abbricht; cancel() protokolliert die abgebrochene Child-Session
//   und unterbricht den laufenden Prompt (wie SessionPrompt.cancel -> Abort).
function hangingPromptOps() {
  const aborted = new Set<string>()
  const started = new Set<string>()
  const gates = new Map<string, Deferred.Deferred<void>>()
  const ops: { prompt: SessionPrompt.Interface["prompt"]; cancel: SessionPrompt.Interface["cancel"] } = {
    prompt: (input) =>
      Effect.gen(function* () {
        if (input.noReply) return assistantReply()
        const gate = yield* Deferred.make<void>()
        gates.set(input.sessionID, gate)
        started.add(input.sessionID)
        // Läuft, bis die Session per cancel() abgebrochen wird (Gate -> Interrupt)
        // oder der lange Lauf endet. Der Timer hält die Suspension unterbrechbar.
        yield* Effect.race(
          Effect.sleep("30 seconds"),
          Deferred.await(gate).pipe(Effect.flatMap(() => Effect.interrupt)),
        )
        return assistantReply()
      }),
    cancel: (sessionID) =>
      Effect.gen(function* () {
        aborted.add(sessionID)
        const gate = gates.get(sessionID)
        if (gate) yield* Deferred.succeed(gate, undefined)
      }),
  }
  return { ops, aborted, started }
}

// Resolve-on-abort-Prompt-Ops: bilden den ECHTEN Produktions-Runner nach.
// Wird eine laufende Agent-Session abgebrochen (cancel -> Abort), RESOLVED der
// Prompt mit dem letzten Assistant-Stand (eine WithParts, deren info.error ein
// abgebrochenes Ergebnis markiert) — er REJECTED NICHT. Genau dieses Verhalten
// (session/prompt.ts: Effect.onInterrupt -> lastAssistant) ist der Kern mehrerer
// Cancel-Bugs: die Erfolgsverzweigung der Settlement-Callbacks lief sonst und
// flippte cancelled->completed.
//
// `delayMs` verzögert die Beantwortung der initialen noReply-Nachricht, damit
// Tests im Startup-Fenster (vor dem Body-Fork) cancellen können.
function resolveOnAbortPromptOps(options?: { delayMs?: number }) {
  const aborted = new Set<string>()
  const started = new Set<string>()
  const gates = new Map<string, Deferred.Deferred<void>>()
  const abortedReply = (): SessionV1.WithParts =>
    ({
      info: { role: "assistant", error: { name: "MessageAbortedError", data: {} } },
      parts: [],
    }) as unknown as SessionV1.WithParts
  const ops: { prompt: SessionPrompt.Interface["prompt"]; cancel: SessionPrompt.Interface["cancel"] } = {
    prompt: (input) =>
      Effect.gen(function* () {
        if (input.noReply) {
          if (options?.delayMs) yield* Effect.sleep(options.delayMs)
          return assistantReply()
        }
        const gate = yield* Deferred.make<void>()
        gates.set(input.sessionID, gate)
        started.add(input.sessionID)
        // Race: entweder der lange Lauf endet, oder cancel() öffnet das Gate ->
        // der Prompt RESOLVED (nicht interrupt!) mit dem abort-Assistant-Stand,
        // wie der echte Runner. Der Timer hält die Suspension unterbrechbar, so
        // dass ein Scope-Close die Session-Fiber dennoch hart interrupten kann.
        return yield* Effect.race(
          Effect.sleep("30 seconds").pipe(Effect.map(() => assistantReply())),
          Deferred.await(gate).pipe(Effect.map(() => abortedReply())),
        )
      }),
    cancel: (sessionID) =>
      Effect.gen(function* () {
        aborted.add(sessionID)
        const gate = gates.get(sessionID)
        if (gate) yield* Deferred.succeed(gate, undefined)
      }),
  }
  return { ops, aborted, started }
}

// N13-Fixture (tokens-Alias): der Agent-Prompt RESOLVED sofort mit echter
// Token-Telemetrie (nicht-null, damit eine Mutation beobachtbar ist), so dass
// der Engine den Node mit `tokens`/`cache` befüllt. Danach hält der Body den Run
// LIVE (langer, unterbrechbarer Timer), so dass get() einen Live-Snapshot liefert
// (nicht den fromRow-Pfad nach der N1-Eviction). cancel() bricht den Timer ab.
function tokensPromptOps(db: Database.Interface["db"]) {
  const ops: { prompt: SessionPrompt.Interface["prompt"]; cancel: SessionPrompt.Interface["cancel"] } = {
    prompt: (input) =>
      Effect.gen(function* () {
        if (input.noReply) return assistantReply()
        return yield* persistTurns(db, input.sessionID, [
          { cost: 0, tokens: { input: 11, output: 22, reasoning: 0, cache: { read: 33, write: 44 } } },
        ])
      }),
    cancel: () => Effect.void,
  }
  return ops
}

// Body: ein Agent-Step (setzt tokens) und danach ein langer Timer, der den Run
// LIVE in der Registry hält, bis der Test cancelt.
const AGENT_THEN_HANG_FIXTURE = "agent-then-hang"
const AGENT_THEN_HANG_WORKFLOW = `export const meta = { name: "${AGENT_THEN_HANG_FIXTURE}", phases: ["run"] }
export async function run(args, ctx) {
  ctx.setPhase("run")
  await ctx.agent({ prompt: "produce tokens" })
  await new Promise((resolve) => setTimeout(resolve, 30000))
  return { ok: true }
}
`

// Schema-Fixtures: Workflows, deren run(ctx) den Agenten MIT Schema aufruft
// (strukturierte Ausgabe angefordert). Der Promtp-Ops-Fake (unten) steuert, ob
// die Session strukturierte Daten, undefined oder einen StructuredOutputError
// liefert. Jeder gibt das geparste Objekt im Ergebnis zurück, damit der
// Positivpfad das Objekt durchreichen kann.
const SCHEMA_SUCCESS_FIXTURE = "schema-success"
const SCHEMA_UNDEFINED_FIXTURE = "schema-undefined"
const SCHEMA_FAILING_FIXTURE = "schema-failing"
const SCHEMA_OBJECT = { value: 123 }

function schemaWorkflow(name: string) {
  return `export const meta = { name: "${name}", phases: ["agent"] }
export async function run(args, ctx) {
  ctx.setPhase("agent")
  const result = await ctx.agent({ prompt: "produce structured", schema: { type: "object" } })
  return { data: result.data }
}
`
}

// Prompt-Ops-Fake, der die SESSION-Schicht nachbildet (nicht die Engine): die
// initiale noReply-Nachricht wird sofort beantwortet; der Agent-Prompt liefert
// eine Assistant-Nachricht, deren `structured`/`error`-Feld der Modus bestimmt:
// - "structured": message.info.structured ist gesetzt (Erfolgspfad);
// - "undefined": structured fehlt trotz angefordertem Schema (stiller Fallback,
//   der jetzt scheitern muss);
// - "error": die Session hat einen StructuredOutputError auf message.info.error
//   gesetzt (genau wie packages/opencode/src/session/prompt.ts es tut), gibt aber
//   weiterhin erfolgreich eine WithParts zurück.
// `cost` mirrors the real telemetry (`message.info.cost`, USD) so a step that
// FAILS structured-output can still report what it actually cost — exactly the
// failed-but-paid case the budget must charge for. Defaults to 0 to leave the
// existing structured-output callers unchanged.
function structuredPromptOps(db: Database.Interface["db"], mode: "structured" | "undefined" | "error", cost = 0) {
  const ops: { prompt: SessionPrompt.Interface["prompt"]; cancel: SessionPrompt.Interface["cancel"] } = {
    prompt: (input) =>
      Effect.gen(function* () {
        if (input.noReply) return assistantReply()
        const turn: AssistantTurn = {
          cost,
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        }
        if (mode === "structured") turn.structured = SCHEMA_OBJECT
        if (mode === "error")
          turn.error = {
            name: "StructuredOutputError",
            data: { message: "Model did not produce structured output", retries: 0 },
          }
        const last = yield* persistTurns(db, input.sessionID, [turn])
        const parts = mode === "undefined" || mode === "error" ? [{ type: "text", text: "here is some plaintext" }] : []
        return { info: last.info, parts } as unknown as SessionV1.WithParts
      }),
    cancel: () => Effect.void,
  }
  return ops
}

// Budget-Fixtures. Der Engine liest die Agent-Kosten aus `message.info.cost`
// (USD) — exakt wie der echte Session-Pfad und das TUI-Dashboard. Dieser Fake
// bildet GENAU diese Telemetrie-Form nach: jede beantwortete Agent-Nachricht
// trägt `cost` (und `tokens`, wie die echte Session), sodass der Engine pro
// Step das Restbudget korrekt dekrementieren kann.
function costPromptOps(db: Database.Interface["db"], cost: number) {
  const ops: { prompt: SessionPrompt.Interface["prompt"]; cancel: SessionPrompt.Interface["cancel"] } = {
    prompt: (input) =>
      Effect.gen(function* () {
        if (input.noReply) return assistantReply()
        return yield* persistTurns(db, input.sessionID, [
          { cost, tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } } },
        ])
      }),
    cancel: () => Effect.void,
  }
  return ops
}

// Item 17: prompt-ops whose telemetry carries TOKENS (with deliberately non-zero
// input/cache numbers, which must NOT count toward the token budget — only
// output + reasoning do). Cost stays 0 so the USD path is provably untouched.
// (Distinct from the aliasing-test `tokensPromptOps` above, which pins a fixed
// token shape — this one parameterizes the budget-relevant output/reasoning.)
function tokenBudgetPromptOps(db: Database.Interface["db"], output: number, reasoning = 0) {
  const ops: { prompt: SessionPrompt.Interface["prompt"]; cancel: SessionPrompt.Interface["cancel"] } = {
    prompt: (input) =>
      Effect.gen(function* () {
        if (input.noReply) return assistantReply()
        return yield* persistTurns(db, input.sessionID, [
          { cost: 0, tokens: { input: 11, output, reasoning, cache: { read: 7, write: 3 } } },
        ])
      }),
    cancel: () => Effect.void,
  }
  return ops
}

// Finding 2 fake: an externally-aborted subagent. The prompt RESOLVES (does not
// reject) with an abort-marked assistant message that ALSO carries a real cost —
// exactly what the production runner returns when a child session is aborted out
// of band (POST /session/:id/abort, internal session timeout) while the workflow
// run itself is NOT cancelling/pausing/removed. The cost is persisted into the
// MessageTable (where the engine's per-session cost sum reads from) so the abort
// artifact carries a charge, and the returned WithParts is abort-marked
// (MessageAbortedError) so `isAbortedMessage` fires with no run-level flag set.
// No cancel() is wired — the abort is purely message-level.
function abortedCostPromptOps(db: Database.Interface["db"], cost: number) {
  const ops: { prompt: SessionPrompt.Interface["prompt"]; cancel: SessionPrompt.Interface["cancel"] } = {
    prompt: (input) =>
      Effect.gen(function* () {
        if (input.noReply) return assistantReply()
        return yield* persistTurns(db, input.sessionID, [
          {
            cost,
            tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
            error: { name: "MessageAbortedError", data: {} },
          },
        ])
      }),
    cancel: () => Effect.void,
  }
  return ops
}

// Multi-turn fake (Fund N12): a SINGLE ctx.agent step whose underlying session
// runs several provider turns (the normal case when the subagent uses tools),
// each persisting its own assistant message with its own cost/tokens. Production
// returns only the LAST turn, so charging that one alone discards every
// intermediate turn. The engine must instead sum cost/tokens across ALL persisted
// assistant messages of the child session.
function multiTurnPromptOps(db: Database.Interface["db"], turns: AssistantTurn[]) {
  const ops: { prompt: SessionPrompt.Interface["prompt"]; cancel: SessionPrompt.Interface["cancel"] } = {
    prompt: (input) =>
      Effect.gen(function* () {
        if (input.noReply) return assistantReply()
        return yield* persistTurns(db, input.sessionID, turns)
      }),
    cancel: () => Effect.void,
  }
  return ops
}

// Fund 23 (budget soft-cap under parallelism): prompt-ops that hold EVERY agent
// prompt at a shared latch until `expected` prompts have arrived, then resolve all
// of them with the given per-step `cost`. The engine checks the budget gate at the
// TOP of `ctx.agent`, BEFORE calling the prompt — so by the time a prompt arrives
// here its step has already passed the gate. Gating the resolution until all
// `expected` prompts have arrived therefore GUARANTEES, deterministically (a
// Deferred barrier, not a timing window), that all parallel in-flight steps passed
// the gate while the budget was still positive. They then all settle and charge,
// documenting the best-effort overspend. Returns the latch arrival promise so the
// test can also await the barrier shape if needed.
function budgetBarrierPromptOps(db: Database.Interface["db"], cost: number, expected: number) {
  const gates: Deferred.Deferred<void>[] = []
  let arrived = 0
  const ops: { prompt: SessionPrompt.Interface["prompt"]; cancel: SessionPrompt.Interface["cancel"] } = {
    prompt: (input) =>
      Effect.gen(function* () {
        if (input.noReply) return assistantReply()
        // Park until all `expected` parallel prompts have arrived: each opens its
        // own gate, and the LAST arrival releases every gate at once.
        const gate = yield* Deferred.make<void>()
        gates.push(gate)
        arrived += 1
        if (arrived >= expected) for (const g of gates) yield* Deferred.succeed(g, undefined)
        yield* Deferred.await(gate)
        return yield* persistTurns(db, input.sessionID, [
          { cost, tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } } },
        ])
      }),
    cancel: () => Effect.void,
  }
  return ops
}

// Fund 23: N parallel agent steps, then a SEQUENTIAL step after the batch. With a
// budget that each parallel step's cost overshoots in aggregate, all N parallel
// steps pass the gate (budget still positive when each is checked) and all are
// charged — the documented soft-cap overspend. The follow-up sequential step then
// hits an exhausted budget and fails. The workflow catches that failure and reports
// how far the budget was overspent and that the post-batch step did NOT run.
const BUDGET_PARALLEL_FIXTURE = "budget-parallel"
const BUDGET_PARALLEL_WORKFLOW = `export const meta = { name: "${BUDGET_PARALLEL_FIXTURE}", phases: ["run"] }
export async function run(args, ctx) {
  ctx.setPhase("run")
  const tasks = Array.from({ length: args.count }, (_, i) => () => ctx.agent({ prompt: "parallel " + i }))
  await ctx.parallel(tasks)
  const overspent = ctx.budgetRemaining
  let nextStarted = false
  let nextFailed = false
  try {
    nextStarted = true
    await ctx.agent({ prompt: "after the batch" })
  } catch (e) {
    nextFailed = true
  }
  return { overspent, nextStarted, nextFailed }
}
`

// Zwei sequentielle ctx.agent-Aufrufe; bei kleinem Budget muss der zweite
// Aufruf am Budget-Gate scheitern (Restbudget <= 0 nach dem ersten Step).
const BUDGET_FIXTURE = "budget-two-steps"
const BUDGET_WORKFLOW = `export const meta = { name: "${BUDGET_FIXTURE}", phases: ["run"] }
export async function run(args, ctx) {
  ctx.setPhase("run")
  await ctx.agent({ prompt: "step one" })
  await ctx.agent({ prompt: "step two" })
  return { ok: true }
}
`

// Item 24 (Turn-Pool): zwei PARALLELE Steps gegen einen Pool mit Headroom für
// genau einen (gepreiste Reservierung via vorab gesettletem Step). Die
// synchrone Check-and-Set-Reservierung lässt exakt EINEN passieren — der
// andere wird VOR der Node-Erzeugung refused (kein Soft-Cap-Overspend mehr).
const POOL_PARALLEL_FIXTURE = "pool-parallel"
const POOL_PARALLEL_WORKFLOW = `export const meta = { name: "${POOL_PARALLEL_FIXTURE}", phases: ["run"] }
export async function run(args, ctx) {
  ctx.setPhase("run")
  await ctx.parallel([
    () => ctx.agent({ prompt: "pool A" }),
    () => ctx.agent({ prompt: "pool B" }),
  ])
  return { ok: true }
}
`

// Item 24: macht die ctx.budget-Pool-Sicht beobachtbar (total/spent vor und
// nach einem Step plus remaining) — ohne Run-Budget leitet sie aus dem Pool ab.
const POOL_SPENT_FIXTURE = "pool-spent"
const POOL_SPENT_WORKFLOW = `export const meta = { name: "${POOL_SPENT_FIXTURE}", phases: ["run"] }
export async function run(args, ctx) {
  ctx.setPhase("run")
  const before = ctx.budget.spent()
  const total = ctx.budget.total
  await ctx.agent({ prompt: "spend" })
  return { before, total, after: ctx.budget.spent(), remaining: ctx.budget.remaining() }
}
`

// Schreibt ctx.budgetRemaining vor und nach einem Agent-Step ins Resultat,
// damit der Test die Live-Dekrementierung beobachten kann.
const BUDGET_REMAINING_FIXTURE = "budget-remaining"
const BUDGET_REMAINING_WORKFLOW = `export const meta = { name: "${BUDGET_REMAINING_FIXTURE}", phases: ["run"] }
export async function run(args, ctx) {
  ctx.setPhase("run")
  const before = ctx.budgetRemaining
  await ctx.agent({ prompt: "spend" })
  const after = ctx.budgetRemaining
  return { before, after }
}
`

// Liest ctx.budgetRemaining OHNE gesetztes Budget — muss Infinity sein.
const BUDGET_UNLIMITED_FIXTURE = "budget-unlimited"
const BUDGET_UNLIMITED_WORKFLOW = `export const meta = { name: "${BUDGET_UNLIMITED_FIXTURE}", phases: ["run"] }
export async function run(args, ctx) {
  ctx.setPhase("run")
  const remaining = ctx.budgetRemaining
  await ctx.agent({ prompt: "spend" })
  return { unlimited: remaining === Infinity }
}
`

// Failed-but-paid-Fixture: ein Agent MIT Schema, der scheitert (kein
// strukturiertes Ergebnis), aber laut Telemetrie echte Kosten verursacht hat.
// Der Workflow fängt den Fehler ab und gibt das Restbudget zurück, damit der
// Test beweisen kann, dass das Budget TROTZ des Fehlers belastet wurde.
const BUDGET_FAILED_PAID_FIXTURE = "budget-failed-paid"
const BUDGET_FAILED_PAID_WORKFLOW = `export const meta = { name: "${BUDGET_FAILED_PAID_FIXTURE}", phases: ["run"] }
export async function run(args, ctx) {
  ctx.setPhase("run")
  let failed = false
  try {
    await ctx.agent({ prompt: "produce structured", schema: { type: "object" } })
  } catch (e) {
    failed = true
  }
  return { failed, remaining: ctx.budgetRemaining }
}
`

// ctx.budget (Claude-Code-Parität) MIT gesetztem Budget: liest total/spent()/
// remaining() OHNE Agent-Step, sodass spent()===0 und remaining()===total gilt.
const BUDGET_API_FIXTURE = "budget-api"
const BUDGET_API_WORKFLOW = `export const meta = { name: "${BUDGET_API_FIXTURE}", phases: ["run"] }
export async function run(args, ctx) {
  ctx.setPhase("run")
  return { total: ctx.budget.total, spent: ctx.budget.spent(), remaining: ctx.budget.remaining() }
}
`

// ctx.budget OHNE Budget: total ist null und remaining() ist Infinity. Infinity
// überlebt JSON nicht, daher gibt das Fixture stattdessen einen Booleschen zurück.
const BUDGET_API_UNLIMITED_FIXTURE = "budget-api-unlimited"
const BUDGET_API_UNLIMITED_WORKFLOW = `export const meta = { name: "${BUDGET_API_UNLIMITED_FIXTURE}", phases: ["run"] }
export async function run(args, ctx) {
  ctx.setPhase("run")
  return { total: ctx.budget.total, remainingFinite: Number.isFinite(ctx.budget.remaining()) }
}
`

// Item 17: ctx.budget token trio MIT Token-Budget — liest tokensTotal/
// tokensSpent()/tokensRemaining() vor und nach einem Agent-Step, damit der Test
// die Live-Verbuchung (output+reasoning, NICHT input/cache) beobachten kann.
const TOKEN_API_FIXTURE = "token-budget-api"
const TOKEN_API_WORKFLOW = `export const meta = { name: "${TOKEN_API_FIXTURE}", phases: ["run"] }
export async function run(args, ctx) {
  ctx.setPhase("run")
  const beforeSpent = ctx.budget.tokensSpent()
  const beforeRemaining = ctx.budget.tokensRemaining()
  await ctx.agent({ prompt: "spend tokens" })
  return {
    total: ctx.budget.tokensTotal,
    beforeSpent,
    beforeRemaining,
    afterSpent: ctx.budget.tokensSpent(),
    afterRemaining: ctx.budget.tokensRemaining(),
  }
}
`

// Item 17: ohne Token-Budget ist tokensTotal null und tokensRemaining()
// Infinity (nicht endlich; Boolean wegen JSON).
const TOKEN_API_UNLIMITED_FIXTURE = "token-budget-unlimited"
const TOKEN_API_UNLIMITED_WORKFLOW = `export const meta = { name: "${TOKEN_API_UNLIMITED_FIXTURE}", phases: ["run"] }
export async function run(args, ctx) {
  ctx.setPhase("run")
  return { tokensTotal: ctx.budget.tokensTotal, remainingFinite: Number.isFinite(ctx.budget.tokensRemaining()) }
}
`

// Fund 18/19/20 (Argument-Koerzierung & Defaults): ein Workflow, der die
// deklarierten args UND deren JS-Laufzeittypen 1:1 ins Resultat zurückgibt.
// Über `typeof` kann der Test beweisen, dass die Engine String-eingehende args
// (z. B. JSON-args über HTTP) gemäß dem deklarierten `type` koerziert hat, bevor
// `run` sie sieht — und dass nicht deklarierte args unverändert durchgereicht
// werden.
const COERCE_FIXTURE = "coerce-args"
const COERCE_WORKFLOW = `export const meta = {
  name: "${COERCE_FIXTURE}",
  arguments: {
    count: { type: "number" },
    flag: { type: "boolean" },
    label: { type: "string" },
    bare: {},
  },
}
export async function run(args, ctx) {
  return {
    count: args.count,
    countType: typeof args.count,
    flag: args.flag,
    flagType: typeof args.flag,
    label: args.label,
    labelType: typeof args.label,
    bare: args.bare,
    bareType: typeof args.bare,
  }
}
`

// Fund 20 (Defaults): deklarierte Defaults für jeden Typ. Werden die args nicht
// übergeben, MUSS run() den (typ-korrekten) Default sehen; ein explizit
// übergebener Wert gewinnt über den Default.
const DEFAULT_FIXTURE = "default-args"
const DEFAULT_WORKFLOW = `export const meta = {
  name: "${DEFAULT_FIXTURE}",
  arguments: {
    name: { type: "string", default: "x" },
    count: { type: "number", default: 7 },
    flag: { type: "boolean", default: true },
  },
}
export async function run(args, ctx) {
  return {
    name: args.name,
    nameType: typeof args.name,
    count: args.count,
    countType: typeof args.count,
    flag: args.flag,
    flagType: typeof args.flag,
  }
}
`

// Review-Fund 3i.3 (LOW): ein deklarierter Default wird selbst durch den
// Koerzierungspfad geschickt, bevor er run() erreicht. Ein STRING-Default "7"
// für ein number-Argument muss run() als die Zahl 7 erreichen — nicht als der
// rohe String "7". Bewusst getrennt von DEFAULT_WORKFLOW (dessen Default schon
// die Zahl 7 ist und den rohen Durchschlupf daher NICHT aufdecken würde).
const STRING_DEFAULT_FIXTURE = "string-default-args"
const STRING_DEFAULT_WORKFLOW = `export const meta = {
  name: "${STRING_DEFAULT_FIXTURE}",
  arguments: {
    count: { type: "number", default: "7" },
    flag: { type: "boolean", default: "true" },
  },
}
export async function run(args, ctx) {
  return {
    count: args.count,
    countType: typeof args.count,
    flag: args.flag,
    flagType: typeof args.flag,
  }
}
`

// Track B — Cap-Fixture: N parallele ctx.agent-Aufrufe, jeder am Barrier-Gate
// geparkt (über die Prompt-Ops, nicht im Body), damit der Test den ECHTEN Peak
// gleichzeitig laufender Agent-Dispatches misst. Die Run-weite Semaphore deckelt
// diesen Peak auf min(16, max(2, cpus-2)). Anders als PARALLEL_BARRIER (das
// schlichte Tasks parkt und so NUR die parallel-Concurrency misst), parkt diese
// Fixture innerhalb von ctx.agent — genau der Pfad, den die Semaphore deckelt.
const AGENT_CAP_FIXTURE = "agent-cap"
const AGENT_CAP_WORKFLOW = `export const meta = { name: "${AGENT_CAP_FIXTURE}", phases: ["run"] }
export async function run(args, ctx) {
  ctx.setPhase("run")
  const tasks = Array.from({ length: args.count }, (_, i) => () => ctx.agent({ prompt: "cap " + i }))
  const result = await ctx.parallel(tasks, { concurrencyLimit: args.count })
  return { result: result.length }
}
`

// Lifetime-Fixture: ruft ctx.agent in einer Schleife N-mal SEQUENTIELL auf, fängt
// einen geworfenen Fehler ab und meldet, wie viele Aufrufe gelangen, bevor das
// Lifetime-Limit zugeschlagen hat.
const LIFETIME_FIXTURE = "agent-lifetime"
const LIFETIME_WORKFLOW = `export const meta = { name: "${LIFETIME_FIXTURE}", phases: ["run"] }
export async function run(args, ctx) {
  ctx.setPhase("run")
  for (let i = 0; i < args.count; i++) {
    await ctx.agent({ prompt: "step " + i })
  }
  return { ok: true }
}
`

// Pause-Fixture: ein Agent-Step, der am Gate hängt (über hangingPromptOps), danach
// ein zweiter Step, der bei korrekter Pause NIE läuft (PAUSE_AFTER_MARKER).
const PAUSE_FIXTURE = "pause-hang"
const PAUSE_AFTER_MARKER = "pause-after-reached"
const PAUSE_WORKFLOW = `export const meta = { name: "${PAUSE_FIXTURE}", phases: ["run", "after"] }
export async function run(args, ctx) {
  ctx.setPhase("run")
  ctx.log("pause-started")
  await ctx.agent({ prompt: "hang" })
  ctx.setPhase("after")
  ctx.log("${PAUSE_AFTER_MARKER}")
  return { ok: true }
}
`

// Resume-Fixture: zwei sequentielle ctx.agent-Aufrufe (A, dann B). Beim ersten
// Lauf wird A completed, B durch die Pause unterbrochen. Beim Resume muss A aus
// dem Journal kommen (KEIN neuer Prompt), B live laufen. Der Body gibt beide
// Outputs zurück, damit der Test die Werte prüfen kann.
const RESUME_FIXTURE = "resume-two-agents"
const RESUME_WORKFLOW = `export const meta = { name: "${RESUME_FIXTURE}", phases: ["run"] }
export async function run(args, ctx) {
  ctx.setPhase("run")
  const a = await ctx.agent({ prompt: "agent A" })
  const b = await ctx.agent({ prompt: "agent B" })
  return { a: a.text, b: b.text }
}
`

// Occurrence-Fixture: ZWEI identische Prompts hintereinander. Beim Resume müssen
// beide getrennt aus dem Journal aufgelöst werden (Occurrence-Index), nicht beide
// auf denselben Journal-Eintrag.
const RESUME_DUP_FIXTURE = "resume-dup-prompts"
const RESUME_DUP_WORKFLOW = `export const meta = { name: "${RESUME_DUP_FIXTURE}", phases: ["run"] }
export async function run(args, ctx) {
  ctx.setPhase("run")
  const first = await ctx.agent({ prompt: "same prompt" })
  const second = await ctx.agent({ prompt: "same prompt" })
  return { first: first.text, second: second.text }
}
`

// Item 20 (prefix-Replay): drei sequentielle Agenten. Mit invalidate_agents:[0]
// bricht der Präfix im Default-Modus ab Index 0 DAUERHAFT — B und C laufen
// ebenfalls live, obwohl sie unverändert sind (Original-Semantik). Im keyed-
// Modus cachen B/C trotz des Invalidates (Shape-Match).
const PREFIX_FIXTURE = "prefix-three-agents"
const PREFIX_WORKFLOW = `export const meta = { name: "${PREFIX_FIXTURE}", phases: ["run"] }
export async function run(args, ctx) {
  ctx.setPhase("run")
  const a = await ctx.agent({ prompt: "agent A" })
  const b = await ctx.agent({ prompt: "agent B" })
  const c = await ctx.agent({ prompt: "agent C" })
  return { a: a.text, b: b.text, c: c.text }
}
`

// Item 20 (Schema-Drift bricht den Präfix dauerhaft): V1 hat einen Plaintext-
// Agenten plus einen unveränderten zweiten Agenten; V2 fordert für Call 1 ein
// Schema an. Der Parse-Fehler am Plaintext-Journal-Node bricht im prefix-Modus
// den Präfix — der UNVERÄNDERTE Call 2 läuft ebenfalls live. Im keyed-Modus
// bleibt Call 2 gecacht (Shape-Match, per-Call-MISS für den Drift).
const DRIFT2_FIXTURE = "resume-schema-drift-two"
const DRIFT2_WORKFLOW_PLAINTEXT = `export const meta = { name: "${DRIFT2_FIXTURE}", phases: ["run"] }
export async function run(args, ctx) {
  ctx.setPhase("run")
  const r = await ctx.agent({ prompt: "drift agent" })
  const s = await ctx.agent({ prompt: "stable agent" })
  return { value: r.text, stable: s.text }
}
`
const DRIFT2_WORKFLOW_SCHEMA = `export const meta = { name: "${DRIFT2_FIXTURE}", phases: ["run"] }
export async function run(args, ctx) {
  ctx.setPhase("run")
  const r = await ctx.agent({ prompt: "drift agent", schema: { type: "object" } })
  const s = await ctx.agent({ prompt: "stable agent" })
  return { value: r.data, stable: s.text }
}
`

// Drift-Fixture (Fund: ungeschütztes JSON.parse auf einem Plaintext-Journal-Node).
// Der Journal-Key ist NUR { prompt, agent, phase } — das Schema gehört NICHT dazu.
// Eine V1-Datei mit einem PLAINTEXT-Agenten (kein Schema) erzeugt einen Journal-
// Node, dessen output kein gültiges JSON ist. Wird die SELBE Datei (gleicher Name
// → gleiche path/journalKey) zwischen Lauf und Resume zu V2 überschrieben — jetzt
// fordert derselbe Agent-Call ein Schema an — matcht der Plaintext-Node die Schema-
// Anfrage. Das alte JSON.parse(cached.output) würde synchron werfen (Defect). Der
// Resume MUSS das stattdessen als Cache-MISS behandeln und den Agenten LIVE laufen
// lassen. Beide Versionen teilen Name/Phase/Prompt, damit der Key identisch ist.
const DRIFT_FIXTURE = "resume-schema-drift"
const DRIFT_WORKFLOW_PLAINTEXT = `export const meta = { name: "${DRIFT_FIXTURE}", phases: ["run"] }
export async function run(args, ctx) {
  ctx.setPhase("run")
  const r = await ctx.agent({ prompt: "drift agent" })
  return { value: r.text }
}
`
const DRIFT_WORKFLOW_SCHEMA = `export const meta = { name: "${DRIFT_FIXTURE}", phases: ["run"] }
export async function run(args, ctx) {
  ctx.setPhase("run")
  const r = await ctx.agent({ prompt: "drift agent", schema: { type: "object" } })
  return { value: r.data }
}
`

// Tasks 12/13 (ctx.question): ein Workflow, der EINE Frage stellt und die Antwort
// zurückgibt. Wird live beantwortet (Deferred), bevor das Timeout feuert. Der
// Question-Node landet als Journal-Step (kind:"question"), so dass ein Resume die
// Antwort aus dem Journal serviert statt erneut zu fragen.
const QUESTION_FIXTURE = "ask-question"
const QUESTION_WORKFLOW = `export const meta = { name: "${QUESTION_FIXTURE}", phases: ["run"] }
export async function run(args, ctx) {
  ctx.setPhase("run")
  const a = await ctx.question({ question: "deploy?", options: ["yes", "no"] })
  return { answer: a.answer }
}
`
// Timeout-Variante: dieselbe Frage, aber mit winzigem Timeout. Wird sie nicht
// rechtzeitig beantwortet, PARKT der Run als `paused` über die bestehende
// Pause-Maschinerie, die offene Question wird persistiert (pending_question).
const QUESTION_TIMEOUT_FIXTURE = "ask-question-timeout"
const QUESTION_TIMEOUT_WORKFLOW = `export const meta = { name: "${QUESTION_TIMEOUT_FIXTURE}", phases: ["run"] }
export async function run(args, ctx) {
  ctx.setPhase("run")
  const a = await ctx.question({ question: "deploy?", options: ["yes", "no"], timeout: 50 })
  return { answer: a.answer }
}
`
// Finding 4 (timeout-park races answer): a question with a very short timeout,
// answered the instant its pending_question is published. The engine must NOT
// both record the answer AND park as paused — exactly one of {answer, park}
// wins. The fix makes the timeout-park branch re-read node.status, so an answer()
// that completed the node mid-race returns the answer instead of parking.
const QUESTION_TINY_TIMEOUT_FIXTURE = "ask-question-tiny-timeout"
const QUESTION_TINY_TIMEOUT_WORKFLOW = `export const meta = { name: "${QUESTION_TINY_TIMEOUT_FIXTURE}", phases: ["run"] }
export async function run(args, ctx) {
  ctx.setPhase("run")
  const a = await ctx.question({ question: "deploy?", options: ["yes", "no"], timeout: 1 })
  return { answer: a.answer }
}
`

// Question-then-agent: asks a question that times out (parks as paused), then
// dispatches a real ctx.agent step that depends on the answer. The resume that
// answer() triggers must thread the prompt-ops vector so this agent step can run
// LIVE on the resumed run (the question is replayed from the journal).
const QUESTION_AGENT_FIXTURE = "q-then-agent"
const QUESTION_AGENT_WORKFLOW = `export const meta = { name: "${QUESTION_AGENT_FIXTURE}", phases: ["run"] }
export async function run(args, ctx) {
  ctx.setPhase("run")
  const a = await ctx.question({ question: "go?", timeout: 50 })
  const r = await ctx.agent({ prompt: "after-" + a.answer })
  return { answer: a.answer, agentText: r.text }
}
`

// T5 gap (mixed cached replay): a workflow that asks a question THEN dispatches
// an agent. On the first run both complete (question answered live, agent
// prompted live). On a resume of the parked/paused run, BOTH must come from the
// journal: the question is NOT re-asked (no pending_question) and the agent is
// NOT re-prompted (recordingPromptOps records nothing).
const MIXED_REPLAY_FIXTURE = "mixed-question-agent"
const MIXED_REPLAY_WORKFLOW = `export const meta = { name: "${MIXED_REPLAY_FIXTURE}", phases: ["run"] }
export async function run(args, ctx) {
  ctx.setPhase("run")
  const a = await ctx.question({ question: "ship?", options: ["yes", "no"] })
  const r = await ctx.agent({ prompt: "do-" + a.answer })
  return { answer: a.answer, work: r.text }
}
`

// Prompt-Ops für den Drift-Test: zählt jeden GEFEUERTEN (live) Prompt und liefert,
// wenn ein Schema angefordert wurde (input.format gesetzt), eine strukturierte
// Antwort (message.info.structured) — sonst PLAINTEXT, dessen Text KEIN gültiges
// JSON ist. So beweist der Resume: matcht die Schema-Anfrage den Plaintext-Journal-
// Node, läuft der Agent live (count +1) und liefert ein echtes structured-Ergebnis,
// statt am JSON.parse des Plaintext-Outputs zu defecten.
function driftPromptOps(db: Database.Interface["db"]) {
  const state = { count: 0 }
  const ops: { prompt: SessionPrompt.Interface["prompt"]; cancel: SessionPrompt.Interface["cancel"] } = {
    prompt: (input) =>
      Effect.gen(function* () {
        if (input.noReply) return assistantReply()
        state.count++
        const wantsSchema = input.format?.type === "json_schema"
        const turn: AssistantTurn = {
          cost: 0,
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        }
        if (wantsSchema) turn.structured = SCHEMA_OBJECT
        const last = yield* persistTurns(db, input.sessionID, [turn])
        // Plaintext-Pfad: ein Text, der bewusst KEIN gültiges JSON ist.
        const parts = wantsSchema ? [] : [{ type: "text", text: "not json at all" }]
        return { info: last.info, parts } as unknown as SessionV1.WithParts
      }),
    cancel: () => Effect.void,
  }
  return { ops, state }
}

// Prompt-Ops, die jeden Agent-Prompt SOFORT mit einem PROMPT-spezifischen Output
// beantworten und (a) jeden gestarteten Prompt-Text protokollieren sowie (b) echte
// Kosten verbuchen. So kann der Resume-Test beweisen, dass für gecachte Agenten
// KEIN neuer Prompt gefeuert wird (Prompt-Text fehlt in `prompted`) und der Output
// aus dem Journal stammt. Der Output ist `"out:" + prompt-text` damit identische
// Prompts dennoch denselben Output liefern (die Occurrence-Trennung wird über die
// Zähl-Logik geprüft, nicht über unterschiedliche Outputs).
// Entfernt die vom Engine vorangestellte Step-Framing-Direktive (Item 6: jeder
// Nicht-Schema-Agent-Prompt wird damit geframt), sodass Prompt-matchende Ops und
// Assertions weiterhin auf dem AUTOREN-Prompt operieren. Schema-Prompts (und der
// rohe node.prompt) tragen das Präfix nie.
function authorPrompt(text: string) {
  const prefix = Workflow.STEP_FRAMING_DIRECTIVE + "\n\n"
  return text.startsWith(prefix) ? text.slice(prefix.length) : text
}

function recordingPromptOps(db: Database.Interface["db"], cost = 0) {
  const prompted: string[] = []
  const ops: { prompt: SessionPrompt.Interface["prompt"]; cancel: SessionPrompt.Interface["cancel"] } = {
    prompt: (input) =>
      Effect.gen(function* () {
        if (input.noReply) return assistantReply()
        const text = authorPrompt(input.parts?.[0]?.type === "text" ? input.parts[0].text : "")
        prompted.push(text)
        const last = yield* persistTurns(db, input.sessionID, [
          { cost, tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } } },
        ])
        return {
          info: last.info,
          parts: [{ type: "text", text: "out:" + text }],
        } as unknown as SessionV1.WithParts
      }),
    cancel: () => Effect.void,
  }
  return { ops, prompted }
}

describe("Workflow", () => {
  // The engine must publish run-lifecycle bus events from persistRun so non-TUI
  // consumers (dashboard, plugins) can observe a run instead of polling. A run
  // crosses persistRun at least once while `running` and once at its terminal
  // transition, so a subscriber must see >=1 `workflow.run.updated` (running)
  // and a final `workflow.run.finished` (completed). The payload is the SLIM
  // shape: `agents` is a COUNT object, never the full array.
  it.instance("publishes workflow.run.updated/finished bus events with a slim payload", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* Effect.promise(() => writeWorkflow(test.directory, EVENTS_FIXTURE, EVENTS_WORKFLOW))
      const workflow = yield* Workflow.Service
      const events = yield* EventV2Bridge.Service
      const seen: Array<{ type: string; data: Record<string, unknown> }> = []
      const unsub = yield* events.listen((event) =>
        Effect.sync(() => {
          if (event.type === "workflow.run.updated" || event.type === "workflow.run.finished")
            seen.push({ type: event.type, data: event.data as Record<string, unknown> })
        }),
      )
      yield* Effect.addFinalizer(() => unsub)

      const started = yield* workflow.start({ name: EVENTS_FIXTURE, args: {} })
      const waited = yield* workflow.wait({ id: started.id })
      const done = waited.run ?? (yield* Effect.fail(new Error("events workflow did not finish")))
      expect(done.status).toBe("completed")

      // At least one `running` update was seen during the run.
      const running = seen.filter((e) => e.type === "workflow.run.updated" && e.data["status"] === "running")
      expect(running.length).toBeGreaterThanOrEqual(1)

      // The final event is the terminal `finished` with status completed.
      const last = seen.at(-1) ?? (yield* Effect.fail(new Error("no workflow.run events seen")))
      expect(last.type).toBe("workflow.run.finished")
      expect(last.data["status"]).toBe("completed")

      // Slim payload: the metadata fields plus an `agents` COUNT object (never the
      // full agents array).
      expect(last.data["id"]).toBe(started.id)
      expect(last.data["workflow"]).toBe(EVENTS_FIXTURE)
      expect(last.data["current_phase"]).toBe("run")
      expect(last.data["directory"]).toBe(test.directory)
      expect(last.data["agents"]).toEqual({ total: 0, running: 0, failed: 0 })
      expect(Array.isArray(last.data["agents"])).toBe(false)
      // The slim payload carries a `pending_question` flag (false for a run with
      // no open human-in-the-loop question — Tasks 12/13).
      expect(last.data["pending_question"]).toBe(false)
    }),
  )

  // Finding 15: the zero-agent fixture above only ever asserts the slim-payload
  // `agents` count in its trivial all-zero state, so a regression that swapped the
  // `running`/`failed` filters or always emitted zeros would still pass. Drive a run
  // that dispatches TWO agents — one completed, one failed (caught) — and assert the
  // emitted `agents` object carries the real NON-zero split, so the count
  // COMPUTATION (not just the "it's a count object" shape) is falsifiable.
  it.instance("the slim-payload agents count reflects a real non-zero total/running/failed split", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* Effect.promise(() => writeWorkflow(test.directory, EVENTS_AGENTS_FIXTURE, EVENTS_AGENTS_WORKFLOW))
      const workflow = yield* Workflow.Service
      const events = yield* EventV2Bridge.Service
      const { db } = yield* Database.Service
      const seen: Array<{ type: string; data: Record<string, unknown> }> = []
      const unsub = yield* events.listen((event) =>
        Effect.sync(() => {
          if (event.type === "workflow.run.updated" || event.type === "workflow.run.finished")
            seen.push({ type: event.type, data: event.data as Record<string, unknown> })
        }),
      )
      yield* Effect.addFinalizer(() => unsub)

      const started = yield* workflow.start({
        name: EVENTS_AGENTS_FIXTURE,
        args: {},
        prompt: eventsAgentsPromptOps(db),
      })
      const waited = yield* workflow.wait({ id: started.id })
      const done = waited.run ?? (yield* Effect.fail(new Error("events-agents workflow did not finish")))
      // The body caught the schema failure, so the run completes...
      expect(done.status).toBe("completed")
      // ...with exactly one completed and one failed agent node.
      expect(done.agents.length).toBe(2)
      expect(done.agents.filter((a) => a.status === "completed").length).toBe(1)
      expect(done.agents.filter((a) => a.status === "failed").length).toBe(1)

      // The terminal slim payload's `agents` COUNT reflects that real split — a
      // swapped running/failed filter or an always-zero emitter would fail here.
      const last = seen.at(-1) ?? (yield* Effect.fail(new Error("no workflow.run events seen")))
      expect(last.type).toBe("workflow.run.finished")
      expect(last.data["agents"]).toEqual({ total: 2, running: 0, failed: 1 })
      expect(Array.isArray(last.data["agents"])).toBe(false)

      // The `running` filter is also exercised live: at least one mid-run `updated`
      // event must have carried a running agent count >= 1 (a dispatched agent is
      // `running` until it settles), so swapping running<->failed would be caught
      // both at the terminal event AND on a live update.
      const runningCounts = seen
        .filter((e) => e.type === "workflow.run.updated")
        .map((e) => (e.data["agents"] as { running: number }).running)
      expect(runningCounts.some((n) => n >= 1)).toBe(true)
    }),
  )

  // Fund 48 (deterministic ordering): the pipeline runs each item's stage SEQUENCE
  // independently — there is NO barrier between stages, so item B can be in stage 2
  // while item A is still in stage 1. Previously proven by sleeping item A 80ms in
  // stage 1 (wall-clock flake); now item A parks on a shared gate in stage 1 and
  // the test waits for B's stage-2 marker (a CONDITION) before releasing A, so the
  // ordering is guaranteed regardless of scheduling speed. Stage 2 also changes the
  // type (string -> { a, b }), proving heterogeneous stages.
  it.instance("pipeline runs stages per item without a barrier and supports heterogeneous types", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* Effect.promise(() => writeWorkflow(test.directory, PIPELINE_ORDER_FIXTURE, PIPELINE_ORDER_WORKFLOW))
      const workflow = yield* Workflow.Service
      const sync = installBarrier()
      const run = yield* workflow.start({ name: PIPELINE_ORDER_FIXTURE, args: { __barrier: sync.token } })
      // Deterministic proof: wait until B has REACHED stage 2 (while A is still
      // parked in stage 1), then release A so the run can finish.
      yield* sync.awaitOrder("B:stage2")
      sync.barrier.release()
      const waited = yield* workflow.wait({ id: run.id })
      const done = waited.run ?? (yield* Effect.fail(new Error("pipeline did not finish")))
      expect(done.status).toBe("completed")
      const result = done.result as { order: string[]; result: Array<{ a: number; b: string }> }
      // No barrier between stages: B reached stage 2 before A left stage 1.
      expect(result.order.indexOf("B:stage2")).toBeLessThan(result.order.indexOf("A:stage1:done"))
      // Stage 2 changes the type; results stay in item order.
      expect(result.result).toEqual([
        { a: 1, b: "x" },
        { a: 2, b: "y" },
      ])
      delete globalThis.__workflowTestBarriers![sync.token]
    }),
  )

  // Fund 48/49 (deterministic peak): an explicit concurrencyLimit caps the number
  // of simultaneously-running parallel tasks. Previously proven by 6 tasks à ~40ms
  // hoping they overlap; now every task parks on a shared gate and the test polls
  // the live `active` counter, so the measured peak is the engine's real scheduling
  // decision, not a timing window. With limit 2 and 6 tasks exactly 2 tasks are
  // ever parked at once (peak === 2): a lower peak would mean over-clamping, a
  // higher one would mean the limit was ignored.
  it.instance("parallel respects concurrencyLimit", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* Effect.promise(() => writeWorkflow(test.directory, PARALLEL_BARRIER_FIXTURE, PARALLEL_BARRIER_WORKFLOW))
      const workflow = yield* Workflow.Service
      const sync = installBarrier()
      const run = yield* workflow.start({
        name: PARALLEL_BARRIER_FIXTURE,
        args: { __barrier: sync.token, count: 6, concurrencyLimit: 2 },
      })
      // Wait until the limit (2) tasks are simultaneously parked, then release the
      // gate so the whole batch can drain.
      yield* sync.awaitPeak(2)
      sync.barrier.release()
      const waited = yield* workflow.wait({ id: run.id })
      const done = waited.run ?? (yield* Effect.fail(new Error("parallel did not finish")))
      expect(done.status).toBe("completed")
      const result = done.result as { peak: number; result: number[] }
      expect(result.result).toHaveLength(6)
      // Exactly the limit: never above (limit honored) and never below 2 (no
      // accidental over-clamp to 1).
      expect(result.peak).toBe(2)
      delete globalThis.__workflowTestBarriers![sync.token]
    }),
  )

  // P1 (Claude parity): a rejecting parallel task must not fail the whole batch.
  // It resolves to `null` at its position, the surviving tasks keep their values,
  // and the drop is logged (never silent). Before this change the first rejection
  // killed the batch and the run ended `failed`.
  it.instance("parallel drops a rejecting task to null and logs it instead of failing the batch", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* Effect.promise(() => writeWorkflow(test.directory, PARALLEL_ERROR_FIXTURE, PARALLEL_ERROR_WORKFLOW, "ts"))
      const workflow = yield* Workflow.Service
      const started = yield* workflow.start({ name: PARALLEL_ERROR_FIXTURE, args: {} })
      const waited = yield* workflow.wait({ id: started.id })
      const run = waited.run ?? (yield* Effect.fail(new Error("par-err did not finish")))
      // The batch survives the rejection.
      expect(run.status).toBe("completed")
      expect((run.result as { out: unknown[] }).out).toEqual(["ok-1", null, "ok-3"])
      // The drop is logged, never silent — and carries the rejection's message.
      const dropLog = run.logs.find((l) => l.message.includes("parallel task 2 dropped"))
      expect(dropLog?.message).toContain("boom")
    }),
  )

  // P2 (Claude parity): a throwing stage in ctx.pipeline must not fail the whole
  // pipeline — it drops ONLY that item to `null` at its position and skips that
  // item's remaining stages; the other items run every stage to completion, and
  // the drop is logged (never silent). Before this change the first throwing item
  // aborted the whole pipeline and the run ended `failed`.
  it.instance("pipeline drops only the throwing item to null and skips its remaining stages", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* Effect.promise(() => writeWorkflow(test.directory, PIPELINE_ERROR_FIXTURE, PIPELINE_ERROR_WORKFLOW, "ts"))
      const workflow = yield* Workflow.Service
      const started = yield* workflow.start({ name: PIPELINE_ERROR_FIXTURE, args: {} })
      const waited = yield* workflow.wait({ id: started.id })
      const run = waited.run ?? (yield* Effect.fail(new Error("pipe-err did not finish")))
      expect(run.status).toBe("completed")
      const r = run.result as { out: unknown[]; calls: string[] }
      expect(r.out).toEqual([11, null, 31]) // only item 2 dropped
      expect(r.calls).not.toContain("s2:2") // item 2's remaining stages skipped
      expect(
        run.logs.some((l) => l.message.includes("pipeline item 2 dropped") && l.message.includes("stage1-boom")),
      ).toBe(true)
    }),
  )

  // Pipeline stages receive the item's index as their third parameter — the same
  // index in EVERY stage the item flows through (stage 2's `prev` is stage 1's
  // returned index, and stage 2's own `i` must match it).
  it.instance("pipeline stage receives the item index in every stage", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* Effect.promise(() => writeWorkflow(test.directory, PIPELINE_INDEX_FIXTURE, PIPELINE_INDEX_WORKFLOW))
      const workflow = yield* Workflow.Service
      const started = yield* workflow.start({ name: PIPELINE_INDEX_FIXTURE, args: {} })
      const waited = yield* workflow.wait({ id: started.id })
      const run = waited.run ?? (yield* Effect.fail(new Error("pipe-index did not finish")))
      expect(run.status).toBe("completed")
      expect((run.result as { out: unknown[] }).out).toEqual([
        { first: 0, second: 0 },
        { first: 1, second: 1 },
      ])
    }),
  )

  // Duplicate-items log bug: the drop log uses the forEach index, so the SECOND
  // occurrence of an identical item reports "item 2" — the old items.indexOf
  // logging always named the first occurrence ("item 1").
  it.instance("duplicate items log the true index on drop", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* Effect.promise(() => writeWorkflow(test.directory, PIPELINE_DUP_FIXTURE, PIPELINE_DUP_WORKFLOW))
      const workflow = yield* Workflow.Service
      const started = yield* workflow.start({ name: PIPELINE_DUP_FIXTURE, args: {} })
      const waited = yield* workflow.wait({ id: started.id })
      const run = waited.run ?? (yield* Effect.fail(new Error("pipe-dup did not finish")))
      expect(run.status).toBe("completed")
      // Only the second occurrence dropped, at its true position.
      expect((run.result as { out: unknown[] }).out).toEqual(["a", null])
      const dropLog = run.logs.find((l) => l.message.includes("dropped"))
      expect(dropLog?.message).toContain("pipeline item 2 dropped")
      expect(dropLog?.message).toContain("dup-boom")
      expect(run.logs.some((l) => l.message.includes("pipeline item 1 dropped"))).toBe(false)
    }),
  )

  // Item cap (Claude parity): a single ctx.parallel call may carry at most 4096
  // tasks. One past the cap fails the run with an explicit InvalidError naming the
  // limit at the call site — never a silent mass of null drops.
  it.instance("parallel rejects more than 4096 tasks with an explicit error", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* Effect.promise(() => writeWorkflow(test.directory, PARALLEL_CAP_FIXTURE, PARALLEL_CAP_WORKFLOW))
      const workflow = yield* Workflow.Service
      const started = yield* workflow.start({ name: PARALLEL_CAP_FIXTURE, args: { count: 4097 } })
      const waited = yield* workflow.wait({ id: started.id })
      const run = waited.run ?? (yield* Effect.fail(new Error("par-cap did not finish")))
      expect(run.status).toBe("failed")
      expect(run.error).toContain("at most 4096")
      expect(run.error).toContain("4097")
    }),
  )

  // Same cap for ctx.pipeline, with the pipeline-specific wording.
  it.instance("pipeline rejects more than 4096 items with an explicit error", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* Effect.promise(() => writeWorkflow(test.directory, PIPELINE_CAP_FIXTURE, PIPELINE_CAP_WORKFLOW))
      const workflow = yield* Workflow.Service
      const started = yield* workflow.start({ name: PIPELINE_CAP_FIXTURE, args: { count: 4097 } })
      const waited = yield* workflow.wait({ id: started.id })
      const run = waited.run ?? (yield* Effect.fail(new Error("pipe-cap did not finish")))
      expect(run.status).toBe("failed")
      expect(run.error).toContain("ctx.pipeline supports at most 4096")
    }),
  )

  // Boundary: EXACTLY 4096 items pass the gate (only > caps) and the batch runs
  // through with the default concurrency clamp.
  it.instance("parallel allows exactly 4096 tasks", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* Effect.promise(() => writeWorkflow(test.directory, PARALLEL_CAP_FIXTURE, PARALLEL_CAP_WORKFLOW))
      const workflow = yield* Workflow.Service
      const started = yield* workflow.start({ name: PARALLEL_CAP_FIXTURE, args: { count: 4096 } })
      const waited = yield* workflow.wait({ id: started.id })
      const run = waited.run ?? (yield* Effect.fail(new Error("par-cap boundary did not finish")))
      expect(run.status).toBe("completed")
      expect((run.result as { length: number }).length).toBe(4096)
    }),
  )

  // Fund 49 (default parallel concurrency): `ctx.parallel` WITHOUT an explicit
  // concurrencyLimit clamps to the documented default of 20
  // (`Math.max(1, options?.concurrencyLimit ?? 20)` in createContext). With 25
  // tasks all parked on the gate, exactly 20 run at once — peak === 20, never 25
  // (would mean unbounded) and never 1 (would mean over-clamped). Deterministic via
  // the parked-task counter, no timing window.
  it.instance("parallel without an explicit limit defaults to a peak concurrency of 20", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* Effect.promise(() => writeWorkflow(test.directory, PARALLEL_BARRIER_FIXTURE, PARALLEL_BARRIER_WORKFLOW))
      const workflow = yield* Workflow.Service
      const sync = installBarrier()
      // 25 tasks, NO concurrencyLimit ⇒ engine default 20.
      const run = yield* workflow.start({
        name: PARALLEL_BARRIER_FIXTURE,
        args: { __barrier: sync.token, count: 25 },
      })
      // Exactly the default (20) tasks become parked simultaneously; the remaining
      // 5 wait for a slot. Wait for that peak, then drain.
      yield* sync.awaitPeak(20)
      // The peak must not climb past the default even given a moment to settle: a
      // 21st parked task would mean the default cap was not applied.
      expect(sync.barrier.active).toBe(20)
      sync.barrier.release()
      const waited = yield* workflow.wait({ id: run.id })
      const done = waited.run ?? (yield* Effect.fail(new Error("parallel did not finish")))
      expect(done.status).toBe("completed")
      const result = done.result as { peak: number; result: number[] }
      expect(result.result).toHaveLength(25)
      expect(result.peak).toBe(20)
      delete globalThis.__workflowTestBarriers![sync.token]
    }),
  )

  // Fund 49 (parallel limit floor): an explicit concurrencyLimit of 0 (and any
  // negative value) is floored to 1 — `Math.max(1, …)` — so the batch runs strictly
  // sequentially (peak === 1) rather than degenerating into "no tasks run" or
  // unbounded. Consistency guard for the clamp.
  it.instance("parallel concurrencyLimit 0 and negative are clamped to a peak of 1", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* Effect.promise(() => writeWorkflow(test.directory, PARALLEL_BARRIER_FIXTURE, PARALLEL_BARRIER_WORKFLOW))
      const workflow = yield* Workflow.Service
      for (const limit of [0, -5]) {
        const sync = installBarrier()
        const run = yield* workflow.start({
          name: PARALLEL_BARRIER_FIXTURE,
          args: { __barrier: sync.token, count: 4, concurrencyLimit: limit },
        })
        // Only ONE task is ever parked at a time; release it so the next can run.
        yield* sync.awaitPeak(1)
        expect(sync.barrier.active).toBe(1)
        sync.barrier.release()
        const waited = yield* workflow.wait({ id: run.id })
        const done = waited.run ?? (yield* Effect.fail(new Error(`parallel(${limit}) did not finish`)))
        expect(done.status).toBe("completed")
        const result = done.result as { peak: number; result: number[] }
        expect(result.result).toHaveLength(4)
        expect(result.peak).toBe(1)
        delete globalThis.__workflowTestBarriers![sync.token]
      }
    }),
  )

  // Fund 49 (default pipeline concurrency): `ctx.pipeline` WITHOUT options runs its
  // items UNBOUNDED (the pipeline default differs from parallel's 20 — see
  // createContext: `options?.concurrencyLimit === undefined ? "unbounded" : …`). With
  // 25 items all parked in the single stage, ALL 25 run concurrently — peak === 25.
  it.instance("pipeline without options runs items unbounded", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* Effect.promise(() => writeWorkflow(test.directory, PIPELINE_BARRIER_FIXTURE, PIPELINE_BARRIER_WORKFLOW))
      const workflow = yield* Workflow.Service
      const sync = installBarrier()
      const run = yield* workflow.start({
        name: PIPELINE_BARRIER_FIXTURE,
        args: { __barrier: sync.token, count: 25 },
      })
      // Unbounded ⇒ every item parks at once; the peak equals the item count.
      yield* sync.awaitPeak(25)
      expect(sync.barrier.active).toBe(25)
      sync.barrier.release()
      const waited = yield* workflow.wait({ id: run.id })
      const done = waited.run ?? (yield* Effect.fail(new Error("pipeline did not finish")))
      expect(done.status).toBe("completed")
      const result = done.result as { peak: number; result: number[] }
      expect(result.result).toHaveLength(25)
      expect(result.peak).toBe(25)
      delete globalThis.__workflowTestBarriers![sync.token]
    }),
  )

  // Fund 49 (pipeline limit floor): a pipeline concurrencyLimit of 0 is floored to 1
  // (same `Math.max(1, …)` clamp as parallel), so items run strictly one at a time
  // (peak === 1) instead of unbounded — only an UNSET limit means unbounded.
  it.instance("pipeline concurrencyLimit 0 is clamped to a peak of 1", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* Effect.promise(() => writeWorkflow(test.directory, PIPELINE_BARRIER_FIXTURE, PIPELINE_BARRIER_WORKFLOW))
      const workflow = yield* Workflow.Service
      const sync = installBarrier()
      const run = yield* workflow.start({
        name: PIPELINE_BARRIER_FIXTURE,
        args: { __barrier: sync.token, count: 4, concurrencyLimit: 0 },
      })
      yield* sync.awaitPeak(1)
      expect(sync.barrier.active).toBe(1)
      sync.barrier.release()
      const waited = yield* workflow.wait({ id: run.id })
      const done = waited.run ?? (yield* Effect.fail(new Error("pipeline did not finish")))
      expect(done.status).toBe("completed")
      const result = done.result as { peak: number; result: number[] }
      expect(result.result).toHaveLength(4)
      expect(result.peak).toBe(1)
      delete globalThis.__workflowTestBarriers![sync.token]
    }),
  )

  it.instance("discovers workflow files", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* Effect.promise(() =>
        writeWorkflow(
          test.directory,
          "hello",
          `export const meta = { name: "Hello", description: "Test workflow", phases: ["start"] }
export async function run(args, ctx) { ctx.setPhase("start"); ctx.log("hello"); return { ok: true } }
`,
        ),
      )
      const workflow = yield* Workflow.Service
      const list = yield* workflow.list()
      expect(list.map((item) => item.name)).toContain("hello")
      expect(list.find((item) => item.name === "hello")?.meta.name).toBe("Hello")
    }),
  )

  it.instance("list() statically extracts meta and never executes module top-level code; start() does", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const marker = path.join(os.tmpdir(), `workflow-side-effect-${Math.random().toString(16).slice(2)}`)
      yield* Effect.promise(() => writeWorkflow(test.directory, SIDE_EFFECT_FIXTURE, sideEffectWorkflow(marker)))
      const workflow = yield* Workflow.Service

      const list = yield* workflow.list()
      const info = list.find((item) => item.name === SIDE_EFFECT_FIXTURE)
      // Meta was extracted statically (valid + literal values present)...
      expect(info?.valid).toBe(true)
      expect(info?.meta.name).toBe("SideEffect")
      expect(info?.meta.description).toBe("writes a marker on import")
      // ...but the module's top-level code was NEVER executed: no marker file.
      expect(yield* Effect.promise(() => Bun.file(marker).exists())).toBe(false)

      // start() really imports the target module, so now the marker appears.
      const run = yield* workflow.start({ name: SIDE_EFFECT_FIXTURE, args: {} })
      const waited = yield* workflow.wait({ id: run.id })
      expect(waited.run?.status).toBe("completed")
      expect(yield* Effect.promise(() => Bun.file(marker).exists())).toBe(true)
    }),
  )

  it.instance("non-statically-analyzable meta is reported invalid without running the file", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const marker = path.join(os.tmpdir(), `workflow-dynamic-meta-${Math.random().toString(16).slice(2)}`)
      // Dynamic meta value (process.env) plus a top-level side effect: the file
      // must be reported invalid AND never executed during list().
      yield* Effect.promise(() =>
        writeWorkflow(
          test.directory,
          "dynamic-meta",
          `await Bun.write(${JSON.stringify(marker)}, "executed")
export const meta = { name: process.env.SECRET }
export async function run(args, ctx) { return { ok: true } }
`,
        ),
      )
      const workflow = yield* Workflow.Service
      const list = yield* workflow.list()
      const info = list.find((item) => item.name === "dynamic-meta")
      expect(info?.valid).toBe(false)
      expect(info?.error).toContain("statically analyzable")
      expect(yield* Effect.promise(() => Bun.file(marker).exists())).toBe(false)
    }),
  )

  it.instance("a broken workflow file does not break list(); it is reported invalid", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* Effect.promise(() =>
        writeWorkflow(
          test.directory,
          HELLO_FIXTURE,
          `export const meta = { name: "Hello", description: "Test workflow", phases: ["start"] }
export async function run(args, ctx) { ctx.setPhase("start"); ctx.log("hello"); return { ok: true } }
`,
        ),
      )
      // Syntaxfehler: unvollständiges Objektliteral -> Modul-Load schlägt fehl.
      yield* Effect.promise(() => writeWorkflow(test.directory, "broken", "export const meta = {"))
      const workflow = yield* Workflow.Service

      const all = yield* workflow.list()
      const broken = all.find((item) => item.name === "broken")
      expect(broken?.valid).toBe(false)
      expect(broken?.error).toBeTruthy()
      // Die gute Datei bleibt trotz der kaputten weiterhin gelistet und gültig.
      expect(all.some((item) => item.name === HELLO_FIXTURE && item.valid !== false)).toBe(true)
    }),
  )

  it.instance("start loads only the target module and fails precisely for broken target", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* Effect.promise(() =>
        writeWorkflow(
          test.directory,
          HELLO_FIXTURE,
          `export const meta = { name: "Hello" }
export async function run(args, ctx) { ctx.setPhase("run"); ctx.log("running"); return { ok: true } }
`,
        ),
      )
      yield* Effect.promise(() => writeWorkflow(test.directory, "broken", "export const meta = {"))
      const workflow = yield* Workflow.Service

      // Ein kaputtes Ziel scheitert präzise (InvalidError, der die Datei/den Namen nennt).
      const failed = yield* workflow.start({ name: "broken", args: {} }).pipe(Effect.flip)
      expect(failed._tag).toBe("WorkflowInvalidError")
      // Narrow the start() error union (InvalidError | NotFoundError) to the
      // precise InvalidError so its `path` is accessible and typed.
      const invalid =
        failed instanceof Workflow.InvalidError ? failed : yield* Effect.fail(new Error("expected InvalidError"))
      expect(invalid.path).toContain("broken")

      // Die gültige Datei ist trotz broken.ts startbar (kein voller list()-Abbruch).
      const ok = yield* workflow.start({ name: HELLO_FIXTURE, args: {} })
      expect(ok.id).toBeTruthy()
    }),
  )

  it.instance("starts and records a workflow run", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* Effect.promise(() =>
        writeWorkflow(
          test.directory,
          "hello",
          `export const meta = { name: "Hello" }
export async function run(args, ctx) { ctx.setPhase("run"); ctx.log("running"); return { value: args.value } }
`,
        ),
      )
      const workflow = yield* Workflow.Service
      const run = yield* workflow.start({ name: "hello", args: { value: 42 } })
      expect(run.status).toBe("running")
      const waited = yield* workflow.wait({ id: run.id })
      const done = waited.run ?? (yield* Effect.fail(new Error("workflow did not finish")))
      expect(done.current_phase).toBe("run")
      expect(done.logs.map((item) => item.message)).toContain("running")
      expect(done.args).toEqual({ value: 42 })
      expect(done.definition?.name).toBe("hello")
      expect(done.definition?.path.endsWith("hello.js")).toBe(true)
      expect(done.result).toEqual({ value: 42 })
    }),
  )

  // Race-regression: cancel() must never report a run as "not found" (undefined →
  // HTTP 404) when it LOSES the race against the run's own natural completion. In
  // the live engine the body fiber's finish("completed") persists the terminal row
  // AND N1-evicts the run from the registry between cancel's registry read and its
  // own finish("cancelled") — leaving that finish to return undefined for a run
  // that exists and is terminal. cancel must then fall back to the persisted
  // snapshot showing the TRUE terminal status (completed), NOT undefined and NOT
  // rewritten to cancelled.
  //
  // Deterministic coverage of the FIX SEMANTICS (the observable contract), not of
  // the exact lost-race code line: complete the run first (await its terminal state
  // via wait, which resolves at finish's Deferred — committed terminal row, but the
  // subsequent N1-evict may or may not have run yet), THEN cancel. The cancel then
  // takes one of the two non-undefined branches — `snapshot(active)` if still
  // registered, or the persisted-DB fallback once evicted — both returning the TRUE
  // terminal status. The pre-fix code returned undefined on the evicted branch.
  // The precise finish-undefined window (cancel's OWN finish returning undefined
  // mid-eviction, the named `finished ?? persisted()` line) is exercised end-to-end
  // by script/httpapi-exercise.ts (workflow.start), whose fixture completes
  // synchronously fast; this unit test pins the contract those branches must honor.
  it.instance("cancel of an already-completed (evicted) run returns the completed snapshot, never undefined", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* Effect.promise(() =>
        writeWorkflow(
          test.directory,
          "instant",
          `export const meta = { name: "Instant" }
export async function run(args, ctx) { ctx.setPhase("run"); return { value: args.value } }
`,
        ),
      )
      const workflow = yield* Workflow.Service
      const run = yield* workflow.start({ name: "instant", args: { value: 7 } })
      // Drive to terminal: wait resolves only after finish() committed the terminal
      // row, and finish() then evicts the run from the live registry (N1).
      const waited = yield* workflow.wait({ id: run.id })
      const done = waited.run ?? (yield* Effect.fail(new Error("workflow did not finish")))
      expect(done.status).toBe("completed")
      // Cancel after completion: the run is terminal and (being) evicted, so cancel
      // either snapshots the still-registered terminal run or, once evicted, takes
      // the new finish-undefined fallback to the persisted row. Both must return a
      // non-undefined run whose status is the TRUE terminal status, never cancelled.
      const cancelled = yield* workflow.cancel(run.id)
      expect(cancelled).toBeDefined()
      expect(cancelled?.status).toBe("completed")
      expect(cancelled?.result).toEqual({ value: 7 })
      // Reserved meaning preserved: a genuinely unknown id still reports undefined.
      expect(yield* workflow.cancel(Workflow.RunID.make("job_unknown_id"))).toBeUndefined()
    }),
  )

  it.instance("preserves temporary workflow source in run definition", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const source = `export const meta = { name: "Temporary" }
export async function run(args, ctx) { ctx.setPhase("run"); return { value: args.value } }
`
      yield* Effect.promise(() => writeWorkflow(test.directory, "temporary", source))
      const workflow = yield* Workflow.Service
      const run = yield* workflow.start({ name: "temporary", args: { value: 99 }, source, temporary: true })
      const waited = yield* workflow.wait({ id: run.id })
      const done = waited.run ?? (yield* Effect.fail(new Error("workflow did not finish")))
      expect(done.definition?.temporary).toBe(true)
      expect(done.definition?.source).toBe(source)
      expect(done.result).toEqual({ value: 99 })
    }),
  )

  // Inline-source start (P3): start({ source, temporary: true }) with NO name loads
  // the module straight from the source string via the builtin source-string load
  // path under a synthetic `inline:<metaName>` marker — never written to the
  // project, never discovered. The run completes, the definition carries the
  // source, list() does NOT surface it, and a second identical start works (the
  // temp-file name randomizes, so no collision).
  it.instance("starts an inline source as a temporary run without discovery", () =>
    Effect.gen(function* () {
      const source = `export const meta = { name: "InlineEngine", description: "Inline." }
export async function run(args, ctx) { ctx.setPhase("run"); return { value: args.value } }
`
      const workflow = yield* Workflow.Service
      const run = yield* workflow.start({ args: { value: 7 }, source, temporary: true })
      const waited = yield* workflow.wait({ id: run.id })
      const done = waited.run ?? (yield* Effect.fail(new Error("inline workflow did not finish")))
      expect(done.status).toBe("completed")
      expect(done.workflow).toBe("InlineEngine")
      expect(done.definition?.temporary).toBe(true)
      expect(done.definition?.source).toBe(source)
      expect(done.result).toEqual({ value: 7 })
      // Never discovered: list() does not surface an inline run's workflow.
      const listed = yield* workflow.list()
      expect(listed.some((item) => item.name === "InlineEngine")).toBe(false)
      // A second identical inline start works (no temp-file collision).
      const run2 = yield* workflow.start({ args: { value: 8 }, source, temporary: true })
      const done2 =
        (yield* workflow.wait({ id: run2.id })).run ??
        (yield* Effect.fail(new Error("second inline workflow did not finish")))
      expect(done2.status).toBe("completed")
      expect(done2.result).toEqual({ value: 8 })
    }),
  )

  // A NAMED on-disk run must carry its module SOURCE in `definition.source` (not
  // just inline starts). The dashboard's save-as-command and any run-detail source
  // view read `run.definition.source`; before the fix only inline starts populated
  // it (`source: input.source`), so a named/on-disk run had `source: undefined` and
  // "save as command" / source view were blank for every real workflow.
  it.instance("a named on-disk run carries its file source in definition.source", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const source = `export const meta = { name: "SourceCarry" }
export async function run(args, ctx) { ctx.setPhase("run"); return { value: args.value } }
`
      yield* Effect.promise(() => writeWorkflow(test.directory, "source-carry", source))
      const workflow = yield* Workflow.Service
      const run = yield* workflow.start({ name: "source-carry", args: { value: 5 } })
      const waited = yield* workflow.wait({ id: run.id })
      const done = waited.run ?? (yield* Effect.fail(new Error("workflow did not finish")))
      expect(done.definition?.source).toBe(source)
    }),
  )

  // A BUILTIN run must carry the bundled module string in `definition.source` so
  // save-as-command works for a builtin too (its `path` is a synthetic marker, not
  // a readable file).
  it.instance("a builtin run carries the bundled source in definition.source", () =>
    Effect.gen(function* () {
      const workflow = yield* Workflow.Service
      const run = yield* workflow.start({ name: "deep-research", args: { question: "x" } })
      // The builtin body needs no model to populate definition at START time — the
      // run's definition.source is set synchronously by start(), so cancel and
      // assert without waiting for the (model-dependent) body to finish.
      yield* workflow.cancel(run.id)
      expect(run.definition?.source).toBe(BUILTIN_WORKFLOWS["deep-research"])
    }),
  )

  // Source-availability read seam (Vasya's "CODE PREVIEW shows nothing"): the
  // pre-run approval preview has no run yet, so it cannot read run.definition.source.
  // workflow.read(name) returns the resolved module source for a NAME — file text
  // for an on-disk workflow, the bundled string for a builtin — without a raw
  // file.read({absolutePath}) (which failed for absolute paths and returned "" for
  // synthetic builtin markers).
  it.instance("read() returns the file source for an on-disk workflow", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const source = `export const meta = { name: "ReadSeam" }
export async function run() { return {} }
`
      yield* Effect.promise(() => writeWorkflow(test.directory, "read-seam", source))
      const workflow = yield* Workflow.Service
      const read = yield* workflow.read("read-seam")
      expect(read?.source).toBe(source)
    }),
  )

  it.instance("read() returns the bundled source for a builtin", () =>
    Effect.gen(function* () {
      const workflow = yield* Workflow.Service
      const read = yield* workflow.read("deep-research")
      expect(read?.source).toBe(BUILTIN_WORKFLOWS["deep-research"])
    }),
  )

  it.instance("read() returns undefined for an unknown workflow name", () =>
    Effect.gen(function* () {
      const workflow = yield* Workflow.Service
      expect(yield* workflow.read("does-not-exist-xyz")).toBeUndefined()
    }),
  )

  // Inline-source start with an INVALID source (non-literal meta name → MetaReader
  // rejects it statically) fails the start as a WorkflowInvalidError, never a
  // defect — the engine validates the source defensively even though the tool also
  // pre-validates before its permission ask.
  it.instance("inline source with invalid meta fails the start as InvalidError", () =>
    Effect.gen(function* () {
      const workflow = yield* Workflow.Service
      const source = `export const meta = { name: someVar }
export async function run() {}
`
      const exit = yield* Effect.exit(workflow.start({ source, temporary: true }))
      expect(Exit.isFailure(exit)).toBe(true)
      expect(Exit.isFailure(exit) ? Cause.pretty(exit.cause) : "").toContain("WorkflowInvalidError")
    }),
  )

  // Static meta gate on the NAME start path: a name start (HTTP/programmatic)
  // previously imported the module directly — only the inline path validated
  // statically. Now the same MetaReader gate runs BEFORE loadModule, so computed
  // meta fails the start as an InvalidError AND the module's top-level code is
  // never executed (no marker file — the gate fired before any import).
  it.instance("start by NAME rejects computed meta statically, before the module is imported", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const marker = path.join(os.tmpdir(), `workflow-name-gate-${Math.random().toString(16).slice(2)}`)
      yield* Effect.promise(() =>
        writeWorkflow(
          test.directory,
          "computed-meta-name",
          `await Bun.write(${JSON.stringify(marker)}, "executed")
export const meta = { name: globalThis.__wfName ?? "computed" }
export async function run(args, ctx) { return { ok: true } }
`,
        ),
      )
      const workflow = yield* Workflow.Service
      const failed = yield* workflow.start({ name: "computed-meta-name", args: {} }).pipe(Effect.flip)
      expect(failed._tag).toBe("WorkflowInvalidError")
      const invalid =
        failed instanceof Workflow.InvalidError ? failed : yield* Effect.fail(new Error("expected InvalidError"))
      expect(invalid.message).toContain("statically analyzable")
      // The gate fired BEFORE the import: the top-level marker was never written.
      expect(yield* Effect.promise(() => Bun.file(marker).exists())).toBe(false)
    }),
  )

  // Same gate on the SECOND ungated seam: a nested ctx.workflow child module is
  // statically validated before loadModule imports it, so a computed-meta child
  // fails the parent run without ever executing the child's top-level code.
  it.instance("nested ctx.workflow rejects a computed-meta child before import", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const marker = path.join(os.tmpdir(), `workflow-nested-gate-${Math.random().toString(16).slice(2)}`)
      yield* Effect.promise(() =>
        writeWorkflow(
          test.directory,
          "bad-child",
          `await Bun.write(${JSON.stringify(marker)}, "executed")
export const meta = { name: globalThis.__wfName ?? "bad-child" }
export async function run(args, ctx) { return { ok: true } }
`,
        ),
      )
      yield* Effect.promise(() =>
        writeWorkflow(
          test.directory,
          "gate-parent",
          `export const meta = { name: "gate-parent" }
export async function run(_args, ctx) { return await ctx.workflow("bad-child") }
`,
        ),
      )
      const workflow = yield* Workflow.Service
      const started = yield* workflow.start({ name: "gate-parent", args: {} })
      const waited = yield* workflow.wait({ id: started.id })
      const run = waited.run ?? (yield* Effect.fail(new Error("gate-parent did not finish")))
      expect(run.status).toBe("failed")
      expect(run.error).toContain("statically analyzable")
      // The child's top-level marker was never written: gate before import.
      expect(yield* Effect.promise(() => Bun.file(marker).exists())).toBe(false)
    }),
  )

  it.instance("loads TypeScript workflow default exports", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* Effect.promise(() =>
        writeWorkflow(
          test.directory,
          "typed",
          `export default {
  meta: { name: "Typed Workflow", phases: ["run"] },
  async run(args, ctx) { ctx.setPhase("run"); ctx.log("typed"); return { value: args.value } }
}
`,
          "ts",
        ),
      )
      const workflow = yield* Workflow.Service
      const list = yield* workflow.list()
      expect(list.map((item) => item.name)).toContain("typed")
      const run = yield* workflow.start({ name: "typed", args: { value: 7 } })

      const done = yield* pollWithTimeout(
        Effect.gen(function* () {
          const current = yield* workflow.get(run.id)
          return current?.status === "completed" ? current : undefined
        }),
        "workflow never completed",
      )
      expect(done.result).toEqual({ value: 7 })
    }),
  )

  it.instance("cancel interrupts a running workflow and aborts its agent sessions", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* Effect.promise(() => writeWorkflow(test.directory, SLOW_FIXTURE, SLOW_WORKFLOW))
      const workflow = yield* Workflow.Service
      const { ops, aborted, started } = hangingPromptOps()

      const run = yield* workflow.start({ name: SLOW_FIXTURE, args: {}, prompt: ops })

      // Warten bis der erste Agent läuft und seine Child-Session erzeugt hat.
      const live = yield* pollWithTimeout(
        Effect.gen(function* () {
          const current = yield* workflow.get(run.id)
          return current && current.agents.some((a) => a.status === "running" && a.session_id) ? current : undefined
        }),
        "agent never started",
      )
      expect(live.agents.some((a) => a.status === "running")).toBe(true)

      yield* workflow.cancel(run.id)

      const after = yield* workflow.get(run.id)
      const done = after ?? (yield* Effect.fail(new Error("run vanished")))
      expect(done.status).toBe("cancelled")
      // Kein Agent darf nach Cancel noch laufen.
      expect(done.agents.every((a) => a.status !== "running")).toBe(true)
      // Folge-Step darf nie gestartet sein.
      expect(done.logs.some((l) => l.message?.includes(STEP2_MARKER))).toBe(false)
      // Kern-Assertion: die Child-Session wurde echt abgebrochen.
      const childSession = done.agents[0]?.session_id
      expect(childSession).toBeDefined()
      expect(started.has(childSession!)).toBe(true)
      expect(aborted.has(childSession!)).toBe(true)
    }),
  )

  // Fund 4 (HIGH): Mit dem REALEN resolve-on-abort-Runner RESOLVED der Agent-
  // Prompt bei Abort (statt zu rejecten). Die Settlement-Erfolgsverzweigung darf
  // den abort-resolved Step NICHT auf `completed` flippen, keinen Write nach dem
  // Terminal-Write absetzen und das Budget nicht fälschlich belasten.
  it.instance("cancel with a resolve-on-abort runner never flips the agent node to completed", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* Effect.promise(() => writeWorkflow(test.directory, SLOW_FIXTURE, SLOW_WORKFLOW))
      const workflow = yield* Workflow.Service
      const { ops, aborted, started } = resolveOnAbortPromptOps()

      const run = yield* workflow.start({ name: SLOW_FIXTURE, args: {}, prompt: ops, budget: 5 })

      const live = yield* pollWithTimeout(
        Effect.gen(function* () {
          const current = yield* workflow.get(run.id)
          return current && current.agents.some((a) => a.status === "running" && a.session_id) ? current : undefined
        }),
        "agent never started",
      )
      const childSession = live.agents[0]?.session_id
      expect(childSession).toBeDefined()

      yield* workflow.cancel(run.id)

      const after = yield* workflow.get(run.id)
      const done = after ?? (yield* Effect.fail(new Error("run vanished")))
      expect(done.status).toBe("cancelled")
      // Der abort-resolved Agent darf NICHT als completed verbucht sein.
      expect(done.agents.every((a) => a.status !== "completed")).toBe(true)
      expect(done.agents.every((a) => a.status !== "running")).toBe(true)
      // Folge-Step lief nie.
      expect(done.logs.some((l) => l.message?.includes(STEP2_MARKER))).toBe(false)
      expect(started.has(childSession!)).toBe(true)
      expect(aborted.has(childSession!)).toBe(true)

      // KEIN Write nach dem Terminal-Write: ein kalter DB-Read (umgeht den
      // In-Memory-Snapshot) muss cancelled zeigen, nicht completed.
      const row = yield* fetchRunRow(run.id)
      expect(row.status).toBe("cancelled")
      expect(row.agents.every((a) => a.status !== "completed")).toBe(true)
    }),
  )

  // N11 (HIGH): Ein Run, der als `completed` endet, während ein Agent-Node noch
  // `running` ist (fire-and-forget ctx.agent, dessen Settlement nach Body-Ende
  // käme). finish('completed') MUSS den noch laufenden Node terminal schließen
  // (failed mit erklärendem error + completed_at) UND die offene Child-Session
  // wirklich abbrechen, sonst verbrennt die detached Session weiter Tokens.
  it.instance("completed run closes a still-running detached agent node and aborts its session", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* Effect.promise(() => writeWorkflow(test.directory, DETACHED_AGENT_FIXTURE, DETACHED_AGENT_WORKFLOW))
      const workflow = yield* Workflow.Service
      const { ops, aborted, started } = hangingPromptOps()

      const run = yield* workflow.start({ name: DETACHED_AGENT_FIXTURE, args: {}, prompt: ops })

      // Auf den vollständig settled Endzustand warten (der Body returnt, während
      // der detached Agent noch am Prompt hängt). Statt nur auf `completed` zu
      // pollen und dann zu hoffen, dass die Terminalisierung des Nodes UND die
      // Abort-Kaskade bereits durchgelaufen sind (das rennt unter CPU-Last gegen
      // den fire-and-forget-Settlement-Pfad), wird hier auf die echte Bedingung
      // gewartet: Run `completed`, der noch laufende Node terminal als `failed`
      // geschlossen (Grund + Zeit). If a child session was registered before
      // terminalization, it must also be aborted; if no child session was ever
      // created, there is nothing that can keep spending.
      const done = yield* pollWithTimeout(
        Effect.gen(function* () {
          const current = yield* workflow.get(run.id)
          if (current?.status !== "completed") return undefined
          if (current.agents.length === 0) return undefined
          if (current.agents.some((a) => a.status === "running")) return undefined
          const closed = current.agents.find((a) => a.status === "failed")
          if (!closed || !((closed.completed_at ?? 0) > 0) || !closed.error) return undefined
          if (Array.from(started).some((sessionID) => !aborted.has(sessionID))) return undefined
          return current
        }),
        "workflow never settled (completed + node closed + no un-aborted child sessions)",
        // Großzügiges Poll-Budget (unter dem 30s-Bun-Test-Timeout): der Settle
        // (completed -> Node terminal -> optional Abort-Kaskade beim Kind) ist
        // eine echte, letztlich wahre Bedingung; unter CPU-Last dauert die
        // Propagation nur länger als die Default-5s. Wir warten auf die
        // Bedingung, raten nicht.
        "25 seconds",
      )
      expect(done.status).toBe("completed")
      // Der noch laufende Node ist terminal geschlossen (failed + Grund + Zeit).
      expect(done.agents.length).toBeGreaterThan(0)
      expect(done.agents.every((a) => a.status !== "running")).toBe(true)
      const closed = done.agents.find((a) => a.status === "failed")
      expect(closed).toBeDefined()
      expect(closed!.completed_at).toBeGreaterThan(0)
      expect(closed!.error).toBeTruthy()

      // Kalt-Read beweist die Terminalisierung über den DB-Roundtrip.
      const row = yield* fetchRunRow(run.id)
      expect(row.status).toBe("completed")
      expect(row.agents.every((a) => a.status !== "running")).toBe(true)

      // Kern: keine hängende Child-Session darf weiterlaufen. Je nach Scheduler
      // kann der fire-and-forget-Agent vor finish() noch gar keine Session erzeugt
      // haben; wenn doch, muss diese Session explizit abgebrochen worden sein.
      for (const sessionID of started) {
        expect(aborted.has(sessionID)).toBe(true)
      }
    }),
  )

  // Fund 5 (HIGH): Cancel im Startup-Fenster — start() registriert den Run,
  // beantwortet aber die Initial-Phase verzögert; ein Cancel landet, BEVOR der
  // Body geforkt wird. Der Body darf NIE laufen (kein Marker) und der Run muss
  // als cancelled enden (nicht voll durchlaufen).
  it.instance("cancel during the startup window prevents the body from ever running", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const marker = path.join(os.tmpdir(), `workflow-startup-${Math.random().toString(16).slice(2)}`)
      yield* Effect.promise(() => writeWorkflow(test.directory, STARTUP_FIXTURE, startupWorkflow(marker)))
      const workflow = yield* Workflow.Service
      // Die Initial-noReply-Antwort wird ~150ms verzögert: start() hängt im
      // Initial-Prompt, der Run ist aber bereits registriert (status running).
      const { ops } = resolveOnAbortPromptOps({ delayMs: 150 })

      // start() forken, damit wir parallel im Startup-Fenster cancellen können.
      const startFiber = yield* Effect.forkScoped(workflow.start({ name: STARTUP_FIXTURE, args: {}, prompt: ops }))

      // Warten bis der Run registriert ist (running, noch kein Body).
      const id = yield* pollWithTimeout(
        Effect.gen(function* () {
          const all = yield* workflow.runs()
          const found = all.find((r) => r.workflow === STARTUP_FIXTURE)
          return found?.id
        }),
        "run never registered",
      )

      // Cancel im Fenster vor dem Body-Fork.
      yield* workflow.cancel(id)
      yield* Fiber.await(startFiber).pipe(Effect.ignore)
      // Settle-Zeit: falls der Body fälschlich geforkt würde, hätte er hier
      // längst Zeit gehabt, den Marker zu schreiben (Bug-Modell läuft voll durch).
      yield* Effect.sleep("300 millis")

      const done = yield* workflow.get(id)
      expect(done?.status).toBe("cancelled")
      // Der Body lief NIE: kein Marker.
      expect(yield* Effect.promise(() => Bun.file(marker).exists())).toBe(false)
    }),
  )

  it.instance("remove on a running run cancels it first, then deletes", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* Effect.promise(() => writeWorkflow(test.directory, SLOW_FIXTURE, SLOW_WORKFLOW))
      const workflow = yield* Workflow.Service
      const { ops, aborted } = hangingPromptOps()

      const run = yield* workflow.start({ name: SLOW_FIXTURE, args: {}, prompt: ops })

      const live = yield* pollWithTimeout(
        Effect.gen(function* () {
          const current = yield* workflow.get(run.id)
          return current && current.agents.some((a) => a.status === "running" && a.session_id) ? current : undefined
        }),
        "agent never started",
      )
      const childSession = live.agents[0]?.session_id
      expect(childSession).toBeDefined()

      yield* workflow.remove(run.id)

      // Run ist gelöscht.
      const gone = yield* workflow.get(run.id)
      expect(gone).toBeUndefined()
      // Und die Child-Session wurde vor dem Löschen abgebrochen.
      expect(aborted.has(childSession!)).toBe(true)
    }),
  )

  // Fund 3 (HIGH): Mit dem resolve-on-abort-Runner laufen die detached Agent-
  // Fibers über bridge.promise NACH dem db.delete weiter und re-INSERTen die
  // gelöschte Row (Zombie). Nach Settlement muss die Row GELÖSCHT bleiben.
  it.instance("remove keeps the row deleted even when the agent settles after delete", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* Effect.promise(() => writeWorkflow(test.directory, SLOW_FIXTURE, SLOW_WORKFLOW))
      const workflow = yield* Workflow.Service
      const { ops } = resolveOnAbortPromptOps()

      const run = yield* workflow.start({ name: SLOW_FIXTURE, args: {}, prompt: ops })

      yield* pollWithTimeout(
        Effect.gen(function* () {
          const current = yield* workflow.get(run.id)
          return current && current.agents.some((a) => a.status === "running" && a.session_id) ? current : undefined
        }),
        "agent never started",
      )

      yield* workflow.remove(run.id)

      // Ein paar Ticks für ggf. nachlaufende detached Settlement-Fibers.
      yield* Effect.sleep("200 millis")

      // Kalt-Read: kein Re-INSERT, die Row bleibt weg.
      const { db } = yield* Database.Service
      const row = yield* db
        .select()
        .from(WorkflowRunTable)
        .where(eq(WorkflowRunTable.id, run.id))
        .get()
        .pipe(Effect.orDie)
      expect(row).toBeUndefined()
      expect(yield* workflow.get(run.id)).toBeUndefined()
    }),
  )

  // Fund 24/16 (parallel): ein parallel-Batch mit drei hängenden Agenten +
  // Cancel mitten drin. ALLE registrierten Child-Sessions müssen abgebrochen
  // werden; der sequentielle Folge-Step darf nie laufen; Status cancelled.
  it.instance("cancel during a parallel batch aborts every started child session", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* Effect.promise(() => writeWorkflow(test.directory, PARALLEL_HANG_FIXTURE, PARALLEL_HANG_WORKFLOW))
      const workflow = yield* Workflow.Service
      const { ops, aborted, started } = resolveOnAbortPromptOps()

      const run = yield* workflow.start({ name: PARALLEL_HANG_FIXTURE, args: {}, prompt: ops })

      // Warten bis alle drei parallelen Agenten ihre Child-Session registriert haben.
      const live = yield* pollWithTimeout(
        Effect.gen(function* () {
          const current = yield* workflow.get(run.id)
          const running = current?.agents.filter((a) => a.status === "running" && a.session_id) ?? []
          return running.length >= 3 ? current : undefined
        }),
        "parallel agents never all started",
      )
      const sessions = live!.agents.map((a) => a.session_id!).filter(Boolean)
      expect(sessions.length).toBeGreaterThanOrEqual(3)

      yield* workflow.cancel(run.id)

      const done = yield* workflow.get(run.id)
      expect(done?.status).toBe("cancelled")
      // Jede gestartete Child-Session wurde echt abgebrochen.
      for (const s of started) expect(aborted.has(s)).toBe(true)
      // Der Folge-Step lief nie.
      expect(done?.logs.some((l) => l.message?.includes(PARALLEL_HANG_MARKER))).toBe(false)
      // Kein Agent bleibt running, keiner wird als completed verbucht.
      expect(done?.agents.every((a) => a.status !== "running")).toBe(true)
      expect(done?.agents.every((a) => a.status !== "completed")).toBe(true)
    }),
  )

  // Fund 50 (low): PromptOps OHNE cancel-Vektor. cancel() muss den Run trotzdem
  // als cancelled markieren und den Folge-Step gaten. Dokumentierter Gap: die
  // in-flight Child-Session wird NICHT abgebrochen (sie läuft aus) — nur die
  // Run-Fiber/der Run-Scope wird beendet.
  it.instance("cancel without a PromptOps.cancel vector still ends the run as cancelled", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* Effect.promise(() => writeWorkflow(test.directory, SLOW_FIXTURE, SLOW_WORKFLOW))
      const workflow = yield* Workflow.Service
      // PromptOps OHNE cancel: der Agent-Prompt hängt (resolved nie von selbst).
      const ops: { prompt: SessionPrompt.Interface["prompt"] } = {
        prompt: (input) =>
          Effect.gen(function* () {
            if (input.noReply) return assistantReply()
            // Hängt unterbrechbar; nur ein Scope-Close (Run-Scope) kann sie beenden.
            yield* Effect.never
            return assistantReply()
          }),
      }

      const run = yield* workflow.start({ name: SLOW_FIXTURE, args: {}, prompt: ops })

      yield* pollWithTimeout(
        Effect.gen(function* () {
          const current = yield* workflow.get(run.id)
          return current && current.agents.some((a) => a.status === "running") ? current : undefined
        }),
        "agent never started",
      )

      yield* workflow.cancel(run.id)

      const done = yield* workflow.get(run.id)
      expect(done?.status).toBe("cancelled")
      // Folge-Step lief nie.
      expect(done?.logs.some((l) => l.message?.includes(STEP2_MARKER))).toBe(false)
    }),
  )

  // Orphan-Mechanismus: Die In-Memory-Test-DB (OPENCODE_DB=:memory:) überlebt
  // keine frische Layer-Instanz, daher wird der Orphan simuliert, indem wir eine
  // running-Zeile OHNE Registry-Eintrag direkt über die SQL-Schicht einfügen und
  // anschließend NUR den Sweep auslösen (engine.sweep()), so wie er beim
  // Service-Start läuft (leere Registry -> alle running-Zeilen werden gefegt).
  it.instance("orphaned running rows are marked interrupted on service start", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const workflow = yield* Workflow.Service
      const orphanId = "job_orphan_sweep"
      yield* seedRunningRow(orphanId, test.directory)

      yield* workflow.sweep()

      const row = yield* fetchRunRow(orphanId)
      expect(row.status).toBe("interrupted")
      expect(row.completed_at).toBeGreaterThan(0)
    }),
  )

  // Fund 15 (medium): Der Sweep schrieb bisher nur Run-Level-Spalten um, nie das
  // agents-JSON. Ein gesweepter Orphan trug daher permanent einen Agent mit
  // status `running` ohne completed_at/error → das TUI rendert ewig ein Live-
  // Icon. Nach dem Sweep MUSS auch jeder noch laufende Agent-Node terminal sein.
  it.instance("orphan sweep normalizes still-running agent nodes to failed", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const workflow = yield* Workflow.Service
      const orphanId = "job_orphan_agent"
      yield* seedRunningRowWithAgent(orphanId, test.directory)

      yield* workflow.sweep()

      const row = yield* fetchRunRow(orphanId)
      expect(row.status).toBe("interrupted")
      // Der laufende Node ist terminal geschlossen (failed + Grund + Zeit).
      const closed = row.agents.find((a) => a.id === "1")
      expect(closed?.status).toBe("failed")
      expect(closed?.completed_at).toBeGreaterThan(0)
      expect(closed?.error).toBeTruthy()
      // Ein bereits abgeschlossener Node bleibt unberührt.
      const intact = row.agents.find((a) => a.id === "2")
      expect(intact?.status).toBe("completed")
      // Kein Node bleibt `running`.
      expect(row.agents.every((a) => a.status !== "running")).toBe(true)
    }),
  )

  it.instance("persisted run round-trips through fromRow", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const workflow = yield* Workflow.Service
      const persistedId = Workflow.RunID.make("job_roundtrip")
      // Persist a finished run directly via the SQL layer (no live registry
      // entry), so get() must read it back through DB->fromRow.
      yield* seedCompletedRow(persistedId, test.directory)

      const viaDb = yield* workflow.get(persistedId)
      const persisted = viaDb ?? (yield* Effect.fail(new Error("run not persisted")))
      expect(persisted).toMatchObject({ id: persistedId, status: "completed" })
      // Telemetrie überlebt den Roundtrip durch fromRow.
      expect(persisted.logs.map((item) => item.message)).toContain("running")
      expect(persisted.agents.length).toBeGreaterThan(0)
      expect(persisted.agents[0]?.output).toBe("did the thing")
      // Fund 51: per-agent cost/tokens (incl. the optional `total`) survive the
      // DB→fromRow roundtrip intact — not just output/status.
      expect(persisted.agents[0]?.cost).toBe(0.42)
      expect(persisted.agents[0]?.tokens).toEqual({
        total: 99,
        input: 11,
        output: 22,
        reasoning: 33,
        cache: { read: 44, write: 55 },
      })
      // N20: das geseedete result überlebt den Roundtrip (wurde bisher nie asserted).
      expect(persisted.result).toEqual({ ok: true })
    }),
  )

  // N1 (medium): Ein terminaler Run muss nach finish() aus der In-Memory-Registry
  // evictet sein, sonst wächst die Map unbeschränkt UND get()/runs() pinnen für
  // immer den In-Memory-Snapshot eines toten Runs statt der DB-Row (gepinnte
  // Divergenz). Seam (ohne neuen Produktions-Export): nach Abschluss die DB-Row
  // direkt über die SQL-Schicht mutieren und get() lesen. Hielte die Registry den
  // Run noch, läse get() den (stale) In-Memory-Snapshot und ignorierte die
  // Mutation; nach Eviction fällt get() auf fromRow → die Mutation ist sichtbar.
  it.instance("a finished run is evicted from the in-memory registry (get falls back to the DB row)", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* Effect.promise(() =>
        writeWorkflow(
          test.directory,
          "hello",
          `export const meta = { name: "Hello" }
export async function run(args, ctx) { ctx.setPhase("run"); ctx.log("running"); return { value: args.value } }
`,
        ),
      )
      const workflow = yield* Workflow.Service
      const run = yield* workflow.start({ name: "hello", args: { value: 42 } })
      const waited = yield* workflow.wait({ id: run.id })
      expect(waited.run?.status).toBe("completed")
      expect(waited.run?.result).toEqual({ value: 42 })

      // Direkt die DB-Row mutieren (umgeht die Engine vollständig) UND innerhalb
      // der Poll-Schleife re-applizieren: eine zuletzt noch geforkte Progress-
      // Schreibung (aus ctx.setPhase/log) kann unmittelbar nach wait() einmalig
      // current_phase auf "run" zurückschreiben — das Re-Apply macht den Test
      // robust gegen dieses kurze Fenster. Hielte die Registry den Run dagegen
      // noch, läse get() den gepinnten In-Memory-Snapshot (current_phase === "run")
      // und die DB-Mutation bliebe — egal wie oft geschrieben — für immer
      // unsichtbar. Nach Eviction (Designreihenfolge 3e/N2: NACH dem Deferred-
      // Resolve) fällt get() auf die DB-Row zurück → die Mutation wird sichtbar.
      const { db } = yield* Database.Service
      const after = yield* pollWithTimeout(
        Effect.gen(function* () {
          yield* db
            .update(WorkflowRunTable)
            .set({ current_phase: "db-mutated" })
            .where(eq(WorkflowRunTable.id, run.id))
            .run()
            .pipe(Effect.orDie)
          const current = yield* workflow.get(run.id)
          return current?.current_phase === "db-mutated" ? current : undefined
        }),
        "finished run was never evicted from the registry (get stayed pinned to the in-memory snapshot)",
      )
      expect(after.current_phase).toBe("db-mutated")
      // Der Terminalstand bleibt sonst korrekt (kein Stale-Verlust).
      expect(after.status).toBe("completed")
      expect(after.result).toEqual({ value: 42 })
      expect(after.logs.map((l) => l.message)).toContain("running")
    }),
  )

  // N1 (medium) — Reihenfolge-Sicherung gegen 3e/N2: ein wait()-Warter, der GENAU
  // um den finish()-Übergang aufwacht, muss noch den Terminalzustand erhalten —
  // die Eviction darf den Waiter nicht entwerten (der Run kommt aus dem resolved
  // done-Deferred; ein get() danach liest die DB-Row, die der Terminal-Persist
  // VOR der Eviction geschrieben hat).
  it.instance("a waiter receives the terminal state across eviction; the DB row is present afterwards", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* Effect.promise(() =>
        writeWorkflow(
          test.directory,
          "hello",
          `export const meta = { name: "Hello" }
export async function run(args, ctx) { ctx.setPhase("run"); return { value: args.value } }
`,
        ),
      )
      const workflow = yield* Workflow.Service
      const run = yield* workflow.start({ name: "hello", args: { value: 7 } })
      // wait() ohne Timeout hängt am done-Deferred und wacht beim Terminal-Übergang
      // auf — nach Persist + Deferred.succeed, danach folgt die Eviction.
      const waited = yield* workflow.wait({ id: run.id })
      expect(waited.run?.status).toBe("completed")
      expect(waited.run?.result).toEqual({ value: 7 })
      // Der Terminal-Persist lief VOR der Eviction: die DB-Row existiert (kein
      // Read-after-Evict-Loch).
      const row = yield* fetchRunRow(run.id)
      expect(row.status).toBe("completed")
      // Und get() nach Abschluss liefert exakt den persistierten Stand.
      const got = yield* workflow.get(run.id)
      expect(got?.status).toBe("completed")
      expect(got?.result).toEqual({ value: 7 })
    }),
  )

  // N16 (medium): cancel() auf einen persistierten, NICHT-live Run (geseedet, kein
  // Registry-Eintrag — der Zustand nach Neustart/Eviction) darf NICHT undefined
  // liefern. Konsistent mit get()/remove() konsultiert cancel() die (gescopte)
  // DB-Row: gefunden → ehrlich den Run-Snapshot zurückgeben (ein bereits
  // terminaler Run wird nicht „gecancelt", aber zurückgegeben). undefined NUR bei
  // echtem not-found.
  it.instance("cancel falls back to the persisted row for a non-live run; undefined only for unknown ids", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const workflow = yield* Workflow.Service
      const persistedId = Workflow.RunID.make("job_cancel_nonlive")
      // Fertiger Run direkt geseedet → kein Registry-Eintrag (nicht live).
      yield* seedCompletedRow(persistedId, test.directory)

      // cancel() findet ihn über die DB und liefert den Snapshot, nicht undefined.
      const cancelled = yield* workflow.cancel(persistedId)
      expect(cancelled).toBeDefined()
      expect(cancelled?.id).toBe(persistedId)
      // Ein bereits terminaler Run wird nicht in cancelled umgeschrieben.
      expect(cancelled?.status).toBe("completed")

      // Eine völlig unbekannte id liefert undefined (→ HTTP 404 in 3h).
      const unknown = yield* workflow.cancel(Workflow.RunID.make("job_cancel_unknown"))
      expect(unknown).toBeUndefined()
    }),
  )

  // N16 — Cross-Directory: cancel() ist auf das aufrufende Verzeichnis gescoped
  // (wie get()/remove()). Eine fremde Row darf NICHT als gefunden gelten.
  it.instance(
    "cancel from another directory cannot see a foreign run",
    () =>
      Effect.gen(function* () {
        const a = yield* TestInstance
        const b = yield* tmpdirScoped({ git: true })
        const workflow = yield* Workflow.Service
        const idA = Workflow.RunID.make("job_cancel_scoped_A")
        yield* seedCompletedRow(idA, a.directory)

        // B sieht ihn nicht → undefined (nicht „found-but-not-cancellable").
        expect(yield* workflow.cancel(idA).pipe(provideInstance(b))).toBeUndefined()
        // A findet ihn weiterhin.
        expect((yield* workflow.cancel(idA))?.id).toBe(idA)
      }),
    { git: true },
  )

  // N13 (low): snapshot()/die öffentliche Run-Ausgabe darf KEINE internen
  // Zusatzfelder (directory/done/runScope/fiber/budget …) tragen und KEINE
  // Live-Referenzen aliasen — Mutieren des zurückgegebenen Objekts (inkl. der
  // verschachtelten args/definition/result) darf den internen Zustand nicht
  // verändern (defensive Projektion).
  it.instance("public run output is a defensive projection with no internal fields or live aliases", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* Effect.promise(() =>
        writeWorkflow(
          test.directory,
          "hello",
          `export const meta = { name: "Hello" }
export async function run(args, ctx) { ctx.setPhase("run"); ctx.log("running"); return { nested: { ok: true } } }
`,
        ),
      )
      const workflow = yield* Workflow.Service
      const run = yield* workflow.start({ name: "hello", args: { nested: { value: 1 } } })

      // Live-Snapshot (Run ist noch in der Registry): keine internen Felder.
      const live = yield* workflow.get(run.id)
      const liveAny = live as unknown as Record<string, unknown>
      for (const internal of [
        "directory",
        "done",
        "runScope",
        "fiber",
        "sessions",
        "cancelSession",
        "cancelling",
        "removed",
        "budget",
        "budgetRemaining",
      ]) {
        expect(internal in liveAny).toBe(false)
      }
      // Exakt die deklarierten Run-Schlüssel (Teilmenge: optionale können fehlen).
      const allowed = new Set([
        "id",
        "session_id",
        "workflow",
        "args",
        "definition",
        "status",
        "started_at",
        "completed_at",
        "current_phase",
        "logs",
        "agents",
        "result",
        "error",
        "resume_of",
        "pending_question",
      ])
      for (const key of Object.keys(liveAny))
        expect(allowed.has(key)).toBe(true)

        // Defensive Projektion: das verschachtelte args mutieren darf den internen
        // Zustand NICHT beeinflussen.
      ;(live!.args as { nested: { value: number } }).nested.value = 999
      const again = yield* workflow.get(run.id)
      expect((again!.args as { nested: { value: number } }).nested.value).toBe(1)

      // Nach Abschluss kommt der Run NICHT mehr aus dem Live-Snapshot: finish()
      // evictet den terminalen Run aus der Registry (N1), so dass jeder folgende
      // get() ihn frisch aus der DB-Row über fromRow rekonstruiert. Eine Mutation
      // an `done.result` und ein erneuter get() würden hier also nur die (ohnehin
      // garantierte) fromRow-Frische prüfen — NICHT die Alias-Trennung des
      // Live-Snapshots. Die result-Alias-Trennung am LIVEN Run ist daher in
      // "snapshot severs agents[].tokens aliasing on a live run" abgedeckt; hier
      // verifizieren wir nur ehrlich, dass das result den DB-Roundtrip überlebt.
      const waited = yield* workflow.wait({ id: run.id })
      const done = waited.run ?? (yield* Effect.fail(new Error("workflow did not finish")))
      expect((done.result as { nested: { ok: boolean } }).nested.ok).toBe(true)
    }),
  )

  // N13 (spec): die öffentliche Run-Projektion darf das verschachtelte
  // `agents[].tokens` (inkl. des weiter genesteten `cache`) NICHT aliasen. Der
  // frühere snapshot kopierte agents nur flach (`{ ...item }`), so dass ein
  // Verbraucher über `snapshot.agents[0].tokens.input` den internen Engine-State
  // mutieren konnte. Geprüft am LIVEN Run (Run noch in der Registry, Agent-Node
  // mit echter Token-Telemetrie), damit get() einen Live-Snapshot liefert und
  // NICHT den ohnehin frischen fromRow-Pfad.
  it.instance("snapshot severs agents[].tokens aliasing on a live run", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* Effect.promise(() => writeWorkflow(test.directory, AGENT_THEN_HANG_FIXTURE, AGENT_THEN_HANG_WORKFLOW))
      const workflow = yield* Workflow.Service
      const { db } = yield* Database.Service
      const run = yield* workflow.start({ name: AGENT_THEN_HANG_FIXTURE, args: {}, prompt: tokensPromptOps(db) })

      // Warten, bis der Agent-Step gesettlet ist (tokens befüllt) und der Run
      // dabei NOCH läuft (Body hängt am 30s-Timer) — get() liefert dann live.
      const live = yield* pollWithTimeout(
        Effect.gen(function* () {
          const current = yield* workflow.get(run.id)
          return current?.status === "running" && current.agents[0]?.tokens ? current : undefined
        }),
        "agent tokens never populated on a live run",
      )
      const tokens = live.agents[0]!.tokens!
      expect(tokens.input).toBe(11)
      expect(tokens.cache.read).toBe(33)

      // Über den Snapshot in den verschachtelten tokens/cache schreiben …
      tokens.input = 999
      tokens.cache.read = 888

      // … darf den internen Engine-State NICHT verändern: ein zweiter Live-Snapshot
      // zeigt die Originalwerte.
      const again = yield* workflow.get(run.id)
      expect(again?.status).toBe("running")
      expect(again!.agents[0]!.tokens!.input).toBe(11)
      expect(again!.agents[0]!.tokens!.cache.read).toBe(33)

      // Aufräumen: den hängenden Run abbrechen, damit der 30s-Timer den Test nicht hält.
      yield* workflow.cancel(run.id)
    }),
  )

  // N2/N13 (regression): ein Workflow, der einen NICHT strukturell klonbaren Wert
  // zurückgibt (`{ kept: 1, cb: () => {} }`), darf weder den no-timeout-wait()
  // strandlassen noch den Terminal-Persist verhindern. Der frühere
  // structuredClone-Snapshot warf darauf (DOMException) und hing. Der Engine
  // normalisiert das result jetzt über denselben JSON-Codec wie der Persist:
  // Funktionen werden (wie JSON.stringify) still verworfen, der Run schließt
  // sauber als `completed` ab, und Live-Snapshot wie DB-Row tragen dieselbe Form.
  it.instance("a non-cloneable workflow result never hangs wait(); JSON-normalized like the persist", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* Effect.promise(() =>
        writeWorkflow(test.directory, UNSERIALIZABLE_RESULT_FIXTURE, UNSERIALIZABLE_RESULT_WORKFLOW),
      )
      const workflow = yield* Workflow.Service
      const run = yield* workflow.start({ name: UNSERIALIZABLE_RESULT_FIXTURE, args: {} })

      // wait() OHNE timeout: kommt terminal zurück (kein Hang) und meldet keinen Timeout.
      const waited = yield* workflow.wait({ id: run.id })
      expect(waited.timedOut).toBe(false)
      const done = waited.run ?? (yield* Effect.fail(new Error("workflow did not finish")))
      expect(done.status).toBe("completed")
      // Funktionen werden (wie bei JSON.stringify) verworfen, serialisierbare
      // Felder bleiben erhalten.
      expect(done.result).toEqual({ kept: 1 })

      // DB-Row und Live-Verhalten konsistent: ein kalter Spalten-Read zeigt
      // dieselbe entfunktionalisierte Form.
      expect(yield* fetchRawResult(run.id)).toBe(JSON.stringify({ kept: 1 }))
      const persisted = yield* workflow.get(run.id)
      expect(persisted?.status).toBe("completed")
      expect(persisted?.result).toEqual({ kept: 1 })
    }),
  )

  // N2/N13 (regression): ein result mit ZIRKULÄRER Referenz lässt JSON.stringify
  // selbst werfen (TypeError). Der mit Effect.try abgesicherte
  // Normalisierungspfad muss den Run dennoch terminal als `completed` abschließen
  // (kein Hang, kein verlorener Terminal-Übergang) und das result auf den
  // $unserializable-Platzhalter setzen.
  it.instance("a circular workflow result finishes with the $unserializable placeholder", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* Effect.promise(() => writeWorkflow(test.directory, CIRCULAR_RESULT_FIXTURE, CIRCULAR_RESULT_WORKFLOW))
      const workflow = yield* Workflow.Service
      const run = yield* workflow.start({ name: CIRCULAR_RESULT_FIXTURE, args: {} })

      const waited = yield* workflow.wait({ id: run.id })
      expect(waited.timedOut).toBe(false)
      const done = waited.run ?? (yield* Effect.fail(new Error("workflow did not finish")))
      expect(done.status).toBe("completed")
      expect((done.result as { $unserializable: string }).$unserializable).toBeDefined()

      // Konsistent in der DB-Row.
      const persisted = yield* workflow.get(run.id)
      expect((persisted?.result as { $unserializable: string }).$unserializable).toBeDefined()
    }),
  )

  // Fund 42 / N20 (low): result === null darf im DB-Roundtrip NICHT zu undefined
  // ("No result recorded.") werden. Drei Fälle, end-to-end durch den echten
  // Engine-Persist getrieben: ein echtes result, result === null und nie gesetzt.
  // Geprüft wird BEIDE Richtungen: die rohe Spalten-Serialisierung (write) und
  // die Decodierung durch fromRow (read), inkl. der Unterscheidung SQL-NULL
  // (nie gesetzt → undefined) vs. JSON-Text "null" (echtes null → null).
  it.instance("null and undefined workflow results survive persistence distinctly", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* Effect.promise(() =>
        writeWorkflow(
          test.directory,
          HELLO_FIXTURE,
          `export const meta = { name: "Hello" }
export async function run(args, ctx) { ctx.setPhase("run"); return { value: args.value } }
`,
        ),
      )
      yield* Effect.promise(() => writeWorkflow(test.directory, NULL_RESULT_FIXTURE, NULL_RESULT_WORKFLOW))
      yield* Effect.promise(() => writeWorkflow(test.directory, VOID_RESULT_FIXTURE, VOID_RESULT_WORKFLOW))
      const workflow = yield* Workflow.Service

      const finishRun = (name: string, args?: Record<string, unknown>) =>
        Effect.gen(function* () {
          const run = yield* workflow.start({ name, args: args ?? {} })
          const waited = yield* workflow.wait({ id: run.id })
          const done = waited.run ?? (yield* Effect.fail(new Error(`${name} did not finish`)))
          expect(done.status).toBe("completed")
          return run.id
        })

      // (a) echtes result.
      const realId = yield* finishRun(HELLO_FIXTURE, { value: 42 })
      expect((yield* workflow.get(realId))?.result).toEqual({ value: 42 })
      expect(yield* fetchRawResult(realId)).toBe(JSON.stringify({ value: 42 }))

      // (b) result === null: roh als JSON-Text "null" persistiert, NICHT SQL-NULL.
      const nullId = yield* finishRun(NULL_RESULT_FIXTURE)
      expect((yield* workflow.get(nullId))?.result).toBeNull()
      expect(yield* fetchRawResult(nullId)).toBe("null")

      // (c) nie gesetzt: roh SQL-NULL, liest als undefined zurück.
      const voidId = yield* finishRun(VOID_RESULT_FIXTURE)
      expect((yield* workflow.get(voidId))?.result).toBeUndefined()
      expect(yield* fetchRawResult(voidId)).toBeNull()

      // Kalt-Read durch fromRow (frische Rows, kein Registry-Eintrag): die drei
      // rohen Spalten-Zustände dekodieren exakt zu value / null / undefined.
      const { db } = yield* Database.Service
      const now = Date.now()
      // Raw INSERT so the `result` column holds the EXACT bytes under test (the
      // text `"null"` vs SQL NULL) — a Drizzle insert would route through the
      // engine's codec and hide the distinction. time_created/time_updated are
      // NOT NULL with no SQL-level default (the default lives in the Drizzle
      // Timestamps helper, which a raw INSERT bypasses), so they must be set here.
      const seedRaw = (id: string, raw: string | null) =>
        db
          .run(
            sql`INSERT INTO ${WorkflowRunTable} (id, workflow, directory, status, started_at, completed_at, logs, agents, result, time_created, time_updated)
              VALUES (${id}, ${HELLO_FIXTURE}, ${test.directory}, 'completed', ${now}, ${now}, '[]', '[]', ${raw}, ${now}, ${now})`,
          )
          .pipe(Effect.orDie)
      yield* seedRaw("job_result_real", JSON.stringify({ value: 7 }))
      yield* seedRaw("job_result_null", "null")
      yield* seedRaw("job_result_void", null)
      expect((yield* workflow.get(Workflow.RunID.make("job_result_real")))?.result).toEqual({ value: 7 })
      expect((yield* workflow.get(Workflow.RunID.make("job_result_null")))?.result).toBeNull()
      expect((yield* workflow.get(Workflow.RunID.make("job_result_void")))?.result).toBeUndefined()
    }),
  )

  it.instance("wait on interrupted run resolves immediately as interrupted (not timedOut)", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const workflow = yield* Workflow.Service
      const orphanId = Workflow.RunID.make("job_orphan_wait")
      yield* seedRunningRow(orphanId, test.directory)
      yield* workflow.sweep()

      const res = yield* workflow.wait({ id: orphanId, timeout: 50 })
      expect(res.run?.status).toBe("interrupted")
      expect(res.timedOut).not.toBe(true)
    }),
  )

  // Fund 25 (a): wait() on a still-RUNNING run with a small timeout times out
  // honestly — `timedOut: true`, the snapshot status stays `running`, and the run
  // is NOT mutated by the timeout. Deterministic: the run is parked on a barrier
  // (genuinely live in the registry, never released until after the assertion), so
  // the timeout is the ONLY thing that ends the wait — no race with the body
  // completing. The barrier is released afterwards so the run can drain.
  it.instance("wait with a small timeout on a hanging run returns timedOut with status still running", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* Effect.promise(() => writeWorkflow(test.directory, PARALLEL_BARRIER_FIXTURE, PARALLEL_BARRIER_WORKFLOW))
      const workflow = yield* Workflow.Service
      const sync = installBarrier()
      const run = yield* workflow.start({ name: PARALLEL_BARRIER_FIXTURE, args: { __barrier: sync.token, count: 1 } })
      // Ensure the run is genuinely live and parked (the single task is at the gate)
      // before testing the timeout, so wait() cannot resolve via completion.
      yield* sync.awaitPeak(1)

      const res = yield* workflow.wait({ id: run.id, timeout: 50 })
      expect(res.timedOut).toBe(true)
      // The snapshot reports the live status (still running); the timeout did not
      // flip or finish the run.
      expect(res.run?.status).toBe("running")
      // The run is still live and running afterwards (the timeout is observation-only).
      const stillLive = yield* workflow.get(run.id)
      expect(stillLive?.status).toBe("running")

      // Release the gate so the run finishes, then drain it.
      sync.barrier.release()
      const waited = yield* workflow.wait({ id: run.id })
      expect(waited.timedOut).toBe(false)
      expect(waited.run?.status).toBe("completed")
      delete globalThis.__workflowTestBarriers![sync.token]
    }),
  )

  // Fund 25 (b): wait() with timeout <= 0 returns an IMMEDIATE snapshot
  // (`timedOut: true`) without ever suspending on the run's done deferred — a
  // zero/negative timeout must not hang on a still-running run. Proven by parking
  // the run on a barrier (so it is genuinely running) and asserting wait({timeout:0})
  // returns at once with the running snapshot; a hung implementation would never
  // return because the gate is still closed.
  it.instance("wait with timeout <= 0 returns an immediate running snapshot without hanging", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* Effect.promise(() => writeWorkflow(test.directory, PARALLEL_BARRIER_FIXTURE, PARALLEL_BARRIER_WORKFLOW))
      const workflow = yield* Workflow.Service
      const sync = installBarrier()
      const run = yield* workflow.start({ name: PARALLEL_BARRIER_FIXTURE, args: { __barrier: sync.token, count: 1 } })
      yield* sync.awaitPeak(1)

      for (const timeout of [0, -10]) {
        // awaitWithTimeout proves the call RETURNS promptly (no hang on the closed
        // gate); a non-short-circuiting implementation would block here forever.
        const res = yield* awaitWithTimeout(
          workflow.wait({ id: run.id, timeout }),
          `wait({timeout:${timeout}}) hung on a still-running run`,
          "2 seconds",
        )
        expect(res.timedOut).toBe(true)
        expect(res.run?.status).toBe("running")
      }

      sync.barrier.release()
      yield* workflow.wait({ id: run.id })
      delete globalThis.__workflowTestBarriers![sync.token]
    }),
  )

  it.instance("schema agent failure is recorded as failed, never silently completed", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* Effect.promise(() =>
        writeWorkflow(test.directory, SCHEMA_FAILING_FIXTURE, schemaWorkflow(SCHEMA_FAILING_FIXTURE)),
      )
      const workflow = yield* Workflow.Service
      const { db } = yield* Database.Service
      const run = yield* workflow.start({
        name: SCHEMA_FAILING_FIXTURE,
        args: {},
        prompt: structuredPromptOps(db, "error"),
      })
      const done = yield* workflow.wait({ id: run.id })
      expect(done.run?.status).toBe("failed")
      expect(done.run?.agents.some((a) => a.status === "failed")).toBe(true)
      // Kein stiller Plaintext-Fallback: der Agent darf NICHT completed sein.
      expect(done.run?.agents.some((a) => a.status === "completed")).toBe(false)
    }),
  )

  it.instance("schema agent with undefined structured result fails instead of plaintext fallback", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* Effect.promise(() =>
        writeWorkflow(test.directory, SCHEMA_UNDEFINED_FIXTURE, schemaWorkflow(SCHEMA_UNDEFINED_FIXTURE)),
      )
      const workflow = yield* Workflow.Service
      const { db } = yield* Database.Service
      const run = yield* workflow.start({
        name: SCHEMA_UNDEFINED_FIXTURE,
        args: {},
        prompt: structuredPromptOps(db, "undefined"),
      })
      const done = yield* workflow.wait({ id: run.id })
      expect(done.run?.status).toBe("failed")
      expect(done.run?.agents.some((a) => a.status === "failed")).toBe(true)
    }),
  )

  it.instance("schema agent success returns the parsed object and completes", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* Effect.promise(() =>
        writeWorkflow(test.directory, SCHEMA_SUCCESS_FIXTURE, schemaWorkflow(SCHEMA_SUCCESS_FIXTURE)),
      )
      const workflow = yield* Workflow.Service
      const { db } = yield* Database.Service
      const run = yield* workflow.start({
        name: SCHEMA_SUCCESS_FIXTURE,
        args: {},
        prompt: structuredPromptOps(db, "structured"),
      })
      const done = yield* workflow.wait({ id: run.id })
      expect(done.run?.status).toBe("completed")
      // Positivpfad: das geparste Objekt wird durch ctx.agent (result.data) und
      // damit das Workflow-Resultat hindurchgereicht.
      expect(done.run?.result).toEqual({ data: SCHEMA_OBJECT })
      expect(done.run?.agents.every((a) => a.status === "completed")).toBe(true)
    }),
  )

  it.instance("agent calls beyond exhausted budget fail the run with a budget error", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* Effect.promise(() => writeWorkflow(test.directory, BUDGET_FIXTURE, BUDGET_WORKFLOW))
      const workflow = yield* Workflow.Service
      const { db } = yield* Database.Service
      // Budget 1.0 USD, jeder Step kostet 1.0 — nach Step 1 ist das Budget
      // erschöpft (Rest 0), also scheitert der zweite ctx.agent am Gate.
      const run = yield* workflow.start({
        name: BUDGET_FIXTURE,
        args: {},
        prompt: costPromptOps(db, 1),
        budget: 1,
      })
      const done = yield* workflow.wait({ id: run.id })
      expect(done.run?.status).toBe("failed")
      expect(done.run?.error ?? "").toMatch(/budget/i)
      // Das Gate verhindert, dass der zweite Step überhaupt STARTET: nur der
      // erste Agent läuft (und wird completed); für den geblockten zweiten Step
      // wird kein Node angelegt — die Engine weigert sich, weiter zu spenden.
      expect(done.run?.agents.filter((a) => a.status === "completed").length).toBe(1)
      expect(done.run?.agents.length).toBe(1)
    }),
  )

  // Fund 23 (best-effort soft cap under parallelism): the budget is enforced PER
  // STEP, checked BEFORE each ctx.agent and settled AFTER it. Steps launched
  // together via ctx.parallel all pass the gate while the budget is still positive,
  // so a run can OVERSPEND by the combined cost of the steps already in flight when
  // the budget runs out — documented soft-cap behavior, not a hard mid-step limit.
  // Deterministic proof: a Deferred barrier holds all 3 parallel prompts until ALL
  // have passed the gate, then releases them so they all charge. With budget 1.0 and
  // 3 parallel steps à 0.5 (total 1.5), the budget overspends to -0.5; the NEXT
  // (sequential) step then fails the exhausted-budget gate.
  it.instance("parallel steps all pass the gate and overspend; the next step fails (soft cap)", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* Effect.promise(() => writeWorkflow(test.directory, BUDGET_PARALLEL_FIXTURE, BUDGET_PARALLEL_WORKFLOW))
      const workflow = yield* Workflow.Service
      const { db } = yield* Database.Service
      // 3 parallel agents à 0.5 USD, budget 1.0. All 3 pass the gate while the
      // budget is positive (the barrier holds them until all 3 have arrived), so
      // all 3 charge ⇒ overspend to -0.5.
      const run = yield* workflow.start({
        name: BUDGET_PARALLEL_FIXTURE,
        args: { count: 3 },
        prompt: budgetBarrierPromptOps(db, 0.5, 3),
        budget: 1,
      })
      const done = yield* workflow.wait({ id: run.id })
      // The run COMPLETES — the workflow body catches the post-batch budget failure.
      expect(done.run?.status).toBe("completed")
      const result = done.run?.result as { overspent: number; nextStarted: boolean; nextFailed: boolean }
      // Soft-cap overspend: all 3 parallel steps charged, driving the budget below 0.
      expect(result.overspent).toBeCloseTo(-0.5, 10)
      // All 3 parallel steps were charged (completed) — the documented overspend.
      const completed = done.run?.agents.filter((a) => a.status === "completed") ?? []
      expect(completed.length).toBe(3)
      const totalCost = completed.reduce((sum, a) => sum + (a.cost ?? 0), 0)
      expect(totalCost).toBeCloseTo(1.5, 10)
      // The NEXT (sequential) step after exhaustion hits the gate and fails.
      expect(result.nextStarted).toBe(true)
      expect(result.nextFailed).toBe(true)
      // The blocked 4th step never created a node (refused before dispatch).
      expect(done.run?.agents.length).toBe(3)
    }),
  )

  // T5 budget-race AUDIT (verdict: benign soft cap, no fix). The review asked
  // specifically: "2 parallel agents, budget for exactly 1 — does the second
  // double-spend BEYOND the documented soft cap?" Deterministic proof via the
  // same Deferred barrier as the Fund-23 test: 2 agents à 1.0, budget 1.0. The
  // barrier holds BOTH until both have passed the synchronous gate, so both
  // charge ⇒ overspend to -1.0 (exactly one extra step's worth, the cost already
  // in flight). This is the DOCUMENTED soft cap — NOT an unbounded race: the gate
  // refuses any FURTHER step once the budget is non-positive. This test pins that
  // boundary so a future refactor that turns the soft cap into either a hard limit
  // OR an unbounded leak fails here.
  it.instance(
    "budget-race audit: 2 parallel agents with budget for 1 overspend by exactly one step (soft cap, bounded)",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        yield* Effect.promise(() => writeWorkflow(test.directory, BUDGET_PARALLEL_FIXTURE, BUDGET_PARALLEL_WORKFLOW))
        const workflow = yield* Workflow.Service
        const { db } = yield* Database.Service
        const run = yield* workflow.start({
          name: BUDGET_PARALLEL_FIXTURE,
          args: { count: 2 },
          prompt: budgetBarrierPromptOps(db, 1, 2),
          budget: 1,
        })
        const done = yield* workflow.wait({ id: run.id })
        expect(done.run?.status).toBe("completed")
        const result = done.run?.result as { overspent: number; nextStarted: boolean; nextFailed: boolean }
        // Exactly one extra step's worth of overspend: 2 * 1.0 charged against a 1.0
        // budget ⇒ remaining -1.0. Bounded, not unbounded.
        expect(result.overspent).toBeCloseTo(-1, 10)
        // Both parallel steps charged (the in-flight cost), and exactly two nodes
        // exist — no third step slipped past the gate.
        const completed = done.run?.agents.filter((a) => a.status === "completed") ?? []
        expect(completed.length).toBe(2)
        expect(done.run?.agents.length).toBe(2)
        // The NEXT sequential step after exhaustion is refused (bounded soft cap).
        expect(result.nextStarted).toBe(true)
        expect(result.nextFailed).toBe(true)
      }),
  )

  // Item 24 Test (1): two runs share ONE turn pool. Run A's two steps charge
  // the whole pool; Run B (same pool) is refused at its FIRST ctx.agent with
  // 'Turn budget exhausted' — the cross-run gate the per-run budget never had.
  it.instance("two runs share one turn pool: the second run fails with 'Turn budget exhausted'", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* Effect.promise(() => writeWorkflow(test.directory, BUDGET_FIXTURE, BUDGET_WORKFLOW))
      const workflow = yield* Workflow.Service
      const { db } = yield* Database.Service
      const pool = TurnBudget.make({ usd: 1 })

      // Run A: 2 steps à 0.6 — passes (reserve sees headroom before each) but
      // commits 1.2, exhausting the pool past its 1.0 cap.
      const first = yield* workflow.start({ name: BUDGET_FIXTURE, args: {}, prompt: costPromptOps(db, 0.6), pool })
      const firstDone =
        (yield* workflow.wait({ id: first.id })).run ?? (yield* Effect.fail(new Error("run A did not settle")))
      expect(firstDone.status).toBe("completed")
      expect(pool.usd!.committed).toBeCloseTo(1.2, 10)

      // Run B on the SAME pool: its first agent is refused before any node is
      // recorded — no spend, run failed with the pool verdict.
      const second = yield* workflow.start({ name: BUDGET_FIXTURE, args: {}, prompt: costPromptOps(db, 0.6), pool })
      const secondDone =
        (yield* workflow.wait({ id: second.id })).run ?? (yield* Effect.fail(new Error("run B did not settle")))
      expect(secondDone.status).toBe("failed")
      expect(secondDone.error ?? "").toMatch(/Turn budget exhausted/)
      expect(secondDone.agents).toHaveLength(0)
      // Nothing further charged, nothing left reserved.
      expect(pool.usd!.committed).toBeCloseTo(1.2, 10)
      expect(pool.usd!.reserved).toBe(0)
    }),
  )

  // Item 24 Test (2): the reservation closes the documented soft-cap race.
  // After ONE settled step the pool prices reservations at its rolling average
  // (1.0); with 0.5 headroom left, of two PARALLEL steps exactly one passes —
  // the other is refused synchronously, before any node exists (contrast the
  // per-run 'budget-race audit' above, where both passed and overspent).
  it.instance("a priced pool reservation lets exactly one of two parallel steps pass", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* Effect.promise(() => writeWorkflow(test.directory, BUDGET_REMAINING_FIXTURE, BUDGET_REMAINING_WORKFLOW))
      yield* Effect.promise(() => writeWorkflow(test.directory, POOL_PARALLEL_FIXTURE, POOL_PARALLEL_WORKFLOW))
      const workflow = yield* Workflow.Service
      const { db } = yield* Database.Service
      const pool = TurnBudget.make({ usd: 1.5 })

      // Prime: one settled step à 1.0 sets avgStepUsd = 1.0, committed = 1.0.
      const prime = yield* workflow.start({
        name: BUDGET_REMAINING_FIXTURE,
        args: {},
        prompt: costPromptOps(db, 1),
        pool,
      })
      const primed =
        (yield* workflow.wait({ id: prime.id })).run ?? (yield* Effect.fail(new Error("prime run did not settle")))
      expect(primed.status).toBe("completed")
      expect(pool.avgStepUsd).toBeCloseTo(1, 10)

      // Two parallel steps, 0.5 headroom, 1.0 reservations: exactly ONE passes.
      // The refused one resolves to null at its position (the P1 parallel drop
      // semantics), so the run COMPLETES — but only one node was ever created
      // (the refusal precedes node recording) and the drop log carries the
      // pool verdict.
      const race = yield* workflow.start({
        name: POOL_PARALLEL_FIXTURE,
        args: {},
        prompt: costPromptOps(db, 0.1),
        pool,
      })
      const raced =
        (yield* workflow.wait({ id: race.id })).run ?? (yield* Effect.fail(new Error("race run did not settle")))
      expect(raced.status).toBe("completed")
      expect(raced.agents.length).toBe(1)
      expect(raced.logs.some((l) => l.message.includes("dropped") && l.message.includes("Turn budget exhausted"))).toBe(
        true,
      )
      // The passed step's reservation settled (committed its 0.1), the refused
      // one never reserved: nothing leaks.
      expect(pool.usd!.committed).toBeCloseTo(1.1, 10)
      expect(pool.usd!.reserved).toBe(0)
    }),
  )

  // Item 24 Test (3): a FAILED step releases its reservation — committed stays
  // untouched, reserved returns to 0 (the ensuring settles on every outcome).
  it.instance("a failed step releases its pool reservation without committing spend", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* Effect.promise(() => writeWorkflow(test.directory, BUDGET_REMAINING_FIXTURE, BUDGET_REMAINING_WORKFLOW))
      const workflow = yield* Workflow.Service
      const { db } = yield* Database.Service
      const pool = TurnBudget.make({ usd: 2 })

      // Prime a settled step so the next reservation is non-zero (0.5).
      const prime = yield* workflow.start({
        name: BUDGET_REMAINING_FIXTURE,
        args: {},
        prompt: costPromptOps(db, 0.5),
        pool,
      })
      yield* workflow.wait({ id: prime.id })
      expect(pool.usd!.committed).toBeCloseTo(0.5, 10)

      // Failing run: the step reserves 0.5, the prompt fails — the ensuring
      // settles with 0: committed unchanged, reserved back to 0.
      const failingOps: Workflow.PromptOps = {
        prompt: (input) =>
          Effect.gen(function* () {
            if (input.noReply) return assistantReply()
            return yield* Effect.fail(new Error("agent exploded"))
          }),
        cancel: () => Effect.void,
      }
      const failed = yield* workflow.start({ name: BUDGET_REMAINING_FIXTURE, args: {}, prompt: failingOps, pool })
      const failedDone =
        (yield* workflow.wait({ id: failed.id })).run ?? (yield* Effect.fail(new Error("failing run did not settle")))
      expect(failedDone.status).toBe("failed")
      expect(pool.usd!.committed).toBeCloseTo(0.5, 10)
      expect(pool.usd!.reserved).toBe(0)
    }),
  )

  // Item 24 Test (4): the ctx.budget pool view. Without a run budget, total/
  // spent()/remaining() derive from the pool — spent() includes the main
  // loop's chargeDirect share (Claude-Code semantics: the TURN's spend).
  it.instance("ctx.budget reflects the pool including chargeDirect spend when no run budget is set", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* Effect.promise(() => writeWorkflow(test.directory, POOL_SPENT_FIXTURE, POOL_SPENT_WORKFLOW))
      const workflow = yield* Workflow.Service
      const { db } = yield* Database.Service
      const pool = TurnBudget.make({ usd: 10 })
      // Simulate the main loop's direct charge before the run starts.
      TurnBudget.chargeDirect(pool, { usd: 0.3 })

      const run = yield* workflow.start({ name: POOL_SPENT_FIXTURE, args: {}, prompt: costPromptOps(db, 0.25), pool })
      const done = (yield* workflow.wait({ id: run.id })).run ?? (yield* Effect.fail(new Error("run did not settle")))
      expect(done.status).toBe("completed")
      const result = done.result as { before: number; total: number; after: number; remaining: number }
      expect(result.total).toBe(10)
      expect(result.before).toBeCloseTo(0.3, 10)
      expect(result.after).toBeCloseTo(0.55, 10)
      expect(result.remaining).toBeCloseTo(10 - 0.55, 10)
    }),
  )

  // Item 24 Test (5): journal REPLAYS charge the pool too (parity with the
  // run-budget charge — node.cost is copied on the cache hit and settled).
  it.instance("a journal replay charges the shared turn pool", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* Effect.promise(() => writeWorkflow(test.directory, BUDGET_FIXTURE, BUDGET_WORKFLOW))
      const workflow = yield* Workflow.Service
      const { db } = yield* Database.Service

      // Source run (NO pool): two steps à 0.5 complete.
      const first = yield* workflow.start({ name: BUDGET_FIXTURE, args: {}, prompt: costPromptOps(db, 0.5) })
      const firstDone =
        (yield* workflow.wait({ id: first.id })).run ?? (yield* Effect.fail(new Error("source run did not settle")))
      expect(firstDone.status).toBe("completed")

      // Resume with a pool: full cache hit, yet the pool is charged 1.0.
      const pool = TurnBudget.make({ usd: 10 })
      const { ops: resumeOps, prompted } = recordingPromptOps(db, 0)
      const resumed = yield* workflow.start({
        name: BUDGET_FIXTURE,
        args: {},
        prompt: resumeOps,
        resume_of: first.id,
        pool,
      })
      const done =
        (yield* workflow.wait({ id: resumed.id })).run ?? (yield* Effect.fail(new Error("resume did not settle")))
      expect(done.status).toBe("completed")
      expect(prompted).toHaveLength(0)
      expect(done.agents.every((a) => a.cached === true)).toBe(true)
      expect(pool.usd!.committed).toBeCloseTo(1, 10)
      expect(pool.usd!.reserved).toBe(0)
    }),
  )

  it.instance("budgetRemaining reflects real spend during the run", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* Effect.promise(() => writeWorkflow(test.directory, BUDGET_REMAINING_FIXTURE, BUDGET_REMAINING_WORKFLOW))
      const workflow = yield* Workflow.Service
      const { db } = yield* Database.Service
      const run = yield* workflow.start({
        name: BUDGET_REMAINING_FIXTURE,
        args: {},
        prompt: costPromptOps(db, 0.25),
        budget: 1,
      })
      const done = yield* workflow.wait({ id: run.id })
      expect(done.run?.status).toBe("completed")
      const result = done.run?.result as { before: number; after: number }
      expect(result.before).toBe(1)
      // Nach einem Step à 0.25 USD bleibt 0.75 übrig.
      expect(result.after).toBe(0.75)
      expect(result.after).toBeLessThan(result.before)
    }),
  )

  // Fund N12 (high): a single ctx.agent step whose child session runs SEVERAL
  // provider turns (the normal case once the subagent uses tools) persists one
  // assistant message per turn, each with its own cost/tokens, but the runner
  // RETURNS only the last. Charging that last message alone discarded every
  // intermediate turn — under-reporting per-agent telemetry AND under-counting the
  // budget. The engine must sum cost/tokens across ALL assistant messages of the
  // child session: cost 0.01 + 0.02 + 0.03 = 0.06 (not just the final 0.03), tokens
  // summed field-wise, and the budget decremented by the full 0.06.
  it.instance("a multi-turn agent step charges the SUM of all turns, not just the last", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* Effect.promise(() => writeWorkflow(test.directory, BUDGET_REMAINING_FIXTURE, BUDGET_REMAINING_WORKFLOW))
      const workflow = yield* Workflow.Service
      const { db } = yield* Database.Service
      const run = yield* workflow.start({
        name: BUDGET_REMAINING_FIXTURE,
        args: {},
        prompt: multiTurnPromptOps(db, [
          { cost: 0.01, tokens: { input: 1, output: 2, reasoning: 3, cache: { read: 4, write: 5 } } },
          { cost: 0.02, tokens: { input: 10, output: 20, reasoning: 30, cache: { read: 40, write: 50 } } },
          { cost: 0.03, tokens: { input: 100, output: 200, reasoning: 300, cache: { read: 400, write: 500 } } },
        ]),
        budget: 1,
      })
      const done = yield* workflow.wait({ id: run.id })
      expect(done.run?.status).toBe("completed")
      // Per-agent telemetry reflects the FULL multi-turn spend (0.06), not 0.03.
      const node = done.run!.agents[0]!
      expect(node.cost).toBeCloseTo(0.06, 10)
      expect(node.tokens).toEqual({ input: 111, output: 222, reasoning: 333, cache: { read: 444, write: 555 } })
      // Budget decremented by the SUM (1 - 0.06 = 0.94), observed live mid-run.
      const result = done.run?.result as { before: number; after: number }
      expect(result.before).toBe(1)
      expect(result.after).toBeCloseTo(0.94, 10)
    }),
  )

  // Fund 51 (telemetry populated from the assistant message): an agent step whose
  // session returns NON-null cost/tokens (including the optional `tokens.total`)
  // must have that telemetry copied onto the agent node — `run.agents[0].cost` and
  // `run.agents[0].tokens` (with `total`) reflect exactly what the assistant message
  // carried. A single-turn session yields exactly one assistant message, so the
  // node equals that message's telemetry verbatim (no summing artifact).
  it.instance("agent telemetry (cost + tokens incl. total) is populated from the assistant message", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* Effect.promise(() => writeWorkflow(test.directory, SINGLE_AGENT_FIXTURE, SINGLE_AGENT_WORKFLOW))
      const workflow = yield* Workflow.Service
      const { db } = yield* Database.Service
      const run = yield* workflow.start({
        name: SINGLE_AGENT_FIXTURE,
        args: {},
        // A single turn with non-null cost AND a non-null tokens.total so a dropped
        // field would be observable.
        prompt: multiTurnPromptOps(db, [
          { cost: 0.17, tokens: { total: 60, input: 10, output: 20, reasoning: 30, cache: { read: 5, write: 7 } } },
        ]),
      })
      const done = yield* workflow.wait({ id: run.id })
      expect(done.run?.status).toBe("completed")
      const node = done.run!.agents[0]!
      expect(node.cost).toBeCloseTo(0.17, 10)
      // The whole tokens shape, including the summed-but-single `total`, is carried.
      expect(node.tokens).toEqual({ total: 60, input: 10, output: 20, reasoning: 30, cache: { read: 5, write: 7 } })
    }),
  )

  // Item 28: subagent sessions load MCP lazily by default — the engine stamps
  // mcp:"lazy" on the subagent PromptInput (observed via the capture seam).
  it.instance("a subagent PromptInput carries mcp:'lazy' by default", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* Effect.promise(() => writeWorkflow(test.directory, SINGLE_AGENT_FIXTURE, SINGLE_AGENT_WORKFLOW))
      const workflow = yield* Workflow.Service
      const { ops, inputs } = capturingPromptOps()
      const run = yield* workflow.start({ name: SINGLE_AGENT_FIXTURE, args: {}, prompt: ops })
      const done = yield* workflow.wait({ id: run.id })
      expect(done.run?.status).toBe("completed")
      expect(inputs).toHaveLength(1)
      expect(inputs[0].mcp).toBe("lazy")
    }),
  )

  // Item 28: config workflows.lazy_mcp=false restores eager subagents (no mcp
  // field on the PromptInput ⇒ the loop's eager default).
  it.instance(
    "workflows.lazy_mcp=false keeps subagent PromptInputs eager",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        yield* Effect.promise(() => writeWorkflow(test.directory, SINGLE_AGENT_FIXTURE, SINGLE_AGENT_WORKFLOW))
        const workflow = yield* Workflow.Service
        const { ops, inputs } = capturingPromptOps()
        const run = yield* workflow.start({ name: SINGLE_AGENT_FIXTURE, args: {}, prompt: ops })
        const done = yield* workflow.wait({ id: run.id })
        expect(done.run?.status).toBe("completed")
        expect(inputs).toHaveLength(1)
        expect(inputs[0].mcp).toBeUndefined()
      }),
    { config: { workflows: { lazy_mcp: false } } },
  )

  it.instance("no budget set means unlimited (Infinity) — unchanged default", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* Effect.promise(() => writeWorkflow(test.directory, BUDGET_UNLIMITED_FIXTURE, BUDGET_UNLIMITED_WORKFLOW))
      const workflow = yield* Workflow.Service
      const { db } = yield* Database.Service
      const run = yield* workflow.start({
        name: BUDGET_UNLIMITED_FIXTURE,
        args: {},
        prompt: costPromptOps(db, 5),
      })
      const done = yield* workflow.wait({ id: run.id })
      expect(done.run?.status).toBe("completed")
      expect((done.run?.result as { unlimited: boolean }).unlimited).toBe(true)
    }),
  )

  // ctx.budget (Claude-Code-Parität) neben ctx.budgetRemaining: mit gesetztem
  // Budget liefert total den Startwert, spent() den bisher ausgegebenen Betrag
  // (0 ohne Agent-Step) und remaining() den Rest (== total bei spent()===0).
  it.instance("ctx.budget exposes total/spent()/remaining() when started with a budget", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* Effect.promise(() => writeWorkflow(test.directory, BUDGET_API_FIXTURE, BUDGET_API_WORKFLOW))
      const workflow = yield* Workflow.Service
      const run = yield* workflow.start({ name: BUDGET_API_FIXTURE, args: {}, budget: 5 })
      const done = yield* workflow.wait({ id: run.id })
      expect(done.run?.status).toBe("completed")
      const result = done.run?.result as { total: number; spent: number; remaining: number }
      expect(result.total).toBe(5)
      expect(result.spent).toBe(0)
      expect(result.remaining).toBe(5)
    }),
  )

  // Ohne Budget: ctx.budget.total ist null und remaining() ist Infinity (nicht
  // endlich). Infinity überlebt JSON nicht, deshalb prüft das Fixture per Boolean.
  it.instance("ctx.budget.total is null and remaining() is Infinity without a budget", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* Effect.promise(() =>
        writeWorkflow(test.directory, BUDGET_API_UNLIMITED_FIXTURE, BUDGET_API_UNLIMITED_WORKFLOW),
      )
      const workflow = yield* Workflow.Service
      const run = yield* workflow.start({ name: BUDGET_API_UNLIMITED_FIXTURE, args: {} })
      const done = yield* workflow.wait({ id: run.id })
      expect(done.run?.status).toBe("completed")
      const result = done.run?.result as { total: number | null; remainingFinite: boolean }
      expect(result.total).toBe(null)
      expect(result.remainingFinite).toBe(false)
    }),
  )

  // Item 17: budget {tokens} gates the next step once the accumulated
  // output+reasoning tokens reach the cap — same two-step shape as the USD gate.
  it.instance("a token budget gates the next step once exhausted", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* Effect.promise(() => writeWorkflow(test.directory, BUDGET_FIXTURE, BUDGET_WORKFLOW))
      const workflow = yield* Workflow.Service
      const { db } = yield* Database.Service
      // Step 1 spends exactly the cap (40 output + 10 reasoning = 50) ⇒ step 2
      // must be refused at the token gate.
      const run = yield* workflow.start({
        name: BUDGET_FIXTURE,
        args: {},
        prompt: tokenBudgetPromptOps(db, 40, 10),
        budget: { tokens: 50 },
      })
      const done = yield* workflow.wait({ id: run.id })
      expect(done.run?.status).toBe("failed")
      expect(done.run?.error ?? "").toMatch(/token budget exhausted/i)
      // Step one really completed; step two was REFUSED at the gate (the throw
      // happens before node creation, exactly like the USD gate).
      const one = done.run?.agents.find((a) => a.prompt === "step one")
      expect(one?.status).toBe("completed")
      expect(done.run?.agents.length).toBe(1)
    }),
  )

  // Item 17: ctx.budget's token trio reads live across steps; only
  // output+reasoning count (the fake carries non-zero input/cache tokens).
  it.instance("ctx.budget exposes tokensTotal/tokensSpent()/tokensRemaining() live across steps", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* Effect.promise(() => writeWorkflow(test.directory, TOKEN_API_FIXTURE, TOKEN_API_WORKFLOW))
      const workflow = yield* Workflow.Service
      const { db } = yield* Database.Service
      const run = yield* workflow.start({
        name: TOKEN_API_FIXTURE,
        args: {},
        prompt: tokenBudgetPromptOps(db, 30, 20),
        budget: { tokens: 100 },
      })
      const done = yield* workflow.wait({ id: run.id })
      expect(done.run?.status).toBe("completed")
      const result = done.run?.result as {
        total: number
        beforeSpent: number
        beforeRemaining: number
        afterSpent: number
        afterRemaining: number
      }
      expect(result.total).toBe(100)
      expect(result.beforeSpent).toBe(0)
      expect(result.beforeRemaining).toBe(100)
      // 30 output + 20 reasoning = 50; input (11) and cache (7/3) do NOT count.
      expect(result.afterSpent).toBe(50)
      expect(result.afterRemaining).toBe(50)
    }),
  )

  // Item 17: without a token budget, tokensTotal is null and tokensRemaining()
  // is Infinity — mirroring the USD trio's unlimited shape.
  it.instance("ctx.budget.tokensTotal is null and tokensRemaining() is Infinity without a token budget", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* Effect.promise(() =>
        writeWorkflow(test.directory, TOKEN_API_UNLIMITED_FIXTURE, TOKEN_API_UNLIMITED_WORKFLOW),
      )
      const workflow = yield* Workflow.Service
      const run = yield* workflow.start({ name: TOKEN_API_UNLIMITED_FIXTURE, args: {} })
      const done = yield* workflow.wait({ id: run.id })
      expect(done.run?.status).toBe("completed")
      const result = done.run?.result as { tokensTotal: number | null; remainingFinite: boolean }
      expect(result.tokensTotal).toBe(null)
      expect(result.remainingFinite).toBe(false)
    }),
  )

  // Item 17 (back-compat pin): the struct form {usd} behaves exactly like the
  // naked-number budget (which the existing USD tests keep pinning).
  it.instance("budget {usd} behaves like the naked-number USD budget", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* Effect.promise(() => writeWorkflow(test.directory, BUDGET_FIXTURE, BUDGET_WORKFLOW))
      const workflow = yield* Workflow.Service
      const { db } = yield* Database.Service
      const run = yield* workflow.start({
        name: BUDGET_FIXTURE,
        args: {},
        prompt: costPromptOps(db, 2),
        budget: { usd: 1 },
      })
      const done = yield* workflow.wait({ id: run.id })
      expect(done.run?.status).toBe("failed")
      expect(done.run?.error ?? "").toMatch(/budget exhausted.*USD/i)
    }),
  )

  // Item 17: a resume's journal REPLAYS charge their token cost too (node.tokens
  // is copied on the cache hit and settled like a live step), so a tight token
  // budget gates a later step even when the earlier one never re-prompted.
  it.instance("a resume charges replayed token cost against the token budget", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* Effect.promise(() => writeWorkflow(test.directory, BUDGET_FIXTURE, BUDGET_WORKFLOW))
      const workflow = yield* Workflow.Service
      const { db } = yield* Database.Service

      // First run: both steps complete, 30 output tokens each.
      const first = yield* workflow.start({ name: BUDGET_FIXTURE, args: {}, prompt: tokenBudgetPromptOps(db, 30) })
      const firstDone =
        (yield* workflow.wait({ id: first.id })).run ?? (yield* Effect.fail(new Error("first run did not finish")))
      expect(firstDone.status).toBe("completed")

      // completed → paused so it is a legitimate resume source (journal kept).
      yield* pollWithTimeout(
        Effect.gen(function* () {
          yield* db
            .update(WorkflowRunTable)
            .set({ status: "paused" })
            .where(eq(WorkflowRunTable.id, first.id))
            .run()
            .pipe(Effect.orDie)
          const current = yield* workflow.get(first.id)
          return current?.status === "paused" ? current : undefined
        }),
        "source run never became paused",
      )

      // Resume with tokens:30 — step one REPLAYS (no prompt) but charges its 30
      // journal tokens, so step two trips the token gate.
      const { ops: resumeOps, prompted } = recordingPromptOps(db, 0)
      const resumed = yield* workflow.start({
        name: BUDGET_FIXTURE,
        args: {},
        prompt: resumeOps,
        resume_of: first.id,
        budget: { tokens: 30 },
      })
      const done =
        (yield* workflow.wait({ id: resumed.id })).run ?? (yield* Effect.fail(new Error("resume did not finish")))
      expect(done.status).toBe("failed")
      expect(done.error ?? "").toMatch(/token budget exhausted/i)
      // Step one was never re-prompted — it came from the journal.
      expect(prompted).not.toContain("step one")
      const one = done.agents.find((a) => a.prompt === "step one")
      expect(one?.cached).toBe(true)
    }),
  )

  it.instance("a failed-but-paid step still charges the budget by its actual cost", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* Effect.promise(() =>
        writeWorkflow(test.directory, BUDGET_FAILED_PAID_FIXTURE, BUDGET_FAILED_PAID_WORKFLOW),
      )
      const workflow = yield* Workflow.Service
      const { db } = yield* Database.Service
      // Schema-Agent scheitert (kein strukturiertes Ergebnis), hat aber 0.3 USD
      // gekostet. Der Workflow fängt den Fehler ab und läuft weiter.
      const run = yield* workflow.start({
        name: BUDGET_FAILED_PAID_FIXTURE,
        args: {},
        prompt: structuredPromptOps(db, "error", 0.3),
        budget: 1,
      })
      const done = yield* workflow.wait({ id: run.id })
      expect(done.run?.status).toBe("completed")
      const result = done.run?.result as { failed: boolean; remaining: number }
      // Der Step ist wirklich gescheitert ...
      expect(result.failed).toBe(true)
      // ... wurde aber trotzdem mit seinen echten Kosten (0.3) belastet.
      expect(result.remaining).toBe(0.7)
      // Und der Agent-Node ist als failed verbucht.
      expect(done.run?.agents.some((a) => a.status === "failed")).toBe(true)
    }),
  )

  // Finding 2 (HIGH): an externally-aborted subagent — a session abort/timeout that
  // is NOT a run-level cancel/pause — RESOLVES with an abort-marked assistant message
  // that carries the abort-artifact cost (0.4 USD here). The run itself never enters
  // cancelling/pausing/removed, so the spend-skip guard used to charge that cost,
  // leaving a `cancelled` run whose budget/costSpent were debited (an internally
  // inconsistent terminal state the comment explicitly forbids). The fix adds the
  // message-level `aborted` flag to the spend-skip guard. We capture the live spend
  // accumulators at the terminal transition (they are never persisted) via the
  // captureSpend seam: the run finishes `cancelled` (the abort propagates) but its
  // budget must be UNTOUCHED (full 1.0 remaining, 0 spent). The per-node telemetry
  // cost is still recorded — only the budget charge is skipped.
  it.instance("an externally-aborted subagent does not charge its abort-artifact cost to the budget", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* Effect.promise(() => writeWorkflow(test.directory, SINGLE_AGENT_FIXTURE, SINGLE_AGENT_WORKFLOW))
      const workflow = yield* Workflow.Service
      const { db } = yield* Database.Service
      const spend = new Map<string, { budgetRemaining: number; costSpent: number }>()
      Workflow.__testHooks.captureSpend((id, s) => spend.set(id, s))
      try {
        const run = yield* workflow.start({
          name: SINGLE_AGENT_FIXTURE,
          args: {},
          prompt: abortedCostPromptOps(db, 0.4),
          budget: 1,
        })
        const done = yield* workflow.wait({ id: run.id })
        // The abort propagates: the run finishes `cancelled` (not completed).
        expect(done.run?.status).toBe("cancelled")
        const captured = spend.get(run.id)
        expect(captured).toBeDefined()
        // The abort-artifact cost was NOT charged: budget intact, nothing spent.
        expect(captured!.budgetRemaining).toBe(1)
        expect(captured!.costSpent).toBe(0)
      } finally {
        Workflow.__testHooks.captureSpend(() => {})
      }
    }),
  )

  // N2 (medium): finish() persistet (orDie) den Terminalzustand. Schlägt dieser
  // Terminal-Write fehl, darf das done-Deferred NICHT verloren gehen — sonst
  // hängt jedes wait() ohne Timeout ewig. Wir injizieren genau eine fehlschlagende
  // Terminal-Persistenz über einen minimalen, klar dokumentierten Test-Seam und
  // verlangen, dass wait() trotzdem mit dem Terminalzustand resolved.
  it.instance("finish resolves waiters even when the terminal persist fails", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* Effect.promise(() =>
        writeWorkflow(
          test.directory,
          "hello",
          `export const meta = { name: "Hello" }
export async function run(args, ctx) { ctx.setPhase("run"); return { value: args.value } }
`,
        ),
      )
      const workflow = yield* Workflow.Service
      // Seam: der NÄCHSTE Terminal-Persist (in finish) wirft einmalig.
      Workflow.__testHooks.failNextTerminalPersist()
      const run = yield* workflow.start({ name: "hello", args: { value: 1 } })
      // wait() OHNE Timeout: darf nicht hängen, sondern muss den Terminalzustand
      // liefern, obwohl der Terminal-DB-Write fehlgeschlagen ist.
      const waited = yield* awaitWithTimeout(
        workflow.wait({ id: run.id }),
        "wait hung after a failing terminal persist",
        "5 seconds",
      )
      expect(waited.run?.status).toBe("completed")
      expect(waited.run?.result).toEqual({ value: 1 })
    }),
  )

  it.instance("reloads workflow implementation after file changes", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* Effect.promise(() =>
        writeWorkflow(
          test.directory,
          "reload",
          `export const meta = { name: "Reload One" }
export async function run() { return { value: "one" } }
`,
          "ts",
        ),
      )
      const workflow = yield* Workflow.Service
      const first = yield* workflow.start({ name: "reload" })
      const firstWaited = yield* workflow.wait({ id: first.id })
      const firstDone = firstWaited.run ?? (yield* Effect.fail(new Error("first workflow did not finish")))
      expect(firstDone.definition?.meta.name).toBe("Reload One")
      expect(firstDone.result).toEqual({ value: "one" })

      yield* Effect.promise(() =>
        writeWorkflow(
          test.directory,
          "reload",
          `export const meta = { name: "Reload Two" }
export async function run() { return { value: "two" } }
`,
          "ts",
        ),
      )

      const second = yield* workflow.start({ name: "reload" })
      const secondWaited = yield* workflow.wait({ id: second.id })
      const secondDone = secondWaited.run ?? (yield* Effect.fail(new Error("second workflow did not finish")))
      expect(secondDone.definition?.meta.name).toBe("Reload Two")
      expect(secondDone.result).toEqual({ value: "two" })
    }),
  )

  // Fund 2 (Symlink-Boundary): Ein Symlink in workflows/ -> externes Ziel darf
  // NIE als Workflow erscheinen. Sonst sieht ein Reviewer nur den harmlosen
  // Symlink, während start() das externe Ziel (z. B. /tmp/payload.ts) lädt.
  it.instance("a symlink in workflows/ pointing outside the directory is not discovered", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      // Externes Ziel außerhalb des workflows-Verzeichnisses.
      const external = path.join(os.tmpdir(), `workflow-symlink-payload-${Math.random().toString(16).slice(2)}.js`)
      yield* Effect.promise(() =>
        Bun.write(
          external,
          `export const meta = { name: "Payload" }
export async function run() { return { ok: true } }
`,
        ),
      )
      // Reguläre Datei als Regressions-Guard: muss weiterhin gefunden werden.
      yield* Effect.promise(() =>
        writeWorkflow(
          test.directory,
          "regular",
          `export const meta = { name: "Regular" }
export async function run() { return { ok: true } }
`,
        ),
      )
      const workflowsDir = path.join(test.directory, ".opencode", "workflows")
      const link = path.join(workflowsDir, "evil.js")
      yield* Effect.promise(() => fs.symlink(external, link))

      const workflow = yield* Workflow.Service
      const list = yield* workflow.list()
      // Der Symlink-Eintrag darf NICHT als gültiger Workflow erscheinen.
      const evil = list.find((item) => item.name === "evil")
      expect(evil?.valid).not.toBe(true)
      // Die reguläre Datei bleibt auffindbar (Regressions-Guard).
      expect(list.some((item) => item.name === "regular" && item.valid === true)).toBe(true)

      yield* Effect.promise(() => fs.rm(external, { force: true }))
    }),
  )

  // Fund 40 (Temp-Cleanup): Eine verwaiste loadModule-Tempdatei (Namensmuster
  // `.<base>.<ts>.<rand>.mts`) im workflows-Verzeichnis darf NIE als Workflow
  // gelistet werden und wird beim Discovery-Lauf opportunistisch gelöscht, wenn
  // sie alt ist (> ~1h).
  it.instance("an orphaned loadModule temp file is never listed and old ones are swept", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* Effect.promise(() =>
        writeWorkflow(
          test.directory,
          "hello",
          `export const meta = { name: "Hello" }
export async function run() { return { ok: true } }
`,
        ),
      )
      const workflowsDir = path.join(test.directory, ".opencode", "workflows")
      // Exaktes Namensmuster, das loadModule erzeugt: `.<base>.<ts>.<rand>.mts`.
      const orphan = path.join(workflowsDir, `.hello.${Date.now()}.abc123.mts`)
      yield* Effect.promise(() =>
        Bun.write(
          orphan,
          `export const meta = { name: "Orphan" }
export async function run() { return { ok: true } }
`,
        ),
      )
      // Alt machen (2h zurück), damit der Sweep sie löscht.
      const old = new Date(Date.now() - 2 * 60 * 60 * 1000)
      yield* Effect.promise(() => fs.utimes(orphan, old, old))

      const workflow = yield* Workflow.Service
      const list = yield* workflow.list()
      // Die Tempdatei darf in keiner Form als Workflow auftauchen.
      expect(list.some((item) => item.name.includes("hello.") || item.meta.name === "Orphan")).toBe(false)
      // Die echte Datei bleibt gelistet.
      expect(list.some((item) => item.name === "hello" && item.valid === true)).toBe(true)
      // Die alte verwaiste Tempdatei wurde beim Discovery-Lauf gelöscht.
      expect(yield* Effect.promise(() => Bun.file(orphan).exists())).toBe(false)
    }),
  )

  // N4 (Projekt-Vorrang): Ein gleichnamiger Workflow im Projekt- UND im
  // Global-Config-Verzeichnis muss zur PROJEKT-Datei auflösen — sonst schattet
  // die globale Datei die Projektdatei und start()/find() trifft die falsche.
  it.instance("a project workflow takes precedence over a same-named global workflow", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      // Projekt-Datei.
      yield* Effect.promise(() =>
        writeWorkflow(
          test.directory,
          "shared",
          `export const meta = { name: "ProjectShared" }
export async function run() { return { from: "project" } }
`,
        ),
      )
      // Gleichnamige Datei im globalen Config-Verzeichnis (~/.config/opencode).
      const globalWorkflows = path.join(Global.Path.config, "workflows")
      const globalFile = path.join(globalWorkflows, "shared.js")
      yield* Effect.promise(() => fs.mkdir(globalWorkflows, { recursive: true }))
      yield* Effect.promise(() =>
        Bun.write(
          globalFile,
          `export const meta = { name: "GlobalShared" }
export async function run() { return { from: "global" } }
`,
        ),
      )

      const workflow = yield* Workflow.Service
      const list = yield* workflow.list()
      const shared = list.filter((item) => item.name === "shared")
      // Genau ein Eintrag (dedupliziert nach Name)...
      expect(shared.length).toBe(1)
      // ... und es ist die PROJEKT-Datei.
      const projectWorkflows = path.join(test.directory, ".opencode", "workflows")
      expect(shared[0]?.path.startsWith(projectWorkflows)).toBe(true)
      expect(shared[0]?.meta.name).toBe("ProjectShared")

      // start() löst denselben Namen ebenfalls zur Projekt-Datei auf.
      const run = yield* workflow.start({ name: "shared" })
      const done = (yield* workflow.wait({ id: run.id })).run
      expect(done?.result).toEqual({ from: "project" })
      expect(done?.definition?.path.startsWith(projectWorkflows)).toBe(true)

      yield* Effect.promise(() => fs.rm(globalFile, { force: true }))
    }),
  )

  // Fund 6 (HIGH) — Cross-Directory-Leak. Zwei Verzeichnisse A/B teilen sich
  // dieselbe (prozess-globale) DB. runs() von B darf As Run NICHT enthalten:
  // jeder Run ist auf das Verzeichnis gescoped, in dem er gestartet wurde.
  it.instance(
    "runs() does not leak runs started in another directory",
    () =>
      Effect.gen(function* () {
        const a = yield* TestInstance
        const b = yield* tmpdirScoped({ git: true })
        yield* Effect.promise(() =>
          writeWorkflow(
            a.directory,
            "hello",
            `export const meta = { name: "Hello" }
export async function run() { return { ok: true } }
`,
          ),
        )
        const workflow = yield* Workflow.Service
        const runA = yield* workflow.start({ name: "hello" })
        yield* workflow.wait({ id: runA.id })

        // B's Liste enthält As Run NICHT.
        const fromB = yield* workflow.runs().pipe(provideInstance(b))
        expect(fromB.some((r) => r.id === runA.id)).toBe(false)
        // A sieht den eigenen Run weiterhin (Regression).
        const fromA = yield* workflow.runs()
        expect(fromA.some((r) => r.id === runA.id)).toBe(true)
      }),
    { git: true },
  )

  // Fund 6 (HIGH) — get()/remove() aus dem fremden Verzeichnis dürfen As Row
  // weder lesen noch löschen. Kalt-Read (kein Registry-Eintrag, nur DB).
  it.instance(
    "get()/remove() from another directory cannot see or delete a foreign run",
    () =>
      Effect.gen(function* () {
        const a = yield* TestInstance
        const b = yield* tmpdirScoped({ git: true })
        const workflow = yield* Workflow.Service
        // As Run direkt als Row seeden, mit As directory.
        const idA = Workflow.RunID.make("job_dir_scoped_A")
        const { db } = yield* Database.Service
        const now = Date.now()
        yield* db
          .insert(WorkflowRunTable)
          .values({
            id: idA,
            workflow: HELLO_FIXTURE,
            status: "completed",
            started_at: now,
            completed_at: now,
            directory: a.directory,
            logs: [],
            agents: [],
          })
          .run()
          .pipe(Effect.orDie)

        // B sieht ihn nicht.
        expect(yield* workflow.get(idA).pipe(provideInstance(b))).toBeUndefined()
        // remove aus B meldet false und lässt As Row unangetastet.
        const removed = yield* workflow.remove(idA).pipe(provideInstance(b))
        expect(removed).toBe(false)
        const row = yield* fetchRunRow(idA)
        expect(row.status).toBe("completed")
        // A findet seinen Run weiterhin.
        const fromA = yield* workflow.get(idA)
        expect(fromA?.id).toBe(idA)
      }),
    { git: true },
  )

  // Fund 17 (medium) — Startup-Sweep cross-directory. Ein Sweep aus B (leere
  // liveIds-Registry, frische InstanceState) darf NUR Bs eigene Zombie-Rows
  // heilen — As running-Row im anderen Verzeichnis bleibt unangetastet.
  it.instance(
    "sweep from another directory leaves foreign running rows untouched",
    () =>
      Effect.gen(function* () {
        const a = yield* TestInstance
        const b = yield* tmpdirScoped({ git: true })
        const workflow = yield* Workflow.Service
        const { db } = yield* Database.Service
        const now = Date.now()
        // As running-Row (gehört Verzeichnis A).
        yield* db
          .insert(WorkflowRunTable)
          .values({
            id: "job_sweep_A",
            workflow: HELLO_FIXTURE,
            status: "running",
            started_at: now,
            directory: a.directory,
            logs: [],
            agents: [],
          })
          .run()
          .pipe(Effect.orDie)
        // Bs eigene Zombie-Row.
        yield* db
          .insert(WorkflowRunTable)
          .values({
            id: "job_sweep_B",
            workflow: HELLO_FIXTURE,
            status: "running",
            started_at: now,
            directory: b,
            logs: [],
            agents: [],
          })
          .run()
          .pipe(Effect.orDie)

        // Sweep aus B: heilt nur Bs Zombie, nicht As running-Row.
        yield* workflow.sweep().pipe(provideInstance(b))
        expect((yield* fetchRunRow("job_sweep_A")).status).toBe("running")
        expect((yield* fetchRunRow("job_sweep_B")).status).toBe("interrupted")

        // As eigener Sweep heilt dann As Zombie.
        yield* workflow.sweep()
        expect((yield* fetchRunRow("job_sweep_A")).status).toBe("interrupted")
      }),
    { git: true },
  )

  // Fund 19 (medium): deklarierte Argument-Typen werden an der Engine-Grenze
  // erzwungen, VOR module.run. Ein String-Wert "42" für ein als `number`
  // deklariertes Argument erreicht run() als die Zahl 42; "true" für ein als
  // `boolean` deklariertes Argument als der Boolean true. Das deckt ALLE
  // Start-Pfade ab (HTTP-JSON-args, Tool, TUI), weil die Koerzierung zentral in
  // start() sitzt. Nicht deklarierte args (`bare`) bleiben unverändert.
  it.instance("declared number/boolean argument types are coerced from strings before run()", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* Effect.promise(() => writeWorkflow(test.directory, COERCE_FIXTURE, COERCE_WORKFLOW))
      const workflow = yield* Workflow.Service
      const run = yield* workflow.start({
        name: COERCE_FIXTURE,
        // String-eingehende args, wie sie über HTTP-JSON oder die TUI ankommen.
        args: { count: "42", flag: "true", label: 99, bare: { keep: 1 } },
      })
      const done = (yield* workflow.wait({ id: run.id })).run ?? (yield* Effect.fail(new Error("did not finish")))
      expect(done.status).toBe("completed")
      const result = done.result as Record<string, unknown>
      // number-Deklaration: "42" -> 42 (echte Zahl).
      expect(result.count).toBe(42)
      expect(result.countType).toBe("number")
      // boolean-Deklaration: "true" -> true (echter Boolean).
      expect(result.flag).toBe(true)
      expect(result.flagType).toBe("boolean")
      // string-Deklaration: ein primitiver Nicht-String (99) wird via String(...)
      // zu "99" koerziert.
      expect(result.label).toBe("99")
      expect(result.labelType).toBe("string")
      // Nicht deklariertes Argument bleibt unverändert durchgereicht.
      expect(result.bare).toEqual({ keep: 1 })
      expect(result.bareType).toBe("object")
    }),
  )

  // Fund 19 (medium): ein als `number` deklariertes Argument mit einem nicht
  // konvertierbaren String ("abc") scheitert mit einem InvalidError an der
  // Engine-Grenze — der Run startet NICHT (kein verwirrender NaN, der erst im
  // Workflow-Body auffliegt).
  it.instance("an unconvertible value for a declared number argument fails with InvalidError", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* Effect.promise(() => writeWorkflow(test.directory, COERCE_FIXTURE, COERCE_WORKFLOW))
      const workflow = yield* Workflow.Service
      const failed = yield* workflow.start({ name: COERCE_FIXTURE, args: { count: "abc" } }).pipe(Effect.flip)
      expect(failed._tag).toBe("WorkflowInvalidError")
      const invalid =
        failed instanceof Workflow.InvalidError ? failed : yield* Effect.fail(new Error("expected InvalidError"))
      expect(invalid.message).toMatch(/count/)
    }),
  )

  // Fund 19 (medium): ein als `boolean` deklariertes Argument akzeptiert nur
  // "true"/"false"; alles andere scheitert mit InvalidError.
  it.instance("an unconvertible value for a declared boolean argument fails with InvalidError", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* Effect.promise(() => writeWorkflow(test.directory, COERCE_FIXTURE, COERCE_WORKFLOW))
      const workflow = yield* Workflow.Service
      const failed = yield* workflow.start({ name: COERCE_FIXTURE, args: { flag: "maybe" } }).pipe(Effect.flip)
      expect(failed._tag).toBe("WorkflowInvalidError")
    }),
  )

  // Review-Fund 3i.1 (IMPORTANT): ein leerer / nur aus Whitespace bestehender
  // String darf für ein number-Argument NICHT still zu 0 koerzieren
  // (`Number("") === 0`, `Number("  ") === 0` — beide finite und würden sonst
  // durchschlüpfen). Beide müssen wie "abc" mit InvalidError scheitern.
  it.instance("empty / whitespace-only string for a declared number argument fails with InvalidError", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* Effect.promise(() => writeWorkflow(test.directory, COERCE_FIXTURE, COERCE_WORKFLOW))
      const workflow = yield* Workflow.Service
      for (const bad of ["", "  ", "\t\n"]) {
        const failed = yield* workflow.start({ name: COERCE_FIXTURE, args: { count: bad } }).pipe(Effect.flip)
        expect(failed._tag).toBe("WorkflowInvalidError")
        const invalid =
          failed instanceof Workflow.InvalidError ? failed : yield* Effect.fail(new Error("expected InvalidError"))
        expect(invalid.message).toMatch(/count/)
      }
    }),
  )

  // Review-Fund 3i.1 (IMPORTANT): non-string, non-number Werte (null, ein Objekt,
  // ein Boolean) für ein number-Argument dürfen nicht als NaN/true durchschlüpfen
  // — sie müssen sauber mit InvalidError scheitern, bevor run() startet.
  it.instance("non-string non-number value for a declared number argument fails with InvalidError", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* Effect.promise(() => writeWorkflow(test.directory, COERCE_FIXTURE, COERCE_WORKFLOW))
      const workflow = yield* Workflow.Service
      for (const bad of [null, {}, [], true] as const) {
        const failed = yield* workflow.start({ name: COERCE_FIXTURE, args: { count: bad } }).pipe(Effect.flip)
        expect(failed._tag).toBe("WorkflowInvalidError")
      }
    }),
  )

  // Review-Fund 3i.4 (LOW): wir akzeptieren bewusst die volle `Number()`-Semantik
  // inkl. Hex ("0x10" -> 16) und Exponent ("1e3" -> 1000) — siehe Doc-Kommentar
  // an coerceArgs. Das ist die geringste Überraschung für JSON/HTTP-Zahlen und
  // konsistent mit dem Rest der numerischen Koerzierung.
  it.instance("hex and exponent numeric strings are accepted via Number() for a declared number argument", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* Effect.promise(() => writeWorkflow(test.directory, COERCE_FIXTURE, COERCE_WORKFLOW))
      const workflow = yield* Workflow.Service
      const run = yield* workflow.start({ name: COERCE_FIXTURE, args: { count: "0x10" } })
      const done = (yield* workflow.wait({ id: run.id })).run ?? (yield* Effect.fail(new Error("did not finish")))
      expect(done.status).toBe("completed")
      const result = done.result as Record<string, unknown>
      expect(result.count).toBe(16)
      expect(result.countType).toBe("number")
    }),
  )

  // Review-Fund 3i.3 (LOW): ein deklarierter STRING-Default ("7") für ein
  // number-Argument wird durch denselben Koerzierungspfad geschickt — run() sieht
  // die Zahl 7, nicht den rohen String "7". Gleiches für den boolean-Default.
  it.instance("declared string-shaped defaults are coerced to their declared type before run()", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* Effect.promise(() => writeWorkflow(test.directory, STRING_DEFAULT_FIXTURE, STRING_DEFAULT_WORKFLOW))
      const workflow = yield* Workflow.Service
      const run = yield* workflow.start({ name: STRING_DEFAULT_FIXTURE, args: {} })
      const done = (yield* workflow.wait({ id: run.id })).run ?? (yield* Effect.fail(new Error("did not finish")))
      expect(done.status).toBe("completed")
      const result = done.result as Record<string, unknown>
      expect(result.count).toBe(7)
      expect(result.countType).toBe("number")
      expect(result.flag).toBe(true)
      expect(result.flagType).toBe("boolean")
    }),
  )

  // Fund 20 (medium): deklarierte Defaults greifen, wenn ein Argument NICHT
  // übergeben wird — run() sieht den typ-korrekten Default.
  it.instance("declared defaults are applied when an argument is not supplied", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* Effect.promise(() => writeWorkflow(test.directory, DEFAULT_FIXTURE, DEFAULT_WORKFLOW))
      const workflow = yield* Workflow.Service
      // Gar keine args übergeben: alle drei Defaults müssen einspringen.
      const run = yield* workflow.start({ name: DEFAULT_FIXTURE, args: {} })
      const done = (yield* workflow.wait({ id: run.id })).run ?? (yield* Effect.fail(new Error("did not finish")))
      expect(done.status).toBe("completed")
      const result = done.result as Record<string, unknown>
      expect(result.name).toBe("x")
      expect(result.nameType).toBe("string")
      expect(result.count).toBe(7)
      expect(result.countType).toBe("number")
      expect(result.flag).toBe(true)
      expect(result.flagType).toBe("boolean")
    }),
  )

  // Fund 20 (medium): ein explizit übergebener Wert gewinnt über den Default und
  // wird dabei dennoch gemäß dem deklarierten Typ koerziert.
  it.instance("an explicitly supplied argument wins over its declared default (and is still coerced)", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* Effect.promise(() => writeWorkflow(test.directory, DEFAULT_FIXTURE, DEFAULT_WORKFLOW))
      const workflow = yield* Workflow.Service
      // count explizit als String "3" übergeben: gewinnt über default 7 und wird
      // zu 3 koerziert. name/flag fallen auf ihre Defaults zurück.
      const run = yield* workflow.start({ name: DEFAULT_FIXTURE, args: { count: "3" } })
      const done = (yield* workflow.wait({ id: run.id })).run ?? (yield* Effect.fail(new Error("did not finish")))
      expect(done.status).toBe("completed")
      const result = done.result as Record<string, unknown>
      expect(result.count).toBe(3)
      expect(result.countType).toBe("number")
      // Die nicht übergebenen behalten ihre Defaults.
      expect(result.name).toBe("x")
      expect(result.flag).toBe(true)
    }),
  )

  // #26514 regression / Fund N9 (security): a workflow subagent MUST inherit the
  // caller SESSION's deny/external_directory rules — the same ruleset the task
  // tool derives. (Parent-AGENT denies are deliberately not inherited since
  // #31696; plan mode is instead gated by the plan agent's `workflow` deny.)
  // Before the fix the engine spawned the child session with NO `permission`,
  // so a parent session `edit: deny` or `external_directory` confinement
  // silently leaked.
  it.instance("workflow subagent inherits the caller session's deny/external_directory rules", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* Effect.promise(() => writeWorkflow(test.directory, SINGLE_AGENT_FIXTURE, SINGLE_AGENT_WORKFLOW))
      const workflow = yield* Workflow.Service
      const sessions = yield* Session.Service

      // The caller session carries the exact rules a Plan-Mode / confined parent
      // would: an edit deny and an external_directory rule. The fix must forward
      // both onto every subagent session the run spawns.
      const caller = yield* sessions.create({
        title: "Caller",
        permission: [
          { permission: "edit", pattern: "**", action: "deny" },
          { permission: "external_directory", pattern: "/outside/**", action: "allow" },
        ],
      })

      const run = yield* workflow.start({
        name: SINGLE_AGENT_FIXTURE,
        args: {},
        prompt: immediatePromptOps(),
        caller: { sessionID: caller.id, agent: "build" },
      })
      const done = (yield* workflow.wait({ id: run.id })).run ?? (yield* Effect.fail(new Error("did not finish")))
      expect(done.status).toBe("completed")

      const childSessionID = done.agents[0]?.session_id
      expect(childSessionID).toBeDefined()
      // The projector persists the session row off the Created event, so poll the
      // read until the row (and its derived permission) is visible. A not-yet-
      // projected row fails get() with NotFound → map to undefined to keep polling.
      const child = yield* pollWithTimeout(
        sessions.get(SessionID.make(childSessionID!)).pipe(
          Effect.map((s) => (s.permission ? s : undefined)),
          Effect.catchCause(() => Effect.succeed(undefined)),
        ),
        "child session permission never populated",
      )
      const rules = child.permission ?? []
      // Core security assertion: the caller's deny + external_directory rules are
      // present on the child (regression of #26514 would leave these absent).
      expect(rules).toContainEqual({ permission: "edit", pattern: "**", action: "deny" })
      expect(rules).toContainEqual({ permission: "external_directory", pattern: "/outside/**", action: "allow" })
    }),
  )

  // Security (compose, never override): per-step tool scoping must NEVER re-grant
  // a tool the inherited subagent permission denies. A caller in Plan Mode denies
  // `edit`; the step passes `tools: { edit: true }`.
  //
  // Before the fix, per-step tools were routed ONLY through PromptInput.tools,
  // whose prompt-loop handler does a FULL ASSIGNMENT `session.permission =
  // [tools→rules]` — clobbering the derived ruleset and re-enabling `edit` for the
  // step. After the fix, when a caller-derived permission exists the per-step
  // tools are instead COMPOSED into the child session's `permission` at creation,
  // placed BEFORE the derived denies so (under last-match-wins evaluation) an
  // inherited deny always beats a per-step grant — and the tools are NO LONGER
  // passed to prompt.prompt (so the clobbering assignment can't fire).
  //
  // Observability: the workflow tests inject fake prompt-ops, so the regression's
  // runtime clobber can't be seen via the prompt loop. We instead assert the two
  // fix-visible facts directly: (1) the composed child-session `permission`
  // CONTAINS the per-step edit grant yet still evaluates `edit` to deny (the
  // inherited deny wins by ordering); (2) the captured PromptInput carries NO
  // `tools` for this step (the engine stopped routing through the clobber path).
  // Both are FALSE before the fix: (1) the create permission never held the
  // per-step rule, and (2) `tools` was passed straight to prompt.prompt.
  it.instance("per-step tools cannot re-grant an inherited-denied tool (deny wins)", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* Effect.promise(() => writeWorkflow(test.directory, TOOLS_REGRANT_FIXTURE, TOOLS_REGRANT_WORKFLOW))
      const workflow = yield* Workflow.Service
      const sessions = yield* Session.Service
      const { ops, inputs } = capturingPromptOps()

      // A Plan-Mode-style caller: edit is denied on the parent session.
      const caller = yield* sessions.create({
        title: "Caller",
        permission: [{ permission: "edit", pattern: "**", action: "deny" }],
      })

      const run = yield* workflow.start({
        name: TOOLS_REGRANT_FIXTURE,
        args: {},
        prompt: ops,
        caller: { sessionID: caller.id, agent: "build" },
      })
      const done = (yield* workflow.wait({ id: run.id })).run ?? (yield* Effect.fail(new Error("did not finish")))
      expect(done.status).toBe("completed")

      const childSessionID = done.agents[0]?.session_id
      expect(childSessionID).toBeDefined()
      const child = yield* pollWithTimeout(
        sessions.get(SessionID.make(childSessionID!)).pipe(
          Effect.map((s) => (s.permission ? s : undefined)),
          Effect.catchCause(() => Effect.succeed(undefined)),
        ),
        "child session permission never populated",
      )
      const rules = child.permission ?? []
      // The inherited edit deny is still present...
      expect(rules).toContainEqual({ permission: "edit", pattern: "**", action: "deny" })
      // ...the per-step grant was COMPOSED into the SAME ruleset (proving tools
      // were folded into sessions.create, not routed to the clobbering prompt path)...
      const grantIdx = rules.findIndex((r) => r.permission === "edit" && r.action === "allow")
      const denyIdx = rules.findIndex((r) => r.permission === "edit" && r.action === "deny")
      expect(grantIdx).toBeGreaterThanOrEqual(0)
      // ...ordered BEFORE the inherited deny (last-match-wins ⇒ deny is later ⇒ deny wins)...
      expect(grantIdx).toBeLessThan(denyIdx)
      // ...so `edit` evaluates to deny despite the per-step `tools: { edit: true }`.
      expect(Permission.evaluate("edit", "anything.ts", rules).action).toBe("deny")
      // And the per-step tools were NOT routed to prompt.prompt (no clobber path).
      expect(inputs.length).toBe(1)
      expect(inputs[0]?.tools).toBeUndefined()
    }),
  )

  // Fallback (documented behavior): a programmatic start with NO caller context
  // keeps the prior behavior — the child session carries no derived `permission`.
  it.instance("workflow subagent has no inherited ruleset when no caller context is supplied", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* Effect.promise(() => writeWorkflow(test.directory, SINGLE_AGENT_FIXTURE, SINGLE_AGENT_WORKFLOW))
      const workflow = yield* Workflow.Service
      const sessions = yield* Session.Service

      const run = yield* workflow.start({
        name: SINGLE_AGENT_FIXTURE,
        args: {},
        prompt: immediatePromptOps(),
      })
      const done = (yield* workflow.wait({ id: run.id })).run ?? (yield* Effect.fail(new Error("did not finish")))
      expect(done.status).toBe("completed")

      const childSessionID = done.agents[0]?.session_id
      expect(childSessionID).toBeDefined()
      // No caller ⇒ no derived ruleset. The session row exists (the run created
      // it), but its `permission` column stays unset (fromRow → undefined). Poll
      // until the row is visible (NotFound → undefined keeps polling), then assert
      // no permission was stored.
      const child = yield* pollWithTimeout(
        sessions.get(SessionID.make(childSessionID!)).pipe(Effect.catchCause(() => Effect.succeed(undefined))),
        "child session never created",
      )
      expect(child.permission).toBeUndefined()
    }),
  )

  // Fund 18 (medium): die drei Workflow-Zeitfelder (LogEntry.time,
  // AgentRun.started_at/completed_at) sind Epoch-Millis und damit IMMER endlich.
  // Als `Schema.Number` erzeugte der SDK-Generator für sie eine NaN/Infinity-
  // String-Union (`number | "NaN" | "Infinity" | ...`), ein unehrlicher
  // Wire-Typ. Nach der Umstellung auf `Schema.Finite` dürfen die generierten
  // SDK-Typen für diese Felder KEINE String-Varianten mehr tragen — sie sind
  // schlicht `number`. Wir greppen die erzeugte types.gen.ts (statisch, kein
  // Laufzeit-Roundtrip nötig).
  test("generated SDK types for workflow time fields are plain numbers, no NaN-string variants", async () => {
    const source = await Bun.file(
      path.join(import.meta.dir, "..", "..", "..", "sdk", "js", "src", "v2", "gen", "types.gen.ts"),
    ).text()
    // Hilfsextraktor: die Zeile, die ein Feld innerhalb eines benannten Typs
    // deklariert, anhand des Typ-Headers + Feldnamens.
    const fieldLine = (typeName: string, field: string) => {
      const block = source.slice(source.indexOf(`export type ${typeName} = {`))
      const line = block
        .split("\n")
        .find((l) => l.trimStart().startsWith(`${field}:`) || l.trimStart().startsWith(`${field}?:`))
      return line ?? ""
    }
    for (const [typeName, field] of [
      ["WorkflowLogEntry", "time"],
      ["WorkflowAgentRun", "started_at"],
      ["WorkflowAgentRun", "completed_at"],
    ] as const) {
      const line = fieldLine(typeName, field)
      expect(line).toContain("number")
      // Keine NaN/Infinity-String-Variante mehr.
      expect(line).not.toContain('"NaN"')
      expect(line).not.toContain('"Infinity"')
    }
  })

  // Track C: Builtin-Workflows als niedrigste Präzedenz-Wurzel (Projekt > Global >
  // Builtin). Ohne gleichnamige Projekt-/Global-Datei MUSS der gebündelte
  // deep-research-Workflow auftauchen, statisch lesbare Meta tragen und als
  // `source_kind: "builtin"` markiert sein. Sein `path` ist ein synthetischer
  // Marker (`builtin:deep-research`), kein echter Dateipfad.
  it.instance("the bundled deep-research workflow is discovered as a builtin with static meta", () =>
    Effect.gen(function* () {
      const workflow = yield* Workflow.Service
      const list = yield* workflow.list()
      const info = list.find((item) => item.name === "deep-research")
      if (!info) return yield* Effect.fail(new Error("deep-research builtin not discovered"))
      expect(info.valid).toBe(true)
      expect(info.source_kind).toBe("builtin")
      expect(info.path).toBe("builtin:deep-research")
      // Meta wurde rein statisch (ohne Modul-Ausführung) gelesen.
      expect(info.meta.name).toBe("deep-research")
      // Phases normalize to the internal object shape (Task 15): strings → { title }.
      expect(info.meta.phases).toEqual([
        { title: "plan" },
        { title: "research" },
        { title: "verify" },
        { title: "synthesize" },
      ])
      expect(info.meta.arguments?.question?.type).toBe("string")
    }),
  )

  // Track C: first-wins-Präzedenz — eine gleichnamige Projektdatei beschattet den
  // gleichnamigen Builtin vollständig (genau EIN Eintrag, und es ist die Datei,
  // KEIN Builtin).
  it.instance("a project workflow takes precedence over a same-named builtin", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* Effect.promise(() =>
        writeWorkflow(
          test.directory,
          "deep-research",
          `export const meta = { name: "ProjectDeepResearch" }
export async function run() { return { from: "project" } }
`,
        ),
      )
      const workflow = yield* Workflow.Service
      const list = yield* workflow.list()
      const matches = list.filter((item) => item.name === "deep-research")
      expect(matches.length).toBe(1)
      // Es ist die Projektdatei (kein Builtin-Marker, kein source_kind).
      const projectWorkflows = path.join(test.directory, ".opencode", "workflows")
      expect(matches[0]?.path.startsWith(projectWorkflows)).toBe(true)
      expect(matches[0]?.source_kind).toBeUndefined()
      expect(matches[0]?.meta.name).toBe("ProjectDeepResearch")
      // start() löst denselben Namen ebenfalls zur Projektdatei auf.
      const run = yield* workflow.start({ name: "deep-research" })
      const done = (yield* workflow.wait({ id: run.id })).run
      expect(done?.result).toEqual({ from: "project" })
    }),
  )

  // Track C: ein gleichnamiger GLOBALER Workflow beschattet den Builtin ebenfalls
  // (Global > Builtin). Genau ein Eintrag, und es ist die globale Datei.
  it.instance("a global workflow takes precedence over a same-named builtin", () =>
    Effect.gen(function* () {
      const globalWorkflows = path.join(Global.Path.config, "workflows")
      const globalFile = path.join(globalWorkflows, "deep-research.js")
      yield* Effect.promise(() => fs.mkdir(globalWorkflows, { recursive: true }))
      yield* Effect.promise(() =>
        Bun.write(
          globalFile,
          `export const meta = { name: "GlobalDeepResearch" }
export async function run() { return { from: "global" } }
`,
        ),
      )
      const workflow = yield* Workflow.Service
      const list = yield* workflow.list()
      const matches = list.filter((item) => item.name === "deep-research")
      expect(matches.length).toBe(1)
      expect(matches[0]?.path.startsWith(globalWorkflows)).toBe(true)
      expect(matches[0]?.source_kind).toBeUndefined()
      expect(matches[0]?.meta.name).toBe("GlobalDeepResearch")
      yield* Effect.promise(() => fs.rm(globalFile, { force: true }))
    }),
  )

  // Track C: der Builtin-Source kompiliert real und lädt über denselben
  // loadModule-Pfad — `run` ist eine Funktion und die Meta ist nach dem echten
  // Import konsistent. KEIN Live-Lauf (deep-research braucht Web-Tools); nur die
  // Lade-Integrität wird geprüft, indem der Builtin-Source via Datei real
  // importiert wird (identische loadModule-Mechanik wie zur Laufzeit).
  test("the deep-research builtin source compiles and exports a real run() via loadModule", async () => {
    const { BUILTIN_WORKFLOWS } = await import("@/workflow/builtin")
    const source = BUILTIN_WORKFLOWS["deep-research"]
    expect(typeof source).toBe("string")
    // INVARIANTE (PR #2 review): Builtin-Sources sind SELF-CONTAINED — keine
    // Imports. Der Temp-Copy wird unter dem GLOBALEN workflows-Verzeichnis
    // materialisiert; ein bare specifier würde dort über `<config>/node_modules`
    // aufgelöst — die PUBLIZIERTE @opencode-ai/plugin, die config.ts installiert,
    // nie der Dev-Workspace (der Reviewer musste das Workspace-Plugin manuell
    // global verlinken, bevor der Builtin lud). Import-frei lädt der Source
    // identisch in Dev, Tests und kompilierter Binary.
    expect(source).not.toMatch(/^\s*import\b/m)
    // Realer Import: in eine Temp-Datei schreiben und dynamisch laden (identisch
    // zur loadModule-Mechanik: GLOBALES workflows-Verzeichnis — der in der
    // kompilierten Bun-Binary beschreibbare Ort, anders als `import.meta.dir`
    // (/$bunfs/root, read-only) — mit TEMP_FILE_RE-Namensschema, laden, danach
    // löschen. Das Modul-Top-Level wird ausgeführt, also deckt dies
    // Syntax-/Compile-Fehler im Source-Literal auf.
    const configDir = path.join(Global.Path.config, "workflows")
    await fs.mkdir(configDir, { recursive: true })
    // Mirror loadModule: resolve to the realpath before writing+importing so the
    // import is consistent with Bun's realpath resolution (the /var → /private/var
    // symlink otherwise breaks a second source-string import in the same dir).
    const workflowsDir = await fs.realpath(configDir)
    const file = path.join(workflowsDir, `.deep-research.${Date.now()}.${Math.random().toString(16).slice(2)}.mts`)
    await Bun.write(file, source)
    try {
      const imported = (await import(pathToFileURL(file).href)) as {
        default?: { meta?: { name?: string }; run?: unknown }
      }
      const mod = imported.default ?? (imported as never)
      expect(mod.meta?.name).toBe("deep-research")
      expect(typeof mod.run).toBe("function")
    } finally {
      await Bun.file(file)
        .delete()
        .catch(() => {})
    }
    // Temp-Datei wurde im globalen workflows-Verzeichnis geladen und ist danach
    // wieder weg (kein Orphan zurückgelassen).
    expect(await Bun.file(file).exists()).toBe(false)
  })

  // P1 (Claude parity): ctx.parallel now resolves a dropped (rejecting/agent-
  // erroring) task to `null` at its position, so the deep-research builtin MUST
  // filter the parallel results before dereferencing them (research findings and
  // verify verdicts). Source-string assertion only — a live run needs web tools.
  test("the deep-research builtin filters dropped parallel results before dereferencing", async () => {
    const { BUILTIN_WORKFLOWS } = await import("@/workflow/builtin")
    const src = BUILTIN_WORKFLOWS["deep-research"]
    expect(src).toContain(".filter((f) => f !== null)")
    expect(src).toContain(".filter((v) => v !== null)")
  })
  // ===========================================================================
  // Track B — Run-Caps (Concurrency + Lifetime) und Pause/Resume
  // ===========================================================================

  // Spec §5.1 (Concurrency-Cap): eine Run-weite Semaphore deckelt ALLE
  // ctx.agent-Dispatches auf min(16, max(2, cpus-2)) — unabhängig von einem
  // großzügigeren per-call concurrencyLimit. 30 parallele Quick-Agents, jeder am
  // Barrier-Gate über die Prompt-Ops geparkt, dürfen daher höchstens cap viele
  // gleichzeitig laufen lassen. Der Peak wird deterministisch über den Barrier-
  // Counter gemessen (wie die Fund-49-Tests), nicht über eine Timing-Window.
  it.instance("run-wide cap bounds concurrent ctx.agent dispatches regardless of per-call limit", () =>
    Effect.gen(function* () {
      const cap = Math.min(16, Math.max(2, os.cpus().length - 2))
      const test = yield* TestInstance
      yield* Effect.promise(() => writeWorkflow(test.directory, AGENT_CAP_FIXTURE, AGENT_CAP_WORKFLOW))
      const workflow = yield* Workflow.Service
      const { db } = yield* Database.Service
      const sync = installBarrier()
      // Prompt-Ops, die jeden Agent-Prompt am Barrier-Gate parken (Peak messbar)
      // und ihn dann mit Telemetrie beantworten.
      const capOps: { prompt: SessionPrompt.Interface["prompt"]; cancel: SessionPrompt.Interface["cancel"] } = {
        prompt: (input) =>
          Effect.gen(function* () {
            if (input.noReply) return assistantReply()
            const barrier = globalThis.__workflowTestBarriers![sync.token]
            barrier.active++
            barrier.peak = Math.max(barrier.peak, barrier.active)
            yield* Effect.promise(() => barrier.gate)
            barrier.active--
            return yield* persistTurns(db, input.sessionID, [
              { cost: 0, tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } } },
            ])
          }),
        cancel: () => Effect.void,
      }
      // 30 parallele Agenten, per-call-Limit 30 (>> cap): die Run-weite Semaphore
      // muss dennoch greifen.
      const run = yield* workflow.start({
        name: AGENT_CAP_FIXTURE,
        args: { count: 30 },
        prompt: capOps,
      })
      // Warten bis cap viele Agenten gleichzeitig am Gate parken.
      yield* sync.awaitPeak(cap)
      // Selbst nach einer Settle-Pause darf der Peak NIE über den Cap klettern:
      // ein (cap+1)-ter gleichzeitiger Dispatch würde die Semaphore verletzen.
      yield* Effect.sleep("200 millis")
      expect(sync.barrier.active).toBe(cap)
      expect(sync.barrier.peak).toBe(cap)
      // Gate öffnen, alle 30 abarbeiten lassen.
      sync.barrier.release()
      const waited = yield* workflow.wait({ id: run.id })
      const done = waited.run ?? (yield* Effect.fail(new Error("cap run did not finish")))
      expect(done.status).toBe("completed")
      expect((done.result as { result: number }).result).toBe(30)
      delete globalThis.__workflowTestBarriers![sync.token]
    }),
  )

  // Spec §5.2 (Lifetime-Cap): ab 1.000 gestarteten Agenten wirft ctx.agent einen
  // WorkflowAgentLimitError. Über den Test-Seam __testHooks.agentLimit wird das
  // Limit auf 5 gesetzt: der 6. ctx.agent-Aufruf scheitert mit _tag
  // "WorkflowAgentLimitError", der Run failt EHRLICH, und genau 5 Agenten sind
  // sichtbar (completed).
  it.instance("agent lifetime limit fails the run at the configured ceiling with a tagged error", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* Effect.promise(() => writeWorkflow(test.directory, LIFETIME_FIXTURE, LIFETIME_WORKFLOW))
      const workflow = yield* Workflow.Service
      const { db } = yield* Database.Service
      Workflow.__testHooks.agentLimit(5)
      const run = yield* workflow.start({
        name: LIFETIME_FIXTURE,
        args: { count: 10 },
        prompt: costPromptOps(db, 0),
      })
      const done = (yield* workflow.wait({ id: run.id })).run ?? (yield* Effect.fail(new Error("did not finish")))
      expect(done.status).toBe("failed")
      expect(done.error ?? "").toMatch(/WorkflowAgentLimitError|agent.*limit/i)
      // Genau 5 Agenten gelangen; der 6. wird vom Lifetime-Gate geblockt (kein
      // Node für den geblockten Aufruf).
      expect(done.agents.filter((a) => a.status === "completed").length).toBe(5)
      expect(done.agents.length).toBe(5)
    }),
  )

  // Spec §5.3 (pause): ein am Agent-Gate hängender Run wird pausiert — die
  // Sessions werden abgebrochen (Recorder), der Scope geschlossen, der Fiber
  // unterbrochen, aber der Run finished mit Status `paused` (NICHT cancelled) und
  // das Journal (agents[]) bleibt erhalten. wait() liefert sofort den
  // paused-Snapshot (timedOut:false). Der Folge-Step läuft nie.
  it.instance("pause suspends a running run as paused, aborts sessions, keeps the journal", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* Effect.promise(() => writeWorkflow(test.directory, PAUSE_FIXTURE, PAUSE_WORKFLOW))
      const workflow = yield* Workflow.Service
      const { ops, aborted } = hangingPromptOps()
      const run = yield* workflow.start({ name: PAUSE_FIXTURE, args: {}, prompt: ops })

      const live = yield* pollWithTimeout(
        Effect.gen(function* () {
          const current = yield* workflow.get(run.id)
          return current && current.agents.some((a) => a.status === "running" && a.session_id) ? current : undefined
        }),
        "agent never started",
      )
      const childSession = live.agents[0]?.session_id
      expect(childSession).toBeDefined()

      const paused = yield* workflow.pause(run.id)
      expect(paused?.status).toBe("paused")
      // Die Child-Session wurde abgebrochen (wie cancel).
      expect(aborted.has(childSession!)).toBe(true)

      // Persistierte Row trägt paused; das Journal bleibt erhalten.
      const row = yield* fetchRunRow(run.id)
      expect(row.status).toBe("paused")
      expect(row.agents.length).toBeGreaterThanOrEqual(1)

      // wait() auf einen paused Run liefert sofort den paused-Snapshot (kein Timeout).
      const waited = yield* workflow.wait({ id: run.id })
      expect(waited.timedOut).toBe(false)
      expect(waited.run?.status).toBe("paused")

      // Der Folge-Step lief nie.
      const after = yield* workflow.get(run.id)
      expect(after?.logs.some((l) => l.message?.includes(PAUSE_AFTER_MARKER))).toBe(false)
    }),
  )

  // Spec §5.3 (Sweep lässt paused in Ruhe): der Orphan-Sweep darf NUR running-Rows
  // ohne Live-Fiber zu interrupted machen — paused-Rows bleiben unangetastet.
  it.instance("sweep leaves paused rows untouched", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const workflow = yield* Workflow.Service
      const { db } = yield* Database.Service
      const pausedId = "job_paused_sweep"
      const now = Date.now()
      yield* db
        .insert(WorkflowRunTable)
        .values({
          id: pausedId,
          workflow: HELLO_FIXTURE,
          status: "paused",
          started_at: now,
          directory: test.directory,
          logs: [],
          agents: [{ id: "1", status: "completed", started_at: now, completed_at: now, prompt: "done", output: "x" }],
        })
        .run()
        .pipe(Effect.orDie)
      yield* workflow.sweep()
      const row = yield* fetchRunRow(pausedId)
      expect(row.status).toBe("paused")
    }),
  )

  // T5 gap (sweep vs parked question): the existing "leaves paused rows untouched"
  // test uses a paused row WITHOUT a pending_question. A run parked by an
  // unanswered ctx.question carries a persisted pending_question; the sweep must
  // leave BOTH the paused status AND the question intact so a later answer() can
  // still resume it.
  it.instance("sweep leaves a paused run that carries a pending_question untouched (status + question preserved)", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const workflow = yield* Workflow.Service
      const { db } = yield* Database.Service
      const pausedId = "job_paused_pending_question"
      const now = Date.now()
      yield* db
        .insert(WorkflowRunTable)
        .values({
          id: pausedId,
          workflow: HELLO_FIXTURE,
          status: "paused",
          started_at: now,
          directory: test.directory,
          logs: [],
          agents: [
            {
              id: "1",
              status: "completed",
              started_at: now,
              completed_at: now,
              kind: "question",
              prompt: "deploy?",
              answer: undefined,
            },
          ],
          pending_question: { question: "deploy?", options: ["yes", "no"], asked_at: now },
        })
        .run()
        .pipe(Effect.orDie)

      yield* workflow.sweep()

      const row = yield* fetchRunRow(pausedId)
      expect(row.status).toBe("paused")
      // The persisted question survives the sweep.
      expect(row.pending_question?.question).toBe("deploy?")
      expect(row.pending_question?.options).toEqual(["yes", "no"])
      // The open question node is not flipped to failed (it is a parked question,
      // not a lost running agent).
      const qnode = row.agents.find((a) => a.kind === "question")
      expect(qnode?.status).not.toBe("failed")
    }),
  )

  // T5 gap (sweep vs live-waiting question): a run blocked LIVE on ctx.question
  // has a real fiber by design — the sweep (which only heals fiber-less zombie
  // running rows) must NOT interrupt it. Start the question run, wait until its
  // pending_question is live, sweep, and assert it is still running and still
  // answerable.
  it.instance("sweep does not interrupt a run waiting live on a question", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* Effect.promise(() => writeWorkflow(test.directory, QUESTION_FIXTURE, QUESTION_WORKFLOW))
      const workflow = yield* Workflow.Service

      const run = yield* workflow.start({ name: QUESTION_FIXTURE, args: {}, prompt: immediatePromptOps() })
      yield* pollWithTimeout(
        Effect.gen(function* () {
          const current = yield* workflow.get(run.id)
          return current?.pending_question?.question === "deploy?" ? current : undefined
        }),
        "pending question never appeared",
      )

      // sweep() keys off the live-id set; the live-waiting run must be protected.
      yield* workflow.sweep()

      const afterSweep = yield* workflow.get(run.id)
      expect(afterSweep?.status).toBe("running")
      expect(afterSweep?.pending_question?.question).toBe("deploy?")
      // The DB row itself must NOT have been flipped to interrupted (get() reads the
      // live registry snapshot, so assert the persisted row directly — this is what
      // bites if sweepOrphans were called with an empty/incorrect live-id set).
      const rowAfterSweep = yield* fetchRunRow(run.id)
      expect(rowAfterSweep.status).toBe("running")

      // Still answerable: the live fiber resolves and the run completes.
      yield* workflow.answer({ id: run.id, answer: "yes" })
      const done =
        (yield* workflow.wait({ id: run.id })).run ??
        (yield* Effect.fail(new Error("live question run did not finish")))
      expect(done.status).toBe("completed")
      expect((done.result as { answer: string }).answer).toBe("yes")
    }),
  )

  // Spec §5.3 (cancel auf paused → cancelled): ein cancel auf einen pausierten Run
  // überführt ihn in den terminalen Status cancelled.
  it.instance("cancel on a paused run transitions it to cancelled", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* Effect.promise(() => writeWorkflow(test.directory, PAUSE_FIXTURE, PAUSE_WORKFLOW))
      const workflow = yield* Workflow.Service
      const { ops } = hangingPromptOps()
      const run = yield* workflow.start({ name: PAUSE_FIXTURE, args: {}, prompt: ops })
      yield* pollWithTimeout(
        Effect.gen(function* () {
          const current = yield* workflow.get(run.id)
          return current && current.agents.some((a) => a.status === "running" && a.session_id) ? current : undefined
        }),
        "agent never started",
      )
      const paused = yield* workflow.pause(run.id)
      expect(paused?.status).toBe("paused")
      const cancelled = yield* workflow.cancel(run.id)
      expect(cancelled?.status).toBe("cancelled")
      const after = yield* workflow.get(run.id)
      expect(after?.status).toBe("cancelled")
    }),
  )

  // Spec §5.4 (Resume-Journal): ein Run mit Agent A (completed) + B (durch pause
  // unterbrochen). Ein resume-Start mit resume_of übernimmt A aus dem Journal
  // (KEIN neuer Prompt für A, output/cost übernommen, cached:true), B läuft live;
  // das Budget des neuen Runs wird um As Kosten vor-dekrementiert.
  it.instance("resume replays the completed agent from the journal and runs the rest live", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* Effect.promise(() => writeWorkflow(test.directory, RESUME_FIXTURE, RESUME_WORKFLOW))
      const workflow = yield* Workflow.Service
      const { db } = yield* Database.Service

      // Erster Lauf: A completed sofort, B hängt → pause unterbricht B.
      const firstAborted = new Set<string>()
      const firstGates = new Map<string, Deferred.Deferred<void>>()
      let promptCount = 0
      const firstOps: { prompt: SessionPrompt.Interface["prompt"]; cancel: SessionPrompt.Interface["cancel"] } = {
        prompt: (input) =>
          Effect.gen(function* () {
            if (input.noReply) return assistantReply()
            promptCount++
            const text = authorPrompt(input.parts?.[0]?.type === "text" ? input.parts[0].text : "")
            // Agent A beantwortet sofort mit Kosten 0.25; Agent B hängt.
            if (text === "agent A") {
              const last = yield* persistTurns(db, input.sessionID, [
                { cost: 0.25, tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } } },
              ])
              return { info: last.info, parts: [{ type: "text", text: "out:A" }] } as unknown as SessionV1.WithParts
            }
            const gate = yield* Deferred.make<void>()
            firstGates.set(input.sessionID, gate)
            yield* Effect.race(
              Effect.sleep("30 seconds"),
              Deferred.await(gate).pipe(Effect.flatMap(() => Effect.interrupt)),
            )
            return assistantReply()
          }),
        cancel: (sessionID) =>
          Effect.gen(function* () {
            firstAborted.add(sessionID)
            const gate = firstGates.get(sessionID)
            if (gate) yield* Deferred.succeed(gate, undefined)
          }),
      }
      const first = yield* workflow.start({ name: RESUME_FIXTURE, args: {}, prompt: firstOps })
      // Warten bis A completed und B running ist.
      yield* pollWithTimeout(
        Effect.gen(function* () {
          const current = yield* workflow.get(first.id)
          const completed = current?.agents.filter((a) => a.status === "completed") ?? []
          const running = current?.agents.filter((a) => a.status === "running" && a.session_id) ?? []
          return completed.length >= 1 && running.length >= 1 ? current : undefined
        }),
        "first run did not reach A-completed + B-running",
      )
      const pausedFirst = yield* workflow.pause(first.id)
      expect(pausedFirst?.status).toBe("paused")
      const firstPromptCount = promptCount

      // Zweiter Lauf (resume): recordingPromptOps protokolliert jeden GEFEUERTEN
      // Prompt. A muss aus dem Journal kommen (NICHT in prompted), B live.
      const { ops: resumeOps, prompted } = recordingPromptOps(db, 0.5)
      const resumed = yield* workflow.start({
        name: RESUME_FIXTURE,
        args: {},
        prompt: resumeOps,
        resume_of: first.id,
        budget: 10,
      })
      const done =
        (yield* workflow.wait({ id: resumed.id })).run ?? (yield* Effect.fail(new Error("resume did not finish")))
      expect(done.status).toBe("completed")
      // A kam aus dem Journal: KEIN neuer Prompt "agent A" wurde gefeuert.
      expect(prompted).not.toContain("agent A")
      // B lief live.
      expect(prompted).toContain("agent B")
      // Das resume hat den Quell-Run NICHT erneut geprompt (firstPromptCount fix).
      expect(firstPromptCount).toBeGreaterThanOrEqual(1)
      // A's Output (aus dem Journal) und B's Live-Output sind im Resultat.
      const result = done.result as { a: string; b: string }
      expect(result.a).toBe("out:A")
      expect(result.b).toBe("out:agent B")
      // Agent-Node A ist als cached markiert, B nicht.
      const agentA = done.agents.find((a) => a.output === "out:A")
      expect(agentA?.cached).toBe(true)
      const agentB = done.agents.find((a) => a.output === "out:agent B")
      expect(agentB?.cached).not.toBe(true)
      // resume_of ist auf der Row vermerkt.
      const row = yield* fetchRunRow(resumed.id)
      expect(row.resume_of).toBe(first.id)
      // Item 6 Regressionsschutz: node.prompt bleibt der ROHE Autoren-Prompt —
      // die Step-Framing-Direktive wird nur auf den DISPATCHTEN Text geprependet,
      // nie auf den Node (und damit nie in den Journal-Key).
      expect(done.agents.every((a) => !a.prompt.includes(Workflow.STEP_FRAMING_DIRECTIVE))).toBe(true)
    }),
  )

  // Spec §5.4 (Occurrence-Index): zwei identische Prompts müssen beim Resume
  // getrennt aus dem Journal aufgelöst werden (je nach Aufruf-Reihenfolge), nicht
  // beide auf denselben Eintrag. Beide A-Agenten kommen aus dem Journal, also wird
  // KEIN Prompt erneut gefeuert. Item 20: das pinnt die KEYED-Occurrence-Semantik
  // (Map + Cursor pro Key) — seit dem prefix-Default explizit mit replay:"keyed";
  // der prefix-Zwilling (Sequenz-Cursor löst Duplikate genauso) steht darunter.
  it.instance("resume caches two identical prompts separately by occurrence (keyed)", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* Effect.promise(() => writeWorkflow(test.directory, RESUME_DUP_FIXTURE, RESUME_DUP_WORKFLOW))
      const workflow = yield* Workflow.Service
      const { db } = yield* Database.Service

      // Erster Lauf: beide identischen Prompts completen sofort mit
      // UNTERSCHEIDBAREN Outputs (out:0, out:1), damit der Test beweisen kann, dass
      // die zwei Journal-Einträge getrennt aufgelöst werden.
      let counter = 0
      const firstOps: { prompt: SessionPrompt.Interface["prompt"]; cancel: SessionPrompt.Interface["cancel"] } = {
        prompt: (input) =>
          Effect.gen(function* () {
            if (input.noReply) return assistantReply()
            const idx = counter++
            const last = yield* persistTurns(db, input.sessionID, [
              { cost: 0, tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } } },
            ])
            return { info: last.info, parts: [{ type: "text", text: "out:" + idx }] } as unknown as SessionV1.WithParts
          }),
        cancel: () => Effect.void,
      }
      const first = yield* workflow.start({ name: RESUME_DUP_FIXTURE, args: {}, prompt: firstOps })
      const firstDone =
        (yield* workflow.wait({ id: first.id })).run ?? (yield* Effect.fail(new Error("first dup run did not finish")))
      expect(firstDone.status).toBe("completed")
      expect(firstDone.result).toEqual({ first: "out:0", second: "out:1" })

      // Dieser Test pinnt die Occurrence-Index-Auflösung aus einer PAUSED Quelle
      // (completed wäre seit der Guard-Erweiterung zwar auch direkt resumebar, aber
      // paused ist der historische Kernfall). Der erste Lauf completed mit beiden
      // Journal-Einträgen; wir versetzen die Row auf `paused` (Journal/agents
      // bleiben erhalten), um diese Resume-Quelle zu erhalten. Das Update
      // wird im Poll wiederholt, bis es sichtbar `paused` ist (der terminale Run wird
      // ASYNCHRON aus der Registry evictet — bis dahin könnte ein letzter Snapshot die
      // DB-Mutation überschreiben; nach Eviction fällt get() auf die Row zurück).
      yield* pollWithTimeout(
        Effect.gen(function* () {
          yield* db
            .update(WorkflowRunTable)
            .set({ status: "paused" })
            .where(eq(WorkflowRunTable.id, first.id))
            .run()
            .pipe(Effect.orDie)
          const current = yield* workflow.get(first.id)
          return current?.status === "paused" ? current : undefined
        }),
        "source run never became paused",
      )

      // Resume: beide identischen Prompts müssen aus dem Journal kommen (kein neuer
      // Prompt), und zwar getrennt: first→out:0, second→out:1 (Occurrence-Reihenfolge).
      const { ops: resumeOps, prompted } = recordingPromptOps(db, 0)
      const resumed = yield* workflow.start({
        name: RESUME_DUP_FIXTURE,
        args: {},
        prompt: resumeOps,
        resume_of: first.id,
        replay: "keyed",
      })
      const done =
        (yield* workflow.wait({ id: resumed.id })).run ?? (yield* Effect.fail(new Error("resume dup did not finish")))
      expect(done.status).toBe("completed")
      // Kein Prompt wurde gefeuert: beide kamen aus dem Journal.
      expect(prompted).toHaveLength(0)
      // Getrennt aufgelöst, in Occurrence-Reihenfolge.
      expect(done.result).toEqual({ first: "out:0", second: "out:1" })
    }),
  )

  // Item 20 (prefix-Zwilling des Occurrence-Tests): im Default-Modus 'prefix'
  // löst der Sequenz-Cursor zwei identische Prompts genauso getrennt auf — der
  // erste Call trifft Eintrag 0, der zweite Eintrag 1, in Original-Reihenfolge.
  it.instance("prefix replay resolves two identical prompts separately in order", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* Effect.promise(() => writeWorkflow(test.directory, RESUME_DUP_FIXTURE, RESUME_DUP_WORKFLOW))
      const workflow = yield* Workflow.Service
      const { db } = yield* Database.Service

      let counter = 0
      const firstOps: { prompt: SessionPrompt.Interface["prompt"]; cancel: SessionPrompt.Interface["cancel"] } = {
        prompt: (input) =>
          Effect.gen(function* () {
            if (input.noReply) return assistantReply()
            const idx = counter++
            const last = yield* persistTurns(db, input.sessionID, [
              { cost: 0, tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } } },
            ])
            return { info: last.info, parts: [{ type: "text", text: "out:" + idx }] } as unknown as SessionV1.WithParts
          }),
        cancel: () => Effect.void,
      }
      const first = yield* workflow.start({ name: RESUME_DUP_FIXTURE, args: {}, prompt: firstOps })
      const firstDone =
        (yield* workflow.wait({ id: first.id })).run ?? (yield* Effect.fail(new Error("first dup run did not finish")))
      expect(firstDone.status).toBe("completed")
      expect(firstDone.result).toEqual({ first: "out:0", second: "out:1" })

      // completed ist seit Item 2 direkt resumebar; explizites replay:"prefix"
      // pinnt das Options-Feld (Default wäre identisch).
      const { ops: resumeOps, prompted } = recordingPromptOps(db, 0)
      const resumed = yield* workflow.start({
        name: RESUME_DUP_FIXTURE,
        args: {},
        prompt: resumeOps,
        resume_of: first.id,
        replay: "prefix",
      })
      const done =
        (yield* workflow.wait({ id: resumed.id })).run ?? (yield* Effect.fail(new Error("resume dup did not finish")))
      expect(done.status).toBe("completed")
      expect(prompted).toHaveLength(0)
      expect(done.result).toEqual({ first: "out:0", second: "out:1" })
    }),
  )

  // Spec §5.4 (invalidate_agents): mit invalidate_agents:[0] läuft Agent #0 live
  // neu, alle anderen cachen. Item 20: das ist KEYED-Semantik (Shape-Match
  // bedient spätere unveränderte Calls trotz früherem Invalidate) — seit dem
  // prefix-Default deshalb explizit mit replay:"keyed" gepinnt; das prefix-
  // Gegenstück ("alles nach dem Invalidate läuft live") steht unten.
  it.instance("resume with invalidate_agents reruns the named index live and caches the rest (keyed)", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* Effect.promise(() => writeWorkflow(test.directory, RESUME_FIXTURE, RESUME_WORKFLOW))
      const workflow = yield* Workflow.Service
      const { db } = yield* Database.Service

      // Erster Lauf: beide Agenten completen sofort.
      const firstOps = recordingPromptOps(db, 0)
      const first = yield* workflow.start({ name: RESUME_FIXTURE, args: {}, prompt: firstOps.ops })
      const firstDone =
        (yield* workflow.wait({ id: first.id })).run ?? (yield* Effect.fail(new Error("first run did not finish")))
      expect(firstDone.status).toBe("completed")

      // Status-Guard: nur paused/interrupted Runs sind gültige Resume-Quellen. Die
      // completed-Row auf `paused` versetzen (Journal bleibt), damit der Resume die
      // invalidate_agents-Semantik prüfen kann. Im Poll wiederholt, bis sichtbar
      // `paused` (asynchrone Eviction des terminalen Runs — siehe oben).
      yield* pollWithTimeout(
        Effect.gen(function* () {
          yield* db
            .update(WorkflowRunTable)
            .set({ status: "paused" })
            .where(eq(WorkflowRunTable.id, first.id))
            .run()
            .pipe(Effect.orDie)
          const current = yield* workflow.get(first.id)
          return current?.status === "paused" ? current : undefined
        }),
        "source run never became paused",
      )

      // Resume mit invalidate_agents:[0] → Agent #0 (A) läuft live neu, B cacht
      // (keyed: der Shape-Match bedient B trotz des früheren Invalidates).
      const { ops: resumeOps, prompted } = recordingPromptOps(db, 0)
      const resumed = yield* workflow.start({
        name: RESUME_FIXTURE,
        args: {},
        prompt: resumeOps,
        resume_of: first.id,
        invalidate_agents: [0],
        replay: "keyed",
      })
      const done =
        (yield* workflow.wait({ id: resumed.id })).run ?? (yield* Effect.fail(new Error("resume did not finish")))
      expect(done.status).toBe("completed")
      // Nur Agent A (#0) lief live neu; B kam aus dem Journal.
      expect(prompted).toContain("agent A")
      expect(prompted).not.toContain("agent B")
      const agentA = done.agents.find((a) => a.prompt === "agent A")
      expect(agentA?.cached).not.toBe(true)
      const agentB = done.agents.find((a) => a.prompt === "agent B")
      expect(agentB?.cached).toBe(true)
    }),
  )

  // T5 gap (invalidate_agents positional): the existing invalidate test only
  // rebuilds index [0]. Pin that a NON-zero index reruns ONLY that agent live
  // while the EARLIER agent stays cached — proving the index is honored
  // positionally, not "always rerun the first". RESUME_WORKFLOW dispatches A
  // (index 0) then B (index 1); invalidate_agents:[1] must rerun B live, cache A.
  it.instance("resume with invalidate_agents reruns a NON-zero index live and caches the earlier agent", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* Effect.promise(() => writeWorkflow(test.directory, RESUME_FIXTURE, RESUME_WORKFLOW))
      const workflow = yield* Workflow.Service
      const { db } = yield* Database.Service

      const firstOps = recordingPromptOps(db, 0)
      const first = yield* workflow.start({ name: RESUME_FIXTURE, args: {}, prompt: firstOps.ops })
      const firstDone =
        (yield* workflow.wait({ id: first.id })).run ?? (yield* Effect.fail(new Error("first run did not finish")))
      expect(firstDone.status).toBe("completed")

      // completed → paused so it is a legitimate resume source (journal kept).
      yield* pollWithTimeout(
        Effect.gen(function* () {
          yield* db
            .update(WorkflowRunTable)
            .set({ status: "paused" })
            .where(eq(WorkflowRunTable.id, first.id))
            .run()
            .pipe(Effect.orDie)
          const current = yield* workflow.get(first.id)
          return current?.status === "paused" ? current : undefined
        }),
        "source run never became paused",
      )

      const { ops: resumeOps, prompted } = recordingPromptOps(db, 0)
      const resumed = yield* workflow.start({
        name: RESUME_FIXTURE,
        args: {},
        prompt: resumeOps,
        resume_of: first.id,
        invalidate_agents: [1],
      })
      const done =
        (yield* workflow.wait({ id: resumed.id })).run ?? (yield* Effect.fail(new Error("resume did not finish")))
      expect(done.status).toBe("completed")
      // Only B (index 1) reran live; A (index 0) came from the journal.
      expect(prompted).toContain("agent B")
      expect(prompted).not.toContain("agent A")
      const agentA = done.agents.find((a) => a.prompt === "agent A")
      expect(agentA?.cached).toBe(true)
      const agentB = done.agents.find((a) => a.prompt === "agent B")
      expect(agentB?.cached).not.toBe(true)
    }),
  )

  // Item 20 Test (1): 'prefix replay stops at the first changed call'. Quelllauf
  // A,B,C sequenziell completed; Resume (Default 'prefix') mit
  // invalidate_agents:[0] ⇒ der Präfix bricht ab Index 0 DAUERHAFT — A, B UND C
  // laufen live, obwohl B/C unverändert sind. Das ist die Original-Semantik:
  // nach dem ersten Mismatch wird nichts mehr aus dem Journal bedient, weil die
  // Workspace-Seiteneffekte späterer Steps stale sein können.
  it.instance("prefix replay stops at the first changed call: invalidate_agents:[0] reruns everything live", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* Effect.promise(() => writeWorkflow(test.directory, PREFIX_FIXTURE, PREFIX_WORKFLOW))
      const workflow = yield* Workflow.Service
      const { db } = yield* Database.Service

      const firstOps = recordingPromptOps(db, 0)
      const first = yield* workflow.start({ name: PREFIX_FIXTURE, args: {}, prompt: firstOps.ops })
      const firstDone =
        (yield* workflow.wait({ id: first.id })).run ?? (yield* Effect.fail(new Error("first run did not finish")))
      expect(firstDone.status).toBe("completed")

      // completed ist seit Item 2 direkt resumebar; kein replay gesetzt ⇒ der
      // DEFAULT ist prefix (genau das pinnt dieser Test mit).
      const { ops: resumeOps, prompted } = recordingPromptOps(db, 0)
      const resumed = yield* workflow.start({
        name: PREFIX_FIXTURE,
        args: {},
        prompt: resumeOps,
        resume_of: first.id,
        invalidate_agents: [0],
      })
      const done =
        (yield* workflow.wait({ id: resumed.id })).run ?? (yield* Effect.fail(new Error("resume did not finish")))
      expect(done.status).toBe("completed")
      // ALLES lief live: A (invalidiert) und die unveränderten B/C dahinter.
      expect(prompted).toEqual(["agent A", "agent B", "agent C"])
      expect(done.agents.every((a) => a.cached !== true)).toBe(true)
    }),
  )

  // Item 20 keyed-Gegentest zur 3-Agenten-Fixture: replay:"keyed" stellt das
  // alte Verhalten exakt wieder her — nur A (invalidiert) läuft live, B und C
  // werden trotz des früheren Invalidates aus dem Journal bedient.
  it.instance("keyed replay after invalidate_agents:[0] serves the unchanged later calls from the journal", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* Effect.promise(() => writeWorkflow(test.directory, PREFIX_FIXTURE, PREFIX_WORKFLOW))
      const workflow = yield* Workflow.Service
      const { db } = yield* Database.Service

      const firstOps = recordingPromptOps(db, 0)
      const first = yield* workflow.start({ name: PREFIX_FIXTURE, args: {}, prompt: firstOps.ops })
      const firstDone =
        (yield* workflow.wait({ id: first.id })).run ?? (yield* Effect.fail(new Error("first run did not finish")))
      expect(firstDone.status).toBe("completed")

      const { ops: resumeOps, prompted } = recordingPromptOps(db, 0)
      const resumed = yield* workflow.start({
        name: PREFIX_FIXTURE,
        args: {},
        prompt: resumeOps,
        resume_of: first.id,
        invalidate_agents: [0],
        replay: "keyed",
      })
      const done =
        (yield* workflow.wait({ id: resumed.id })).run ?? (yield* Effect.fail(new Error("resume did not finish")))
      expect(done.status).toBe("completed")
      // Nur A lief live; B/C kamen aus dem Journal (keyed-Shape-Match).
      expect(prompted).toEqual(["agent A"])
      const agentB = done.agents.find((a) => a.prompt === "agent B")
      expect(agentB?.cached).toBe(true)
      const agentC = done.agents.find((a) => a.prompt === "agent C")
      expect(agentC?.cached).toBe(true)
    }),
  )

  // Item 20 Test (2): 'prefix replay serves an unchanged full prefix'. Ein
  // identisches Script (kein Invalidate, kein Drift) ist unter explizitem
  // replay:"prefix" ein voller Cache-Hit — kein Prompt, alle Nodes cached.
  it.instance("prefix replay serves an unchanged full prefix as a complete cache hit", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* Effect.promise(() => writeWorkflow(test.directory, PREFIX_FIXTURE, PREFIX_WORKFLOW))
      const workflow = yield* Workflow.Service
      const { db } = yield* Database.Service

      const firstOps = recordingPromptOps(db, 0)
      const first = yield* workflow.start({ name: PREFIX_FIXTURE, args: {}, prompt: firstOps.ops })
      const firstDone =
        (yield* workflow.wait({ id: first.id })).run ?? (yield* Effect.fail(new Error("first run did not finish")))
      expect(firstDone.status).toBe("completed")

      const { ops: resumeOps, prompted } = recordingPromptOps(db, 0)
      const resumed = yield* workflow.start({
        name: PREFIX_FIXTURE,
        args: {},
        prompt: resumeOps,
        resume_of: first.id,
        replay: "prefix",
      })
      const done =
        (yield* workflow.wait({ id: resumed.id })).run ?? (yield* Effect.fail(new Error("resume did not finish")))
      expect(done.status).toBe("completed")
      expect(prompted).toHaveLength(0)
      expect(done.agents).toHaveLength(3)
      expect(done.agents.every((a) => a.cached === true)).toBe(true)
      expect(done.result).toEqual(firstDone.result)
    }),
  )

  // Item 27 (Transcript-Export): export(id) schreibt run.json plus eine
  // <agent-id>.jsonl pro Agent-Node unter <data>/workflow/<runId>/transcripts.
  // Live-Nodes (mit Session) exportieren eine {info,parts}-Zeile pro Message;
  // ein gecachter (session-loser) Node erzeugt GENAU die Fallback-Zeile {node}
  // — der Export ist immer vollständig über alle Nodes, jede Zeile valides JSON.
  it.instance("export writes run.json plus one parseable JSONL per agent node (incl. cached fallback)", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* Effect.promise(() => writeWorkflow(test.directory, RESUME_FIXTURE, RESUME_WORKFLOW))
      const workflow = yield* Workflow.Service
      const { db } = yield* Database.Service

      const firstOps = recordingPromptOps(db, 0)
      const first = yield* workflow.start({ name: RESUME_FIXTURE, args: {}, prompt: firstOps.ops })
      const firstDone =
        (yield* workflow.wait({ id: first.id })).run ?? (yield* Effect.fail(new Error("first run did not finish")))
      expect(firstDone.status).toBe("completed")

      const exported = yield* workflow.export(first.id)
      expect(exported).toBeDefined()
      expect(exported!.path).toBe(path.join(Global.Path.data, "workflow", first.id, "transcripts"))
      expect(exported!.files).toContain("run.json")
      // run.json ist parsebar und trägt die Run-ID.
      const runJson = JSON.parse(
        yield* Effect.promise(() => fs.readFile(path.join(exported!.path, "run.json"), "utf8")),
      ) as { id: string }
      expect(runJson.id).toBe(first.id)
      // Je Agent-Node eine .jsonl; jede Zeile besteht JSON.parse. Live-Nodes
      // tragen Session-Messages ({info,parts}).
      expect(firstDone.agents).toHaveLength(2)
      for (const node of firstDone.agents) {
        const file = `${node.id}.jsonl`
        expect(exported!.files).toContain(file)
        const lines = (yield* Effect.promise(() => fs.readFile(path.join(exported!.path, file), "utf8")))
          .split("\n")
          .filter((line) => line.length > 0)
        expect(lines.length).toBeGreaterThanOrEqual(1)
        for (const line of lines) {
          const parsed = JSON.parse(line) as Record<string, unknown>
          expect("info" in parsed || "node" in parsed).toBe(true)
        }
      }

      // Resume der completed-Quelle: voller Cache-Hit ⇒ session-lose cached-
      // Nodes. Deren Export ist die einzelne Fallback-Zeile {node}.
      const resumeOps = recordingPromptOps(db, 0)
      const resumed = yield* workflow.start({
        name: RESUME_FIXTURE,
        args: {},
        prompt: resumeOps.ops,
        resume_of: first.id,
      })
      const done =
        (yield* workflow.wait({ id: resumed.id })).run ?? (yield* Effect.fail(new Error("resume did not finish")))
      expect(done.status).toBe("completed")
      const exported2 = yield* workflow.export(resumed.id)
      expect(exported2).toBeDefined()
      const cached = done.agents.find((a) => a.cached === true)
      expect(cached).toBeDefined()
      const fallbackLines = (yield* Effect.promise(() =>
        fs.readFile(path.join(exported2!.path, `${cached!.id}.jsonl`), "utf8"),
      ))
        .split("\n")
        .filter((line) => line.length > 0)
      expect(fallbackLines).toHaveLength(1)
      const parsedFallback = JSON.parse(fallbackLines[0]) as { node?: { id?: string; cached?: boolean } }
      expect(parsedFallback.node?.id).toBe(cached!.id)
      expect(parsedFallback.node?.cached).toBe(true)

      // Re-Export überschreibt deterministisch (gleiche Namen, kein Fehler).
      const again = yield* workflow.export(first.id)
      expect(again!.files.toSorted()).toEqual(exported!.files.toSorted())

      // Aufräumen: die Export-Verzeichnisse beider Runs entfernen (das Test-
      // Datadir wird zwar am Prozessende gelöscht; lokal trotzdem nichts liegen
      // lassen).
      yield* Effect.promise(() =>
        fs.rm(path.join(Global.Path.data, "workflow", first.id), { recursive: true, force: true }),
      )
      yield* Effect.promise(() =>
        fs.rm(path.join(Global.Path.data, "workflow", resumed.id), { recursive: true, force: true }),
      )
    }),
  )

  // Item 27: export() ist directory-scoped wie get() — eine dem Workspace
  // fremde Run-ID liefert undefined (HTTP → 404) und schreibt nichts; eine
  // völlig unbekannte ID ebenso.
  it.instance(
    "export of an unknown or foreign-directory run returns undefined",
    () =>
      Effect.gen(function* () {
        const b = yield* tmpdirScoped({ git: true })
        const workflow = yield* Workflow.Service
        const idA = Workflow.RunID.make("job_export_foreign_A")
        // As Run direkt als Row seeden, mit As (Test-)directory.
        yield* seedCompletedRow(idA, (yield* TestInstance).directory)
        // B sieht ihn nicht — kein Export, kein Verzeichnis.
        expect(yield* workflow.export(idA).pipe(provideInstance(b))).toBeUndefined()
        const foreignDir = path.join(Global.Path.data, "workflow", idA, "transcripts")
        expect(yield* Effect.promise(() => fs.stat(foreignDir).then(() => true).catch(() => false))).toBe(false)
        // Unbekannte ID ⇒ undefined.
        expect(yield* workflow.export(Workflow.RunID.make("job_export_unknown"))).toBeUndefined()
        // A selbst kann exportieren (der geseedete Node hat keine Session ⇒
        // Fallback-Zeile), danach aufräumen.
        const exported = yield* workflow.export(idA)
        expect(exported).toBeDefined()
        expect(exported!.files.toSorted()).toEqual(["1.jsonl", "run.json"])
        yield* Effect.promise(() =>
          fs.rm(path.join(Global.Path.data, "workflow", idA), { recursive: true, force: true }),
        )
      }),
    { git: true },
  )

  // T5 gap (mixed journal: agent cached, question re-asked on an ORDINARY resume).
  // A workflow that asks a question THEN dispatches an agent. On the first run the
  // question is answered live and the agent runs live. On an ORDINARY resume
  // (resume_of only — no answer()-seed), the engine replays the completed AGENT
  // node from the journal (cached, NOT re-prompted) but DELIBERATELY does NOT
  // journal-replay the question: question replay is the answer()-seeded path only
  // (workflow.ts ~1967 + q-then-agent test). So the question re-asks LIVE and we
  // answer it live again; the cached agent proves the agent-journal replay works
  // alongside a question node, and the live re-ask pins the documented boundary.
  it.instance("ordinary resume of a mixed journal caches the agent and re-asks the question live", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* Effect.promise(() => writeWorkflow(test.directory, MIXED_REPLAY_FIXTURE, MIXED_REPLAY_WORKFLOW))
      const workflow = yield* Workflow.Service
      const { db } = yield* Database.Service

      // First run: answer the question live, agent runs live with a recorded prompt.
      const firstOps = recordingPromptOps(db, 0)
      const first = yield* workflow.start({ name: MIXED_REPLAY_FIXTURE, args: {}, prompt: firstOps.ops })
      yield* pollWithTimeout(
        Effect.gen(function* () {
          const current = yield* workflow.get(first.id)
          return current?.pending_question?.question === "ship?" ? current : undefined
        }),
        "pending question never appeared",
      )
      yield* workflow.answer({ id: first.id, answer: "yes" })
      const firstDone =
        (yield* workflow.wait({ id: first.id })).run ??
        (yield* Effect.fail(new Error("first mixed run did not finish")))
      expect(firstDone.status).toBe("completed")
      expect(firstOps.prompted).toContain("do-yes")
      const firstResult = firstDone.result as { answer: string; work: string }
      expect(firstResult.answer).toBe("yes")

      // completed → paused so it is a legitimate resume source (journal kept).
      yield* pollWithTimeout(
        Effect.gen(function* () {
          yield* db
            .update(WorkflowRunTable)
            .set({ status: "paused" })
            .where(eq(WorkflowRunTable.id, first.id))
            .run()
            .pipe(Effect.orDie)
          const current = yield* workflow.get(first.id)
          return current?.status === "paused" ? current : undefined
        }),
        "source run never became paused",
      )

      // Ordinary resume: the agent is served from the journal; the question
      // re-asks live (no seed), so we answer it live once it appears.
      const { ops: resumeOps, prompted } = recordingPromptOps(db, 0)
      const resumed = yield* workflow.start({
        name: MIXED_REPLAY_FIXTURE,
        args: {},
        prompt: resumeOps,
        resume_of: first.id,
      })
      yield* pollWithTimeout(
        Effect.gen(function* () {
          const current = yield* workflow.get(resumed.id)
          return current?.pending_question?.question === "ship?" ? current : undefined
        }),
        "resumed run never re-asked the question",
      )
      yield* workflow.answer({ id: resumed.id, answer: "yes" })
      const done =
        (yield* workflow.wait({ id: resumed.id })).run ?? (yield* Effect.fail(new Error("mixed resume did not finish")))
      expect(done.status).toBe("completed")
      // The agent step came from the journal — it was NOT re-prompted on the resume.
      expect(prompted).not.toContain("do-yes")
      const anode = done.agents.find((a) => a.prompt === "do-yes")
      expect(anode?.cached).toBe(true)
      // The question was re-asked live and answered; no lingering pending_question.
      expect(done.pending_question).toBeUndefined()
      const qnode = done.agents.find((a) => a.kind === "question")
      expect(qnode?.answer).toBe("yes")
      // Replayed-agent result still matches the first run's structured result.
      expect(done.result).toEqual(firstResult)
    }),
  )

  // T5 gap (resume after engine restart): the resume path is proven within ONE
  // service lifetime; here we PROVE it survives a process restart. A run parks as
  // paused (its journal persisted in SQLite, which lives at the test-layer scope —
  // NOT per-instance), then we reload the instance via the SAME test-layer
  // InstanceStore (reloadInstance → runDisposers invalidates Workflow's
  // per-directory InstanceState ScopedCache, so the next access rebuilds a FRESH
  // runs registry and re-runs the startup orphan sweep over the same DB). The
  // reload must NOT touch the paused row (it has no live fiber by design but is
  // parked, not lost), and answer() on the fresh service must still resume and
  // replay the journaled question from disk.
  // NOTE (execution-time reconciliation): the plan suggested `reloadTestInstance`,
  // but that bridges through the process-global AppRuntime's InstanceStore — a
  // DIFFERENT registry than this test layer's. The faithful in-layer restart is the
  // test-layer `reloadInstance` (InstanceStore.reload), which disposes+rebuilds the
  // cached per-directory state. testInstanceStoreLayer supplies InstanceStore.Service
  // for both provideInstance and reloadInstance.
  it.live("a resume after an engine restart (instance reload) replays the journaled question from disk", () =>
    Effect.gen(function* () {
      const directory = yield* tmpdirScoped({ git: true })
      yield* Effect.promise(() => writeWorkflow(directory, QUESTION_TIMEOUT_FIXTURE, QUESTION_TIMEOUT_WORKFLOW))

      // Lifetime 1: start the run; its 50ms-timeout question parks it as paused
      // with the open question persisted on the row.
      const pausedId = yield* Effect.gen(function* () {
        const workflow = yield* Workflow.Service
        const run = yield* workflow.start({ name: QUESTION_TIMEOUT_FIXTURE, args: {}, prompt: immediatePromptOps() })
        const paused =
          (yield* workflow.wait({ id: run.id })).run ?? (yield* Effect.fail(new Error("timeout run did not settle")))
        expect(paused.status).toBe("paused")
        expect(paused.pending_question?.question).toBe("deploy?")
        return run.id
      }).pipe(provideInstance(directory))

      // Restart: dispose+rebuild the instance over the SAME directory (invalidates
      // Workflow's per-directory InstanceState → fresh runs registry + startup sweep).
      yield* reloadInstance({ directory })

      // Lifetime 2: the fresh service ran its startup sweep. The paused row must be
      // intact (not swept to interrupted), and answer() must start a resume that
      // replays the question from disk and completes.
      yield* Effect.gen(function* () {
        const workflow = yield* Workflow.Service
        const reloaded = yield* workflow.get(pausedId)
        expect(reloaded?.status).toBe("paused")
        expect(reloaded?.pending_question?.question).toBe("deploy?")
        const resumed = yield* workflow.answer({ id: pausedId, answer: "no" })
        expect(resumed).toBeDefined()
        expect(resumed!.resume_of).toBe(pausedId)
        const done =
          (yield* workflow.wait({ id: resumed!.id })).run ??
          (yield* Effect.fail(new Error("post-restart resume did not finish")))
        expect(done.status).toBe("completed")
        expect((done.result as { answer: string }).answer).toBe("no")
        const replayed = done.agents.find((a) => a.kind === "question")
        expect(replayed?.answer).toBe("no")
      }).pipe(provideInstance(directory))
    }).pipe(Effect.provide(testInstanceStoreLayer)),
  )

  // Status-Guard (erweitert): ein COMPLETED Quell-Run ist eine gültige Resume-
  // Quelle — der Re-Run eines identischen Scripts ist ein 100%-Cache-Hit: KEIN
  // Prompt wird gefeuert, beide Agent-Nodes kommen als cached:true aus dem
  // Journal, der Run endet sofort completed mit demselben Resultat.
  it.instance("resume of a COMPLETED run is a full cache hit", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* Effect.promise(() => writeWorkflow(test.directory, RESUME_FIXTURE, RESUME_WORKFLOW))
      const workflow = yield* Workflow.Service
      const { db } = yield* Database.Service

      // Quell-Run läuft regulär bis completed.
      const firstOps = recordingPromptOps(db, 0)
      const first = yield* workflow.start({ name: RESUME_FIXTURE, args: {}, prompt: firstOps.ops })
      const firstDone =
        (yield* workflow.wait({ id: first.id })).run ?? (yield* Effect.fail(new Error("first run did not finish")))
      expect(firstDone.status).toBe("completed")

      // Resume der completed-Quelle: vollständiger Cache-Hit.
      const { ops: resumeOps, prompted } = recordingPromptOps(db, 0)
      const resumed = yield* workflow.start({ name: RESUME_FIXTURE, args: {}, prompt: resumeOps, resume_of: first.id })
      const done =
        (yield* workflow.wait({ id: resumed.id })).run ??
        (yield* Effect.fail(new Error("completed-resume did not finish")))
      expect(done.status).toBe("completed")
      // KEIN Prompt wurde gefeuert — beide Agenten kamen aus dem Journal.
      expect(prompted).toHaveLength(0)
      expect(done.agents).toHaveLength(2)
      expect(done.agents.every((a) => a.cached === true)).toBe(true)
      // Das Resultat ist identisch zum Erstlauf; resume_of ist vermerkt.
      expect(done.result).toEqual(firstDone.result)
      const row = yield* fetchRunRow(resumed.id)
      expect(row.resume_of).toBe(first.id)
    }),
  )

  // Status-Guard (erweitert): ein FAILED Quell-Run ist eine gültige Resume-Quelle —
  // das trägt die Kerniterationsschleife (Run failt → Script editieren → Präfix
  // replayen). Der completed-Präfix (Agent A) kommt aus dem Journal (KEIN neuer
  // Prompt); der gefailte Agent B steht NICHT im Journal (nur completed-Nodes
  // landen dort) und läuft live — diesmal erfolgreich, der Run endet completed.
  it.instance("resume of a FAILED run replays the completed prefix and reruns the failed step live", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* Effect.promise(() => writeWorkflow(test.directory, RESUME_FIXTURE, RESUME_WORKFLOW))
      const workflow = yield* Workflow.Service
      const { db } = yield* Database.Service

      // Erster Lauf: Agent A antwortet, Agent B's Prompt schlägt fehl → Run failed.
      // Als Workflow.PromptOps typisiert (Error-Kanal `unknown`), damit der
      // gewollte Effect.fail(Error) den Prompt-Typ nicht verengt.
      const failingOps: Workflow.PromptOps = {
        prompt: (input) =>
          Effect.gen(function* () {
            if (input.noReply) return assistantReply()
            const text = authorPrompt(input.parts?.[0]?.type === "text" ? input.parts[0].text : "")
            if (text === "agent A") {
              const last = yield* persistTurns(db, input.sessionID, [
                { cost: 0, tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } } },
              ])
              return { info: last.info, parts: [{ type: "text", text: "out:A" }] } as unknown as SessionV1.WithParts
            }
            return yield* Effect.fail(new Error("B exploded"))
          }),
        cancel: () => Effect.void,
      }
      const first = yield* workflow.start({ name: RESUME_FIXTURE, args: {}, prompt: failingOps })
      const firstDone =
        (yield* workflow.wait({ id: first.id })).run ?? (yield* Effect.fail(new Error("first run did not finish")))
      expect(firstDone.status).toBe("failed")

      // Resume des failed-Runs: A aus dem Journal (NICHT erneut geprompt), B live
      // (jetzt erfolgreiche Ops) → Run completed.
      const { ops: resumeOps, prompted } = recordingPromptOps(db, 0)
      const resumed = yield* workflow.start({ name: RESUME_FIXTURE, args: {}, prompt: resumeOps, resume_of: first.id })
      const done =
        (yield* workflow.wait({ id: resumed.id })).run ??
        (yield* Effect.fail(new Error("failed-resume did not finish")))
      expect(done.status).toBe("completed")
      expect(prompted).not.toContain("agent A")
      expect(prompted).toContain("agent B")
      const result = done.result as { a: string; b: string }
      expect(result.a).toBe("out:A")
      expect(result.b).toBe("out:agent B")
      // A ist als cached markiert (Journal-Replay), B nicht (lief live).
      const agentA = done.agents.find((a) => a.output === "out:A")
      expect(agentA?.cached).toBe(true)
      const agentB = done.agents.find((a) => a.output === "out:agent B")
      expect(agentB?.cached).not.toBe(true)
    }),
  )

  // Status-Guard (unverändert verboten): ein noch RUNNING Quell-Run darf nicht
  // resumt werden — die Original-Voraussetzung bleibt: erst stoppen. Erwartung:
  // WorkflowInvalidError mit der neuen Fehlermeldung.
  it.instance("resume from a running source run still fails with WorkflowInvalidError", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* Effect.promise(() => writeWorkflow(test.directory, PAUSE_FIXTURE, PAUSE_WORKFLOW))
      const workflow = yield* Workflow.Service
      const { db } = yield* Database.Service

      // Hängenden Run starten (bleibt running am Agent-Gate).
      const { ops } = hangingPromptOps()
      const run = yield* workflow.start({ name: PAUSE_FIXTURE, args: {}, prompt: ops })
      yield* pollWithTimeout(
        Effect.gen(function* () {
          const current = yield* workflow.get(run.id)
          return current && current.agents.some((a) => a.status === "running" && a.session_id) ? current : undefined
        }),
        "agent never started",
      )

      const { ops: resumeOps } = recordingPromptOps(db, 0)
      const failed = yield* workflow
        .start({ name: PAUSE_FIXTURE, args: {}, prompt: resumeOps, resume_of: run.id })
        .pipe(Effect.flip)
      expect(failed._tag).toBe("WorkflowInvalidError")
      const invalid =
        failed instanceof Workflow.InvalidError ? failed : yield* Effect.fail(new Error("expected InvalidError"))
      expect(invalid.message).toContain("status is running")
      expect(invalid.message).toContain("stopped first")
      expect(invalid.message).toContain(run.id)

      // Cleanup: die hängende Quelle canceln, damit kein Fiber den Test überlebt.
      const cancelled = yield* workflow.cancel(run.id)
      expect(cancelled?.status).toBe("cancelled")
    }),
  )

  // Finding 11 (cross-workflow resume): the start route accepts the workflow NAME
  // and the resume source `resume_of` INDEPENDENTLY. Resuming a paused run of
  // workflow A while requesting a DIFFERENT workflow B must be rejected — otherwise
  // B would replay A's journaled agent output/cost wherever a journal key collides,
  // and record resume_of pointing at an unrelated workflow. We start A
  // (RESUME_FIXTURE), park it as `paused` (a VALID resume status, so only the
  // identity guard can reject), then attempt to resume it under name B
  // (SINGLE_AGENT_FIXTURE). Expectation: WorkflowInvalidError naming BOTH workflows.
  // The status guard alone would NOT catch this (the source is a legitimate paused
  // resume source). This guards both the HTTP and tool start paths.
  it.instance("resume of workflow A's run while requesting workflow B fails with WorkflowInvalidError", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* Effect.promise(() => writeWorkflow(test.directory, RESUME_FIXTURE, RESUME_WORKFLOW))
      yield* Effect.promise(() => writeWorkflow(test.directory, SINGLE_AGENT_FIXTURE, SINGLE_AGENT_WORKFLOW))
      const workflow = yield* Workflow.Service
      const { db } = yield* Database.Service

      // Start A and let it complete, then park it as `paused` so it is a valid
      // resume source (only the workflow-identity guard should reject the resume).
      const firstOps = recordingPromptOps(db, 0)
      const first = yield* workflow.start({ name: RESUME_FIXTURE, args: {}, prompt: firstOps.ops })
      const firstDone =
        (yield* workflow.wait({ id: first.id })).run ?? (yield* Effect.fail(new Error("first run did not finish")))
      expect(firstDone.status).toBe("completed")
      yield* pollWithTimeout(
        Effect.gen(function* () {
          yield* db
            .update(WorkflowRunTable)
            .set({ status: "paused" })
            .where(eq(WorkflowRunTable.id, first.id))
            .run()
            .pipe(Effect.orDie)
          const current = yield* workflow.get(first.id)
          return current?.status === "paused" ? current : undefined
        }),
        "source run never became paused",
      )

      // Resume A's run while requesting workflow B → cross-workflow, must fail.
      const { ops: resumeOps } = recordingPromptOps(db, 0)
      const failed = yield* workflow
        .start({ name: SINGLE_AGENT_FIXTURE, args: {}, prompt: resumeOps, resume_of: first.id })
        .pipe(Effect.flip)
      expect(failed._tag).toBe("WorkflowInvalidError")
      const invalid =
        failed instanceof Workflow.InvalidError ? failed : yield* Effect.fail(new Error("expected InvalidError"))
      // The message names BOTH the source workflow (A) and the requested one (B).
      expect(invalid.message).toContain(RESUME_FIXTURE)
      expect(invalid.message).toContain(SINGLE_AGENT_FIXTURE)
      expect(invalid.message).toContain(first.id)
    }),
  )

  // Status-Guard / cancel-paused-Race: ein CANCELLED Quell-Run (hier: hängender Run
  // → pause → cancel, exakt die cancel-of-a-paused-run-Semantik) darf AUCH nach der
  // Erweiterung des Guards (failed/completed sind jetzt erlaubt) NICHT resumt
  // werden. Ein direkter DB-UPDATE auf cancelled (die Race) wäre sonst re-resumebar.
  // Erwartung: WorkflowInvalidError, der den Status `cancelled` nennt.
  it.instance("resume from a cancelled source run fails with WorkflowInvalidError", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* Effect.promise(() => writeWorkflow(test.directory, PAUSE_FIXTURE, PAUSE_WORKFLOW))
      const workflow = yield* Workflow.Service
      const { db } = yield* Database.Service

      // Hängenden Run starten, pausieren, dann cancellen → terminal cancelled.
      const { ops } = hangingPromptOps()
      const run = yield* workflow.start({ name: PAUSE_FIXTURE, args: {}, prompt: ops })
      yield* pollWithTimeout(
        Effect.gen(function* () {
          const current = yield* workflow.get(run.id)
          return current && current.agents.some((a) => a.status === "running" && a.session_id) ? current : undefined
        }),
        "agent never started",
      )
      const paused = yield* workflow.pause(run.id)
      expect(paused?.status).toBe("paused")
      const cancelled = yield* workflow.cancel(run.id)
      expect(cancelled?.status).toBe("cancelled")

      // Resume von einer cancelled-Quelle MUSS scheitern.
      const { ops: resumeOps } = recordingPromptOps(db, 0)
      const failed = yield* workflow
        .start({ name: PAUSE_FIXTURE, args: {}, prompt: resumeOps, resume_of: run.id })
        .pipe(Effect.flip)
      expect(failed._tag).toBe("WorkflowInvalidError")
      const invalid =
        failed instanceof Workflow.InvalidError ? failed : yield* Effect.fail(new Error("expected InvalidError"))
      expect(invalid.message).toContain("status is cancelled")
      expect(invalid.message).toContain("cancelled runs cannot be resumed")
      expect(invalid.message).toContain(run.id)
    }),
  )

  // Finding 1 (consume-once): answer() on a PAUSED run with a persisted
  // pending_question must consume the source row exactly once — a second answer()
  // with the same id must NOT spawn a duplicate resume run (which would re-replay
  // the journal and burn budget twice). The first answer() starts the resume; the
  // second finds the source no longer has an open pending_question and returns
  // undefined. Only ONE resume run is ever created.
  it.instance("answer() on a paused run consumes the source once: a second answer() spawns no duplicate resume", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* Effect.promise(() => writeWorkflow(test.directory, QUESTION_TIMEOUT_FIXTURE, QUESTION_TIMEOUT_WORKFLOW))
      const workflow = yield* Workflow.Service

      // Park the run as paused with an open pending_question (50ms timeout).
      const run = yield* workflow.start({ name: QUESTION_TIMEOUT_FIXTURE, args: {}, prompt: immediatePromptOps() })
      const paused =
        (yield* workflow.wait({ id: run.id })).run ?? (yield* Effect.fail(new Error("timeout run did not park")))
      expect(paused.status).toBe("paused")
      expect(paused.pending_question?.question).toBe("deploy?")

      // First answer() resumes (consumes the source).
      const firstResume = yield* workflow.answer({ id: run.id, answer: "yes" })
      expect(firstResume).toBeDefined()
      expect(firstResume!.resume_of).toBe(run.id)

      // Second answer() must find the source already consumed → undefined, NO
      // second resume run.
      const secondResume = yield* workflow.answer({ id: run.id, answer: "yes" })
      expect(secondResume).toBeUndefined()

      // Exactly ONE resume run exists for this source (plus the source itself).
      const allRuns = yield* workflow.runs()
      const resumes = allRuns.filter((r) => r.resume_of === run.id)
      expect(resumes.length).toBe(1)
    }),
  )

  // Finding 9 (inline-source resume): a paused run that was started via the
  // INLINE-source path (start({ source }) with no name) persists its module body
  // ONLY on definition.source — its workflow NAME is never written to disk and is
  // not discoverable. answer() must thread that source back into the resume start
  // so it re-runs the SAME module, instead of taking the named-discovery branch
  // and failing NotFound (or running a foreign same-named workflow).
  it.instance("answer() resume of a paused INLINE-source workflow threads the source and resumes", () =>
    Effect.gen(function* () {
      yield* TestInstance
      const workflow = yield* Workflow.Service
      // Inline workflow whose meta NAME is deliberately NOT on disk anywhere, so a
      // named-discovery resume would NotFound. 50ms-timeout question parks it.
      const source = `export const meta = { name: "InlineQ", phases: ["run"] }
export async function run(args, ctx) {
  ctx.setPhase("run")
  const a = await ctx.question({ question: "deploy?", options: ["yes", "no"], timeout: 50 })
  return { answer: a.answer }
}
`
      const run = yield* workflow.start({ source, args: {}, prompt: immediatePromptOps() })
      const paused =
        (yield* workflow.wait({ id: run.id })).run ?? (yield* Effect.fail(new Error("inline run did not park")))
      expect(paused.status).toBe("paused")
      expect(paused.pending_question?.question).toBe("deploy?")

      // answer() must resume the inline workflow (threading the persisted source).
      const resumed = yield* workflow.answer({ id: run.id, answer: "no" })
      expect(resumed).toBeDefined()
      expect(resumed!.resume_of).toBe(run.id)
      const done =
        (yield* workflow.wait({ id: resumed!.id })).run ??
        (yield* Effect.fail(new Error("inline resume did not finish")))
      expect(done.status).toBe("completed")
      expect((done.result as { answer: string }).answer).toBe("no")
    }),
  )

  // Finding 10 (live answer loses to an in-flight pause): answer()'s live-writer
  // branch must NOT consume the open question of a run that is already unwinding
  // to paused (active.pausing set). Otherwise it clears+persists pending_question
  // on a run that finishes `paused`, leaving a paused row with NO pending_question
  // that can never be resumed via answer(). Drive it deterministically by setting
  // active.pausing on the live registry entry while the run is parked on the
  // question, then calling answer().
  it.instance("answer() declines a live run that is already pausing, leaving it resumable", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* Effect.promise(() => writeWorkflow(test.directory, QUESTION_FIXTURE, QUESTION_WORKFLOW))
      const workflow = yield* Workflow.Service

      const run = yield* workflow.start({ name: QUESTION_FIXTURE, args: {}, prompt: immediatePromptOps() })
      yield* pollWithTimeout(
        Effect.gen(function* () {
          const current = yield* workflow.get(run.id)
          return current?.pending_question?.question === "deploy?" ? current : undefined
        }),
        "pending question never appeared",
      )

      // Simulate an in-flight pause(): flip the live registry entry's pausing flag
      // exactly as abortRun(active,"pause") does synchronously, BEFORE the scope
      // close clears pendingQuestion — the precise window Finding 10 describes.
      yield* Workflow.__testHooks.setPausing(run.id)

      // answer() must DECLINE (not consume the open question) because the run is
      // unwinding to paused.
      const answered = yield* workflow.answer({ id: run.id, answer: "yes" })
      expect(answered).toBeUndefined()

      // Now finish the pause for real and assert the run is paused WITH its
      // pending_question intact (so it is still resumable via answer()).
      const paused = yield* workflow.pause(run.id)
      expect(paused?.status).toBe("paused")
      expect(paused?.pending_question?.question).toBe("deploy?")
    }),
  )

  // Finding 4 (timeout-park races answer): a live answer() that completes the
  // question node in the window between the timeout firing and the park decision
  // must WIN — the run completes with the answer rather than parking as paused
  // with the answer silently discarded. The race is driven deterministically via
  // the __testHooks.runOnQuestionTimeoutPark seam, which fires answer() exactly in
  // that window (the open question is still live in-memory there). On broken code
  // the run parks as paused (answer lost); on fixed code the timeout branch
  // re-reads the now-completed node and returns the answer.
  it.instance("a live answer() that lands as the question times out wins over the park (no lost answer)", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* Effect.promise(() =>
        writeWorkflow(test.directory, QUESTION_TINY_TIMEOUT_FIXTURE, QUESTION_TINY_TIMEOUT_WORKFLOW),
      )
      const workflow = yield* Workflow.Service

      // The run id is only known after start(); capture it so the hook can answer
      // the right run. The hook fires INSIDE the timeout-park window (question still
      // live), so this answer() takes the authoritative live-writer branch.
      let runId: Workflow.RunID | undefined
      Workflow.__testHooks.runOnQuestionTimeoutPark(
        Effect.suspend(() => (runId ? workflow.answer({ id: runId, answer: "yes" }).pipe(Effect.ignore) : Effect.void)),
      )

      const started = yield* workflow.start({
        name: QUESTION_TINY_TIMEOUT_FIXTURE,
        args: {},
        prompt: immediatePromptOps(),
      })
      runId = started.id

      const done =
        (yield* workflow.wait({ id: started.id })).run ??
        (yield* Effect.fail(new Error("tiny-timeout question run did not settle")))
      // The answer won: the run completed with it, NOT parked as paused.
      expect(done.status).toBe("completed")
      expect((done.result as { answer: string }).answer).toBe("yes")
      expect(done.pending_question).toBeUndefined()
      const qnode = done.agents.find((a) => a.kind === "question")
      expect(qnode?.status).toBe("completed")
      expect(qnode?.answer).toBe("yes")
    }),
  )

  // Schema/Journal-Drift (Fund: ungeschütztes JSON.parse(cached.output)): der
  // Journal-Key ignoriert das Schema. Ein PLAINTEXT-Quell-Node kann beim Resume
  // eine Schema-Anfrage matchen, wenn die Workflow-Datei zwischen Lauf und Resume
  // driftet (gleicher Name/Prompt/Phase, jetzt mit schema im agent-Call). Statt am
  // JSON.parse des Plaintext-Outputs zu defecten, MUSS der Resume das als Cache-MISS
  // behandeln und den Agenten LIVE laufen lassen (PromptOps-Zähler +1, Run completed).
  // Item 20: der Per-Call-MISS-ohne-Konsum ist KEYED-Semantik — seit dem
  // prefix-Default explizit mit replay:"keyed" gepinnt; der prefix-Zwilling
  // (Drift bricht den Präfix DAUERHAFT) steht darunter.
  it.instance("a schema call matching a plaintext journal node runs live instead of defecting (keyed)", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      // V1: Plaintext-Agent (kein Schema) → Journal-Node mit nicht-JSON-Output.
      yield* Effect.promise(() => writeWorkflow(test.directory, DRIFT_FIXTURE, DRIFT_WORKFLOW_PLAINTEXT))
      const workflow = yield* Workflow.Service
      const { db } = yield* Database.Service

      const { ops: firstOps, state: firstState } = driftPromptOps(db)
      const first = yield* workflow.start({ name: DRIFT_FIXTURE, args: {}, prompt: firstOps })
      const firstDone =
        (yield* workflow.wait({ id: first.id })).run ?? (yield* Effect.fail(new Error("first run did not finish")))
      expect(firstDone.status).toBe("completed")
      // Der Quell-Node trägt Plaintext (kein gültiges JSON).
      expect(firstDone.result).toEqual({ value: "not json at all" })
      expect(firstState.count).toBe(1)

      // Quell-Row auf `paused` versetzen → legitime Resume-Quelle (Journal bleibt).
      // Im Poll wiederholt, bis sichtbar `paused` (asynchrone Eviction, siehe oben).
      yield* pollWithTimeout(
        Effect.gen(function* () {
          yield* db
            .update(WorkflowRunTable)
            .set({ status: "paused" })
            .where(eq(WorkflowRunTable.id, first.id))
            .run()
            .pipe(Effect.orDie)
          const current = yield* workflow.get(first.id)
          return current?.status === "paused" ? current : undefined
        }),
        "source run never became paused",
      )

      // Drift: SELBE Datei (gleicher Name → gleicher path/journalKey) wird zu V2
      // überschrieben — derselbe Agent-Call fordert jetzt ein Schema an.
      yield* Effect.promise(() => writeWorkflow(test.directory, DRIFT_FIXTURE, DRIFT_WORKFLOW_SCHEMA))

      // Resume: die Schema-Anfrage matcht den Plaintext-Journal-Node. Kein Defect —
      // der Agent läuft LIVE und liefert ein echtes structured-Ergebnis.
      const { ops: resumeOps, state: resumeState } = driftPromptOps(db)
      const resumed = yield* workflow.start({
        name: DRIFT_FIXTURE,
        args: {},
        prompt: resumeOps,
        resume_of: first.id,
        replay: "keyed",
      })
      const done =
        (yield* workflow.wait({ id: resumed.id })).run ?? (yield* Effect.fail(new Error("resume did not finish")))
      // Kein Defect: der Run completed sauber.
      expect(done.status).toBe("completed")
      // Der Agent lief LIVE (Zähler +1), NICHT aus dem Journal repliziert.
      expect(resumeState.count).toBe(1)
      // Das Live-Ergebnis ist das geparste Schema-Objekt, nicht der Plaintext.
      expect(done.result).toEqual({ value: SCHEMA_OBJECT })
      // Der Agent-Node ist NICHT als cached markiert (Cache-MISS → Live-Lauf).
      const node = done.agents.find((a) => a.prompt === "drift agent")
      expect(node?.cached).not.toBe(true)
    }),
  )

  // Item 20 Test (4): 'schema drift breaks the prefix permanently'. Wie der
  // Drift-Test, aber mit einem UNVERÄNDERTEN zweiten Agenten: im Default-Modus
  // 'prefix' bricht der Parse-Fehler an Call 1 den Präfix dauerhaft — auch der
  // unveränderte Call 2 läuft live (Zähler 2, kein cached-Node).
  it.instance("schema drift breaks the prefix permanently: the unchanged second call runs live too", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* Effect.promise(() => writeWorkflow(test.directory, DRIFT2_FIXTURE, DRIFT2_WORKFLOW_PLAINTEXT))
      const workflow = yield* Workflow.Service
      const { db } = yield* Database.Service

      const { ops: firstOps, state: firstState } = driftPromptOps(db)
      const first = yield* workflow.start({ name: DRIFT2_FIXTURE, args: {}, prompt: firstOps })
      const firstDone =
        (yield* workflow.wait({ id: first.id })).run ?? (yield* Effect.fail(new Error("first run did not finish")))
      expect(firstDone.status).toBe("completed")
      expect(firstState.count).toBe(2)

      // Drift: dieselbe Datei wird zu V2 überschrieben (Call 1 fordert jetzt ein
      // Schema an, Call 2 bleibt unverändert). completed ist direkt resumebar.
      yield* Effect.promise(() => writeWorkflow(test.directory, DRIFT2_FIXTURE, DRIFT2_WORKFLOW_SCHEMA))

      const { ops: resumeOps, state: resumeState } = driftPromptOps(db)
      const resumed = yield* workflow.start({
        name: DRIFT2_FIXTURE,
        args: {},
        prompt: resumeOps,
        resume_of: first.id,
      })
      const done =
        (yield* workflow.wait({ id: resumed.id })).run ?? (yield* Effect.fail(new Error("resume did not finish")))
      expect(done.status).toBe("completed")
      // BEIDE Calls liefen live: der Drift brach den Präfix, der unveränderte
      // zweite Call wurde NICHT mehr aus dem Journal bedient.
      expect(resumeState.count).toBe(2)
      expect(done.agents.every((a) => a.cached !== true)).toBe(true)
      const stable = done.agents.find((a) => a.prompt === "stable agent")
      expect(stable?.cached).not.toBe(true)
    }),
  )

  // Item 20 keyed-Gegentest zum Drift-Zwilling: unter replay:"keyed" bleibt der
  // Drift ein Per-Call-MISS — Call 1 läuft live, der unveränderte Call 2 wird
  // weiterhin aus dem Journal bedient (Zähler 1, stable-Node cached).
  it.instance("schema drift under keyed replay misses only the drifted call and keeps the second cached", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* Effect.promise(() => writeWorkflow(test.directory, DRIFT2_FIXTURE, DRIFT2_WORKFLOW_PLAINTEXT))
      const workflow = yield* Workflow.Service
      const { db } = yield* Database.Service

      const { ops: firstOps } = driftPromptOps(db)
      const first = yield* workflow.start({ name: DRIFT2_FIXTURE, args: {}, prompt: firstOps })
      const firstDone =
        (yield* workflow.wait({ id: first.id })).run ?? (yield* Effect.fail(new Error("first run did not finish")))
      expect(firstDone.status).toBe("completed")

      yield* Effect.promise(() => writeWorkflow(test.directory, DRIFT2_FIXTURE, DRIFT2_WORKFLOW_SCHEMA))

      const { ops: resumeOps, state: resumeState } = driftPromptOps(db)
      const resumed = yield* workflow.start({
        name: DRIFT2_FIXTURE,
        args: {},
        prompt: resumeOps,
        resume_of: first.id,
        replay: "keyed",
      })
      const done =
        (yield* workflow.wait({ id: resumed.id })).run ?? (yield* Effect.fail(new Error("resume did not finish")))
      expect(done.status).toBe("completed")
      // Nur der Drift-Call lief live; der unveränderte zweite kam aus dem Journal.
      expect(resumeState.count).toBe(1)
      const stable = done.agents.find((a) => a.prompt === "stable agent")
      expect(stable?.cached).toBe(true)
    }),
  )

  // TASK 12/13 — TEST A (live answer): ctx.question persists a pending question on
  // the run (pending_question + a kind:"question" journal node), emits a
  // workflow.run.updated event carrying pending_question:true, and waits LIVE for
  // an answer. workflow.answer({ id, answer }) resolves the Deferred → the body
  // gets { answer }, the run completes, pending_question is cleared, and the
  // question node carries the answer.
  it.instance("ctx.question waits live for an answer, records it on the journal node, clears pending_question", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* Effect.promise(() => writeWorkflow(test.directory, QUESTION_FIXTURE, QUESTION_WORKFLOW))
      const workflow = yield* Workflow.Service
      const events = yield* EventV2Bridge.Service
      const seenPending: boolean[] = []
      const unsub = yield* events.listen((event) =>
        Effect.sync(() => {
          if (event.type === "workflow.run.updated")
            seenPending.push((event.data as Record<string, unknown>)["pending_question"] === true)
        }),
      )
      yield* Effect.addFinalizer(() => unsub)

      const run = yield* workflow.start({ name: QUESTION_FIXTURE, args: {}, prompt: immediatePromptOps() })

      // Poll until the pending question is persisted/visible on the run.
      const live = yield* pollWithTimeout(
        Effect.gen(function* () {
          const current = yield* workflow.get(run.id)
          return current?.pending_question?.question === "deploy?" ? current : undefined
        }),
        "pending question never appeared",
      )
      expect(live.pending_question?.options).toEqual(["yes", "no"])
      expect(live.status).toBe("running")

      // Answer it live.
      const answered = yield* workflow.answer({ id: run.id, answer: "yes" })
      expect(answered?.id).toBe(run.id)

      const done =
        (yield* workflow.wait({ id: run.id })).run ?? (yield* Effect.fail(new Error("question run did not finish")))
      expect(done.status).toBe("completed")
      expect((done.result as { answer: string }).answer).toBe("yes")
      // pending_question cleared after the answer.
      expect(done.pending_question).toBeUndefined()
      // The journal carries a kind:"question" node with the answer.
      const qnode = done.agents.find((a) => a.kind === "question")
      expect(qnode).toBeDefined()
      expect(qnode?.prompt).toBe("deploy?")
      expect(qnode?.answer).toBe("yes")
      expect(qnode?.status).toBe("completed")
      // At least one workflow.run.updated event carried pending_question:true.
      expect(seenPending.some((p) => p === true)).toBe(true)
    }),
  )

  // TASK 12/13 — TEST B (park + resume): a question with a tiny timeout that goes
  // unanswered PARKS the run as `paused` (existing pause machinery), keeping the
  // journal (incl. the open question node) and the persisted pending_question.
  // workflow.answer on the paused run starts a RESUME (resume_of) whose journal
  // replay serves the answer to the question node WITHOUT asking again.
  it.instance("an unanswered ctx.question times out, parks as paused, and answer() resumes serving the reply", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* Effect.promise(() => writeWorkflow(test.directory, QUESTION_TIMEOUT_FIXTURE, QUESTION_TIMEOUT_WORKFLOW))
      const workflow = yield* Workflow.Service

      const run = yield* workflow.start({ name: QUESTION_TIMEOUT_FIXTURE, args: {}, prompt: immediatePromptOps() })

      // The timeout (50ms) fires → the run parks as paused.
      const paused =
        (yield* workflow.wait({ id: run.id })).run ?? (yield* Effect.fail(new Error("timeout run did not settle")))
      expect(paused.status).toBe("paused")
      // The open question node + persisted pending_question survive the park.
      expect(paused.pending_question?.question).toBe("deploy?")
      const openNode = paused.agents.find((a) => a.kind === "question")
      expect(openNode).toBeDefined()
      expect(openNode?.answer).toBeUndefined()

      // answer() on the paused run starts a NEW resume run.
      const resumed = yield* workflow.answer({ id: run.id, answer: "no" })
      expect(resumed).toBeDefined()
      expect(resumed!.id).not.toBe(run.id)
      expect(resumed!.resume_of).toBe(run.id)

      const done =
        (yield* workflow.wait({ id: resumed!.id })).run ?? (yield* Effect.fail(new Error("resume did not finish")))
      expect(done.status).toBe("completed")
      expect((done.result as { answer: string }).answer).toBe("no")
      // No second live ask on the resumed run: the question node carries the
      // replayed answer and there is no open pending_question.
      expect(done.pending_question).toBeUndefined()
      const replayed = done.agents.find((a) => a.kind === "question")
      expect(replayed?.answer).toBe("no")
      expect(replayed?.status).toBe("completed")
    }),
  )

  // TASK 12/13 follow-up: answer() must forward the SAME execution options start()
  // accepts for a resume (at minimum the prompt-ops vector), so a workflow that
  // asks a question and THEN dispatches ctx.agent steps can complete on the resume.
  // The question times out → parks paused; answer({..., prompt}) starts a resume
  // that replays the question from the journal AND runs the live agent step.
  it.instance("answer() forwards prompt ops so a resumed run can dispatch agents after the question", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* Effect.promise(() => writeWorkflow(test.directory, QUESTION_AGENT_FIXTURE, QUESTION_AGENT_WORKFLOW))
      const workflow = yield* Workflow.Service
      const { db } = yield* Database.Service

      const run = yield* workflow.start({ name: QUESTION_AGENT_FIXTURE, args: {}, prompt: immediatePromptOps() })

      // Unanswered question times out → run parks as paused.
      const paused =
        (yield* workflow.wait({ id: run.id })).run ?? (yield* Effect.fail(new Error("q-then-agent did not settle")))
      expect(paused.status).toBe("paused")
      expect(paused.pending_question?.question).toBe("go?")

      // answer() with prompt ops → resume that runs the live agent step.
      const { ops: resumeOps, prompted } = recordingPromptOps(db, 0)
      const resumed = yield* workflow.answer({ id: run.id, answer: "yes", prompt: resumeOps })
      expect(resumed).toBeDefined()
      expect(resumed!.resume_of).toBe(run.id)

      const done =
        (yield* workflow.wait({ id: resumed!.id })).run ?? (yield* Effect.fail(new Error("resume did not finish")))
      expect(done.status).toBe("completed")
      const result = done.result as { answer: string; agentText: string }
      // The question was replayed (answer served) AND the agent step ran live on
      // the resumed run, prompted with the answer-dependent text.
      expect(result.answer).toBe("yes")
      expect(prompted).toContain("after-yes")
      expect(result.agentText).toBe("out:after-yes")
      // The resumed run carries both the (replayed) question node and the live
      // agent node; no second pending_question.
      expect(done.pending_question).toBeUndefined()
      expect(done.agents.find((a) => a.kind === "question")?.answer).toBe("yes")
      expect(done.agents.some((a) => a.kind !== "question" && a.output === "out:after-yes")).toBe(true)
    }),
  )

  // Task 6: a per-step reasoning `variant` passed to ctx.agent must be threaded
  // verbatim into the underlying prompt run. The recording prompt-ops capture the
  // real PromptInput, so the dispatched `variant` is asserted directly — proving
  // ctx.agent({ prompt, variant }) reaches SessionPrompt.prompt as input.variant.
  it.instance("ctx.agent variant is threaded into the prompt run", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* Effect.promise(() => writeWorkflow(test.directory, VARIANT_FIXTURE, VARIANT_WORKFLOW))
      const workflow = yield* Workflow.Service
      const { ops, inputs } = capturingPromptOps()

      const started = yield* workflow.start({ name: VARIANT_FIXTURE, args: {}, prompt: ops })
      const waited = yield* workflow.wait({ id: started.id })
      const done = waited.run ?? (yield* Effect.fail(new Error("variant workflow did not finish")))
      expect(done.status).toBe("completed")

      // Exactly one real agent dispatch, carrying the requested variant.
      expect(inputs.length).toBe(1)
      expect(inputs[0]?.variant).toBe("max")
    }),
  )

  // Task 7: ctx.agent({ model: "small" }) must resolve to the configured
  // small_model and dispatch the prompt against that provider/model. The
  // capturing prompt-ops record the real PromptInput, so the resolved model is
  // asserted directly against the configured small_model's providerID/modelID.
  it.instance(
    'ctx.agent model:"small" routes to the configured small_model',
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        yield* Effect.promise(() => writeWorkflow(test.directory, SMALL_MODEL_FIXTURE, SMALL_MODEL_WORKFLOW))
        const workflow = yield* Workflow.Service
        const { ops, inputs } = capturingPromptOps()

        const started = yield* workflow.start({ name: SMALL_MODEL_FIXTURE, args: {}, prompt: ops })
        const waited = yield* workflow.wait({ id: started.id })
        const done = waited.run ?? (yield* Effect.fail(new Error("small-model workflow did not finish")))
        expect(done.status).toBe("completed")

        // The dispatch resolved to the configured small_model, not the default agent model.
        expect(inputs.length).toBe(1)
        expect(String(inputs[0]?.model?.providerID)).toBe("smallprov")
        expect(String(inputs[0]?.model?.modelID)).toBe("small-model")
      }),
    { config: { small_model: "smallprov/small-model" } },
  )

  // Task 7 (error path): requesting model:"small" with NO small_model configured
  // is an authoring error. The agent step must fail with a clear message rather
  // than silently falling back; the prompt is never dispatched.
  it.instance('ctx.agent model:"small" fails clearly when no small_model is configured', () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* Effect.promise(() => writeWorkflow(test.directory, SMALL_MODEL_FIXTURE, SMALL_MODEL_WORKFLOW))
      const workflow = yield* Workflow.Service
      const { ops, inputs } = capturingPromptOps()

      const started = yield* workflow.start({ name: SMALL_MODEL_FIXTURE, args: {}, prompt: ops })
      const waited = yield* workflow.wait({ id: started.id })
      const done = waited.run ?? (yield* Effect.fail(new Error("small-model workflow did not finish")))

      // The run failed because the only agent step could not resolve a model.
      expect(done.status).toBe("failed")
      const node = done.agents[0]
      expect(node?.status).toBe("failed")
      expect(node?.error).toContain("small_model")
      // The prompt was never dispatched (no model to run against).
      expect(inputs.length).toBe(0)
    }),
  )

  // Task 8: a per-step `tools` whitelist/blacklist passed to ctx.agent must be
  // threaded verbatim into the underlying prompt run. opencode's tool-scoping
  // mechanism is PromptInput.tools (a Record<string,boolean> with glob-able
  // keys), which the prompt loop turns into session permission rules — so the
  // capturing prompt-ops record it directly and the dispatched object is
  // asserted unchanged.
  it.instance("ctx.agent tools scoping is threaded into the prompt run", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* Effect.promise(() => writeWorkflow(test.directory, TOOLS_FIXTURE, TOOLS_WORKFLOW))
      const workflow = yield* Workflow.Service
      const { ops, inputs } = capturingPromptOps()

      const started = yield* workflow.start({ name: TOOLS_FIXTURE, args: {}, prompt: ops })
      const waited = yield* workflow.wait({ id: started.id })
      const done = waited.run ?? (yield* Effect.fail(new Error("tools workflow did not finish")))
      expect(done.status).toBe("completed")

      // Exactly one real agent dispatch, carrying the requested tools object unchanged.
      expect(inputs.length).toBe(1)
      expect(inputs[0]?.tools).toEqual({ webfetch: false })
    }),
  )

  // Task 9: a per-step `skills` array passed to ctx.agent must be honoured.
  // opencode only loads skills via the runtime `skill` tool (no structured
  // create/prompt field), so the engine prepends a load directive naming the
  // skills to the prompt text and enables the `skill` tool for the step. Both
  // are asserted on the captured PromptInput.
  it.instance("ctx.agent skills are loaded via a prompt directive and the enabled skill tool", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* Effect.promise(() => writeWorkflow(test.directory, SKILLS_FIXTURE, SKILLS_WORKFLOW))
      const workflow = yield* Workflow.Service
      const { ops, inputs } = capturingPromptOps()

      const started = yield* workflow.start({ name: SKILLS_FIXTURE, args: {}, prompt: ops })
      const waited = yield* workflow.wait({ id: started.id })
      const done = waited.run ?? (yield* Effect.fail(new Error("skills workflow did not finish")))
      expect(done.status).toBe("completed")

      expect(inputs.length).toBe(1)
      // The skill tool is enabled for this step.
      expect(inputs[0]?.tools?.skill).toBe(true)
      // The text part carries a directive naming both skills, ahead of the prompt.
      const textPart = inputs[0]?.parts.find((p) => p.type === "text")
      expect(textPart?.type).toBe("text")
      const text = textPart?.type === "text" ? textPart.text : ""
      expect(text).toContain("pdf")
      expect(text).toContain("xlsx")
      expect(text).toContain("do it")
      // Directive comes BEFORE the author's prompt.
      expect(text.indexOf("pdf")).toBeLessThan(text.indexOf("do it"))
    }),
  )

  // Item 6 (Subagenten-Framing): a NON-schema agent step's dispatched prompt is
  // prepended with the step-framing directive (the step's final message is a
  // program's value, not a human reply). node.prompt keeps the RAW author prompt
  // so the resume journal key is untouched.
  it.instance("a non-schema agent step prepends the framing directive to the dispatched prompt", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* Effect.promise(() => writeWorkflow(test.directory, SINGLE_AGENT_FIXTURE, SINGLE_AGENT_WORKFLOW))
      const workflow = yield* Workflow.Service
      const { ops, inputs } = capturingPromptOps()

      const started = yield* workflow.start({ name: SINGLE_AGENT_FIXTURE, args: {}, prompt: ops })
      const waited = yield* workflow.wait({ id: started.id })
      const done = waited.run ?? (yield* Effect.fail(new Error("framing workflow did not finish")))
      expect(done.status).toBe("completed")

      expect(inputs.length).toBe(1)
      const textPart = inputs[0]?.parts.find((p) => p.type === "text")
      const text = textPart?.type === "text" ? textPart.text : ""
      // Framing first, author's prompt last — nothing else in between.
      expect(text).toBe(`${Workflow.STEP_FRAMING_DIRECTIVE}\n\ndo the thing`)
      // The node carries the RAW prompt (journal-key stability).
      expect(done.agents[0]?.prompt).toBe("do the thing")
    }),
  )

  // Item 6: a SCHEMA step is NOT framed — the StructuredOutput tool call enforces
  // the shape already, and an extra "output only data" line could compete with
  // the structured-output system prompt. The dispatched text is the author's
  // prompt verbatim.
  it.instance("a schema agent step does NOT get the framing directive", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* Effect.promise(() =>
        writeWorkflow(test.directory, SCHEMA_SUCCESS_FIXTURE, schemaWorkflow(SCHEMA_SUCCESS_FIXTURE)),
      )
      const workflow = yield* Workflow.Service
      const { db } = yield* Database.Service
      // Structured-answering ops that ALSO capture the dispatched prompt text.
      const texts: string[] = []
      const ops: { prompt: SessionPrompt.Interface["prompt"]; cancel: SessionPrompt.Interface["cancel"] } = {
        prompt: (input) =>
          Effect.gen(function* () {
            if (input.noReply) return assistantReply()
            const part = input.parts?.[0]
            texts.push(part?.type === "text" ? part.text : "")
            const turn: AssistantTurn = {
              cost: 0,
              tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
              structured: SCHEMA_OBJECT,
            }
            const last = yield* persistTurns(db, input.sessionID, [turn])
            return { info: last.info, parts: [] } as unknown as SessionV1.WithParts
          }),
        cancel: () => Effect.void,
      }

      const started = yield* workflow.start({ name: SCHEMA_SUCCESS_FIXTURE, args: {}, prompt: ops })
      const waited = yield* workflow.wait({ id: started.id })
      const done = waited.run ?? (yield* Effect.fail(new Error("schema framing workflow did not finish")))
      expect(done.status).toBe("completed")
      // The dispatched prompt is the author's text VERBATIM — no framing.
      expect(texts).toEqual(["produce structured"])
    }),
  )

  // Item 6: framing composes with the skills directive — framing first, then the
  // skills line, then the author's prompt.
  it.instance("the framing directive composes with the skills directive ahead of the author's prompt", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* Effect.promise(() => writeWorkflow(test.directory, SKILLS_FIXTURE, SKILLS_WORKFLOW))
      const workflow = yield* Workflow.Service
      const { ops, inputs } = capturingPromptOps()

      const started = yield* workflow.start({ name: SKILLS_FIXTURE, args: {}, prompt: ops })
      const waited = yield* workflow.wait({ id: started.id })
      const done = waited.run ?? (yield* Effect.fail(new Error("skills framing workflow did not finish")))
      expect(done.status).toBe("completed")

      expect(inputs.length).toBe(1)
      const textPart = inputs[0]?.parts.find((p) => p.type === "text")
      const text = textPart?.type === "text" ? textPart.text : ""
      expect(text).toBe(`${Workflow.STEP_FRAMING_DIRECTIVE}\n\nLoad these skills before starting: pdf, xlsx.\n\ndo it`)
    }),
  )

  // Task 10: a per-step `files` array passed to ctx.agent attaches files
  // declaratively. Each path resolves relative to the run's workspace directory;
  // the engine appends a file part (after the text part) whose URL is the
  // absolute file:// URL of the attachment.
  it.instance("ctx.agent files are resolved against the workspace and appended as file parts", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* Effect.promise(() => Bun.write(path.join(test.directory, "ATTACH.md"), "# attached\n"))
      yield* Effect.promise(() => writeWorkflow(test.directory, FILES_FIXTURE, FILES_WORKFLOW))
      const workflow = yield* Workflow.Service
      const { ops, inputs } = capturingPromptOps()

      const started = yield* workflow.start({ name: FILES_FIXTURE, args: {}, prompt: ops })
      const waited = yield* workflow.wait({ id: started.id })
      const done = waited.run ?? (yield* Effect.fail(new Error("files workflow did not finish")))
      expect(done.status).toBe("completed")

      expect(inputs.length).toBe(1)
      const parts = inputs[0]?.parts ?? []
      // Text part first, file part appended after it.
      expect(parts[0]?.type).toBe("text")
      const filePart = parts.find((p) => p.type === "file")
      expect(filePart?.type).toBe("file")
      // The file part resolves to the absolute attachment in the workspace directory.
      const expectedUrl = pathToFileURL(path.join(test.directory, "ATTACH.md")).href
      expect(filePart?.type === "file" ? filePart.url : undefined).toBe(expectedUrl)
    }),
  )

  // Task 10 (error path): a non-existent attachment is an authoring error. The
  // agent step must fail with a WorkflowInvalidError naming the missing file
  // rather than dispatching a broken prompt.
  it.instance("ctx.agent files fails clearly when an attachment does not exist", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* Effect.promise(() => writeWorkflow(test.directory, FILES_MISSING_FIXTURE, FILES_MISSING_WORKFLOW))
      const workflow = yield* Workflow.Service
      const { ops, inputs } = capturingPromptOps()

      const started = yield* workflow.start({ name: FILES_MISSING_FIXTURE, args: {}, prompt: ops })
      const waited = yield* workflow.wait({ id: started.id })
      const done = waited.run ?? (yield* Effect.fail(new Error("files-missing workflow did not finish")))

      expect(done.status).toBe("failed")
      const node = done.agents[0]
      expect(node?.status).toBe("failed")
      expect(node?.error).toContain("DOES_NOT_EXIST.md")
      // The prompt was never dispatched (the attachment could not be resolved).
      expect(inputs.length).toBe(0)
    }),
  )

  // Task 10 (directory path): an attachment that resolves to a directory is NOT a
  // regular file and must fail the step cleanly — same as a missing file — instead
  // of being dispatched as a broken file:// part. Pins the corrected portable
  // existence check: fs.stat().isFile() (a directory -> false), matching the prior
  // Bun.file(dir).exists() behaviour. A naive fs.access() would WRONGLY pass here.
  it.instance("ctx.agent files fails clearly when an attachment is a directory", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* Effect.promise(() => fs.mkdir(path.join(test.directory, "ATTACH_DIR"), { recursive: true }))
      yield* Effect.promise(() => writeWorkflow(test.directory, FILES_DIR_FIXTURE, FILES_DIR_WORKFLOW))
      const workflow = yield* Workflow.Service
      const { ops, inputs } = capturingPromptOps()

      const started = yield* workflow.start({ name: FILES_DIR_FIXTURE, args: {}, prompt: ops })
      const waited = yield* workflow.wait({ id: started.id })
      const done = waited.run ?? (yield* Effect.fail(new Error("files-dir workflow did not finish")))

      expect(done.status).toBe("failed")
      const node = done.agents[0]
      expect(node?.status).toBe("failed")
      expect(node?.error).toContain("ATTACH_DIR")
      // The prompt was never dispatched (the directory is not an attachable file).
      expect(inputs.length).toBe(0)
    }),
  )

  // Task 11: ctx.agent({ isolation: "worktree" }) runs the subagent inside a
  // FRESH git worktree so parallel agents that mutate files do not conflict. The
  // load-bearing assertion is that the EFFECTIVE instance directory the prompt
  // runs under (what the subagent's file tools resolve cwd against) is the
  // worktree path — NOT the run's workspace directory. The directory-capturing
  // prompt-ops read InstanceState.directory from inside the dispatch, so we can
  // assert real isolation rather than merely "a worktree was created". After the
  // run finishes the worktree must be gone (run-scope finalizer cleaned it up).
  it.instance(
    'ctx.agent isolation:"worktree" runs the subagent in a fresh git worktree and cleans it up',
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        yield* Effect.promise(() => writeWorkflow(test.directory, ISOLATION_FIXTURE, ISOLATION_WORKFLOW))
        const workflow = yield* Workflow.Service
        const { ops, inputs, directories, wasGitWorktree } = directoryCapturingPromptOps()

        const started = yield* workflow.start({ name: ISOLATION_FIXTURE, args: {}, prompt: ops })
        const waited = yield* workflow.wait({ id: started.id })
        const done = waited.run ?? (yield* Effect.fail(new Error("isolation workflow did not finish")))
        expect(done.status).toBe("completed")

        // Exactly one real agent dispatch.
        expect(inputs.length).toBe(1)
        const effectiveDir = directories[0]
        // The subagent ran under a DIFFERENT directory than the workspace — this
        // is the load-bearing proof of real isolation: the prompt run (and so the
        // subagent's file tools) resolves cwd against the worktree, not the
        // workspace. Before the InstanceRef override this was the workspace dir.
        expect(effectiveDir).toBeDefined()
        expect(effectiveDir).not.toBe(test.directory)
        // It was a real git worktree at dispatch time: it had a `.git` entry (a
        // worktree's `.git` is a file pointing at the parent's gitdir), observed
        // live before the finalizer removed it.
        expect(wasGitWorktree[0]).toBe(true)
        // The worktree lived OUTSIDE the workspace (a sibling temp dir), so it can
        // never collide with the workspace or another step's worktree.
        expect(effectiveDir!.startsWith(test.directory)).toBe(false)

        // Run-scope finalizer cleans up the worktree. On a normal finish the run
        // scope is closed fire-and-forget (so the terminal return is never delayed
        // by a finalizer), meaning cleanup is async relative to wait() — poll for
        // the directory to disappear rather than asserting it synchronously.
        yield* pollWithTimeout(
          Effect.promise(() =>
            fs
              .stat(effectiveDir!)
              .then(() => undefined)
              .catch(() => true as const),
          ),
          `worktree ${effectiveDir} was not cleaned up after the run finished`,
        )
      }),
    { git: true },
  )

  // Finding 3: the per-step worktree base must NOT be a predictable, world-readable
  // path under the shared tmp root (`<tmp>/oc-wf-<runid>-<nodeid>`, both segments
  // guessable). It must be minted via `fs.mkdtemp` (random suffix) AND chmod 0700,
  // so on a multi-user host no other local user can read the checkout or any secrets
  // the subagent writes. We observe the worktree directory live at dispatch time
  // (the directory-capturing prompt-ops record its mode then) and assert: it lives
  // under tmpdir with the `oc-wf-` prefix, it is NOT the predictable
  // `oc-wf-<runid>-<nodeid>` name, and its mode is exactly 0700.
  it.instance(
    'ctx.agent isolation:"worktree" mints a private (0700) worktree under an unguessable mkdtemp path',
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        yield* Effect.promise(() => writeWorkflow(test.directory, ISOLATION_FIXTURE, ISOLATION_WORKFLOW))
        const workflow = yield* Workflow.Service
        const { ops, inputs, directories, modes } = directoryCapturingPromptOps()

        const started = yield* workflow.start({ name: ISOLATION_FIXTURE, args: {}, prompt: ops })
        const waited = yield* workflow.wait({ id: started.id })
        const done = waited.run ?? (yield* Effect.fail(new Error("isolation workflow did not finish")))
        expect(done.status).toBe("completed")
        expect(inputs.length).toBe(1)

        const worktree = directories[0]!
        expect(worktree).toBeDefined()
        const tmp = yield* Effect.promise(() => fs.realpath(os.tmpdir()))
        const realWorktree = yield* Effect.promise(() => fs.realpath(worktree).catch(() => worktree))
        // It lives under the shared tmp root with the shared `oc-wf-` prefix.
        const name = path.basename(realWorktree)
        expect(path.dirname(realWorktree)).toBe(tmp)
        expect(name.startsWith("oc-wf-")).toBe(true)
        // But it is NOT the OLD predictable `oc-wf-<runid>-<nodeid>` path: an
        // attacker who knows the run id + node id could no longer guess it.
        const node = done.agents[0]!
        expect(name).not.toBe(`oc-wf-${started.id}-${node.id}`)
        expect(name.includes(started.id)).toBe(false)
        // And it was 0700 at dispatch time — only the running user may traverse it.
        expect(modes[0]).toBe(0o700)
      }),
    { git: true },
  )

  // Finding 3 (orphan sweep): a SIGKILLed/crashed run never fires its run-scope
  // remove finalizer, leaking its `<tmp>/oc-wf-*` worktree (with checked-out repo
  // content + any agent-written secrets) into tmp indefinitely. The startup sweep
  // must reclaim a STALE such dir on the next instance start, while leaving a FRESH
  // one (a currently-running sibling's worktree) untouched. We plant one aged dir
  // and one new dir, reload the instance (re-runs the startup sweep), and assert the
  // stale one is gone and the fresh one survives.
  it.live("startup sweep removes a stale orphaned oc-wf-* worktree but spares a fresh one", () =>
    Effect.gen(function* () {
      const directory = yield* tmpdirScoped({ git: true })
      const tmp = os.tmpdir()
      // A stale leaked worktree dir, aged well past the 1h cutoff.
      const stale = yield* Effect.promise(() => fs.mkdtemp(path.join(tmp, "oc-wf-")))
      yield* Effect.promise(() => fs.writeFile(path.join(stale, "leaked-secret"), "shh"))
      const old = Date.now() - 3 * 60 * 60 * 1000
      yield* Effect.promise(() => fs.utimes(stale, old / 1000, old / 1000))
      // A fresh worktree dir (mtime now) — represents a sibling process's live run.
      const fresh = yield* Effect.promise(() => fs.mkdtemp(path.join(tmp, "oc-wf-")))

      try {
        // Bring an instance up over the directory and touch an operation that
        // MATERIALIZES the per-directory InstanceState (a ScopedCache value whose
        // factory runs the startup sweep). `runs()` reads the registry, forcing
        // materialization → the sweep runs.
        yield* Effect.gen(function* () {
          const workflow = yield* Workflow.Service
          yield* workflow.runs()
        }).pipe(provideInstance(directory))
        // Reload to force a fresh state materialization (and a second sweep), proving
        // the sweep is wired to startup regardless of first-vs-subsequent access.
        yield* reloadInstance({ directory })
        yield* Effect.gen(function* () {
          const workflow = yield* Workflow.Service
          yield* workflow.runs()
        }).pipe(provideInstance(directory))

        // The sweep is forked (best-effort, non-blocking); poll for its effect.
        yield* pollWithTimeout(
          Effect.promise(() =>
            fs
              .stat(stale)
              .then(() => undefined)
              .catch(() => true as const),
          ),
          `stale orphaned worktree ${stale} was not swept`,
        )
        // The fresh dir (a live sibling's worktree) must NOT be touched.
        const freshAlive = yield* Effect.promise(() =>
          fs
            .stat(fresh)
            .then(() => true)
            .catch(() => false),
        )
        expect(freshAlive).toBe(true)
      } finally {
        yield* Effect.promise(() => fs.rm(stale, { recursive: true, force: true }).catch(() => {}))
        yield* Effect.promise(() => fs.rm(fresh, { recursive: true, force: true }).catch(() => {}))
      }
    }).pipe(Effect.provide(testInstanceStoreLayer)),
  )

  // Item 7: an isolated worktree with UNCOMMITTED changes is PRESERVED at run
  // end (git registration intact), the preserve is logged with the path, and
  // the node records its work location (`worktree`).
  it.instance(
    "a dirty isolated worktree survives the run",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        yield* Effect.promise(() => writeWorkflow(test.directory, ISOLATION_FIXTURE, ISOLATION_WORKFLOW))
        const workflow = yield* Workflow.Service
        const { ops, directories } = dirtyingPromptOps()

        const started = yield* workflow.start({ name: ISOLATION_FIXTURE, args: {}, prompt: ops })
        const waited = yield* workflow.wait({ id: started.id })
        const done = waited.run ?? (yield* Effect.fail(new Error("isolation workflow did not finish")))
        expect(done.status).toBe("completed")
        const worktree = directories[0]!
        expect(worktree).toBeDefined()
        // The node records where the step worked (Item 7).
        expect(done.agents[0]?.worktree).toBe(worktree)

        try {
          // The preserve runs in the run-scope finalizer (async relative to
          // wait()); poll the persisted run for the preserve log.
          const preserved = yield* pollWithTimeout(
            Effect.gen(function* () {
              const current = yield* workflow.get(started.id)
              return current?.logs.some((l) => l.message.includes("worktree preserved at")) ? current : undefined
            }),
            "preserve log never appeared on the run",
          )
          const log = preserved.logs.find((l) => l.message.includes("worktree preserved at"))
          expect(log?.message).toContain(worktree)
          expect(log?.message).toContain("uncommitted changes")
          // The worktree (with the uncommitted file) is still on disk…
          const file = yield* Effect.promise(() =>
            fs.readFile(path.join(worktree, "UNCOMMITTED.txt"), "utf8").catch(() => undefined),
          )
          expect(file).toBe("dirty")
          // …and carries the sweep-skip marker.
          const marker = yield* Effect.promise(() =>
            fs
              .stat(path.join(worktree, ".oc-wf-preserved"))
              .then(() => true)
              .catch(() => false),
          )
          expect(marker).toBe(true)
        } finally {
          // Cleanup: detach + remove the deliberately preserved worktree.
          yield* Effect.promise(async () => {
            spawnSync("git", ["worktree", "remove", "--force", worktree], { cwd: test.directory })
            await fs.rm(worktree, { recursive: true, force: true }).catch(() => {})
            spawnSync("git", ["worktree", "prune"], { cwd: test.directory })
          })
        }
      }),
    { git: true },
  )

  // Item 7 (sweep protection): the startup worktree sweep must skip BOTH a
  // marker-carrying preserved worktree and (fallback) a marker-less but DIRTY
  // git worktree, while still reclaiming a plain aged leak.
  it.live("sweepWorktrees skips preserved and dirty worktrees but reclaims plain leaks", () =>
    Effect.gen(function* () {
      const directory = yield* tmpdirScoped({ git: true })
      const tmp = os.tmpdir()
      const old = Date.now() - 3 * 60 * 60 * 1000
      const age = (dir: string) => Effect.promise(() => fs.utimes(dir, old / 1000, old / 1000))

      // (a) An aged dir WITH the preserve marker — must survive.
      const preserved = yield* Effect.promise(() => fs.mkdtemp(path.join(tmp, "oc-wf-")))
      yield* Effect.promise(() => fs.writeFile(path.join(preserved, ".oc-wf-preserved"), ""))
      // (b) An aged REAL worktree, marker-less but dirty — fallback skip.
      const dirty = yield* Effect.promise(() => fs.mkdtemp(path.join(tmp, "oc-wf-")))
      spawnSync("git", ["worktree", "add", "--detach", dirty], { cwd: directory })
      yield* Effect.promise(() => fs.writeFile(path.join(dirty, "WORK.txt"), "in flight"))
      // (c) An aged plain (non-git) leak — must be reclaimed as before.
      const leak = yield* Effect.promise(() => fs.mkdtemp(path.join(tmp, "oc-wf-")))
      yield* age(preserved)
      yield* age(dirty)
      yield* age(leak)

      try {
        yield* Effect.promise(() => Workflow.__testHooks.sweepWorktrees(directory))
        const exists = (dir: string) =>
          Effect.promise(() =>
            fs
              .stat(dir)
              .then(() => true)
              .catch(() => false),
          )
        expect(yield* exists(preserved)).toBe(true)
        expect(yield* exists(dirty)).toBe(true)
        expect(yield* exists(leak)).toBe(false)
      } finally {
        yield* Effect.promise(async () => {
          spawnSync("git", ["worktree", "remove", "--force", dirty], { cwd: directory })
          for (const dir of [preserved, dirty, leak]) {
            await fs.rm(dir, { recursive: true, force: true }).catch(() => {})
          }
          spawnSync("git", ["worktree", "prune"], { cwd: directory })
        })
      }
    }).pipe(Effect.provide(testInstanceStoreLayer)),
  )

  // Task 11 (error path): isolation:"worktree" in a NON-git workspace is an
  // authoring/environment error. The step must fail with a clear
  // WorkflowInvalidError naming the missing git repository rather than crashing,
  // and the prompt is never dispatched.
  it.instance('ctx.agent isolation:"worktree" fails clearly outside a git repository', () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* Effect.promise(() => writeWorkflow(test.directory, ISOLATION_FIXTURE, ISOLATION_WORKFLOW))
      const workflow = yield* Workflow.Service
      const { ops, inputs } = capturingPromptOps()

      const started = yield* workflow.start({ name: ISOLATION_FIXTURE, args: {}, prompt: ops })
      const waited = yield* workflow.wait({ id: started.id })
      const done = waited.run ?? (yield* Effect.fail(new Error("isolation workflow did not finish")))

      expect(done.status).toBe("failed")
      expect(done.error ?? "").toContain("requires a git repository")
      const node = done.agents[0]
      expect(node?.status).toBe("failed")
      // The prompt was never dispatched (no worktree to run in).
      expect(inputs.length).toBe(0)
    }),
  )

  // Task 11a: ctx.shell runs a real command in the run's workspace and returns
  // { output, exitCode } without an LLM turn. A successful command reports
  // exitCode 0 and its stdout; a non-zero exit is returned (failCode === 3), never
  // thrown; and ctx.budget.spent() is 0 because shell never touches the budget.
  // Item 23: runs with the kill-switch (workflows.shell_permission=false) so
  // this test keeps pinning the UNGATED behavior — a headless run with no
  // ruleset would otherwise park on the interactive ask. The kill-switch path
  // is itself the documented regression guard for the pre-gate semantics.
  it.instance(
    "ctx.shell runs a deterministic non-LLM step returning output + exitCode without touching budget",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        yield* Effect.promise(() => writeWorkflow(test.directory, SHELL_FIXTURE, SHELL_WORKFLOW))
        const workflow = yield* Workflow.Service

        const started = yield* workflow.start({ name: SHELL_FIXTURE, args: {} })
        const waited = yield* workflow.wait({ id: started.id })
        const done = waited.run ?? (yield* Effect.fail(new Error("shell workflow did not finish")))

        expect(done.status).toBe("completed")
        const result = done.result as { out: string; okCode: number; failCode: number; spent: number }
        expect(result.out).toBe("hello-workflow")
        expect(result.okCode).toBe(0)
        // A non-zero exit is mapped to the return value, NOT a throw.
        expect(result.failCode).toBe(3)
        // Shell does not touch the budget — spend stays at 0.
        expect(result.spent).toBe(0)
      }),
    { config: { workflows: { shell_permission: false } } },
  )

  // Task 11b (a): a parent runs a DISCOVERED child inline via ctx.workflow under
  // the SAME run. The parent completes, the child's result flows back
  // (fromChild === 42), exactly ONE run row exists for this start (no separate
  // child run row), and the parent's logs include the child's prefixed log entry.
  it.instance("ctx.workflow runs a discovered child inline under the same run with prefixed logs", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* Effect.promise(() => writeWorkflow(test.directory, NEST_CHILD_FIXTURE, NEST_CHILD_WORKFLOW))
      yield* Effect.promise(() => writeWorkflow(test.directory, NEST_PARENT_FIXTURE, NEST_PARENT_WORKFLOW))
      const workflow = yield* Workflow.Service

      const started = yield* workflow.start({ name: NEST_PARENT_FIXTURE, args: {} })
      const waited = yield* workflow.wait({ id: started.id })
      const done = waited.run ?? (yield* Effect.fail(new Error("parent workflow did not finish")))

      expect(done.status).toBe("completed")
      expect((done.result as { fromChild: number }).fromChild).toBe(42)

      // Exactly ONE run row exists for this start: no separate child run row.
      const runs = yield* workflow.runs()
      expect(runs.length).toBe(1)
      expect(runs[0]!.id).toBe(started.id)

      // The parent's logs include the child's prefixed log entry.
      const messages = done.logs.map((l) => l.message)
      expect(messages).toContain("child: child-ran")
    }),
  )

  // Task 11b (b): nesting is limited to depth 1. A child that itself calls
  // ctx.workflow must be refused — the nested call throws a WorkflowInvalidError
  // mentioning the depth limit, and the run fails with that error.
  it.instance("ctx.workflow enforces a depth-1 limit: a nested ctx.workflow call fails the run", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* Effect.promise(() => writeWorkflow(test.directory, NEST_GRANDCHILD_FIXTURE, NEST_GRANDCHILD_WORKFLOW))
      yield* Effect.promise(() => writeWorkflow(test.directory, NEST_DEEP_CHILD_FIXTURE, NEST_DEEP_CHILD_WORKFLOW))
      yield* Effect.promise(() => writeWorkflow(test.directory, NEST_DEEP_PARENT_FIXTURE, NEST_DEEP_PARENT_WORKFLOW))
      const workflow = yield* Workflow.Service

      const started = yield* workflow.start({ name: NEST_DEEP_PARENT_FIXTURE, args: {} })
      const waited = yield* workflow.wait({ id: started.id })
      const done = waited.run ?? (yield* Effect.fail(new Error("deep-parent workflow did not finish")))

      expect(done.status).toBe("failed")
      expect(done.error ?? "").toMatch(/WorkflowInvalidError|nesting|depth/i)

      // Still exactly ONE run row — the failed nesting never created a second run.
      const runs = yield* workflow.runs()
      expect(runs.length).toBe(1)
    }),
  )

  // Task 11b (c): the child's agent dispatches count against the SAME run's
  // agent-lifetime cap. With the cap lowered to 3, the parent's one agent plus the
  // child's dispatches collectively exceed it, so the over-cap dispatch (inside
  // the child) fails the WHOLE run with a tagged AgentLimitError — proving the cap
  // is shared, not reset per nested workflow.
  it.instance("ctx.workflow shares the run's agent-lifetime cap with the child", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* Effect.promise(() => writeWorkflow(test.directory, NEST_AGENT_CHILD_FIXTURE, NEST_AGENT_CHILD_WORKFLOW))
      yield* Effect.promise(() => writeWorkflow(test.directory, NEST_AGENT_PARENT_FIXTURE, NEST_AGENT_PARENT_WORKFLOW))
      const workflow = yield* Workflow.Service
      const { db } = yield* Database.Service
      Workflow.__testHooks.agentLimit(3)

      const started = yield* workflow.start({
        name: NEST_AGENT_PARENT_FIXTURE,
        args: {},
        prompt: costPromptOps(db, 0),
      })
      const waited = yield* workflow.wait({ id: started.id })
      const done = waited.run ?? (yield* Effect.fail(new Error("agent-parent workflow did not finish")))

      expect(done.status).toBe("failed")
      expect(done.error ?? "").toMatch(/WorkflowAgentLimitError|agent.*limit/i)
      // The cap is shared across parent + child: exactly 3 agents (1 parent + 2
      // child) reach `completed` before the 4th dispatch is refused.
      expect(done.agents.filter((a) => a.status === "completed").length).toBe(3)
      // One run row only — the child never created its own run.
      const runs = yield* workflow.runs()
      expect(runs.length).toBe(1)
    }),
  )

  // Task 11a (real timeout): ctx.shell("sleep 5", { timeout: 100 }) must kill the
  // hung command and resolve PROMPTLY with a non-zero exitCode — never hang for the
  // full 5s and never throw. The fixture records elapsed wall-clock so we can prove
  // the timeout actually fired (well under the command's 5s natural duration).
  it.instance(
    "ctx.shell enforces a real wall-clock timeout: a hung command resolves promptly with non-zero exit",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        yield* Effect.promise(() => writeWorkflow(test.directory, SHELL_TIMEOUT_FIXTURE, SHELL_TIMEOUT_WORKFLOW))
        const workflow = yield* Workflow.Service

        const started = yield* workflow.start({ name: SHELL_TIMEOUT_FIXTURE, args: {} })
        const waited = yield* workflow.wait({ id: started.id })
        const done = waited.run ?? (yield* Effect.fail(new Error("shell-timeout workflow did not finish")))

        expect(done.status).toBe("completed")
        const result = done.result as { exitCode: number; elapsed: number }
        // A timed-out command is killed -> non-zero exit (mapped, not thrown).
        expect(result.exitCode).not.toBe(0)
        // It resolved promptly: well before the command's natural 5s duration.
        expect(result.elapsed).toBeLessThan(3000)
      }),
    // Item 23: kill-switch — see the budget shell test above.
    { config: { workflows: { shell_permission: false } } },
  )

  // Finding 5: a ctx.shell with NO timeout must have its OS child reaped on
  // cancel — closing the run scope interrupts the Effect fiber, and the fix wires
  // that interrupt to the AbortController so Process.run SIGTERMs the child. The
  // shell writes a "running" marker immediately (so we can synchronize on the
  // child being live) then sleeps 3s then writes a "leaked" marker. We cancel once
  // the running marker exists and assert: the run is cancelled AND the leaked
  // marker is NEVER written within a window comfortably past the 3s sleep — i.e.
  // the orphaned child did not survive the cancel and fire the second touch.
  it.instance(
    "ctx.shell with no timeout has its OS child killed on cancel (no process leak)",
    () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* Effect.promise(() => writeWorkflow(test.directory, SHELL_LEAK_FIXTURE, SHELL_LEAK_WORKFLOW))
      const workflow = yield* Workflow.Service
      const running = path.join(test.directory, "shell-running.marker")
      const leaked = path.join(test.directory, "shell-leaked.marker")

      const run = yield* workflow.start({ name: SHELL_LEAK_FIXTURE, args: { running, leaked } })

      // Wait until the shell child is actually live (it just wrote `running`).
      yield* pollWithTimeout(
        Effect.promise(() =>
          fs
            .stat(running)
            .then(() => true as const)
            .catch(() => undefined),
        ),
        "shell child never started (running marker not written)",
      )

      // Cancel mid-sleep: the scope close interrupts the shell fiber, which (with
      // the fix) aborts the controller and SIGTERMs the OS child.
      yield* workflow.cancel(run.id)
      const after = yield* workflow.get(run.id)
      expect(after?.status).toBe("cancelled")

      // Give the child MORE than its 3s sleep to (incorrectly) fire the second
      // touch if it were leaked. With the child killed, the leaked marker never
      // appears; if the process leaked, it would appear ~3s after the touch ran.
      yield* Effect.sleep("4 seconds")
      const leakedExists = yield* Effect.promise(() =>
        fs
          .stat(leaked)
          .then(() => true)
          .catch(() => false),
      )
      expect(leakedExists).toBe(false)
    }),
    // Item 23: kill-switch — see the budget shell test above.
    { config: { workflows: { shell_permission: false } } },
    // The body sleeps 4s by design (leak window) — the 5s default timeout
    // leaves <1s for spawn + poll + cancel.
    15000,
  )

  // Item 23 (Stufe 1, deny): a caller session carrying a bash DENY rule gates
  // ctx.shell — the run fails with the denial (the error names the command) and
  // the process is NEVER spawned (the target file survives).
  it.instance("ctx.shell honors a caller bash deny rule: run fails, process never spawned", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* Effect.promise(() => writeWorkflow(test.directory, SHELL_GATE_FIXTURE, SHELL_GATE_WORKFLOW))
      const workflow = yield* Workflow.Service
      const sessions = yield* Session.Service

      // The file the denied `rm` would delete — must still exist afterwards.
      const target = "shell-deny.marker"
      yield* Effect.promise(() => Bun.write(path.join(test.directory, target), "keep me"))

      const caller = yield* sessions.create({
        permission: [{ permission: "bash", action: "deny", pattern: "rm *" }],
      })
      const run = yield* workflow.start({
        name: SHELL_GATE_FIXTURE,
        args: { command: `rm ${target}` },
        caller: { sessionID: caller.id },
      })
      const done =
        (yield* workflow.wait({ id: run.id })).run ?? (yield* Effect.fail(new Error("gate run did not settle")))
      expect(done.status).toBe("failed")
      // The error names the command, so the failure is self-explanatory.
      expect(done.error ?? "").toContain("rm shell-deny.marker")
      expect(done.error ?? "").toMatch(/denied|rule/i)
      // The process never spawned: the target file is untouched.
      const survived = yield* Effect.promise(() =>
        fs
          .stat(path.join(test.directory, target))
          .then(() => true)
          .catch(() => false),
      )
      expect(survived).toBe(true)
    }),
  )

  // Item 23 (Stufe 1, allow): a caller ALLOW rule lets ctx.shell run with no
  // interactive ask — the run completing at all is the proof (an open ask would
  // park it), and no pending permission request is left behind.
  it.instance("ctx.shell with a caller bash allow rule runs through without an interactive ask", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* Effect.promise(() => writeWorkflow(test.directory, SHELL_GATE_FIXTURE, SHELL_GATE_WORKFLOW))
      const workflow = yield* Workflow.Service
      const sessions = yield* Session.Service
      const permission = yield* Permission.Service

      const caller = yield* sessions.create({
        permission: [{ permission: "bash", action: "allow", pattern: "*" }],
      })
      const run = yield* workflow.start({
        name: SHELL_GATE_FIXTURE,
        args: { command: "echo gated-ok" },
        caller: { sessionID: caller.id },
      })
      const done =
        (yield* workflow.wait({ id: run.id })).run ?? (yield* Effect.fail(new Error("gate run did not settle")))
      expect(done.status).toBe("completed")
      expect((done.result as { out: string }).out).toBe("gated-ok")
      // No interactive ask was raised (the allow rule short-circuited it).
      expect(yield* permission.list()).toHaveLength(0)
    }),
  )

  // Item 23 (Stufe 1, cancel during an open ask): a headless run (no caller
  // ruleset) parks on the interactive bash ask. Cancelling the run interrupts
  // the open ask cleanly — the run finishes `cancelled`, the pending request is
  // cleaned up (no leak), and the command never ran.
  it.instance("cancel during an open ctx.shell ask unwinds the run as cancelled without leaking the request", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* Effect.promise(() => writeWorkflow(test.directory, SHELL_GATE_FIXTURE, SHELL_GATE_WORKFLOW))
      const workflow = yield* Workflow.Service
      const permission = yield* Permission.Service

      const leaked = "shell-ask-leak.marker"
      const run = yield* workflow.start({
        name: SHELL_GATE_FIXTURE,
        args: { command: `touch ${leaked}` },
      })
      // Wait until the gate's interactive ask is pending.
      yield* pollWithTimeout(
        Effect.gen(function* () {
          const pending = yield* permission.list()
          return pending.length > 0 ? pending : undefined
        }),
        "ctx.shell ask never became pending",
      )
      const cancelled = yield* workflow.cancel(run.id)
      expect(cancelled?.status).toBe("cancelled")
      // The pending request was cleaned up (ask's ensuring removed it).
      yield* pollWithTimeout(
        Effect.gen(function* () {
          const pending = yield* permission.list()
          return pending.length === 0 ? true : undefined
        }),
        "pending ask was never cleaned up",
      )
      // The gated command never executed.
      const leakedExists = yield* Effect.promise(() =>
        fs
          .stat(path.join(test.directory, leaked))
          .then(() => true)
          .catch(() => false),
      )
      expect(leakedExists).toBe(false)
    }),
  )

  // Task 11b (phase restore): a child's setPhase must not bleed into the parent.
  // Parent sets "plan", the nested child sets "research" (recorded prefixed as
  // "phase-child: research" on its own log), and the parent's log AFTER the nested
  // call must carry the parent's "plan" phase again — not the child's leftover.
  it.instance("ctx.workflow restores the parent's phase after a nested child changes it", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* Effect.promise(() => writeWorkflow(test.directory, NEST_PHASE_CHILD_FIXTURE, NEST_PHASE_CHILD_WORKFLOW))
      yield* Effect.promise(() => writeWorkflow(test.directory, NEST_PHASE_PARENT_FIXTURE, NEST_PHASE_PARENT_WORKFLOW))
      const workflow = yield* Workflow.Service

      const started = yield* workflow.start({ name: NEST_PHASE_PARENT_FIXTURE, args: {} })
      const waited = yield* workflow.wait({ id: started.id })
      const done = waited.run ?? (yield* Effect.fail(new Error("phase-parent workflow did not finish")))

      expect(done.status).toBe("completed")
      // The child's own log was attributed to its (prefixed) phase...
      const childLog = done.logs.find((l) => l.message === "phase-child: inside-child")
      expect(childLog?.phase).toBe("phase-child: research")
      // ...and the parent's log AFTER the nested call carries the parent's phase,
      // NOT the child's leftover "phase-child: research".
      const parentLog = done.logs.find((l) => l.message === "after-nested")
      expect(parentLog?.phase).toBe("plan")
      // The run's terminal phase is the parent's, not the child's leftover.
      expect(done.current_phase).toBe("plan")
    }),
  )

  // Task 14: a workflow run now emits OTel spans — `workflow.run` for the run
  // body and `workflow.agent` for each ctx.agent dispatch. The test stack has NO
  // span-collection seam (no in-memory tracer/exporter is wired into the engine's
  // layer), so this is a SMOKE test: it proves the spans are transparent (a full
  // 1-agent run still completes, the agent step succeeds, and the prompt was
  // dispatched exactly once). The spans themselves are exercised by the engine's
  // default no-op tracer; behavioral equivalence is the real gate.
  it.instance("a 1-agent run still completes with run/agent spans wrapping it (transparent)", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* Effect.promise(() => writeWorkflow(test.directory, SINGLE_AGENT_FIXTURE, SINGLE_AGENT_WORKFLOW))
      const workflow = yield* Workflow.Service
      const { ops, inputs } = capturingPromptOps()

      const started = yield* workflow.start({ name: SINGLE_AGENT_FIXTURE, args: {}, prompt: ops })
      const waited = yield* workflow.wait({ id: started.id })
      const done = waited.run ?? (yield* Effect.fail(new Error("single-agent workflow did not finish")))

      // The wrapping spans changed nothing: the run completes and its single agent
      // step ran to completion against exactly one dispatched prompt.
      expect(done.status).toBe("completed")
      expect(done.agents.length).toBe(1)
      expect(done.agents[0]?.status).toBe("completed")
      expect(inputs.length).toBe(1)
    }),
  )

  // Task 15(b): a structured phase declares a default `model`. While that phase is
  // active, a ctx.agent call with NO explicit model resolves to the phase default;
  // an explicit per-call model still wins over the phase default.
  it.instance("a phase default model is used when ctx.agent gives no model; explicit model wins", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* Effect.promise(() => writeWorkflow(test.directory, PHASE_MODEL_FIXTURE, PHASE_MODEL_WORKFLOW))
      const workflow = yield* Workflow.Service
      const { ops, inputs } = capturingPromptOps()

      const started = yield* workflow.start({ name: PHASE_MODEL_FIXTURE, args: {}, prompt: ops })
      const waited = yield* workflow.wait({ id: started.id })
      const done = waited.run ?? (yield* Effect.fail(new Error("phase-model workflow did not finish")))
      expect(done.status).toBe("completed")

      // Two dispatches. The first (no explicit model) resolved to the "verify"
      // phase's default `stub/mini`; the second's explicit model won over it.
      expect(inputs.length).toBe(2)
      expect(String(inputs[0]?.model?.providerID)).toBe("stub")
      expect(String(inputs[0]?.model?.modelID)).toBe("mini")
      expect(String(inputs[1]?.model?.providerID)).toBe("other")
      expect(String(inputs[1]?.model?.modelID)).toBe("explicit")
    }),
  )

  // Item 16 (a): a per-call `phase` pins the node to that phase even after
  // setPhase has moved the run's current phase — closing the parallel/pipeline
  // race window deterministically (the sequential setPhase("b") stands in for
  // the concurrent phase move).
  it.instance("a per-call phase pins the agent node to that phase", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* Effect.promise(() => writeWorkflow(test.directory, PERCALL_PHASE_FIXTURE, PERCALL_PHASE_WORKFLOW))
      const workflow = yield* Workflow.Service

      const started = yield* workflow.start({ name: PERCALL_PHASE_FIXTURE, args: {}, prompt: immediatePromptOps() })
      const waited = yield* workflow.wait({ id: started.id })
      const done = waited.run ?? (yield* Effect.fail(new Error("percall-phase workflow did not finish")))
      expect(done.status).toBe("completed")
      expect(done.agents.length).toBe(2)
      // The pinned step carries its per-call phase, not the moved current phase…
      expect(done.agents[0]?.phase).toBe("a")
      // …while an unpinned step still snapshots current_phase as before.
      expect(done.agents[1]?.phase).toBe("b")
    }),
  )

  // Item 16 (b): a per-call phase resolves ITS declared default model (explicit
  // model still wins), never the global current phase's model — and it has no
  // setPhase side effect on the run.
  it.instance("a per-call phase resolves the declared phase default model without moving the run phase", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* Effect.promise(() =>
        writeWorkflow(test.directory, PERCALL_PHASE_MODEL_FIXTURE, PERCALL_PHASE_MODEL_WORKFLOW),
      )
      const workflow = yield* Workflow.Service
      const { ops, inputs } = capturingPromptOps()

      const started = yield* workflow.start({ name: PERCALL_PHASE_MODEL_FIXTURE, args: {}, prompt: ops })
      const waited = yield* workflow.wait({ id: started.id })
      const done = waited.run ?? (yield* Effect.fail(new Error("percall-phase-model workflow did not finish")))
      expect(done.status).toBe("completed")
      expect(inputs.length).toBe(3)
      // Call 1: phase "y" is declared with stub/mini → that model is the default.
      expect(String(inputs[0]?.model?.providerID)).toBe("stub")
      expect(String(inputs[0]?.model?.modelID)).toBe("mini")
      // Call 2: an explicit model wins over the per-call phase default.
      expect(String(inputs[1]?.model?.providerID)).toBe("other")
      expect(String(inputs[1]?.model?.modelID)).toBe("explicit")
      // Call 3: pinned to "x" (no declared model) while the GLOBAL phase is "y"
      // (model stub/mini) — the per-call phase must NOT inherit the global
      // phase's model.
      expect(inputs[2]?.model).toBeUndefined()
      // The first two calls never moved the run's phase (no setPhase side
      // effect); only the explicit setPhase("y") did.
      expect(done.current_phase).toBe("y")
      expect(done.agents[0]?.phase).toBe("y")
      expect(done.agents[2]?.phase).toBe("x")
    }),
  )

  // Item 16 (c): `label` is persisted on the agent node and survives the
  // DB→fromRow roundtrip.
  it.instance("a per-call label is persisted on the agent node and round-trips through fromRow", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* Effect.promise(() => writeWorkflow(test.directory, LABEL_FIXTURE, LABEL_WORKFLOW))
      const workflow = yield* Workflow.Service

      const started = yield* workflow.start({ name: LABEL_FIXTURE, args: {}, prompt: immediatePromptOps() })
      const waited = yield* workflow.wait({ id: started.id })
      const done = waited.run ?? (yield* Effect.fail(new Error("label workflow did not finish")))
      expect(done.status).toBe("completed")
      expect(done.agents[0]?.label).toBe("Find the bug")

      // DB roundtrip (seedCompletedRow-style): a seeded row's agent label comes
      // back through DB→fromRow.
      const persistedId = Workflow.RunID.make("job_label_roundtrip")
      yield* seedCompletedRow(persistedId, test.directory)
      const persisted = (yield* workflow.get(persistedId)) ?? (yield* Effect.fail(new Error("seeded run not readable")))
      expect(persisted.agents[0]?.label).toBe("seeded label")
      // Item 7: the isolated-worktree location survives the roundtrip too.
      expect(persisted.agents[0]?.worktree).toBe("/tmp/oc-wf-seeded")
    }),
  )

  // Item 16 (d): a nested ctx.workflow child's per-call phase is prefixed with
  // the child's logPrefix, consistent with its setPhase.
  it.instance("a nested child's per-call phase is prefixed with the child name", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* Effect.promise(() => writeWorkflow(test.directory, PERCALL_CHILD_FIXTURE, PERCALL_CHILD_WORKFLOW))
      yield* Effect.promise(() => writeWorkflow(test.directory, PERCALL_PARENT_FIXTURE, PERCALL_PARENT_WORKFLOW))
      const workflow = yield* Workflow.Service

      const started = yield* workflow.start({ name: PERCALL_PARENT_FIXTURE, args: {}, prompt: immediatePromptOps() })
      const waited = yield* workflow.wait({ id: started.id })
      const done = waited.run ?? (yield* Effect.fail(new Error("percall-parent workflow did not finish")))
      expect(done.status).toBe("completed")
      expect(done.agents.length).toBe(1)
      expect(done.agents[0]?.phase).toBe(`${PERCALL_CHILD_FIXTURE}: p`)
    }),
  )

  // Item 16 (e): a per-call phase is resume-stable — the journal keys on
  // node.phase, which carries the per-call phase on both the seed and the live
  // lookup side, so a resumed run replays the pinned step instead of re-prompting.
  it.instance("a per-call phase step replays from the journal on resume", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* Effect.promise(() => writeWorkflow(test.directory, PERCALL_PHASE_FIXTURE, PERCALL_PHASE_WORKFLOW))
      const workflow = yield* Workflow.Service
      const { db } = yield* Database.Service

      const firstOps = recordingPromptOps(db, 0)
      const first = yield* workflow.start({ name: PERCALL_PHASE_FIXTURE, args: {}, prompt: firstOps.ops })
      const firstDone =
        (yield* workflow.wait({ id: first.id })).run ?? (yield* Effect.fail(new Error("first run did not finish")))
      expect(firstDone.status).toBe("completed")
      expect(firstOps.prompted.length).toBe(2)

      // completed → paused so it is a legitimate resume source (journal kept).
      yield* pollWithTimeout(
        Effect.gen(function* () {
          yield* db
            .update(WorkflowRunTable)
            .set({ status: "paused" })
            .where(eq(WorkflowRunTable.id, first.id))
            .run()
            .pipe(Effect.orDie)
          const current = yield* workflow.get(first.id)
          return current?.status === "paused" ? current : undefined
        }),
        "source run never became paused",
      )

      const { ops: resumeOps, prompted } = recordingPromptOps(db, 0)
      const resumed = yield* workflow.start({
        name: PERCALL_PHASE_FIXTURE,
        args: {},
        prompt: resumeOps,
        resume_of: first.id,
      })
      const done =
        (yield* workflow.wait({ id: resumed.id })).run ??
        (yield* Effect.fail(new Error("percall-phase resume did not finish")))
      expect(done.status).toBe("completed")
      // Both steps — the pinned and the unpinned one — replayed from the journal.
      expect(prompted).toHaveLength(0)
      expect(done.agents.every((agent) => agent.cached === true)).toBe(true)
    }),
  )

  // Item 12: a run started with caller_model resolves a DEFAULT-agent step (no
  // explicit/phase model) to the caller session's model; an explicitly chosen
  // agent keeps its own model resolution (no inheritance).
  it.instance("caller_model resolves a default-agent step; an explicit agent does not inherit it", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* Effect.promise(() => writeWorkflow(test.directory, CALLER_MODEL_FIXTURE, CALLER_MODEL_WORKFLOW))
      const workflow = yield* Workflow.Service
      const { ops, inputs } = capturingPromptOps()

      const started = yield* workflow.start({
        name: CALLER_MODEL_FIXTURE,
        args: {},
        prompt: ops,
        caller_model: { providerID: "stub", modelID: "caller" },
      })
      const waited = yield* workflow.wait({ id: started.id })
      const done = waited.run ?? (yield* Effect.fail(new Error("caller-model workflow did not finish")))
      expect(done.status).toBe("completed")
      expect(inputs.length).toBe(2)
      // The default-agent step inherited the caller session's model…
      expect(String(inputs[0]?.model?.providerID)).toBe("stub")
      expect(String(inputs[0]?.model?.modelID)).toBe("caller")
      // …while the explicitly-chosen agent kept its own model resolution (the
      // "general" agent declares no model, so nothing is dispatched).
      expect(inputs[1]?.model).toBeUndefined()
    }),
  )

  // Item 12: precedence — a declared phase default model still wins over the
  // caller model (the inheritance tier sits BELOW phase model).
  it.instance("a phase default model wins over caller_model", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* Effect.promise(() => writeWorkflow(test.directory, CALLER_PHASE_FIXTURE, CALLER_PHASE_WORKFLOW))
      const workflow = yield* Workflow.Service
      const { ops, inputs } = capturingPromptOps()

      const started = yield* workflow.start({
        name: CALLER_PHASE_FIXTURE,
        args: {},
        prompt: ops,
        caller_model: { providerID: "stub", modelID: "caller" },
      })
      const waited = yield* workflow.wait({ id: started.id })
      const done = waited.run ?? (yield* Effect.fail(new Error("caller-phase workflow did not finish")))
      expect(done.status).toBe("completed")
      expect(inputs.length).toBe(1)
      expect(String(inputs[0]?.model?.providerID)).toBe("stub")
      expect(String(inputs[0]?.model?.modelID)).toBe("mini")
    }),
  )

  // Item 15: skipping an IN-FLIGHT agent step resolves its ctx.agent call to
  // null, marks the node `skipped` (no budget charge), and the run continues.
  it.instance("skipAgent resolves the in-flight agent call to null and the run continues", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* Effect.promise(() => writeWorkflow(test.directory, SKIP_FIXTURE, SKIP_WORKFLOW))
      const workflow = yield* Workflow.Service
      const { ops } = resolveOnAbortPromptOps()

      const run = yield* workflow.start({ name: SKIP_FIXTURE, args: {}, prompt: ops })
      // Wait until the step is genuinely in flight (session registered).
      yield* pollWithTimeout(
        Effect.gen(function* () {
          const current = yield* workflow.get(run.id)
          const node = current?.agents[0]
          return node?.status === "running" && node.session_id ? current : undefined
        }),
        "agent node never started",
      )
      const snap = yield* workflow.skipAgent({ id: run.id, agentId: "1" })
      expect(snap?.id).toBe(run.id)

      const done = (yield* workflow.wait({ id: run.id })).run ?? (yield* Effect.fail(new Error("run did not finish")))
      expect(done.status).toBe("completed")
      // The body observed null for the skipped step…
      expect(done.result).toEqual({ skipped: true })
      // …and the node settled as `skipped` with no charge (the abort artifact
      // carries no real spend; the ensuring skips the charge for aborted steps).
      expect(done.agents[0]?.status).toBe("skipped")
      expect(done.agents[0]?.cost ?? 0).toBe(0)
    }),
  )

  // Item 15: a skip that lands BEFORE the step's prompt dispatches (its node
  // exists, its dispatch still waits for a run-semaphore permit) resolves the
  // step without ever prompting. Deterministic via semaphore saturation: cap+1
  // parallel steps, the (cap+1)-th waits while the first cap hang in prompts.
  it.instance(
    "a skip that lands before the step dispatches resolves it without ever prompting",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        // The lifetime-cap tests above leak their tiny agentLimit override (the
        // seam is module-global, captured per run at start). This test dispatches
        // cap+1 agents, so restore the production default for OUR run first.
        Workflow.__testHooks.agentLimit(1_000)
        // The engine's run-wide concurrency cap (agentConcurrencyCap) — kept in
        // sync by the poll below, which REQUIRES exactly `cap` dispatched
        // sessions and one undisptached node before proceeding.
        const cap = Math.min(16, Math.max(2, os.cpus().length - 2))
        yield* Effect.promise(() => writeWorkflow(test.directory, SKIP_PARALLEL_FIXTURE, SKIP_PARALLEL_WORKFLOW))
        const workflow = yield* Workflow.Service
        const { ops, started } = resolveOnAbortPromptOps()

        const run = yield* workflow.start({
          name: SKIP_PARALLEL_FIXTURE,
          args: { count: cap + 1 },
          prompt: ops,
        })
        // All cap+1 nodes exist; exactly cap are dispatched (session registered);
        // one still waits for a permit. Generous bound: under full-suite load,
        // creating `cap` child sessions (up to 16) can take a while — the
        // saturation itself is deterministic.
        const saturated = yield* pollWithTimeout(
          Effect.gen(function* () {
            const current = yield* workflow.get(run.id)
            if (!current || current.agents.length !== cap + 1) return undefined
            const dispatched = current.agents.filter((a) => a.session_id).length
            const pending = current.agents.find((a) => a.status === "running" && !a.session_id)
            return dispatched === cap && pending ? { pendingId: pending.id } : undefined
          }),
          "saturated batch never materialized",
          "45 seconds",
        )
        // Skip the not-yet-dispatched node FIRST (nothing to abort yet)…
        yield* workflow.skipAgent({ id: run.id, agentId: saturated.pendingId })
        // …then skip the in-flight steps so permits free up and the run settles.
        const live = yield* workflow.get(run.id)
        for (const node of live?.agents ?? []) {
          if (node.id === saturated.pendingId) continue
          yield* workflow.skipAgent({ id: run.id, agentId: node.id }).pipe(Effect.ignore)
        }

        const done = (yield* workflow.wait({ id: run.id })).run ?? (yield* Effect.fail(new Error("run did not finish")))
        expect(done.status).toBe("completed")
        expect(done.result).toEqual({ allNull: true })
        const skippedEarly = done.agents.find((a) => a.id === saturated.pendingId)
        expect(skippedEarly?.status).toBe("skipped")
        // The pre-dispatch skip never prompted: only the cap in-flight steps did.
        expect(started.size).toBe(cap)
      }),
    90_000,
  )

  // Item 15: skipAgent's rejection matrix — completed node, unknown agent id,
  // unknown run id, and a persisted (non-live) run.
  it.instance("skipAgent rejects completed nodes, unknown agents, and non-live runs", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* Effect.promise(() => writeWorkflow(test.directory, AGENT_THEN_HANG_FIXTURE, AGENT_THEN_HANG_WORKFLOW))
      const workflow = yield* Workflow.Service

      // Live run whose single agent node already COMPLETED (body still hanging).
      const run = yield* workflow.start({ name: AGENT_THEN_HANG_FIXTURE, args: {}, prompt: immediatePromptOps() })
      yield* pollWithTimeout(
        Effect.gen(function* () {
          const current = yield* workflow.get(run.id)
          return current?.agents[0]?.status === "completed" ? current : undefined
        }),
        "agent node never completed",
      )
      const exitCompleted = yield* Effect.exit(workflow.skipAgent({ id: run.id, agentId: "1" }))
      expect(Exit.isFailure(exitCompleted)).toBe(true)
      expect(Exit.isFailure(exitCompleted) ? Cause.pretty(exitCompleted.cause) : "").toContain("is not running")

      const exitUnknownAgent = yield* Effect.exit(workflow.skipAgent({ id: run.id, agentId: "99" }))
      expect(Exit.isFailure(exitUnknownAgent)).toBe(true)
      expect(Exit.isFailure(exitUnknownAgent) ? Cause.pretty(exitUnknownAgent.cause) : "").toContain("not found")

      // Unknown run id → undefined (HTTP 404).
      const unknown = yield* workflow.skipAgent({
        id: Workflow.RunID.make("job_skip_unknown"),
        agentId: "1",
      })
      expect(unknown).toBeUndefined()

      // A persisted run without a live registry entry has nothing to skip → 409.
      const persistedId = Workflow.RunID.make("job_skip_notlive")
      yield* seedCompletedRow(persistedId, test.directory)
      const exitNotLive = yield* Effect.exit(workflow.skipAgent({ id: persistedId, agentId: "1" }))
      expect(Exit.isFailure(exitNotLive)).toBe(true)
      expect(Exit.isFailure(exitNotLive) ? Cause.pretty(exitNotLive.cause) : "").toContain("is not live")

      // Cleanup: stop the hanging body.
      yield* workflow.cancel(run.id)
    }),
  )

  // Item 15 (onError:"null"): a failing step resolves null so the body can
  // branch; its node still records the failure.
  it.instance("onError:null resolves a failing agent to null while the node stays failed", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* Effect.promise(() => writeWorkflow(test.directory, ONERROR_NULL_FIXTURE, ONERROR_NULL_WORKFLOW))
      const workflow = yield* Workflow.Service

      const run = yield* workflow.start({ name: ONERROR_NULL_FIXTURE, args: {}, prompt: failingPromptOps() })
      const done = (yield* workflow.wait({ id: run.id })).run ?? (yield* Effect.fail(new Error("run did not finish")))
      expect(done.status).toBe("completed")
      expect(done.result).toEqual({ isNull: true })
      expect(done.agents[0]?.status).toBe("failed")
      expect(done.agents[0]?.error ?? "").toContain("boom")
    }),
  )

  // Item 15: budget exhaustion is NEVER swallowed by onError:"null" — otherwise
  // a while-loop with onError:null would spin forever against an exhausted cap.
  it.instance("onError:null does NOT swallow budget exhaustion", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* Effect.promise(() => writeWorkflow(test.directory, ONERROR_BUDGET_FIXTURE, ONERROR_BUDGET_WORKFLOW))
      const workflow = yield* Workflow.Service

      const run = yield* workflow.start({
        name: ONERROR_BUDGET_FIXTURE,
        args: {},
        prompt: immediatePromptOps(),
        budget: 0,
      })
      const done = (yield* workflow.wait({ id: run.id })).run ?? (yield* Effect.fail(new Error("run did not finish")))
      expect(done.status).toBe("failed")
      expect(done.error ?? "").toMatch(/budget exhausted/i)
    }),
  )

  // Item 15: a `skipped` node survives the DB→fromRow roundtrip.
  it.instance("a skipped agent node round-trips through fromRow", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const workflow = yield* Workflow.Service
      const { db } = yield* Database.Service
      const id = Workflow.RunID.make("job_skipped_roundtrip")
      const now = Date.now()
      yield* db
        .insert(WorkflowRunTable)
        .values({
          id,
          workflow: HELLO_FIXTURE,
          status: "completed",
          started_at: now,
          completed_at: now,
          directory: test.directory,
          logs: [],
          agents: [{ id: "1", status: "skipped", started_at: now, completed_at: now, prompt: "skipped step" }],
        })
        .run()
        .pipe(Effect.orDie)
      const persisted = (yield* workflow.get(id)) ?? (yield* Effect.fail(new Error("seeded run not readable")))
      expect(persisted.agents[0]?.status).toBe("skipped")
    }),
  )

  // Task 15(c): setPhase on a phase NOT declared in meta.phases is allowed — the
  // run completes — but a run log records a warning naming the undeclared phase.
  it.instance("setPhase on an undeclared phase completes the run and logs a warning", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* Effect.promise(() => writeWorkflow(test.directory, UNDECLARED_PHASE_FIXTURE, UNDECLARED_PHASE_WORKFLOW))
      const workflow = yield* Workflow.Service

      const started = yield* workflow.start({ name: UNDECLARED_PHASE_FIXTURE, args: {} })
      const waited = yield* workflow.wait({ id: started.id })
      const done = waited.run ?? (yield* Effect.fail(new Error("undeclared-phase workflow did not finish")))

      // No error: an undeclared phase is allowed.
      expect(done.status).toBe("completed")
      // A run log warns about the undeclared phase.
      const warning = done.logs.find((l) => l.message.includes('phase "undeclared" is not declared'))
      expect(warning).toBeTruthy()
    }),
  )
})

// Track T8 Feature A: the engine save() seam the HTTP /workflow/save route reuses.
// Mirrors the create tool's write logic (MetaReader validation + sanitized name +
// project/global dir resolution + no-overwrite conflict), minus the tool-context
// permission ask.
const SAVE_SOURCE = `export const meta = { name: "saved-flow", description: "a saved run" }
export async function run(args, ctx) { return { ok: true } }
`

describe("Workflow.save", () => {
  it.instance("writes a project workflow file that is then discoverable", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const workflow = yield* Workflow.Service
      const saved = yield* workflow.save({ name: "saved-flow", source: SAVE_SOURCE })
      const expected = path.join(test.directory, ".opencode", "workflows", "saved-flow.ts")
      expect(saved.path).toBe(expected)
      // The file really landed on disk with the exact source.
      const onDisk = yield* Effect.promise(() => Bun.file(expected).text())
      expect(onDisk).toBe(SAVE_SOURCE)
      // And it is now discoverable via list() (static meta extraction).
      const list = yield* workflow.list()
      const info = list.find((item) => item.name === "saved-flow")
      expect(info?.valid).toBe(true)
      expect(info?.path).toBe(expected)
    }),
  )

  it.instance("saving with scope:global writes under the global config workflows dir", () =>
    Effect.gen(function* () {
      const workflow = yield* Workflow.Service
      // Use a name unlikely to collide with any real global file in the test home.
      const name = `t8-global-${Date.now()}`
      const saved = yield* workflow.save({ name, source: SAVE_SOURCE.replace("saved-flow", name), scope: "global" })
      const expected = path.join(Global.Path.config, "workflows", `${name}.ts`)
      expect(saved.path).toBe(expected)
      const onDisk = yield* Effect.promise(() => Bun.file(expected).text())
      expect(onDisk).toContain(`name: "${name}"`)
      // Clean up the global file so it does not leak into other tests.
      yield* Effect.promise(() => fs.rm(expected).catch(() => {}))
    }),
  )

  it.instance("a duplicate save fails with SaveConflictError (never overwrites)", () =>
    Effect.gen(function* () {
      const workflow = yield* Workflow.Service
      yield* workflow.save({ name: "dup-flow", source: SAVE_SOURCE })
      // A second save with a VALID source (so it clears the meta gate) must still
      // be refused as a conflict — save never overwrites.
      const second = yield* Effect.exit(workflow.save({ name: "dup-flow", source: SAVE_SOURCE }))
      expect(Exit.isFailure(second)).toBe(true)
      const conflict = Exit.isFailure(second) ? (Cause.squash(second.cause) as { _tag?: string }) : undefined
      expect(conflict?._tag).toBe("WorkflowSaveConflictError")
    }),
  )

  it.instance("a bad name fails with InvalidError before any write", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const workflow = yield* Workflow.Service
      const result = yield* Effect.exit(workflow.save({ name: "../escape", source: SAVE_SOURCE }))
      expect(Exit.isFailure(result)).toBe(true)
      const badName = Exit.isFailure(result) ? (Cause.squash(result.cause) as { _tag?: string }) : undefined
      expect(badName?._tag).toBe("WorkflowInvalidError")
      // No traversal file was created.
      const escaped = yield* Effect.promise(() =>
        Bun.file(path.join(test.directory, ".opencode", "workflows", "../escape.ts")).exists(),
      )
      expect(escaped).toBe(false)
    }),
  )

  it.instance("statically-invalid meta fails with InvalidError and writes nothing", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const workflow = yield* Workflow.Service
      // Non-literal meta (a call expression) is rejected by the AST-only MetaReader.
      const result = yield* Effect.exit(
        workflow.save({ name: "bad-meta", source: "export const meta = makeMeta()\nexport async function run() {}" }),
      )
      expect(Exit.isFailure(result)).toBe(true)
      const badMeta = Exit.isFailure(result) ? (Cause.squash(result.cause) as { _tag?: string }) : undefined
      expect(badMeta?._tag).toBe("WorkflowInvalidError")
      const wrote = yield* Effect.promise(() =>
        Bun.file(path.join(test.directory, ".opencode", "workflows", "bad-meta.ts")).exists(),
      )
      expect(wrote).toBe(false)
    }),
  )

  // Cross-version phases compatibility (@VasyaYovbak): a migration/version
  // mismatch between branches leaves old `workflow_run` rows in the local DB
  // whose `definition.meta.phases` is the OLD wire shape (bare strings, e.g.
  // `["setup","run"]`) instead of the normalized object form. The three tests
  // below pin the round-trip the fix must hold across schema versions.

  // (B) Normalize on READ: an OLD row whose phases are bare strings must be
  // read back through get()/runs() as the canonical OBJECT form, AND that
  // in-memory run must re-encode cleanly through the public `Run` schema (the
  // shape the HTTP layer serializes) with no `undefined` title and no error —
  // the failure the reviewer saw was the `Run` encode choking on string phases.
  it.instance("reads an old string-phases row back as normalized object phases that re-encode cleanly", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const workflow = yield* Workflow.Service
      const id = Workflow.RunID.make("job_oldstringphases")
      // The OLD on-disk shape produced by a branch whose `phases` was `string[]`.
      yield* seedRowWithRawMeta(id, test.directory, { name: HELLO_FIXTURE, phases: ["setup", "run"] })

      const viaGet = yield* workflow.get(id)
      const run = viaGet ?? (yield* Effect.fail(new Error("run not read")))
      // Canonical object form regardless of the stored (string) shape.
      expect(run.definition?.meta.phases).toEqual([{ title: "setup" }, { title: "run" }])

      // runs() (the list path) must normalize identically.
      const listed = yield* workflow.runs()
      const fromList = listed.find((r) => r.id === id) ?? (yield* Effect.fail(new Error("run not listed")))
      expect(fromList.definition?.meta.phases).toEqual([{ title: "setup" }, { title: "run" }])

      // The public `Run` encode (the HTTP response shape) succeeds — pre-fix this
      // threw / produced an `undefined` title because the run still held strings.
      const encoded = Schema.encodeUnknownExit(Workflow.Run)(run)
      expect(Exit.isSuccess(encoded)).toBe(true)
    }),
  )

  // (A) Persist back-compat ENCODED form: a freshly started run with plain
  // string phases must be PERSISTED as bare strings (`["setup"]`), NOT the
  // in-memory normalized objects — so an OLDER reader whose schema still expects
  // `phases: string[]` can decode our row. A phase carrying detail/model has no
  // back-compat string form, so it stays an object.
  it.instance("persists plain phases as back-compat strings while keeping structured phases as objects", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* Effect.promise(() =>
        writeWorkflow(
          test.directory,
          "phase-encode",
          `export const meta = { name: "PhaseEncode", phases: ["setup", { title: "verify", model: "stub/mini" }] }
export async function run(args, ctx) { ctx.setPhase("setup"); return { ok: true } }
`,
        ),
      )
      const workflow = yield* Workflow.Service
      const run = yield* workflow.start({ name: "phase-encode", args: {} })
      yield* workflow.wait({ id: run.id })

      // Read the RAW DB row — the persisted bytes, not the engine projection.
      const row = yield* fetchRunRow(run.id)
      const phases = (row.definition?.meta.phases ?? []) as unknown[]
      // A title-only phase is stored as the bare STRING (decodable by an old
      // `string[]` reader); a phase with a model stays a structured object.
      expect(phases[0]).toBe("setup")
      expect(phases[1]).toEqual({ title: "verify", model: "stub/mini" })

      // The in-memory snapshot is still the NORMALIZED object form (only the
      // persisted bytes change) — the live run keeps its canonical shape.
      const snap = yield* workflow.get(run.id)
      expect(snap?.definition?.meta.phases).toEqual([{ title: "setup" }, { title: "verify", model: "stub/mini" }])
    }),
  )

  // (A) Non-mutation invariant: `encodeDefinitionForRow` runs on EVERY persist
  // (each setPhase/log forks a progress write), so it must NEVER mutate the LIVE
  // in-memory run — only the persisted bytes change. Drive a still-RUNNING run
  // (a hanging agent step) whose phases are plain strings; by the time the agent
  // is live at least one persist has already encoded the definition. A mid-run
  // get() returns snapshot(active), i.e. the LIVE definition: its phases must
  // still be the canonical OBJECT form. A mutating encode would have rewritten
  // active.run.definition.meta.phases to strings and this would observe them.
  it.instance("persist does not mutate the live run's in-memory object phases", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* Effect.promise(() => writeWorkflow(test.directory, SLOW_FIXTURE, SLOW_WORKFLOW))
      const workflow = yield* Workflow.Service
      const { ops } = hangingPromptOps()
      const run = yield* workflow.start({ name: SLOW_FIXTURE, args: {}, prompt: ops })

      // Poll until the agent step is live — guarantees a progress persist (which
      // calls encodeDefinitionForRow) has already run at least once.
      const live = yield* pollWithTimeout(
        Effect.gen(function* () {
          const current = yield* workflow.get(run.id)
          return current && current.agents.some((a) => a.status === "running") ? current : undefined
        }),
        "agent never started",
      )
      // SLOW_WORKFLOW declares `phases: ["agent","after"]` (authored as strings),
      // normalized to objects in memory. The live snapshot must STILL be objects.
      expect(live.definition?.meta.phases).toEqual([{ title: "agent" }, { title: "after" }])

      yield* workflow.cancel(run.id)
    }),
  )

  // (A) `definition.source` survival: the prior fix populates `source` for every
  // run (named/builtin/inline), and `encodeDefinitionForRow` only rewrites
  // `meta.phases` — it must leave `source` byte-identical through persist→read.
  // A blank source here would re-break "save as command" / the source preview.
  it.instance("definition.source survives the phase-encode persist round-trip intact", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const source = `export const meta = { name: "SourceThroughEncode", phases: ["setup", "run"] }
export async function run(args, ctx) { ctx.setPhase("setup"); return { ok: true } }
`
      yield* Effect.promise(() => writeWorkflow(test.directory, "source-through-encode", source))
      const workflow = yield* Workflow.Service
      const run = yield* workflow.start({ name: "source-through-encode", args: {} })
      yield* workflow.wait({ id: run.id })

      // Read back through the DB->fromRow path (the run is evicted post-terminal):
      // source must be intact AND phases must round-trip to the object form.
      const persisted = yield* workflow.get(run.id)
      expect(persisted?.definition?.source).toBe(source)
      expect(persisted?.definition?.meta.phases).toEqual([{ title: "setup" }, { title: "run" }])
    }),
  )

  // (C) Per-row resilience: a single un-decodable/foreign row (here, `phases` is
  // a malformed shape the decode rejects) must NOT blow up the whole list. The
  // OTHER valid row must still come back. The fix COERCES the poison row (keeps
  // it, with safe phases) rather than dropping it, so a user's run never silently
  // vanishes from history — degrade, don't disappear.
  it.instance("a poison definition row does not fail the whole list; valid rows still return", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const workflow = yield* Workflow.Service
      const goodId = Workflow.RunID.make("job_resilientgood")
      const poisonId = Workflow.RunID.make("job_resilientpoison")
      // A valid (old-string-phases) row and a poison row whose `phases` is a
      // shape neither a string nor a `{title}` object — the decode must reject it.
      yield* seedRowWithRawMeta(goodId, test.directory, { name: HELLO_FIXTURE, phases: ["setup"] })
      yield* seedRowWithRawMeta(poisonId, test.directory, { name: HELLO_FIXTURE, phases: [{ nope: 123 }, 42] })

      // The list must not throw and must still surface the valid run.
      const listed = yield* workflow.runs()
      const good = listed.find((r) => r.id === goodId) ?? (yield* Effect.fail(new Error("valid run dropped")))
      expect(good.definition?.meta.phases).toEqual([{ title: "setup" }])
      // The poison row is coerced (kept, but with safe/empty phases), so it is
      // still present and the whole list survived.
      const poison = listed.find((r) => r.id === poisonId)
      expect(poison).toBeDefined()
    }),
  )
})

describe("Workflow.fmt", () => {
  test("fmt renders whenToUse inside the available_workflows block", () => {
    const out = Workflow.fmt([
      {
        name: "deploy",
        path: "/p/.opencode/workflows/deploy.ts",
        valid: true,
        meta: { name: "Deploy", description: "Deploy the app.", whenToUse: "When shipping to prod." },
      },
    ])
    expect(out).toContain("<when_to_use>When shipping to prod.</when_to_use>")
  })
})
