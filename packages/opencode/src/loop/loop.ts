// Server-side port of the loop engine that used to live entirely in
// cli/cmd/loop.ts. That version kept state in an in-process Map, so
// list/pause/resume/cancel only worked from the process that started the
// loop and the TUI had no visibility into it at all. This service owns loop
// state for the life of the server instead, so any client (CLI or TUI) can
// see and control any loop.
import path from "path"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { EventV2 } from "@opencode-ai/core/event"
import { withStatics } from "@opencode-ai/core/schema"
import { AbortedError, SessionV1 } from "@opencode-ai/core/v1/session"
import { Cause, Context, Deferred, Effect, Layer, Ref, Result, Schema, Scope } from "effect"
import { EventV2Bridge } from "@/event-v2-bridge"
import { Identifier } from "@/id/id"
import { SessionPrompt } from "@/session/prompt"
import { SessionID } from "@/session/schema"
import { Session } from "@/session/session"
import { SessionStatus } from "@/session/status"
import { Config } from "@/config/config"
import { Provider } from "@/provider/provider"
import { baseURLOf, parentCapacity } from "@/local/placement"
import { PermissionV1 } from "@opencode-ai/core/v1/permission"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"

import { buildBrief, type Gate } from "./spec-queue/brief"
import {
  evaluateCommit,
  evaluateImplement,
  evaluateTest,
  evaluateVerify,
  GateFailureLimit,
  type Exec,
  type GateOptions,
} from "./spec-queue/gates"
import {
  cursor,
  nearbyOpenspecRepos,
  quarantine,
  resolveQueue,
  unquarantine,
  type QueueChange,
} from "./spec-queue/queue"
import { QueueDenyRules, withoutCredentials } from "./spec-queue/authority"

import { contractPart, DEFAULT_COMPLETION_TOKEN, matchesCompletion, promptDisablesCompletion } from "./completion"

export const COMPLETE_SIGNAL = DEFAULT_COMPLETION_TOKEN

export const DefaultMaxIterations = 50
export const DefaultNoProgressLimit = 3
export const DefaultIntervalSeconds = 2
// Keep at most this many IterationInfo entries in the state payload.
// After this cap the full count is still tracked via info.iteration.
// Without a cap the iterations array grows to thousands of entries, making
// every emit() serialize O(N²) total data over a loop's lifetime.
const MaxStoredIterations = 50

// Consecutive-iteration output comparison uses this as "near-identical" —
// see the skein incident referenced in design.md: a promise token that never
// arrives must not be the only way a loop stops.
const NoProgressSimilarityThreshold = 0.92

export const LoopID = Schema.String.check(Schema.isStartsWith("loop")).pipe(
  Schema.brand("LoopID"),
  withStatics((s) => ({
    ascending: (id?: string) => s.make(Identifier.ascending("loop", id)),
  })),
)
export type LoopID = Schema.Schema.Type<typeof LoopID>

export const Status = Schema.Literals([
  "running",
  "paused",
  "completed",
  "stalled",
  "cancelled",
  "max_reached",
  "error",
])
export type Status = Schema.Schema.Type<typeof Status>

export const IterationInfo = Schema.Struct({
  iteration: Schema.Int,
  sessionID: SessionID,
  toolCalls: Schema.Int,
  outputLength: Schema.Int,
  complete: Schema.Boolean,
  // True when the iteration was skipped because the target session already
  // had a running turn (foreign-turn guard) — no prompt was sent.
  skipped: Schema.optional(Schema.Boolean),
  startedAt: Schema.Finite,
  finishedAt: Schema.Finite,
})
export type IterationInfo = Schema.Schema.Type<typeof IterationInfo>

export const Mode = Schema.Literals(["prompt", "queue"])
export type Mode = Schema.Schema.Type<typeof Mode>

export const Info = Schema.Struct({
  id: LoopID,
  directory: Schema.String,
  sessionID: SessionID,
  parentSessionID: Schema.optional(SessionID),
  prompt: Schema.String,
  status: Status,
  maxIterations: Schema.Int,
  interval: Schema.optional(Schema.Finite),
  noProgressLimit: Schema.Int,
  completionToken: Schema.String,
  iteration: Schema.Int,
  iterations: Schema.Array(IterationInfo),
  // The most recent iteration's child session. Iterations run in fresh child
  // sessions of `sessionID` so context never accumulates across iterations;
  // this is the handle a client needs to navigate to (or abort) the turn
  // that is actually executing.
  iterationSessionID: Schema.optional(SessionID),
  mode: Schema.optional(Mode),
  // Queue mode progress for UI: the change being worked and its gate.
  currentChange: Schema.optional(Schema.String),
  currentGate: Schema.optional(Schema.String),
  // End-of-run report for queue mode (design D7).
  report: Schema.optional(Schema.String),
  startedAt: Schema.Finite,
  lastRunAt: Schema.optional(Schema.Finite),
  finishedAt: Schema.optional(Schema.Finite),
}).annotate({ identifier: "Loop" })
export type Info = Schema.Schema.Type<typeof Info>

