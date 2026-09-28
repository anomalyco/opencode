// Sub-agent lifecycle (ARCHITECTURE §13): pending ──admit──► running ──► completed | failed | cancelled.
// ≤ max_concurrent running children per parent (extras wait pending), a depth limit, background completions
// queued for the parent's next turn boundary, and every child cancelled when its parent's run ends.
import { Deferred, Effect, Option } from "effect"
import {
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
import { renderOutput } from "../forked/task-contract"
import { validId } from "../session/store"
import { id } from "../util/paths"

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

export function make(deps: { start: RuntimeShape["start"]; store: SessionStoreShape; cfg: ResolvedConfig }): Manager {
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
      transport: "in-process",
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
      const started = yield* deps
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
        .pipe(Effect.result)
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
      if (agent.transport === "mcp") return yield* fail("transport: mcp arrives in phase 6")
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
          transport: "in-process",
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
  return renderOutput({ sessionID: info.id, state, summary, text: truncate(text) })
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
