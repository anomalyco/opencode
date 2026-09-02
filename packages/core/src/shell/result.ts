export * as ShellResult from "./result.js"

import type { Shell } from "@opencode-ai/schema/shell"
import { Schema } from "effect"

export type Result = {
  info: Shell.Info
  capture: { output: string; truncated: boolean } | undefined
}

/**
 * How one shell command ended, as the producer saw it. This is the shell job's typed result:
 * the foreground tool response, the background notice, and restart recovery all render from it.
 * `killed` is only ever produced by an explicit external stop, never by the model.
 */
export const Outcome = Schema.Struct({
  kind: Schema.Literal("shell"),
  status: Schema.Literals(["exited", "timeout", "killed"]),
  exit: Schema.optionalKey(Schema.Number),
  output: Schema.String,
  truncated: Schema.Boolean,
})
export type Outcome = typeof Outcome.Type

const missing = "Shell command output is no longer available."
export const unavailable: Shell.Output = {
  output: missing,
  cursor: Buffer.byteLength(missing),
  size: Buffer.byteLength(missing),
  truncated: false,
}

export const stopped = "Command stopped by user. Do not restart it unless the user asks."

export function outcome(result: Result): Outcome {
  return {
    kind: "shell",
    // A result is always terminal; a still-"running" snapshot can only come from a command removed mid-flight.
    status: result.info.status === "running" ? "killed" : result.info.status,
    ...(result.info.exit !== undefined ? { exit: result.info.exit } : {}),
    output: result.capture?.output ?? unavailable.output,
    truncated: result.capture?.truncated ?? false,
  }
}

export function notice(outcome: Pick<Outcome, "status" | "exit">) {
  if (outcome.status === "killed") return stopped
  if (outcome.status === "timeout") return "Command timed out before completion."
  return `Command exited with code ${outcome.exit ?? "unknown"}.`
}

/** Model-visible text: the bounded output followed by how the command ended. */
export function text(outcome: Outcome) {
  return `${outcome.output}\n\n${notice(outcome)}`
}

export function metadata(outcome: Pick<Outcome, "status" | "exit" | "truncated">) {
  return {
    truncated: outcome.truncated,
    ...(outcome.exit !== undefined ? { exit: outcome.exit } : {}),
    ...(outcome.status === "timeout" ? { timeout: true } : {}),
  }
}

export type State = "completed" | "stopped" | "cancelled" | "error"

export function state(outcome: Pick<Outcome, "status">): State {
  return outcome.status === "killed" ? "stopped" : "completed"
}

export function notification(input: {
  shellID: string
  jobID?: string
  command: string
  state: State
  text: string
  outcome?: Outcome
}) {
  return {
    text: `<shell id="${input.jobID ?? input.shellID}" state="${input.state}" command="${input.command}">\n${input.text}\n</shell>`,
    metadata: {
      source: "shell",
      shellID: input.shellID,
      ...(input.jobID !== undefined ? { jobID: input.jobID } : {}),
      state: input.state,
      ...(input.outcome ? metadata(input.outcome) : {}),
    },
  }
}

export function userNotification(result: Result) {
  const ended = outcome(result)
  const message = notification({
    shellID: result.info.id,
    command: result.info.command,
    state: state(ended),
    text: text(ended),
    outcome: ended,
  })
  return { ...message, text: `The following shell command was executed by the user:\n${message.text}` }
}
