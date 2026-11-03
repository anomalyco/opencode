export * as DoomLoopFold from "./fold.js"

import type { SessionMessage } from "@opencode/schema/session-message"
import { DoomLoopDetector } from "./detector.js"

// Rebuilds detector state from durable session history when a session is first touched after a
// restart. The history read is SessionHistory's "latest" view — it starts at the most recent
// completed compaction — and only the accounting half is replayed. Two calibrations keep the
// replay faithful to the live path:
//
// - Calls the before hook rejected DID persist (as error parts) but were never accounted live,
//   because a rejected call never reaches execute.after (tool.ts runs before hooks first). The
//   plugin marks its own rejections (blockedMetadata) and declines/interrupts/input failures carry
//   non-execution error types; both are skipped here.
// - Warnings the after hook injected into results persist with them, while live hashes before
//   injecting; they are stripped so streaks rebuild exactly.
//
// Declared losses: C's failure streaks from before the latest compaction are invisible (miss
// direction; the streak self-heals within a few calls); B restarts with a rebuilt line store but
// a zero streak — safe because B's surgical block still requires the corroborating A streak,
// which IS rebuilt; Code Mode inner calls are invisible (the outer "execute" part is skipped,
// mirroring the live exemption, but the real tool names it re-entered with are not in history).
// The circuit breaker cannot be folded from history; the plugin persists it separately.

// Error types a persisted error part can carry without the call ever having executed — the live
// after hook (and thus signal C) never saw them: declines and interruptions ("aborted" —
// runner step.ts declines, llm.ts settleStaleToolCalls) and input failures that never reached
// the tool ("tool.input-json" / "tool.input-incomplete" — runner INPUT_FAILURES).
const UNEXECUTED_ERROR_TYPES = new Set(["aborted", "tool.input-json", "tool.input-incomplete"])

export function fold(state: DoomLoopDetector.SessionState, messages: ReadonlyArray<SessionMessage.Info>) {
  for (const message of messages) {
    if (message.type === "user") {
      DoomLoopDetector.userMessage(state)
      continue
    }
    // Standalone shell messages are user-run commands (Session.shell), not model tool calls; the
    // model's background shell arrives as a "shell" tool part with metadata.status "running".
    if (message.type !== "assistant") continue
    for (const part of message.content) {
      // The outer Code Mode tool re-enters with real tool names; its own call is exempt, as live.
      if (part.type !== "tool" || part.name === "execute") continue
      if (part.state.status === "error") {
        if (
          DoomLoopDetector.hasBlockedMetadata(part.state.metadata) ||
          UNEXECUTED_ERROR_TYPES.has(part.state.error.type)
        )
          continue
        // The live C warning rides the persisted error message; strip it so the failure hash
        // matches what live accounted. recordFailed excludes argument-validation rejections via
        // the same message prefix the live path matches on.
        const suffix = DoomLoopDetector.injectedFailureSuffix(part.name)
        const message = part.state.error.message
        const errorText = message.endsWith(suffix) ? message.slice(0, -suffix.length) : message
        DoomLoopDetector.recordFailed(state, {
          tool: part.name,
          errorText,
          validation: errorText.startsWith(DoomLoopDetector.VALIDATION_PREFIX),
        })
        continue
      }
      if (part.state.status !== "completed") continue
      const sigHash = DoomLoopDetector.signature(part.name, part.state.input)
      if (part.name === "question" || (part.name === "shell" && part.state.metadata?.status === "running")) {
        DoomLoopDetector.recordUnobserved(state, sigHash)
        continue
      }
      // The persisted content carries any injected warning prepended by the live after hook;
      // strip a leading warning part so the hash matches what live accounted.
      const first = part.state.content[0]
      const content =
        first !== undefined &&
        first.type === "text" &&
        DoomLoopDetector.injectedWarnings(part.name).includes(first.text)
          ? part.state.content.slice(1)
          : part.state.content
      DoomLoopDetector.recordCompleted(state, {
        tool: part.name,
        sigHash,
        text: DoomLoopDetector.outputText(content),
      })
    }
  }
  // Match the live steady state: an execution end tightens the store to the newest 1000 lines,
  // and a fold from a long history could otherwise fill it to the 10k cap.
  DoomLoopDetector.tighten(state)
  // Fresh streak over the rebuilt line store is the self-consistent restart state; see header.
  state.bStreak = 0
}
