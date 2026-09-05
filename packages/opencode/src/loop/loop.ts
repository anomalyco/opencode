// Server-side port of the loop engine that used to live entirely in
// cli/cmd/loop.ts. That version kept state in an in-process Map, so
// list/pause/resume/cancel only worked from the process that started the
// loop and the TUI had no visibility into it at all. This service owns loop
// state for the life of the server instead, so any client (CLI or TUI) can
// see and control any loop.
import path from "path"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { EventV2 } from "@opencode-ai/core/event"
import { statics } from "@opencode-ai/schema/schema"
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
import { Agent as AgentSvc } from "@/agent/agent"
import { deriveSubagentSessionPermission } from "@/agent/subagent-permissions"
import { Permission } from "@/permission"
import { describePeer, resolvePeers } from "@/session/peers"
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
import { AgentGates, readVerdict, resolvePersonas, type PersonaBindings } from "./spec-queue/personas"

import { contractPart, DEFAULT_COMPLETION_TOKEN, matchesCompletion, promptDisablesCompletion } from "./completion"

export const COMPLETE_SIGNAL = DEFAULT_COMPLETION_TOKEN

export const DefaultMaxIterations = 50
// fix-loop-stall: 10 was too low for complex tasks whose iterations produce
// structurally similar output (long file dumps, boilerplate) across several
// genuinely-progressing steps — raised to 15 so real progress has more room
// before the stall guard fires.
export const DefaultNoProgressLimit = 15
export const DefaultIntervalSeconds = 2
// Keep at most this many IterationInfo entries in the state payload.
// After this cap the full count is still tracked via info.iteration.
// Without a cap the iterations array grows to thousands of entries, making
// every emit() serialize O(N²) total data over a loop's lifetime.
const MaxStoredIterations = 50

// Consecutive-iteration output comparison uses this as "near-identical" —
// see the skein incident referenced in design.md: a promise token that never
// arrives must not be the only way a loop stops.
// fix-loop-stall: 0.92 false-positived on outputs that differ in small but
// meaningful ways (e.g. one changed line in a long file dump) — character
// bigrams over long, structurally-repetitive text (boilerplate, file
// contents) score high regardless of the actual edit. Raised to 0.96, and
// paired with MinOutputLengthChangeRatio below so a real heuristic — not
// just a higher magic number — catches the case a fixed threshold alone
// cannot: same length, same shape, genuinely different content.
const NoProgressSimilarityThreshold = 0.96
// fix-loop-stall: an output whose length differs from the previous
// iteration's by more than this fraction is treated as progress even when
// bigram similarity alone would call it near-identical — catches inserted/
// removed content that a pure character-bigram score under-weights in long
// output. 0 disables this heuristic; keep in [0, 1).
const MinOutputLengthChangeRatio = 0.1

