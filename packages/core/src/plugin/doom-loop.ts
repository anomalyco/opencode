export * as DoomLoopPlugin from "./doom-loop.js"

import { define } from "@opencode/plugin/effect/plugin"
import type { Session } from "@opencode/schema/session"
import type { SessionEvent } from "@opencode/schema/session-event"
import { Effect, Exit, Option, Scope, Stream } from "effect"
import { Permission } from "../permission.js"
import { Tool } from "../tool.js"
import { DoomLoopDetector } from "./doom-loop/detector.js"
import { DoomLoopFold } from "./doom-loop/fold.js"

// Session state is rebuilt lazily from durable history on first tool-hook touch (fold), so a
// process restart continues A/C streaks instead of silently zeroing them. The one fact history
// cannot rebuild is a tripped circuit breaker (B's streak restarts at zero), so it is persisted
// in plugin KV and re-armed only by a real user message.
//
// Because every entry can be re-folded, the sessions map is a pure cache: past
// MAX_TRACKED_SESSIONS the least recently touched entry is dropped and re-folded on its next
// touch. Every eviction loss is miss-direction — bStreak restarts at zero exactly as after a
// restart, and calls accounted since the last durable write replay short. The breaker survives
// in KV, and an executing session touches the map on every hook, so the LRU tail is always a
// session no hook is touching.

const DEFAULT_MAX_TRACKED_SESSIONS = 64

type Tracked =
  | SessionEvent.Deleted
  | SessionEvent.InboxEnqueued
  | SessionEvent.Step.Ended
  | SessionEvent.Compaction.Ended
  | SessionEvent.Execution.Succeeded
  | SessionEvent.Execution.Failed
  | SessionEvent.Execution.Interrupted

interface Entry {
  state: DoomLoopDetector.SessionState
}

const circuitKey = (sessionID: Session.ID) => `circuit:${sessionID}`

