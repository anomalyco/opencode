import type { CliRenderer } from "@opentui/core"

export type ProgramResumeInput = Readonly<{
  /** The terminal's OSC7577_TOKEN, taken out of the environment before anything started a child process. */
  token: string
  /** The command this build installs as, such as `opencode`, looked up on PATH when the terminal resumes it. */
  command: string
  /** Flags that decide which server the session lives on or how it runs, so resuming brings back the same thing. */
  flags: readonly string[]
}>

// Tells the terminal which command brings this TUI back after the terminal restarts (OSC 7577). The terminal holds one
// command per process. It is replaced when the session on screen changes, cleared when no session is on screen or the
// user quits, and kept when the terminal ends OpenCode (SIGHUP, SIGTERM), because that is when the terminal needs it.
export function createProgramResume(
  input: ProgramResumeInput & { cwd: string; renderer: Pick<CliRenderer, "setProgramResume"> },
) {
  // The session the terminal holds a command for, if any.
  let reported: string | undefined
  // The session on screen.
  let current: string | undefined
  const send = (sessionID: string | undefined) => {
    const report = sessionID
      ? { token: input.token, argv: [input.command, "--session", sessionID, ...input.flags], cwd: input.cwd }
      : { token: input.token, clear: true as const }
    // A report that didn't reach the output queue is retried on the next change.
    if (input.renderer.setProgramResume(report)) reported = sessionID
  }
  return {
    report(sessionID: string | undefined) {
      current = sessionID
      if (sessionID !== reported) send(sessionID)
    },
    /** Another program may have replaced the command while this one was stopped. */
    again() {
      if (current !== undefined) send(current)
    },
    /** The user quit, so the terminal must not bring OpenCode back. */
    clear() {
      current = undefined
      if (reported !== undefined) send(undefined)
    },
  }
}
