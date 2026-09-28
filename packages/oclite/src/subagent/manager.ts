// Sub-agent lifecycle (ARCHITECTURE §13): pending ──admit──► running ──► completed | failed | cancelled.
// ≤ max_concurrent running children per parent (extras wait pending), a depth limit, background completions
// queued for the parent's next turn boundary, and every child cancelled when its parent's run ends.
import { Deferred, Effect, Exit, Option, Scope } from "effect"
import {
  type AgentDef,
  type AskerShape,
  SpawnError,
  type ResolvedConfig,
  type RunHandle,
  type RunResult,
  type RuntimeShape,
  type SessionStoreShape,
  type SpawnInput,
  type SubagentInfo,
  type SubagentsShape,
} from "../contract"
import { evaluate } from "../forked/permission-rules"
import { renderOutput } from "../forked/task-contract"
import { neutralize } from "../runtime/context"
import { validId } from "../session/store"
import { id, isLoopback } from "../util/paths"
import { redactUrl, registerSecret } from "../util/redact"

/** Handback text cap: 4000 tokens ≈ 16,000 chars (SPEC §4). */
export const ENVELOPE_CHARS = 16_000

export interface Manager extends SubagentsShape {
  /** Cancels every live child of a parent session (its run ended or was cancelled). */
  readonly cancelAll: (parent_session_id: string) => Effect.Effect<void>
  /** Denials in finished children (each child's count already includes its own descendants). */
  readonly denials: (parent_session_id: string) => Effect.Effect<number>
}

interface Entry {
  info: SubagentInfo
  input: SpawnInput
  handle?: RunHandle
  done: Deferred.Deferred<SubagentInfo>
  denied: number
}