// Factory-injected cap: tests construct a plugin with a small cap instead of mutating shared state.
export function makePlugin(options?: { maxTrackedSessions?: number }) {
  const cap = options?.maxTrackedSessions ?? DEFAULT_MAX_TRACKED_SESSIONS

  return define({
    id: "opencode.doom.loop",
    effect: Effect.fn(function* (ctx) {
    const scope = yield* Scope.Scope
    const sessions = new Map<Session.ID, Promise<Entry>>()

    const folded = (sessionID: Session.ID): Promise<Entry> =>
      Effect.runPromise(
        Effect.gen(function* () {
          const entry: Entry = { state: DoomLoopDetector.state() }
          const messages = yield* ctx.session.context({ sessionID })
          DoomLoopFold.fold(entry.state, messages)
          if ((yield* ctx.storage.get(circuitKey(sessionID))) === true) entry.state.circuitBroken = true
          return entry
        }),
        // A history read failure must not fail the tool call: fall back to a fresh state (the
        // pre-fold behavior) rather than dropping detection entirely.
      ).catch((): Entry => ({ state: DoomLoopDetector.state() }))

    // The promise enters the map synchronously so concurrent first touches share one fold.
    const session = (sessionID: Session.ID) => {
      const existing = sessions.get(sessionID)
      if (existing) {
        // LRU touch: Map.set on an existing key does not reorder, so reinsert at the tail.
        sessions.delete(sessionID)
        sessions.set(sessionID, existing)
        return existing
      }
      const created = folded(sessionID)
      sessions.set(sessionID, created)
      // Eviction is a bare delete: the KV breaker key belongs to the session lifecycle, not to
      // this cache, and everything else re-folds from durable history on the next touch.
      while (sessions.size > cap) {
        const oldest = sessions.keys().next().value
        if (oldest === undefined) break
        sessions.delete(oldest)
      }
      return created
    }

    // Event-time mutations chain onto the in-flight fold so they apply after it settles. Sessions
    // never touched by a hook are not created here: a fresh state is already the zeroed state.
    const mutate = (sessionID: Session.ID, fn: (state: DoomLoopDetector.SessionState) => void) => {
      const existing = sessions.get(sessionID)
      if (existing)
        sessions.set(
          sessionID,
          existing.then((entry) => {
            fn(entry.state)
            return entry
          }),
        )
    }

    yield* ctx.tool.hook("execute.before", (event) =>
      Effect.gen(function* () {
        // The outer Code Mode tool is built per snapshot and re-enters with real tool names; its
        // own `execute` call carries no observable signature. Skipping by name also exempts an
        // MCP/custom tool literally named `execute` — a false-negative, conservative direction.
        if (event.tool === "execute") return
        const current = yield* Effect.promise(() => session(event.sessionID))
        const sigHash = DoomLoopDetector.signature(event.tool, event.input)
        const verdict = DoomLoopDetector.beforeCall(current.state, {
          tool: event.tool,
          sigHash,
          messageID: event.messageID,
        })
        if (verdict.kind === "pass") return
        if (verdict.kind === "circuit") {
          // A sticky circuit (a previous denial) stops without re-asking, until the user speaks.
          if (verdict.sticky) {
            yield* ctx.session.interrupt({ sessionID: event.sessionID }).pipe(Effect.ignore, Effect.forkIn(scope))
            return yield* new Tool.Error({ message: verdict.message, metadata: DoomLoopDetector.blockedMetadata })
          }
          // The breaker goes through doom_loop like every other signal: allow resets B and lets
          // the run continue; a denial makes the stop sticky and explains why it happened.
          const resource = `${event.tool}:${sigHash}${DoomLoopDetector.resourceSuffix.b}`
          const outcome = yield* Effect.exit(
            ctx.permission.assert({
              sessionID: event.sessionID,
              agent: event.agent,
              action: "doom_loop",
              resources: [resource],
              save: [resource],
              source: { type: "tool", messageID: event.messageID, id: event.id },
            }),
          )
          if (Exit.isSuccess(outcome)) {
            current.state.bStreak = 0
            return
          }
          const error = Option.getOrUndefined(Exit.findErrorOption(outcome))
          // A rule-based denial makes the stop sticky; a CorrectedError carries model feedback and
          // returns as a plain Tool.Error so the model can act on it (no sticky stop, no interrupt).
          // Only a CorrectedError returns as plain feedback for the model (no sticky stop).
          // The host wraps it as Tool.Error with the CorrectedError in `.error`, so check both.
          const corrected =
            error instanceof Permission.CorrectedError ||
            (error instanceof Tool.Error && error.error instanceof Permission.CorrectedError)
          if (!corrected) {
            yield* ctx.storage.set(circuitKey(event.sessionID), true).pipe(Effect.ignore)
            current.state.circuitBroken = true
            yield* ctx.session.interrupt({ sessionID: event.sessionID }).pipe(Effect.ignore, Effect.forkIn(scope))
          }
          return yield* new Tool.Error({
            message: `${verdict.message}\n\n${error?.message ?? "rejected"}`,
            metadata: DoomLoopDetector.blockedMetadata,
          })
        }
        const resource = `${event.tool}:${sigHash}${DoomLoopDetector.resourceSuffix[verdict.signal]}`
        // host.ts maps BlockedError/CorrectedError to Tool.Error and keeps a plain rejection a
        // defect; stacking our copy on the mapped message preserves the "why blocked + what next"
        // guidance for both typed outcomes. Deliberately no inner `error`: toSessionError unwraps
        // to the innermost error's message when one is attached, which would discard our copy.
        // The blockedMetadata marker persists on the error part so the fold skips this call — it
        // never executed, so the live path never accounted it.
        return yield* ctx.permission
          .assert({
            sessionID: event.sessionID,
            agent: event.agent,
            action: "doom_loop",
            resources: [resource],
            save: [resource],
            source: { type: "tool", messageID: event.messageID, id: event.id },
          })
          .pipe(
            Effect.mapError(
              (error) =>
                new Tool.Error({
                  message: `${verdict.message}\n\n${error.message}`,
                  metadata: DoomLoopDetector.blockedMetadata,
                }),
            ),
          )
      }),
    )

    yield* ctx.tool.hook("execute.after", (event) =>
      Effect.gen(function* () {
        if (event.tool === "execute") return
        const current = yield* Effect.promise(() => session(event.sessionID))
        const sigHash = DoomLoopDetector.signature(event.tool, event.input)
        if (event.status === "error") {
          // Failure events feed signal C only — they never enter A/B, or a run of failures with
          // distinct messages would count as identical empty outputs. The warning lands on the
          // error message because a failed call has no result content.
          // Deviation from ⑦, declared: error events carry no metadata, so a background shell's
          // launch failure cannot be distinguished and is counted into C. Deliberately conservative
          // direction (detect more; C still only ever asks, never hard-blocks silently).
          const warning = DoomLoopDetector.recordFailed(current.state, {
            tool: event.tool,
            sigHash,
            errorText: event.error.message,
            validation: event.error.message.startsWith(DoomLoopDetector.VALIDATION_PREFIX),
          })
          if (warning !== undefined) event.error.message = `${event.error.message}\n\n${warning}`
          return
        }
        // Unobserved layer (background shell — registered under the name "shell"; question):
        // A/B/C abstain — the receipt text is fixed, so counting it would false-positive signal A
        // immediately.
        const unobserved =
          event.tool === "question" ||
          (event.tool === "shell" && event.result.metadata !== undefined && event.result.metadata.status === "running")
        if (unobserved) {
          DoomLoopDetector.recordUnobserved(current.state, sigHash)
          return
        }
        // Hash and account before touching content so our own text never feeds back in.
        const text = DoomLoopDetector.outputText(event.result.content, event.result.output)
        const warning = DoomLoopDetector.recordCompleted(current.state, { tool: event.tool, sigHash, text })
        if (warning === undefined) return
        // Prepend rather than append: the runner's ToolOutput.truncate keeps the head of oversized
        // outputs (tool-output.ts), so a tail warning would be cut exactly on the huge outputs of
        // looping MCP-style tools.
        const existing = event.result.content
        event.result = {
          ...event.result,
          content: [
            { type: "text" as const, text: warning },
            ...(typeof existing === "string" ? [{ type: "text" as const, text: existing }] : (existing ?? [])),
          ],
        }
      }),
    )

    yield* ctx.event.subscribe().pipe(
      Stream.filter(
        (event): event is Tracked =>
          event.type === "session.deleted" ||
          event.type === "session.inbox.enqueued" ||
          event.type === "session.step.ended" ||
          event.type === "session.compaction.ended" ||
          event.type === "session.execution.succeeded" ||
          event.type === "session.execution.failed" ||
          event.type === "session.execution.interrupted",
      ),
      Stream.runForEach((event) =>
        Effect.gen(function* () {
          const sessionID = event.data.sessionID
          if (event.type === "session.deleted") {
            sessions.delete(sessionID)
            yield* ctx.storage.remove(circuitKey(sessionID)).pipe(Effect.ignore)
            return
          }
          if (event.type === "session.inbox.enqueued") {
            // Only real user messages re-arm the breaker; our own synthetic injections must not.
            // The persisted key clears even when this process never folded the session.
            if (event.data.item.type !== "user") return
            yield* ctx.storage.remove(circuitKey(sessionID)).pipe(Effect.ignore)
            mutate(sessionID, DoomLoopDetector.userMessage)
            return
          }
          if (event.type === "session.step.ended") {
            if (event.data.files === undefined || event.data.files.length === 0) return
            mutate(sessionID, DoomLoopDetector.filesChanged)
            return
          }
          if (event.type === "session.compaction.ended") {
            mutate(sessionID, DoomLoopDetector.compacted)
            return
          }
          mutate(sessionID, DoomLoopDetector.tighten)
        }),
      ),
      Effect.forkScoped({ startImmediately: true }),
    )
  }),
  })
}

export const Plugin = makePlugin()