export const CreateInput = Schema.Struct({
  prompt: Schema.String,
  sessionID: Schema.optional(SessionID),
  maxIterations: Schema.optional(Schema.Int),
  interval: Schema.optional(Schema.Finite),
  noProgressLimit: Schema.optional(Schema.Int),
  completionToken: Schema.optional(Schema.String),
  // Queue mode (loop-spec-queue): the unit of work is an openspec change,
  // not the prompt string. `queue` restricts and orders the changes; empty
  // means every eligible change under openspec/changes/.
  mode: Schema.optional(Mode),
  queue: Schema.optional(Schema.mutable(Schema.Array(Schema.String))),
  // Optional standing instruction repeated on every iteration of a queue run.
  // Steers how the work is done; never what work is chosen.
  queueGuidance: Schema.optional(Schema.String),
  // Tracker sync after a change completes. Off by default: writing to
  // GitHub/beads is an outward-facing side effect an unattended run must not
  // take unless asked. When on, a dry run is executed and logged first.
  queueSync: Schema.optional(Schema.Boolean),
  // Gate command overrides. Defaults: `bun test`, `bun run typecheck`, and
  // the default branch detected from origin/HEAD (fallback "main").
  queueOptions: Schema.optional(
    Schema.Struct({
      testCommand: Schema.optional(Schema.String),
      verifyCommand: Schema.optional(Schema.String),
      defaultBranch: Schema.optional(Schema.String),
      // Directory the gate commands run in. Defaults to the loop's directory
      // (the repo root), which is wrong for repos whose test runner must be
      // invoked from a package directory — this repo's root `test` script is
      // literally `exit 1`, so a root-run gate can never pass here.
      cwd: Schema.optional(Schema.String),
    }),
  ),
})
export type CreateInput = Schema.Schema.Type<typeof CreateInput>

export const Event = {
  Updated: EventV2.define({
    type: "loop.updated",
    schema: { loop: Info },
  }),
}

export class QueueActiveError extends Schema.TaggedErrorClass<QueueActiveError>()("LoopQueueActiveError", {
  activeLoopID: LoopID,
  directory: Schema.String,
}) {}