export const LoopID = Schema.String.check(Schema.isStartsWith("loop")).pipe(
  Schema.brand("LoopID"),
  statics((s) => ({
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
  // loop-eternal-by-default: when true (the default) a plain-mode loop that
  // completes checks the openspec backlog before finalizing, and continues as
  // a queue run if planned work remains instead of stopping. false restores
  // the pre-existing stop-on-completion behavior exactly.
  eternal: Schema.Boolean,
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
  // Prompt mode only: continue into openspec backlog work on completion
  // instead of stopping (default: true). Ignored in queue mode, which is
  // already relentless by construction.
  eternal: Schema.optional(Schema.Boolean),
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
  // Push a completed change's branch. On by default: "done" means the work
  // left this machine, and a run that stops at a local commit has not finished
  // the job it was asked to do. Only the branch the commit gate already
  // enforced is pushed, never the default branch, and the model still cannot
  // push anything itself — the driver runs the one command.
  queuePush: Schema.optional(Schema.Boolean),
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
  /** Append a correction carried into every subsequent iteration. */
  readonly nudge: (id: LoopID, text: string) => Effect.Effect<boolean>
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
  push?: boolean
  syncs: { slug: string; ok: boolean; output: string }[]
  pushes: { slug: string; branch: string; ok: boolean; output: string }[]
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
  // Corrections given while the run is live (`/nudge`). Distinct from the
  // run's initial `--guidance`: guidance is the standing instruction it
  // started with, these arrived later because it was going the wrong way, and
  // they outrank it where the two conflict.
  //
  // Delivery is "append here". Both modes rebuild their prompt from this
  // record every iteration, so there is nothing to inject into a running turn
  // and nothing to race.
  steers: string[]
  // Present while paused. The run fiber blocks on it at zero cost instead of
  // polling; resume (or cancel) resolves it to wake the fiber immediately.
  pauseGate?: Deferred.Deferred<void>
  // loop-eternal-by-default: set once a prompt-mode loop has used its single
  // bounded reprieve on hitting the no-progress streak limit. Prevents an
  // unbounded retry — one extra, harder-worded iteration per loop lifetime,
  // never more.
  stallReprieve?: "pending" | "used"
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
    const agents = yield* AgentSvc.Service
    const permission = yield* Permission.Service
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
      override?: { promptText: string; sessionID?: SessionID },
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
        const targetSessionID = override?.sessionID ?? record.info.sessionID
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
        // Prompt mode gets the same corrections, appended rather than woven
        // in: the user's own prompt must stay recognisable as theirs, and a
        // correction that silently rewrote it would be impossible to audit.
        // `override` is the queue's brief, which already carries them.
        const base = override?.promptText ?? continuationPrompt(record.info.prompt, record.lastOutcome)
        const promptText =
          override || record.steers.length === 0
            ? base
            : [
                base,
                "",
                "Corrections from the operator, given while this run was already going.",
                "They override the instruction above wherever the two disagree:",
                "",
                ...record.steers.map((steer) => `- ${steer}`),
              ].join("\n")
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
          yield* Effect.logError("loop iteration prompt failed", {
            "loop.id": record.info.id,
            iteration: iterationNumber,
            failure: String(outcome.failure),
          })
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

        // A turn can also end in a *message-level* error without promptSvc.prompt()
        // itself failing — auth failure, context overflow, etc. all resolve as a
        // completed assistant message carrying `.info.error` (see SessionProcessor /
        // MessageV2.fromError) rather than propagating as an Effect failure. Left
        // undetected here, a turn like that reports 0 tool calls and empty output,
        // which similarity() deliberately scores as "not identical" for two empty
        // strings — so the no-progress streak below never builds (it keeps
        // resetting to 1) and a provider that is already known to be dead just
        // gets re-prompted every iteration up to maxIterations. Treat it the same
        // as the Effect-failure path: fail
        // the iteration outright instead of feeding the no-progress heuristic.
        const turnErrored = message.info.role === "assistant" && !!message.info.error && !aborted

        return {
          iteration: iterationNumber,
          sessionID: targetSessionID,
          toolCalls,
          outputLength: output.length,
          output,
          complete: matchesCompletion(output, record.info.completionToken, promptText),
          error: turnErrored,
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

          // loop-eternal-by-default: consume a pending stall reprieve for
          // exactly this one iteration. Flipped to "used" immediately so a
          // productive reprieve iteration does not leave the override text
          // applying to every iteration after it.
          const usingReprieve = record.stallReprieve === "pending"
          if (usingReprieve) {
            yield* patch(id, (current) => ({ ...current, stallReprieve: "used" }))
          }
          const result = yield* runIteration(
            record,
            usingReprieve
              ? {
                  promptText: [
                    "You appear stuck — no measurable progress for several iterations in a row.",
                    "Reassess from scratch: either make concrete, verifiable progress this turn, or",
                    "explain exactly what is blocking you. This is the last iteration before this",
                    "run gives up and reports stalled.",
                    "",
                    record.info.prompt,
                  ].join("\n"),
                }
              : undefined,
          )

          if (result.skipped) {
            // Foreign-turn guard tripped: the target session was busy with a
            // turn this loop did not start (the user's own message, or a
            // slow previous turn not yet settled), so no prompt was sent.
            // This must not consume the iteration budget or advance the
            // counter — doing so let a long in-flight generation burn the
            // whole run in `interval`-second ticks (2s default) before the
            // loop ever got to send its own first prompt, visibly racing
            // the counter to max_reached while the model was still
            // "thinking" on unrelated work.
            yield* patch(id, (current) => ({
              ...current,
              info: { ...current.info, lastRunAt: result.finishedAt },
            }))
            yield* waitBetween(id, (record.info.interval ?? DefaultIntervalSeconds) * 1000)
            continue
          }

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
          // fix-loop-stall: a length swing this large means real content was
          // added or removed — bigram similarity over long, structurally
          // repetitive output (file dumps, boilerplate) can still score high
          // in that case, so check length first and let it veto "identical."
          const lengthChanged =
            updated.lastOutput !== undefined &&
            Math.abs(result.output.length - updated.lastOutput.length) / Math.max(updated.lastOutput.length, 1) >
              MinOutputLengthChangeRatio
          const nearIdentical =
            !lengthChanged &&
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
            // loop-eternal-by-default: one bounded reprieve before giving up,
            // unless this loop already used it or opted out with eternal:false.
            // Never more than one per loop lifetime — stallReprieve only ever
            // moves pending -> used, and this branch requires "undefined".
            if (updated.info.eternal && record.stallReprieve === undefined) {
              yield* patch(id, (current) => ({ ...current, stallReprieve: "pending", noProgressStreak: 0 }))
              yield* waitBetween(id, (updated.info.interval ?? DefaultIntervalSeconds) * 1000)
              continue
            }
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

    // Other agents working in this directory. Unlike the tool, this runs
    // INSIDE the loop service, so it can see live loop state and does not have
    // to infer activity from session status alone.
    const activePeers = (callerID: SessionID, directory: string) =>
      Effect.gen(function* () {
        const [sessions, statuses, permissions, loops] = yield* Effect.all([
          session.list().pipe(Effect.orElseSucceed(() => [])),
          status.list().pipe(Effect.orElseSucceed(() => new Map())),
          permission.list().pipe(Effect.orElseSucceed(() => [])),
          Effect.map(Ref.get(state), (map) => [...map.values()].map((item) => item.info)),
        ])
        return resolvePeers({
          sessions: sessions.map((item) => ({
            id: item.id,
            parentID: item.parentID,
            directory: item.directory,
            title: item.title,
            agent: item.agent,
            model: item.model ? { providerID: item.model.providerID, id: item.model.id } : undefined,
            updatedAt: item.time.updated,
          })),
          statuses,
          pendingPermission: new Set(permissions.map((item) => item.sessionID)),
          loops: loops.map((item) => ({
            id: item.id,
            sessionID: item.sessionID,
            status: item.status,
            iteration: item.iteration,
          })),
          callerID,
          directory,
          now: Date.now(),
        }).map(describePeer)
      }).pipe(Effect.orElseSucceed(() => [] as string[]))

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
      if (queue.push === false) {
        lines.push("", "Push disabled (--no-push). Branches with commits are waiting for you.")
      } else if (queue.pushes.length > 0) {
        lines.push("", "Pushed:")
        for (const item of queue.pushes) {
          lines.push(`- ${item.slug}: ${item.ok ? `pushed ${item.branch}` : `push failed — ${item.output}`}`)
        }
        lines.push("", "Branches were pushed. Nothing was merged into the default branch.")
      } else {
        lines.push("", "Nothing reached the commit gate, so nothing was pushed.")
      }
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
    //
    // Retries internally on the foreign-turn guard (changeSessionID busy with
    // a turn this queue run didn't start) instead of returning the skipped
    // result to the caller — the 3 call sites treat a returned result as a
    // real gate attempt (toolCalls: 0, output: "" would read as a failing
    // turn and cost this change a strike), and the per-change `iterations`
    // counter they maintain must only count turns that actually ran.
    const queueTurn = (
      id: LoopID,
      change: QueueChange,
      gate: Gate,
      changeSessionID: SessionID,
      failure?: { gate: Gate; output: string },
      persona?: string,
    ) =>
      Effect.gen(function* () {
        while (true) {
          const record = (yield* Ref.get(state)).get(id)
          if (!record) return undefined
          const peers = yield* idlePeers
          const neighbours = yield* activePeers(changeSessionID, record.info.directory)
          const brief = buildBrief({
            change,
            gate,
            failure,
            idlePeers: peers,
            peers: neighbours,
            guidance: record.queue?.guidance,
            steers: record.steers,
            persona,
          })
          const result = yield* runIteration(record, { promptText: brief, sessionID: changeSessionID })

          if (result.skipped) {
            yield* patch(id, (current) => ({
              ...current,
              info: { ...current.info, lastRunAt: result.finishedAt },
            }))
            yield* waitBetween(id, (record.info.interval ?? DefaultIntervalSeconds) * 1000)
            if ((yield* Ref.get(state)).get(id)?.info.status !== "running") return undefined
            continue
          }

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
                  startedAt: result.startedAt,
                  finishedAt: result.finishedAt,
                },
              ].slice(-MaxStoredIterations),
            },
          }))
          yield* emit(id)
          return result
        }
      })

    const BLOCKED_TOKEN = "<promise>BLOCKED</promise>"

    // Gate → persona bindings, resolved once per run against the live agent
    // registry. Config missing entirely is the common case and must produce
    // defaults, not nothing.
    const personaBindings = Effect.gen(function* () {
      const cfg = yield* config.get().pipe(Effect.orElseSucceed(() => ({}) as never))
      const configured = (cfg as { experimental?: { queue_personas?: Record<string, string | false> } }).experimental
        ?.queue_personas
      const list = yield* agents.list().pipe(Effect.orElseSucceed(() => [] as { name: string }[]))
      return resolvePersonas(
        configured,
        list.map((item) => item.name),
      )
    })

    // A gate subagent decides whether work ships. It must not be able to change
    // that work, and that cannot be left to its persona file: config directories
    // are merged with `~/.opencode` scanned LAST, so skein's globally seeded
    // personas silently override a project's own — and only ever toward MORE
    // permission. Observed live: a project reviewer declaring `bash: deny`
    // resolved to `bash: allow` because ~/.opencode/agent/reviewer.md (a symlink
    // into ~/.skein/agents) said so, and the reviewer promptly wrote a file.
    //
    // So the gate states its own ceiling and does not ask the persona's opinion.
    const GateSubagentDenies: PermissionV1.Ruleset = ["bash", "write", "edit", "patch", "apply_patch"].map(
      (permission) => ({ permission, pattern: "*" as const, action: "deny" as const }),
    )

    /**
     * Run a gate whose verdict a subagent decides.
     *
     * The subagent gets its own child session under the running one, so its
     * parts render inline where the user is already looking, and its permission
     * ruleset is derived from its persona UNDER the run's authority ceiling —
     * the reviewer is denied write/edit by its own definition, and the run's
     * deny rules still apply on top.
     *
     * Any outcome that is not an unambiguous pass fails the gate. That is
     * deliberate: this is the last gate before `commit` in an unattended run,
     * and a crashed reviewer must never read as approval.
     */
    const runAgentGate = (
      gate: Gate,
      agentName: string,
      change: QueueChange,
      parentSessionID: SessionID,
      exec: Exec,
    ): Effect.Effect<{ passed: boolean; output: string }> =>
      Effect.gen(function* () {
        const persona = yield* agents.get(agentName).pipe(Effect.orElseSucceed(() => undefined))
        if (!persona) {
          return { passed: false, output: `the ${gate} gate is bound to "${agentName}", which is not a known agent` }
        }
        const parent = yield* session.get(parentSessionID).pipe(Effect.orElseSucceed(() => undefined))
        const child = yield* session
          .create({
            parentID: parentSessionID,
            title: `${gate}: ${agentName} on ${change.slug}`,
            // Order is load-bearing. Rules are evaluated last-match-wins
            // (Permission.evaluate uses findLast) and tools merge as
            // [agent rules, session rules], so whatever sits last here beats
            // everything before it.
            //
            // The persona's ruleset goes on the session WHOLE and in order, not
            // filtered to its denies: a read-only persona expresses itself as
            // `bash: {"*": deny, "git diff*": allow}`, and copying only the
            // deny would strand it with no bash at all.
            //
            // The derived ceiling goes LAST so it always wins — the parent's
            // deny rules (the queue's no-push authority) must not be
            // overridable by anything a persona says about itself.
            // Order is load-bearing: rules are last-match-wins
            // (Permission.evaluate uses findLast) and tools merge as
            // [agent rules, session rules], so whatever sits last here beats
            // everything before it. Persona first, then the parent's ceiling,
            // then the gate's own non-negotiable denies.
            permission: [
              ...persona.permission,
              ...deriveSubagentSessionPermission({
                parentSessionPermission: parent?.permission ?? [],
                subagent: persona,
              }),
              ...GateSubagentDenies,
            ],
          })
          .pipe(Effect.orElseSucceed(() => undefined))
        if (!child) return { passed: false, output: `could not start the ${agentName} subagent for the ${gate} gate` }

        const diff = yield* Effect.promise(() => exec("git diff HEAD"))
        // Status as well as diff: `git diff HEAD` does not show untracked
        // files, so a change whose entire contribution is a NEW file looks
        // empty to the reviewer. Observed on the first live run — the reviewer
        // saw only the tasks.md checkbox and correctly called it incomplete,
        // but for the wrong reason. It can read the files itself once it knows
        // they exist.
        const status = yield* Effect.promise(() => exec("git status --porcelain"))
        const brief = [
          `Review the work done on openspec change "${change.slug}" (${change.directory}).`,
          "Read the diff and status below, then the change's proposal.md and tasks.md, then",
          "whatever surrounding code you need. Files marked ?? are untracked and will NOT",
          "appear in the diff — read them directly.",
          "",
          "Your verdict decides whether this change advances to commit. End your reply with",
          "exactly one of these two tokens on its own line, spelled this way and no other:",
          "",
          "  LGTM",
          "  NEEDS_WORK",
          "",
          "Any other wording — PASS, APPROVED, looks good — is read as no verdict at all and",
          "fails the gate. Say the token.",
          "",
          "## git status --porcelain",
          "",
          status.output.slice(0, 20_000) || "(clean)",
          "",
          "## git diff HEAD",
          "",
          diff.output.slice(0, 100_000) || "(empty)",
        ].join("\n")

        const outcome = yield* promptSvc
          .prompt({ sessionID: child.id, agent: agentName, parts: [{ type: "text", text: brief }] })
          .pipe(Effect.result)
        if (Result.isFailure(outcome)) {
          return { passed: false, output: `the ${agentName} subagent errored during the ${gate} gate` }
        }
        const text = outcome.success.parts
          .filter((part) => part.type === "text")
          .map((part) => (part as { text: string }).text)
          .join("\n")
        const verdict = readVerdict(text)
        return verdict.passed ? { passed: true, output: "" } : { passed: false, output: verdict.reason }
      })


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
        // A gate bound to an agent that does not exist halts the run here
        // rather than silently reverting to the command. A review gate that
        // quietly stops reviewing is worse than one that refuses to start: the
        // run keeps advancing toward commit with nobody checking the work.
        const personas: PersonaBindings = yield* personaBindings
        if (personas.errors.length > 0) {
          yield* finishQueue(
            id,
            "error",
            `queue persona misconfiguration — nothing was attempted:\n${personas.errors.join("\n")}`,
          )
          return
        }
        yield* Effect.logInfo("queue personas", {
          "queue.personas":
            Object.entries(personas.bindings)
              .map(([gate, agent]) => `${gate}→${agent}`)
              .join(", ") || "(none)",
        })
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

          // The work runs in the session you are looking at. Not a child, not
          // one per change: a child session's message stream is only reachable
          // by keypress, so an unattended run looked like a still, empty screen.
          // Being able to watch the agent outranks a clean context per change.
          //
          // The authority ceiling has to come along, because it is the session's
          // ruleset that both denies pushing AND marks the run unattended so it
          // never stops to ask. It is applied for the duration of the run and
          // restored when the run ends — see `restorePermission` below.
          const changeSessionID = record.info.sessionID

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
                  const attempt = yield* queueTurn(id, change, "implement", changeSessionID, repairing, personas.bindings.implement)
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
                const result = yield* queueTurn(id, change, "implement", changeSessionID, failure, personas.bindings.implement)
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
                // A passing command proves the tests ran, not that the change
                // is any good — and this is the last gate before commit. When a
                // reviewer is bound, its verdict decides the gate instead.
                const reviewer = AgentGates.includes("verify") ? personas.bindings.verify : undefined
                const result = reviewer
                  ? { ...(yield* runAgentGate("verify", reviewer, change, changeSessionID, exec)), gate: "verify" as const }
                  : yield* Effect.promise(() => evaluateVerify(exec, change, options))
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
                const result = yield* queueTurn(id, change, "commit", changeSessionID, { gate: "commit", output: check.output })
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
          // An agent gate is excluded: a reviewer that returns NEEDS_WORK three
          // times is doing its job, and quarantining the change is the correct
          // outcome. Only a command that never once succeeded is suspect.
          const suspectGate =
            ending.outcome === "quarantined" &&
            ending.gate !== undefined &&
            (ending.gate === "test" || ending.gate === "verify") &&
            personas.bindings[ending.gate] === undefined &&
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
          // Push the completed change's branch. The commit gate has already
          // established that a commit exists, that it touches this change, that
          // the tree is clean, and that we are NOT on the default branch — so
          // there is exactly one safe ref to publish and this computes it
          // rather than taking the model's word for it.
          //
          // The DRIVER runs this, not the model: QueueDenyRules still deny
          // `*git*push*` to every session in the run. The distinction is the
          // point. An unattended agent that can push anything it likes is a
          // different risk from a harness that pushes one branch it verified,
          // after gates it verified, and reports exactly what it did.
          if (ending.outcome === "completed" && queueState.push !== false) {
            const head = yield* Effect.promise(() => exec("git rev-parse --abbrev-ref HEAD"))
            const branch = head.output.trim()
            if (head.code !== 0 || branch === "" || branch === "HEAD") {
              queueState.pushes.push({
                slug: change.slug,
                branch,
                ok: false,
                output: `could not determine the current branch: ${head.output.slice(-500)}`,
              })
            } else if (branch === options.defaultBranch) {
              // Unreachable if the commit gate did its job; kept because this
              // is the one check whose failure is unrecoverable.
              queueState.pushes.push({
                slug: change.slug,
                branch,
                ok: false,
                output: `refused to push the default branch "${branch}"`,
              })
            } else {
              const push = yield* Effect.promise(() => exec(`git push -u origin ${branch}`))
              queueState.pushes.push({
                slug: change.slug,
                branch,
                ok: push.code === 0,
                output: push.output.slice(-2_000),
              })
              yield* Effect.logInfo("queue push", { "change.slug": change.slug, branch, code: push.code })
            }
          }

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

    // loop-eternal-by-default: default queue state for a prompt-mode loop
    // transitioning into queue continuation on completion. Mirrors the
    // defaults `create` applies to a loop started directly in queue mode.
    const defaultQueueState = (): QueueState => ({
      only: undefined,
      guidance: undefined,
      sync: false,
      gatesPassed: new Set<Gate>(),
      options: undefined,
      push: true,
      syncs: [],
      pushes: [],
      outcomes: [],
      consecutiveQuarantines: 0,
      anyGatePassed: false,
    })

    // Runs a prompt-mode loop; on completion, checks the openspec backlog
    // before finalizing (design: loop-eternal-by-default). If planned work
    // remains and the loop opted in (the default), the loop does not stop —
    // it transitions into queue-style continuation instead, picking up the
    // same relentless, quarantine-don't-halt driver `/backlog` already uses.
    //
    // The transition applies the SAME authority ceiling `create` applies to a
    // loop started directly in queue mode (QueueDenyRules: no push/tag/deploy
    // from the model) — an eternal plain loop must never end up with MORE
    // authority than a queue loop has today just because it started as a
    // single prompt.
    const runPromptThenMaybeQueue = (id: LoopID): Effect.Effect<void> =>
      Effect.gen(function* () {
        yield* run(id)
        const record = (yield* Ref.get(state)).get(id)
        if (!record) return
        if (record.info.status !== "completed") return
        if (!record.info.eternal) return

        const resolved = resolveQueue(record.info.directory, undefined)
        if (resolved.eligible.length === 0) return

        // Two queue-shaped drivers over one directory would fight over the
        // same derived cursor and working tree (the exact conflict
        // QueueActiveError exists to prevent at creation time) — the same
        // guard applies here since this transition makes this loop
        // queue-shaped too.
        const activeQueue = Array.from((yield* Ref.get(state)).values()).find(
          (other) =>
            other.info.id !== id &&
            other.info.mode === "queue" &&
            other.info.directory === record.info.directory &&
            !isTerminal(other.info.status),
        )
        if (activeQueue) {
          yield* Effect.logInfo(
            "loop completed with backlog work remaining, but another queue run is already active in this directory — not transitioning",
            { "loop.id": id, "active.loop.id": activeQueue.info.id },
          )
          return
        }

        yield* Effect.logInfo("loop completed with backlog work remaining — continuing as a queue run", {
          "loop.id": id,
          "queue.next": resolved.eligible[0]?.slug,
        })

        const sessionID = record.info.sessionID
        const priorPermission =
          (yield* session.get(sessionID).pipe(Effect.orElseSucceed(() => undefined)))?.permission ?? []

        yield* patch(id, (current) => ({
          ...current,
          queue: defaultQueueState(),
          info: { ...current.info, status: "running", mode: "queue", finishedAt: undefined },
        }))
        yield* emit(id)

        yield* session.setPermission({ sessionID, permission: [...priorPermission, ...QueueDenyRules] }).pipe(Effect.ignore)
        yield* runQueue(id).pipe(
          Effect.ensuring(session.setPermission({ sessionID, permission: priorPermission }).pipe(Effect.ignore)),
        )
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
            title: mode === "queue" ? "auto: openspec backlog" : `loop: ${promptHead(prompt)}`,
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
          // Only meaningful in prompt mode; queue mode is already relentless
          // by construction (it drains the whole backlog before stopping).
          eternal: mode === "prompt" ? (input.eternal ?? true) : false,
          mode,
          iteration: 0,
          iterations: [],
          startedAt: now,
        }
        yield* Ref.update(state, (map) =>
          new Map(map).set(id, {
            info,
            noProgressStreak: 0,
            steers: [],
            queue:
              mode === "queue"
                ? {
                    only: input.queue?.length ? [...input.queue] : undefined,
                    guidance: input.queueGuidance,
                    sync: input.queueSync ?? false,
                    push: input.queuePush ?? true,
                    gatesPassed: new Set<Gate>(),
                    options: input.queueOptions,
                    syncs: [],
                    pushes: [],
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
        // The authority ceiling rides on the session the work runs in — which
        // is the session you are watching, because a run you cannot see is
        // useless. That ruleset is what denies pushing AND what marks the run
        // unattended so it never stops to ask.
        //
        // Applied here, next to the fiber that owns the run's whole lifetime,
        // and released with `ensuring` so that draining, halting, cancelling
        // or dying all hand your session back exactly as it was found. Doing
        // this deeper inside the driver would leave the return paths to be
        // audited one by one.
        const priorPermission =
          mode === "queue"
            ? ((yield* session.get(sessionID).pipe(Effect.orElseSucceed(() => undefined)))?.permission ?? [])
            : []
        if (mode === "queue") {
          yield* session
            .setPermission({ sessionID, permission: [...priorPermission, ...QueueDenyRules] })
            .pipe(Effect.ignore)
        }

        const driver = mode === "queue" ? runQueue(id) : runPromptThenMaybeQueue(id)
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
            Effect.ensuring(
              mode === "queue"
                ? session.setPermission({ sessionID, permission: [...priorPermission] }).pipe(Effect.ignore)
                : Effect.void,
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

    // Delivery is an append to the record. Both modes rebuild their prompt
    // from it every iteration, so there is no turn to inject into and no race
    // to lose — the correction is picked up by whichever iteration builds its
    // prompt next, and by every one after that.
    const nudge = (id: LoopID, text: string) =>
      Effect.gen(function* () {
        const trimmed = text.trim()
        if (trimmed === "") return false
        const record = (yield* Ref.get(state)).get(id)
        if (!record) return false
        // A paused loop is steerable — correcting it before resuming is the
        // obvious thing to want. A terminal one is not.
        if (record.info.status !== "running" && record.info.status !== "paused") return false
        yield* patch(id, (current) => ({ ...current, steers: [...current.steers, trimmed] }))
        yield* Effect.logInfo("loop steered", { "loop.id": id, "loop.steers": record.steers.length + 1 })
        return true
      })

    return Service.of({ create, list, get, pause, resume, cancel, nudge })
  }),
)

export const node = LayerNode.make({
  service: Service,
  layer,
  deps: [
    Session.node,
    SessionPrompt.node,
    SessionStatus.node,
    Config.node,
    Provider.node,
    AgentSvc.node,
    Permission.node,
    EventV2Bridge.node,
  ],
})

export * as Loop from "./loop"