/** `ask` is this process's Asker: a `transport: mcp` child's asks (elicitation) are answered by it. */
export function make(deps: { start: RuntimeShape["start"]; store: SessionStoreShape; cfg: ResolvedConfig; ask: AskerShape["ask"] }): Manager {
  const children = new Map<string, Entry>()
  const finished = new Map<string, SubagentInfo[]>()
  const of = (parent: string) => [...children.values()].filter((entry) => entry.input.parent.session_id === parent)
  const live = (entry: Entry) => entry.info.state === "pending" || entry.info.state === "running"

  const record = (entry: Entry) =>
    deps.store.append(entry.input.parent.session_id, {
      type: "subagent",
      call_id: entry.input.parent.call_id,
      child_id: entry.info.id,
      agent: entry.info.agent,
      state: entry.info.state,
      transport: entry.info.transport,
      background: entry.input.background,
    })

  const finish = (entry: Entry, patch: Partial<SubagentInfo>) =>
    Effect.gen(function* () {
      if (!live(entry)) return
      entry.info = { ...entry.info, ...patch }
      yield* record(entry)
      if (entry.input.background)
        finished.set(entry.input.parent.session_id, [...(finished.get(entry.input.parent.session_id) ?? []), entry.info])
      yield* Deferred.succeed(entry.done, entry.info)
      yield* admit(entry.input.parent.session_id)
    })

  const launch = (entry: Entry) =>
    Effect.gen(function* () {
      entry.info = { ...entry.info, state: "running", started_at: Date.now() }
      yield* record(entry)
      const parent = entry.input.parent
      const agent = deps.cfg.agents[entry.input.agent]!
      const launched: Effect.Effect<RunHandle, { message: string }> = agent.transport === "mcp" ? remote(entry, agent) : deps
        .start(
          {
            session_id: entry.info.id,
            agent: entry.input.agent,
            prompt: entry.input.prompt,
            model: entry.input.model,
            permissionMode: entry.input.permissionMode,
            cwd: parent.cwd,
            parent: { session_id: parent.session_id, depth: parent.depth, ruleset: parent.ruleset, call_id: parent.call_id },
          },
          entry.input.sink,
        )
      const started = yield* launched.pipe(Effect.result)
      if (started._tag === "Failure") return yield* finish(entry, { state: "failed", error: started.failure.message })
      entry.handle = started.success
      yield* started.success.await.pipe(
        Effect.flatMap((result) => {
          entry.denied = result.denied
          return finish(entry, outcome(result))
        }),
        Effect.forkDetach,
      )
    })

  // A child `oclite mcp serve` (ARCHITECTURE §12): spawn{background} then result{wait}, behind a RunHandle so limits,
  // envelope and cancellation match in-process children. The parent's ruleset travels as `parent_rules` (the child
  // keeps only its denies and external_directory rules, as in-process), the parent's mode as the child's serve mode
  // (a client can only tighten it), and every forwarded ask is checked against the parent's ruleset first. Rejected
  // forwarded asks count as the child's denials (headless exit 3).
  const remote = (entry: Entry, agent: AgentDef) =>
    Effect.gen(function* () {
      const { connectChild } = yield* Effect.promise(() => import("../mcp/child"))
      const parent = entry.input.parent
      const scope = yield* Scope.make()
      const asked = { denied: 0 }
      const auth = childAuth(agent, process.env)
      if (auth.notice)
        yield* entry.input.sink({ session_id: parent.session_id, agent_path: [agent.name], type: "status", phase: "notice", message: auth.notice })
      const command = agent.mcp?.command ?? ["oclite", "mcp", "serve", "--permission-mode", deps.cfg.permissionMode]
      const { stillTrusted } = yield* Effect.promise(() => import("../config/config"))
      const trusted = command[0] === "oclite" && (yield* Effect.promise(() => stillTrusted(deps.cfg)))
      const client = yield* connectChild({
        command: trusted ? [...command, "--trust-project"] : command,
        url: agent.mcp?.url, token: auth.token, cwd: parent.cwd, env: childEnv(process.env, parent.depth + 1),
        // The child's run already carries its own name first in agent_path (it runs with a parent).
        onEvent: entry.input.sink,
        onAsk: (req) =>
          (req.patterns.some((pattern) => evaluate(req.tool, pattern, parent.ruleset).action === "deny")
            ? Effect.succeed("reject" as const)
            : deps.ask({ ...req, agent: `${agent.name}/${req.agent}` })
          ).pipe(Effect.tap((reply) => Effect.sync(() => void (reply === "reject" && asked.denied++)))),
      }).pipe(Scope.provide(scope))
      const id = yield* client.spawn({ agent: agent.name, prompt: entry.input.prompt, background: true, permission_mode: entry.input.permissionMode,
        model: entry.input.model, parent_rules: parent.ruleset, parent_session_id: parent.session_id })
        .pipe(Effect.onError(() => Scope.close(scope, Exit.void)))
      const started_at = Date.now()
      const tokens = { input: 0, output: 0, estimated: true }
      const handle: RunHandle = {
        session_id: entry.info.id,
        send: (message) => client.send(id, message).pipe(Effect.ignore),
        cancel: client.cancel(id),
        status: Effect.succeed({ state: "running", step: 0, started_at, tokens }),
        await: client.result(id, 86_400_000).pipe(
          Effect.map((out): RunResult => ({ session_id: entry.info.id, state: out.state, text: out.state === "completed" ? out.text : "", error: out.state === "completed" ? undefined : out.text,
            turns: 0, usage: tokens, reason: out.state === "completed" ? "stop" : out.state === "cancelled" ? "cancelled" : "error", denied: asked.denied })),
          Effect.catch((error) => Effect.succeed<RunResult>({ session_id: entry.info.id, state: "failed", text: "", error: error.message, turns: 0, usage: tokens, reason: "error", denied: asked.denied })),
          Effect.ensuring(Scope.close(scope, Exit.void)),
        ),
      }
      return handle
    }).pipe(Effect.mapError((error) => new SpawnError({ message: error.message })))

  // Starts pending children of `parent` in spawn order while slots are free.
  const admit = (parent: string): Effect.Effect<void> =>
    Effect.gen(function* () {
      const running = of(parent).filter((entry) => entry.info.state === "running").length
      const next = of(parent).find((entry) => entry.info.state === "pending")
      if (!next || running >= deps.cfg.subagent.max_concurrent) return
      yield* launch(next)
      yield* admit(parent)
    })

  const cancel = (child: string) =>
    Effect.gen(function* () {
      const entry = children.get(child)
      if (!entry) return undefined
      if (entry.info.state === "pending") yield* finish(entry, { state: "cancelled" })
      if (entry.info.state === "running" && entry.handle) {
        yield* entry.handle.cancel
        yield* Deferred.await(entry.done)
      }
      return entry.info.state
    })

  const spawn = (input: SpawnInput) =>
    Effect.gen(function* () {
      const agent = deps.cfg.agents[input.agent]
      if (!agent || agent.mode === "primary") {
        const available = Object.values(deps.cfg.agents).filter((item) => item.mode !== "primary").map((item) => item.name)
        return yield* fail(`Unknown agent type: ${input.agent} is not a valid agent type. Available subagents: ${available.sort().join(", ")}`)
      }
      const header = (yield* deps.store.read(input.parent.session_id)).find((item) => item.type === "session")
      const parentAgent = deps.cfg.agents[header?.agent ?? ""]
      const limit = Math.min(parentAgent?.max_depth ?? deps.cfg.subagent.max_depth, deps.cfg.subagent.max_depth)
      if (input.parent.depth + 1 > limit) return yield* fail(`Subagent depth limit reached (${limit})`)
      if (agent.transport === "mcp" && input.task_id !== undefined) return yield* fail("task_id resume is not supported for transport: mcp agents")
      if (input.task_id !== undefined) {
        const existing = children.get(input.task_id)
        if (existing && live(existing)) return yield* fail(`task ${input.task_id} is still ${existing.info.state}`)
        const child = validId(input.task_id) ? yield* deps.store.read(input.task_id) : []
        const own = child.find((item) => item.type === "session")
        if (own?.parent_id !== input.parent.session_id)
          return yield* fail(`task_id ${input.task_id} is not a sub-agent task of this session`)
      }
      const entry: Entry = {
        input,
        denied: 0,
        done: yield* Deferred.make<SubagentInfo>(),
        info: {
          id: input.task_id ?? id("ses"),
          parent_session_id: input.parent.session_id,
          agent: agent.name,
          description: input.description,
          transport: agent.transport,
          state: "pending",
          step: 0,
          started_at: Date.now(),
          tokens: { input: 0, output: 0, estimated: false },
        },
      }
      children.set(entry.info.id, entry)
      yield* record(entry)
      yield* admit(input.parent.session_id)
      return entry.info
    })

  return {
    spawn,
    wait: (child, timeout_ms) =>
      Effect.gen(function* () {
        const entry = children.get(child)
        if (!entry) return yield* Effect.die(new Error(`unknown sub-agent ${child}`))
        const waited = Deferred.await(entry.done)
        if (timeout_ms === undefined) return yield* waited
        return Option.getOrElse(yield* waited.pipe(Effect.timeoutOption(timeout_ms)), () => entry.info)
      }),
    get: (child) =>
      Effect.gen(function* () {
        const entry = children.get(child)
        if (!entry?.handle || !live(entry)) return entry?.info
        const status = yield* entry.handle.status
        entry.info = { ...entry.info, step: status.step, tokens: status.tokens }
        return entry.info
      }),
    send: (child, message) => {
      const entry = children.get(child)
      if (!entry?.handle || entry.info.state !== "running") return Effect.succeed(false)
      return entry.handle.send(message).pipe(Effect.as(true))
    },
    cancel,
    takeFinished: (parent) =>
      Effect.sync(() => {
        const items = finished.get(parent) ?? []
        finished.delete(parent)
        return items
      }),
    running: (parent) => Effect.sync(() => of(parent).filter(live).length),
    envelope,
    denials: (parent) => Effect.sync(() => of(parent).reduce((sum, entry) => sum + entry.denied, 0)),
    cancelAll: (parent) =>
      Effect.forEach(of(parent).filter(live), (entry) => cancel(entry.info.id), { concurrency: "unbounded", discard: true }),
  }
}