export interface Interface {
  readonly create: (input: CreateInput) => Effect.Effect<Info, QueueActiveError>
  readonly list: (input?: { directory?: string }) => Effect.Effect<Info[]>
  readonly get: (id: LoopID) => Effect.Effect<Info | undefined>
  readonly pause: (id: LoopID) => Effect.Effect<boolean>
  readonly resume: (id: LoopID) => Effect.Effect<boolean>
  readonly cancel: (id: LoopID) => Effect.Effect<boolean>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Loop") {}

// similarity lives in ./similarity (import-free module) so session/prompt.ts
// can use it WITHOUT importing this module — this file imports SessionPrompt,
// and a prompt.ts -> loop.ts import is a cycle that leaves SessionPrompt.node
// undefined in the LayerNode.make() call below (boot crash, black TUI).
// Re-exported for existing callers.
export { similarity } from "./similarity"
import { similarity } from "./similarity"
export { continuationPrompt, type PreviousOutcome } from "./continuation"
import { continuationPrompt, type PreviousOutcome } from "./continuation"

function promptHead(prompt: string) {
  const trimmed = prompt.trim()
  return trimmed.length > 40 ? trimmed.slice(0, 40) + "…" : trimmed
}

type QueueGateConfig = {
  cwd?: string
  test_command?: string
  verify_command?: string
  default_branch?: string
}

type ChangeOutcome = {
  slug: string
  outcome: "completed" | "quarantined"
  gate: Gate
  iterations: number
  cause?: string
}

type QueueState = {
  only?: readonly string[]
  guidance?: string
  sync?: boolean
  /** Gates that have passed at least once in this run — see the misconfiguration halt. */
  gatesPassed: Set<Gate>
  options?: CreateInput["queueOptions"]
  syncs: { slug: string; ok: boolean; output: string }[]
  outcomes: ChangeOutcome[]
  consecutiveQuarantines: number
  anyGatePassed: boolean
}

type Record_ = {
  info: Info
  queue?: QueueState
  lastOutput?: string
  // Shape of the previous iteration, feeding the adaptive continuation
  // prompt: a stalled or spinning iteration gets a directive nudge instead
  // of a verbatim re-send of the same prompt it just failed to act on.
  lastOutcome?: PreviousOutcome
  noProgressStreak: number
  // Present while paused. The run fiber blocks on it at zero cost instead of
  // polling; resume (or cancel) resolves it to wake the fiber immediately.
  pauseGate?: Deferred.Deferred<void>
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const session = yield* Session.Service
    const promptSvc = yield* SessionPrompt.Service
    const status = yield* SessionStatus.Service
    const events = yield* EventV2Bridge.Service
    const config = yield* Config.Service
    const provider = yield* Provider.Service
    const scope = yield* Scope.Scope

    const state = yield* Ref.make<Map<LoopID, Record_>>(new Map())

    const emit = (id: LoopID) =>
      Effect.gen(function* () {
        const record = (yield* Ref.get(state)).get(id)
        if (!record) return
        yield* events.publish(Event.Updated, { loop: record.info })
      })

    const patch = (id: LoopID, fn: (record: Record_) => Record_) =>
      Ref.modify(state, (map) => {
        const current = map.get(id)
        if (!current) return [undefined, map]
        const next = new Map(map)
        const updated = fn(current)
        next.set(id, updated)
        return [updated, next]
      })

    const runIteration = (
      record: Record_,
      override?: { promptText: string; title?: string; permission?: PermissionV1.Ruleset },
    ) =>
      Effect.gen(function* () {
        const iterationNumber = record.info.iteration + 1
        const startedAt = Date.now()
        // Iterations run in the loop's OWN session — the one you are looking
        // at — so the work appears as ordinary turns and any subagents it
        // spawns appear as ordinary subagent parts.
        //
        // They used to run in a fresh child session each time, for a clean
        // context window per iteration. That traded away the thing that matters
        // more: work you cannot see is work you cannot supervise, and an
        // unattended run looked like it was doing nothing at all. Context
        // growth is what compaction is for.
        //
        // Foreign-turn guard: the loop session is shared across iterations, so
        // if a turn is already running there, prompting would make
        // ensureRunning JOIN it and attribute someone else's output to this
        // iteration. Skip instead.
        const targetSessionID = record.info.sessionID
        {
          const busy = yield* status.get(targetSessionID).pipe(Effect.orElseSucceed(() => undefined))
          if (busy?.type === "busy") {
            return {
              iteration: iterationNumber,
              sessionID: targetSessionID,
              toolCalls: 0,
              outputLength: 0,
              output: "",
              complete: false,
              error: false,
              aborted: false,
              skipped: true,
              startedAt,
              finishedAt: Date.now(),
            }
          }
        }
        // Recorded before prompting so cancel() aborts the turn running now.
        yield* patch(record.info.id, (current) => ({
          ...current,
          info: { ...current.info, iterationSessionID: targetSessionID },
        }))
        yield* emit(record.info.id)
        // The user's prompt stays the base (possibly with a directive
        // prepended when the previous iteration stalled or spun); the
        // contract is a separate trailing part so the model is actually told
        // the token it is expected to emit. Injected per iteration rather
        // than into the system prompt so the iteration counter stays
        // accurate and no non-loop session ever sees it.
        const promptText = override?.promptText ?? continuationPrompt(record.info.prompt, record.lastOutcome)
        const outcome = yield* promptSvc
          .prompt({
            sessionID: targetSessionID,
            parts: [
              { type: "text", text: promptText },
              {
                type: "text",
                text: contractPart(record.info.completionToken, iterationNumber, record.info.maxIterations),
              },
            ],
          })
          .pipe(Effect.result)
        const finishedAt = Date.now()

        if (Result.isFailure(outcome)) {
          return {
            iteration: iterationNumber,
            sessionID: targetSessionID,
            toolCalls: 0,
            outputLength: 0,
            output: "",
            complete: false,
            error: true,
            aborted: false,
            skipped: false,
            startedAt,
            finishedAt,
          }
        }

        const message = outcome.success
        // Count tool calls across the WHOLE turn, not just the message the
        // prompt returns. `promptSvc.prompt` resolves to the LAST assistant
        // message, so a multi-step turn (tools in step 1, prose in step 4)
        // reported 0 tool calls — observed on a real run that had just deleted
        // four files. That number feeds the no-progress guard, so undercounting
        // it scores productive work as a stall.
        //
        // The loop session is shared across iterations now, so this turn's tool
        // calls are the assistant messages created since it started.
        const turnMessages = yield* session
          .messages({ sessionID: targetSessionID })
          .pipe(Effect.orElseSucceed(() => [] as SessionV1.WithParts[]))
        const boundary = startedAt
        const countedTools = turnMessages
          .filter((item) => item.info.role === "assistant" && (item.info.time?.created ?? 0) >= boundary)
          .reduce((total, item) => total + item.parts.filter((part) => part.type === "tool").length, 0)
        // Never report fewer than the returned message alone shows (defensive:
        // a messages() failure must not turn a real tool call into a stall).
        const lastMessageTools = message.parts.filter((part) => part.type === "tool").length
        const toolCalls = Math.max(countedTools, lastMessageTools)
        const output = message.parts
          .filter((part) => part.type === "text")
          .map((part) => part.text)
          .join("")

        // A user interrupt (TUI escape → session.abort) finalizes the iteration's
        // assistant message with AbortedError and returns it normally. Without
        // this the loop would treat an aborted turn as "no progress" and fire
        // the next iteration — making it impossible to stop from the session.
        const aborted = message.info.role === "assistant" && AbortedError.isInstance(message.info.error)

        return {
          iteration: iterationNumber,
          sessionID: targetSessionID,
          toolCalls,
          outputLength: output.length,
          output,
          complete: matchesCompletion(output, record.info.completionToken, promptText),
          error: false,
          aborted,
          skipped: false,
          startedAt,
          finishedAt,
        }
      })

    // Cancel is checked every 500ms of sleep instead of once per full
    // interval, so `cancel` reliably takes effect within ~500ms even when
    // the loop is mid-interval on a long --interval.
    const waitBetween = (id: LoopID, ms: number) =>
      Effect.gen(function* () {
        let remaining = ms
        while (remaining > 0) {
          const chunk = Math.min(500, remaining)
          yield* Effect.sleep(`${chunk} millis`)
          remaining -= chunk
          const record = (yield* Ref.get(state)).get(id)
          if (!record || record.info.status !== "running") return
        }
      })

    // Terminal statuses are sticky: once a loop is cancelled (or completed,
    // stalled, …) a slower path finishing later must not rewrite the outcome
    // or its finishedAt — a user-cancelled loop reported as "completed" is a
    // lie about what happened.
    const isTerminal = (status: Status) => status !== "running" && status !== "paused"

    const finalize = (id: LoopID, status: Status) =>
      Effect.gen(function* () {
        const current = (yield* Ref.get(state)).get(id)
        if (!current || isTerminal(current.info.status)) return
        yield* patch(id, (record) => ({
          ...record,
          info: { ...record.info, status, finishedAt: Date.now() },
        }))
        yield* emit(id)
      })

    const run = (id: LoopID): Effect.Effect<void> =>
      Effect.gen(function* () {
        while (true) {
          const record = (yield* Ref.get(state)).get(id)
          if (!record) return
          if (record.info.status === "paused") {
            // Block on the gate instead of polling — zero cost while paused,
            // woken instantly by resume() or cancel(). The sleep fallback
            // only covers a record paused without a gate (not a state
            // pause() can produce; defensive against direct patches).
            if (record.pauseGate) yield* Deferred.await(record.pauseGate)
            else yield* Effect.sleep("500 millis")
            continue
          }
          // Any other non-running status (cancelled, completed, stalled,
          // max_reached, error) means a terminal transition already
          // happened elsewhere — nothing left for this fiber to do.
          if (record.info.status !== "running") return

          const iterationNumber = record.info.iteration + 1
          if (iterationNumber > record.info.maxIterations) {
            yield* finalize(id, "max_reached")
            return
          }

          const result = yield* runIteration(record)
          const updated = yield* patch(id, (current) => ({
            ...current,
            info: {
              ...current.info,
              iteration: result.iteration,
              iterationSessionID: result.sessionID,
              lastRunAt: result.finishedAt,
              // Cap the stored history to MaxStoredIterations to prevent the
              // iterations array from growing unboundedly. The true count is
              // always available via info.iteration.
              iterations: [
                ...current.info.iterations,
                {
                  iteration: result.iteration,
                  sessionID: result.sessionID,
                  toolCalls: result.toolCalls,
                  outputLength: result.outputLength,
                  complete: result.complete,
                  skipped: result.skipped ? true : undefined,
                  startedAt: result.startedAt,
                  finishedAt: result.finishedAt,
                },
              ].slice(-MaxStoredIterations),
            },
          }))
          if (!updated) return
          yield* emit(id)

          if (result.error) {
            yield* finalize(id, "error")
            return
          }
          if (result.aborted) {
            // User interrupted the iteration's turn — stop the loop rather
            // than grinding on.
            yield* finalize(id, "cancelled")
            return
          }
          if (result.complete) {
            yield* finalize(id, "completed")
            return
          }

          const limit = updated.info.noProgressLimit
          const noToolCalls = result.toolCalls === 0
          const nearIdentical =
            updated.lastOutput !== undefined &&
            similarity(result.output, updated.lastOutput) >= NoProgressSimilarityThreshold
          const streak =
            noToolCalls && (updated.noProgressStreak === 0 || nearIdentical) ? updated.noProgressStreak + 1 : 0

          yield* patch(id, (current) => ({
            ...current,
            lastOutput: result.output,
            lastOutcome: {
              toolCalls: result.toolCalls,
              outputLength: result.outputLength,
              wasNearIdentical: nearIdentical,
            },
            noProgressStreak: streak,
          }))

          if (limit > 0 && streak >= limit) {
            yield* finalize(id, "stalled")
            return
          }

          if (result.iteration >= updated.info.maxIterations) {
            yield* finalize(id, "max_reached")
            return
          }

          yield* waitBetween(id, (updated.info.interval ?? DefaultIntervalSeconds) * 1000)
        }
      })

    // ── queue mode (loop-spec-queue) ────────────────────────────────────

    // Authority ceiling for unattended queue runs (design D4): edit, test,
    // verify, commit locally; never push, tag, publish, release, or deploy.
    // Enforced by the permission layer — tools.ts evaluates deny rules
    // before the auto-mode skip, so auto mode cannot void this.
    // Gate evaluator commands run with a hard wall-clock cap so a wedged
    // test runner cannot park the queue driver — the same disease the
    // stream watchdog cures on the provider side.
    const ExecTimeoutMs = 20 * 60 * 1000
    const execIn =
      (cwd: string): Exec =>
      async (command) => {
        const proc = Bun.spawn(["bash", "-lc", command], {
          cwd,
          stdout: "pipe",
          stderr: "pipe",
          env: { ...process.env },
        })
        const timer = setTimeout(() => proc.kill(), ExecTimeoutMs)
        try {
          const [out, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()])
          const code = await proc.exited
          return {
            code,
            output: [out, err].filter(Boolean).join("\n").slice(-20_000),
          }
        } finally {
          clearTimeout(timer)
        }
      }

