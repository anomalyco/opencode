// The `task` tool (ARCHITECTURE §13): spawn, resume or steer a sub-agent and hand back its `<task>` envelope.
import { Effect, Schema } from "effect"
import { ToolFailure } from "@opencode-ai/llm"
import DESCRIPTION from "@/tool/task.txt"
import type { RenderEvent, ResolvedConfig, RunToolContext, SubagentsShape } from "../contract"
import { evaluate } from "../forked/permission-rules"
import { BACKGROUND_STARTED, BACKGROUND_UPDATED, Parameters, renderOutput } from "../forked/task-contract"
import { define } from "../tools/fs"
import { id } from "../util/paths"

/** Foreground sub-agents can run for a long time; the step budget, not this timeout, is the real limit. */
const TIMEOUT_MS = 3_600_000

/**
 * `parentReadOnly` (read_only agent or plan mode) starts every child in plan mode, so the child's own read_only
 * rules apply on top of the denies it inherits: a plan parent can't escalate by spawning a writer.
 */
export function taskTool(input: { ctx: RunToolContext; subagents: SubagentsShape; cfg: ResolvedConfig; parentReadOnly: boolean }) {
  const ctx = input.ctx
  const names = subagents(input.cfg, ctx).map((agent) => agent.name)
  // Child events arrive tagged with the child's name; prefix this run's own name so nesting shows as indentation.
  const sink = (event: RenderEvent) =>
    ctx.sink({ ...event, agent_path: [...(ctx.depth > 0 ? [ctx.agent.name] : []), ...event.agent_path] })
  return define({
    name: "task",
    // opencode's BACKGROUND_DESCRIPTION paragraph is left out: the `background` parameter's own description carries the
    // same guidance, and with it the default profile's fixed overhead exceeds its 7,300-token budget (7,337).
    description: [DESCRIPTION.trim(), available(input.cfg, ctx)].join("\n\n"),
    // Local profiles use their tools.local.json description, so the agent names go into the (shorter) parameters.
    parameters: ctx.profile.name === "default" ? Parameters : localParameters(names),
    // `readOnly` only groups calls for concurrency: consecutive task/read calls run together, and any mutating call
    // runs alone. Each child's own ruleset decides what it may do.
    readOnly: true,
    timeoutMs: TIMEOUT_MS,
    access: (params) => ({ permission: "task", patterns: [params.subagent_type], always: ["*"] }),
    summarize: (params) => `task ${params.subagent_type}: ${params.description}`,
    execute: (params, call) =>
      Effect.gen(function* () {
        const existing = params.task_id ? yield* input.subagents.get(params.task_id) : undefined
        if (existing && existing.parent_session_id !== ctx.session_id)
          return yield* new ToolFailure({ message: `task_id ${existing.id} is not a sub-agent task of this session` })
        if (existing && (existing.state === "running" || existing.state === "pending")) {
          if (!(yield* input.subagents.send(existing.id, params.prompt)))
            return yield* new ToolFailure({ message: `task ${existing.id} is ${existing.state}; try again when it is running` })
          return renderOutput({ sessionID: existing.id, state: "running", summary: "Background task updated", text: BACKGROUND_UPDATED })
        }
        const info = yield* input.subagents
          .spawn({
            parent: { session_id: ctx.session_id, depth: ctx.depth, ruleset: ctx.ruleset, call_id: call?.id ?? id("call"), cwd: ctx.cwd },
            agent: params.subagent_type,
            prompt: params.prompt,
            description: params.description,
            background: params.background === true,
            task_id: params.task_id,
            permissionMode: input.parentReadOnly ? "plan" : undefined,
            sink,
          })
          .pipe(Effect.mapError((error) => new ToolFailure({ message: error.message })))
        if (params.background === true)
          return renderOutput({ sessionID: info.id, state: "running", summary: "Background task started", text: BACKGROUND_STARTED })
        // A foreground child dies with the call (timeout, or the parent cancelled mid-tool).
        const done = yield* input.subagents.wait(info.id).pipe(Effect.onInterrupt(() => input.subagents.cancel(info.id)))
        return input.subagents.envelope(done)
      }),
  })
}

/** Sub-agents this run may start (not denied `task` by its ruleset), sorted by name. */
function subagents(cfg: ResolvedConfig, ctx: RunToolContext) {
  return Object.values(cfg.agents)
    .filter((agent) => agent.mode !== "primary" && evaluate("task", agent.name, ctx.ruleset).action !== "deny")
    .toSorted((a, b) => a.name.localeCompare(b.name))
}

/** opencode's agent list (default profile). */
function available(cfg: ResolvedConfig, ctx: RunToolContext) {
  const lines = subagents(cfg, ctx).map(
    (agent) => `- ${agent.name}: ${agent.description ?? "This subagent should only be called manually by the user."}`,
  )
  return ["Available agent types and the tools they have access to:", ...lines].join("\n")
}

/** Same fields as the fork with terse descriptions (local budgets); subagent_type names the agents. */
function localParameters(names: readonly string[]) {
  return Schema.Struct({
    description: Schema.String.annotate({ description: "3-5 word summary" }),
    prompt: Schema.String.annotate({ description: "Self-contained brief" }),
    subagent_type: Schema.String.annotate({ description: `One of: ${names.join(", ")}` }),
    task_id: Schema.optional(Schema.String).annotate({ description: "Resume this earlier task" }),
    background: Schema.optional(Schema.Boolean).annotate({ description: "Run in background; you are notified when done" }),
  })
}
