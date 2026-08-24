// fork: tracks which sessions currently have a tool executing.
//
// The AI SDK awaits a tool's execute() before it emits `tool-result` into
// fullStream, so the LLM event stream is legitimately silent for the entire
// duration of a tool call. The inactivity watchdog (llm.ts) watches that same
// stream and cannot otherwise tell "the provider went away" from "our own tool
// is still working" — so a tool slower than the deadline killed the turn and
// blamed the provider ("Provider stream stalled: no events for 300s").
//
// That was not a rare edge: a FOREGROUND subagent is allowed 600s by
// SUBAGENT_TASK_TIMEOUT_MS (task.ts) while the watchdog default is 300s, so any
// subagent taking between five and ten minutes killed its parent every time,
// and the subagent backstop could never actually be reached.
//
// Keyed by session so a long tool in one session cannot keep an unrelated
// session's dead stream alive. A counter, not a boolean: parallel tool calls
// within one session overlap.
const running = new Map<string, number>()

export const ToolActivity = {
  /** True while at least one tool is executing for this session. */
  active(sessionID: string): boolean {
    return (running.get(sessionID) ?? 0) > 0
  },
  begin(sessionID: string): void {
    running.set(sessionID, (running.get(sessionID) ?? 0) + 1)
  },
  end(sessionID: string): void {
    const next = (running.get(sessionID) ?? 0) - 1
    if (next > 0) running.set(sessionID, next)
    else running.delete(sessionID)
  },
}