    // Gate commands resolve per-loop options first, then the repo's
    // `experimental.queue_gate` config, then built-in defaults. The config
    // layer exists for the TUI: typing `--test-command "…" --gate-cwd …` into
    // a prompt box every time is not a workflow, and the built-in default
    // (`bun test` at the repo root) is wrong for any repo that refuses to run
    // tests from the root — this one included.
    const gateOptions = (exec: Exec, overrides?: CreateInput["queueOptions"]) =>
      Effect.gen(function* () {
        const cfg = yield* config.get().pipe(Effect.orElseSucceed(() => ({}) as never))
        const fromConfig = (cfg as { experimental?: { queue_gate?: QueueGateConfig } }).experimental?.queue_gate
        return yield* Effect.promise(async (): Promise<GateOptions> => {
          const detect = async () => {
            const head = await exec("git symbolic-ref --short refs/remotes/origin/HEAD")
            return head.code === 0 && head.output.trim() ? head.output.trim().replace(/^origin\//, "") : "main"
          }
          return {
            testCommand: overrides?.testCommand ?? fromConfig?.test_command ?? "bun test",
            verifyCommand: overrides?.verifyCommand ?? fromConfig?.verify_command ?? "bun run typecheck",
            defaultBranch: overrides?.defaultBranch ?? fromConfig?.default_branch ?? (await detect()),
          }
        })
      })

    /** Resolved gate working directory: per-loop, then config, then the repo root. */
    const gateCwd = (record: Record_ | undefined) =>
      Effect.gen(function* () {
        const cfg = yield* config.get().pipe(Effect.orElseSucceed(() => ({}) as never))
        const fromConfig = (cfg as { experimental?: { queue_gate?: QueueGateConfig } }).experimental?.queue_gate
        const base = record?.info.directory ?? process.cwd()
        const configured = record?.queue?.options?.cwd ?? fromConfig?.cwd
        if (!configured) return base
        // A relative cwd is relative to the REPO, not to wherever the server
        // process happens to have been started — `"packages/opencode"` in a
        // config file has to mean the obvious thing.
        return path.isAbsolute(configured) ? configured : path.resolve(base, configured)
      })

    // Idle local peers for the brief's fan-out nudge (design D9). Only
    // providers with a local baseURL are probed; errors read as "not idle".
    const idlePeers = Effect.gen(function* () {
      const cfg = yield* config.get().pipe(Effect.orElseSucceed(() => ({}) as never))
      if (
        (cfg as { experimental?: { local_subagent_placement?: boolean } }).experimental?.local_subagent_placement ===
        false
      )
        return [] as string[]
      const providers = yield* provider.list().pipe(Effect.orElseSucceed(() => ({}) as Record<string, Provider.Info>))
      const local = Object.entries(providers).filter(([, info]) => baseURLOf(info) !== undefined)
      const idle: string[] = []
      for (const [id] of local) {
        const capacity = yield* Effect.promise(() =>
          parentCapacity({
            parent: { providerID: ProviderV2.ID.make(id), modelID: ModelV2.ID.make("probe") },
            providers,
            timeoutMs: 1_000,
          }),
        ).pipe(Effect.orElseSucceed(() => "unknown" as const))
        if (capacity === "free") idle.push(id)
      }
      return idle
    })

    const buildReport = (queue: QueueState, ending: string) => {
      const lines: string[] = [`# Queue run report`, "", `Ending: ${ending}`, ""]
      if (queue.outcomes.length === 0) lines.push("No changes were attempted.")
      for (const outcome of queue.outcomes) {
        lines.push(
          `- ${outcome.slug}: ${outcome.outcome}` +
            ` (gate reached: ${outcome.gate}, iterations: ${outcome.iterations})` +
            (outcome.cause ? ` — ${outcome.cause}` : ""),
        )
      }
      if (queue.syncs.length > 0) {
        lines.push("", "Tracker sync (--sync):")
        for (const item of queue.syncs) lines.push(`- ${item.slug}: ${item.ok ? "synced" : "sync failed"}`)
      }
      lines.push("", "Nothing was pushed. Branches with commits are awaiting your review and push.")
      return lines.join("\n")
    }

    const finishQueue = (id: LoopID, status: Status, ending: string) =>
      Effect.gen(function* () {
        const record = (yield* Ref.get(state)).get(id)
        if (!record?.queue) return
        yield* patch(id, (current) => ({
          ...current,
          info: { ...current.info, report: buildReport(current.queue!, ending) },
        }))
        yield* finalize(id, status)
      })

    // One model turn inside a queue run. Iteration bookkeeping matches run():
    // the child session is recorded before prompting so cancel targets it.
    const queueTurn = (id: LoopID, change: QueueChange, gate: Gate, failure?: { gate: Gate; output: string }) =>
      Effect.gen(function* () {
        const record = (yield* Ref.get(state)).get(id)
        if (!record) return undefined
        const peers = yield* idlePeers
        const brief = buildBrief({ change, gate, failure, idlePeers: peers, guidance: record.queue?.guidance })
        const result = yield* runIteration(record, { promptText: brief, permission: QueueDenyRules })
        yield* patch(id, (current) => ({
          ...current,
          info: {
            ...current.info,
            iteration: result.iteration,
            iterationSessionID: result.sessionID,
            lastRunAt: result.finishedAt,
            iterations: [
              ...current.info.iterations,
              {
                iteration: result.iteration,
                sessionID: result.sessionID,
                toolCalls: result.toolCalls,
                outputLength: result.outputLength,
                complete: result.complete,
                skipped: result.skipped ? true : undefined,
                startedAt: result.startedAt,
                finishedAt: result.finishedAt,
              },
            ].slice(-MaxStoredIterations),
          },
        }))
        yield* emit(id)
        return result
      })

    const BLOCKED_TOKEN = "<promise>BLOCKED</promise>"

    const runQueue = (id: LoopID): Effect.Effect<void> =>
      Effect.gen(function* () {
        const initial = (yield* Ref.get(state)).get(id)
        const exec = execIn(yield* gateCwd(initial))
        // The spec requires the resolved order be reported before the first
        // iteration: an unattended run is only auditable if you can see what it
        // decided to work, and in what order, up front.
        if (initial) {
          const first = resolveQueue(initial.info.directory, initial.queue?.only)
          // "Nothing eligible" and "this is not an openspec repo" are the same
          // empty queue but completely different situations. Reporting the
          // second as a drained backlog tells someone their work is done when
          // in fact nothing was ever found — most likely because the run was
          // started in a workspace directory rather than in a repo.
          if (!first.hasOpenspec) {
            const nearby = nearbyOpenspecRepos(initial.info.directory)
            yield* finishQueue(
              id,
              "error",
              `no openspec/changes directory in ${initial.info.directory} — nothing was attempted.` +
                (nearby.length > 0
                  ? ` These subdirectories are openspec repos, start the run inside one of them: ${nearby.join(", ")}`
                  : " Start the run from a repository that has an openspec/changes directory."),
            )
            return
          }
          yield* Effect.logInfo("queue resolved", {
            "queue.order": first.eligible.map((c) => c.slug).join(", ") || "(nothing eligible)",
            "queue.quarantined": first.quarantined.join(", ") || "(none)",
            "queue.complete": first.complete.join(", ") || "(none)",
          })
        }
        const options = yield* gateOptions(exec, initial?.queue?.options)

        const running = () =>
          Effect.gen(function* () {
            while (true) {
              const record = (yield* Ref.get(state)).get(id)
              if (!record) return undefined
              if (record.info.status === "paused") {
                if (record.pauseGate) yield* Deferred.await(record.pauseGate)
                else yield* Effect.sleep("500 millis")
                continue
              }
              if (record.info.status !== "running") return undefined
              return record
            }
          })

        while (true) {
          const record = yield* running()
          if (!record?.queue) return
          const queueState = record.queue

          // The queue is re-resolved from disk every time a change is chosen
          // (design D1/D8): restarts resume, mid-run additions join, and a
          // drained resolution is the only clean ending.
          const resolved = resolveQueue(record.info.directory, queueState.only)
          const change = cursor(resolved)
          if (!change) {
            yield* finishQueue(id, "completed", "queue drained — every change is complete or quarantined")
            return
          }

          yield* patch(id, (current) => ({
            ...current,
            info: { ...current.info, currentChange: change.slug, currentGate: "implement" },
          }))
          yield* emit(id)

          // Work this change through its gates until it completes, is
          // quarantined, or the loop leaves "running".
          let gate: Gate = "implement"
          let failure: { gate: Gate; output: string } | undefined
          const failCounts: Partial<Record<Gate, number>> = {}
          let iterations = 0
          // Object property rather than a let: quarantineNow mutates it from
          // inside an Effect closure, which TS flow narrowing cannot see.
          const ending: {
            outcome: "completed" | "quarantined" | "stopped"
            cause?: string
            gate?: Gate
            detail?: string
          } = {
            outcome: "stopped",
          }

          const quarantineNow = (why: string, detail: string, byGate?: Gate) =>
            Effect.sync(() => {
              quarantine(change, { cause: why, detail })
              ending.outcome = "quarantined"
              ending.cause = why
              ending.gate = byGate
              ending.detail = detail
            })

          change: while (true) {
            const live = yield* running()
            if (!live) return

            if (iterations >= live.info.maxIterations) {
              yield* quarantineNow(
                `max_reached: ${live.info.maxIterations} iterations without completing`,
                failure?.output ?? "",
              )
              break change
            }

            yield* patch(id, (current) => ({
              ...current,
              info: { ...current.info, currentGate: gate },
            }))

            const fail = (which: Gate, output: string) =>
              Effect.gen(function* () {
                failCounts[which] = (failCounts[which] ?? 0) + 1
                failure = { gate: which, output }
                if ((failCounts[which] ?? 0) >= GateFailureLimit) {
                  yield* quarantineNow(`${which} gate failed ${GateFailureLimit}x consecutively`, output, which)
                  return true
                }
                // Any gate failure returns to implement with the output as
                // context (design D3) — a failing test usually means the
                // implementation is wrong.
                gate = "implement"
                return false
              })

            switch (gate) {
              case "implement": {
                // A downstream gate (test/verify/commit) that failed sends us
                // back here to REPAIR, and repair always costs a model turn.
                // Short-circuiting on "all checkboxes are still checked" would
                // re-pass instantly and burn every strike without the model
                // ever seeing the failure — observed on the first real
                // unattended run, where three test-gate failures quarantined a
                // finished change with zero repair attempts.
                if (failure) {
                  const repairing = failure
                  iterations += 1
                  const attempt = yield* queueTurn(id, change, "implement", repairing)
                  if (!attempt) return
                  if (attempt.aborted) {
                    yield* finishQueue(id, "cancelled", "cancelled by user")
                    return
                  }
                  if (matchesCompletion(attempt.output, BLOCKED_TOKEN, "")) {
                    yield* quarantineNow("model signalled BLOCKED", attempt.output.slice(-2_000))
                    break change
                  }
                  // Re-run the gate that failed; its own strike counter decides
                  // when repair attempts have been exhausted.
                  gate = repairing.gate
                  failure = undefined
                  continue
                }
                const check = evaluateImplement(change)
                if (check.passed) {
                  failCounts.implement = 0
                  gate = "test"
                  queueState.anyGatePassed = true
                  queueState.gatesPassed.add("implement")
                  continue
                }
                iterations += 1
                const result = yield* queueTurn(id, change, "implement", failure)
                if (!result) return
                if (result.aborted) {
                  yield* finishQueue(id, "cancelled", "cancelled by user")
                  return
                }
                if (result.error) {
                  if (yield* fail("implement", "iteration failed: the model turn ended in an error")) break change
                  continue
                }
                if (matchesCompletion(result.output, BLOCKED_TOKEN, "")) {
                  yield* quarantineNow("model signalled BLOCKED", result.output.slice(-2_000))
                  break change
                }
                const after = evaluateImplement(change)
                if (after.passed) {
                  failCounts.implement = 0
                  failure = undefined
                  gate = "test"
                  queueState.anyGatePassed = true
                  queueState.gatesPassed.add("implement")
                } else {
                  // Completion-claim verification (design D2): a token with
                  // unchecked boxes is a false claim; say so explicitly.
                  const claimed = result.complete
                  const detail = claimed
                    ? `You signalled completion, but verification failed: ${after.output}`
                    : after.output
                  if (yield* fail("implement", detail)) break change
                }
                continue
              }
              case "test": {
                const result = yield* Effect.promise(() => evaluateTest(exec, options))
                if (result.passed) {
                  failCounts.test = 0
                  gate = "verify"
                  queueState.anyGatePassed = true
                  queueState.gatesPassed.add("test")
                  continue
                }
                if (yield* fail("test", result.output)) break change
                continue
              }
              case "verify": {
                const result = yield* Effect.promise(() => evaluateVerify(exec, change, options))
                if (result.passed) {
                  failCounts.verify = 0
                  gate = "commit"
                  queueState.anyGatePassed = true
                  queueState.gatesPassed.add("verify")
                  continue
                }
                if (yield* fail("verify", result.output)) break change
                continue
              }
              case "commit": {
                const check = yield* Effect.promise(() => evaluateCommit(exec, change, options))
                if (check.passed) {
                  ending.outcome = "completed"
                  break change
                }
                iterations += 1
                const result = yield* queueTurn(id, change, "commit", { gate: "commit", output: check.output })
                if (!result) return
                if (result.aborted) {
                  yield* finishQueue(id, "cancelled", "cancelled by user")
                  return
                }
                const after = yield* Effect.promise(() => evaluateCommit(exec, change, options))
                if (after.passed) {
                  ending.outcome = "completed"
                  break change
                }
                if (yield* fail("commit", after.output)) break change
                continue
              }
            }
          }

          // Decide whether the gate that quarantined this change is itself
          // suspect BEFORE recording an outcome or leaving a blocker behind: a
          // command-backed gate that never passed once in the entire run is far
          // more likely misconfigured than proof the change is bad (observed:
          // `bun test` invoked from a repo root that refuses to run tests
          // there). Halting is only honest if it also un-poisons the change —
          // otherwise a config mistake blockers finished work forever.
          const suspectGate =
            ending.outcome === "quarantined" &&
            ending.gate !== undefined &&
            (ending.gate === "test" || ending.gate === "verify") &&
            !queueState.gatesPassed.has(ending.gate)
          if (suspectGate) {
            yield* Effect.sync(() => unquarantine(change))
            yield* finishQueue(
              id,
              "error",
              `suspected misconfigured ${ending.gate} gate: it never passed once this run, so ` +
                `"${change.slug}" was NOT quarantined (its blocker was removed). Check the command ` +
                `and its working directory (queueOptions.cwd / --gate-cwd). Verbatim output:\n` +
                (ending.detail ?? "").slice(-2_000),
            )
            return
          }
          queueState.outcomes.push({
            slug: change.slug,
            outcome: ending.outcome === "completed" ? "completed" : "quarantined",
            gate,
            iterations,
            cause: ending.cause,
          })
          // Tracker sync, opt-in only (--sync). A dry run goes first and both
          // are logged, so an unattended run can be audited for exactly what
          // it wrote outward. A sync failure never changes the change's
          // outcome: the work is done and committed either way.
          if (ending.outcome === "completed" && queueState.sync) {
            const dry = yield* Effect.promise(() => exec(`specsync -change ${change.slug} -dry-run`))
            yield* Effect.logInfo("queue sync dry run", {
              "change.slug": change.slug,
              code: dry.code,
              output: dry.output.slice(-2_000),
            })
            if (dry.code === 0) {
              const real = yield* Effect.promise(() => exec(`specsync -change ${change.slug}`))
              queueState.syncs.push({ slug: change.slug, ok: real.code === 0, output: real.output.slice(-2_000) })
            } else {
              queueState.syncs.push({ slug: change.slug, ok: false, output: `dry run failed:\n${dry.output}` })
            }
          }
          if (ending.outcome === "quarantined") {
            queueState.consecutiveQuarantines += 1
            // Systemic-failure guard (design D8): quarantine is for sick
            // changes, not a sick environment. Do not consume the backlog's
            // eligibility against a broken harness.
            if (queueState.consecutiveQuarantines >= 3 && !queueState.anyGatePassed) {
              yield* finishQueue(
                id,
                "error",
                "suspected systemic failure: 3 consecutive changes quarantined with no gate passing anywhere",
              )
              return
            }
          } else {
            queueState.consecutiveQuarantines = 0
          }

          yield* waitBetween(id, (record.info.interval ?? DefaultIntervalSeconds) * 1000)
        }
      })

    const create = (input: CreateInput) =>
      Effect.gen(function* () {
        const prompt = input.prompt.trim()
        const mode: Mode = input.mode ?? "prompt"
        const id = LoopID.ascending()
        const now = Date.now()
        let sessionID: SessionID
        let parentSessionID: SessionID | undefined
        let directory: string
        if (input.sessionID) {
          // Loop inside the caller's existing session. The lookup is only for
          // bookkeeping (directory scoping in `list`, parent link) — a missing
          // session must not block the loop; the iteration prompt surfaces the
          // real error if the session is truly gone.
          sessionID = input.sessionID
          const existing = yield* session.get(input.sessionID).pipe(Effect.orElseSucceed(() => undefined))
          parentSessionID = existing?.parentID
          directory = existing?.directory ?? ""
        } else {
          const parent = yield* session.create({
            title: mode === "queue" ? "loop: openspec queue" : `loop: ${promptHead(prompt)}`,
            // The queue's authority ceiling starts at the parent so even the
            // degraded no-child fallback path inherits it.
            permission: mode === "queue" ? [...QueueDenyRules] : undefined,
          })
          sessionID = parent.id
          parentSessionID = undefined
          directory = parent.directory
        }
        if (mode === "queue") {
          // Two queue loops over one directory would fight over the same
          // derived cursor and working tree (design D1) — refuse the second.
          const active = Array.from((yield* Ref.get(state)).values()).find(
            (record) =>
              record.info.mode === "queue" && record.info.directory === directory && !isTerminal(record.info.status),
          )
          if (active) {
            return yield* Effect.fail(new QueueActiveError({ activeLoopID: active.info.id, directory }))
          }
        }
        const completionToken = input.completionToken?.trim() || DEFAULT_COMPLETION_TOKEN
        // A token that already appears in the user's prompt cannot be told
        // apart from the model quoting its instructions back, so
        // matchesCompletion refuses to fire on it. Say so up front rather
        // than letting the loop silently run to max_reached.
        if (promptDisablesCompletion(prompt, completionToken))
          yield* Effect.logWarning(
            "loop prompt contains the completion token; token-based completion is disabled for this loop",
            { "loop.id": id, "loop.completionToken": completionToken },
          )
        const info: Info = {
          id,
          directory,
          sessionID,
          parentSessionID,
          prompt,
          status: "running",
          maxIterations: input.maxIterations ?? DefaultMaxIterations,
          interval: input.interval,
          noProgressLimit: input.noProgressLimit ?? DefaultNoProgressLimit,
          completionToken,
          mode,
          iteration: 0,
          iterations: [],
          startedAt: now,
        }
        yield* Ref.update(state, (map) =>
          new Map(map).set(id, {
            info,
            noProgressStreak: 0,
            queue:
              mode === "queue"
                ? {
                    only: input.queue?.length ? [...input.queue] : undefined,
                    guidance: input.queueGuidance,
                    sync: input.queueSync ?? false,
                    gatesPassed: new Set<Gate>(),
                    options: input.queueOptions,
                    syncs: [],
                    outcomes: [],
                    consecutiveQuarantines: 0,
                    anyGatePassed: false,
                  }
                : undefined,
          }),
        )
        yield* emit(id)
        // A defect escaping the driver (a missing service, a bug in an
        // iteration) would otherwise kill this fiber silently and leave the
        // loop stuck "running" forever with no way to observe why. Finalize
        // as "error" and log the cause instead.
        const driver = mode === "queue" ? runQueue(id) : run(id)
        yield* driver
          .pipe(
            Effect.catchCause((cause) =>
              Effect.gen(function* () {
                yield* Effect.logError("loop run fiber died", {
                  "loop.id": id,
                  cause: Cause.pretty(cause),
                })
                yield* finalize(id, "error")
              }),
            ),
          )
          .pipe(Effect.forkIn(scope))
        return info
      })

    const list = (input?: { directory?: string }) =>
      Effect.gen(function* () {
        const all = Array.from((yield* Ref.get(state)).values()).map((record) => record.info)
        if (!input?.directory) return all
        return all.filter((info) => info.directory === input.directory)
      })

    const get = (id: LoopID) => Ref.get(state).pipe(Effect.map((map) => map.get(id)?.info))

    const pause = (id: LoopID) =>
      Effect.gen(function* () {
        const record = (yield* Ref.get(state)).get(id)
        if (!record || record.info.status !== "running") return false
        const gate = yield* Deferred.make<void>()
        yield* patch(id, (current) => ({
          ...current,
          pauseGate: gate,
          info: { ...current.info, status: "paused" },
        }))
        yield* emit(id)
        return true
      })

    // The fiber forked by `create` never exits while status is "paused" — it
    // blocks on the pause gate (see `run`'s paused branch) — so resuming only
    // needs to flip the status and resolve the gate; no new fiber to fork.
    const resume = (id: LoopID) =>
      Effect.gen(function* () {
        const record = (yield* Ref.get(state)).get(id)
        if (!record || record.info.status !== "paused") return false
        const gate = record.pauseGate
        yield* patch(id, (current) => ({
          ...current,
          pauseGate: undefined,
          info: { ...current.info, status: "running" },
        }))
        yield* emit(id)
        if (gate) yield* Deferred.succeed(gate, undefined)
        return true
      })

    const cancel = (id: LoopID) =>
      Effect.gen(function* () {
        const record = (yield* Ref.get(state)).get(id)
        if (!record) return false
        if (record.info.status !== "running" && record.info.status !== "paused") return false
        const gate = record.pauseGate
        yield* patch(id, (current) => ({
          ...current,
          pauseGate: undefined,
          info: {
            ...current.info,
            status: "cancelled",
            finishedAt: Date.now(),
          },
        }))
        yield* emit(id)
        // A fiber parked on the pause gate must be woken so it can observe
        // the terminal status and exit — otherwise cancelling a paused loop
        // leaks its fiber until server shutdown.
        if (gate) yield* Deferred.succeed(gate, undefined)
        // Abort the in-flight turn, not just the loop bookkeeping: without
        // this, every cancel entry point except the TUI escape key (which
        // happens to also call session.abort) let the model turn run to
        // completion. Iterations run in child sessions, so target the
        // active child; fall back to the loop session for the degraded
        // no-child path.
        yield* promptSvc.cancel(record.info.iterationSessionID ?? record.info.sessionID)
        return true
      })

    return Service.of({ create, list, get, pause, resume, cancel })
  }),
)

export const defaultLayer = layer.pipe(
  Layer.provide(Session.defaultLayer),
  Layer.provide(SessionPrompt.defaultLayer),
  Layer.provide(SessionStatus.defaultLayer),
  Layer.provide(Config.defaultLayer),
  Layer.provide(Provider.defaultLayer),
  Layer.provide(EventV2Bridge.defaultLayer),
)

export const node = LayerNode.make(layer, [
  Session.node,
  SessionPrompt.node,
  SessionStatus.node,
  Config.node,
  Provider.node,
  EventV2Bridge.node,
])

export * as Loop from "./loop"