/** `<task id state>` handback. Handbacks are data: nothing parses them for approvals (SPEC context #6). */
export function envelope(info: SubagentInfo, summary?: string) {
  const state = info.state === "completed" ? "completed" : info.state === "failed" || info.state === "cancelled" ? "error" : "running"
  const text = state === "error" ? (info.error ?? info.result ?? `Task ${info.state}`) : (info.result ?? "")
  // The opencode wrapper stays; the child's text and the description inside it are neutralized.
  return renderOutput({ sessionID: info.id, state, summary: summary && neutralize(summary), text: neutralize(truncate(text)) })
}

/**
 * Bearer token for a remote `transport: mcp` child: an explicit frontmatter `mcp.token` (`{env:NAME}` or a literal)
 * wins; otherwise OCLITE_MCP_TOKEN goes only to loopback URLs, so an agent file can't send it to any host it names.
 */
export function childAuth(agent: AgentDef, env: Record<string, string | undefined>): { token?: string; notice?: string } {
  const raw = (agent.options.mcp as { token?: unknown } | undefined)?.token
  if (typeof raw === "string") {
    const token = raw.match(/^\{env:([A-Za-z_][A-Za-z0-9_]*)\}$/) ? env[raw.slice(5, -1)] : raw
    if (token) registerSecret(token)
    return { token }
  }
  const url = agent.mcp?.url
  if (!url || isLoopback(url)) return { token: url ? env.OCLITE_MCP_TOKEN : undefined }
  return { notice: `transport: mcp agent ${agent.name}: ${redactUrl(url)} is not loopback, so OCLITE_MCP_TOKEN is not sent (set mcp.token in the agent)` }
}

/** A stdio child's env: the parent's minus OCLITE_MCP_TOKEN (the child serves stdio; it needs no bearer token). */
export function childEnv(env: Record<string, string | undefined>, depth: number): Record<string, string> {
  // Trust reaches a child only as an explicit --trust-project after re-checking the project hash (see spawn).
  const entries = Object.entries(env).filter((entry): entry is [string, string] =>
    entry[0] !== "OCLITE_MCP_TOKEN" && entry[0] !== "OCLITE_TRUST_PROJECT" && entry[1] !== undefined)
  return { ...Object.fromEntries(entries), OCLITE_DEPTH: String(depth) }
}

/** The reminder for a background child that finished since the parent's last turn. */
export function notice(info: SubagentInfo) {
  const verb = info.state === "completed" ? "completed" : "failed"
  return envelope(info, `Background task ${verb}: ${info.description}`)
}

function truncate(text: string) {
  return text.length > ENVELOPE_CHARS ? `${text.slice(0, ENVELOPE_CHARS)}…[truncated]` : text
}

function outcome(result: RunResult): Partial<SubagentInfo> {
  return {
    state: result.state,
    result: result.text,
    error: result.error,
    step: result.turns,
    tokens: result.usage,
  }
}

function fail(message: string) {
  return Effect.fail(new SpawnError({ message }))
}
