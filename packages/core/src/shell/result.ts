export * as ShellResult from "./result.js"

import os from "os"
import type { Shell } from "@opencode/schema/shell"

export type Result = {
  info: Shell.Info
  // `killed` says why a command was killed when no exit code or signal of its own tells, e.g. the process daemon stopped.
  capture: { output: string; truncated: boolean; killed?: string } | undefined
}

type Output = { output: string; truncated: boolean; exit?: number; signal?: string; timeout?: boolean; killed?: string }

const missing = "Shell command output is no longer available."
export const unavailable: Shell.Output = {
  output: missing,
  cursor: Buffer.byteLength(missing),
  size: Buffer.byteLength(missing),
  truncated: false,
}

export function output(result: Result): Output {
  return {
    output: result.capture?.output ?? unavailable.output,
    truncated: result.capture?.truncated ?? false,
    ...(result.info.exit !== undefined ? { exit: result.info.exit } : {}),
    ...(result.info.signal !== undefined ? { signal: result.info.signal } : {}),
    ...(result.info.status === "timeout" ? { timeout: true } : {}),
    ...(result.capture?.killed !== undefined ? { killed: result.capture.killed } : {}),
  }
}

// What the model gets for a command stopped because the user interrupted its call (`message`): the output so far,
// where the full output is, and the shell ID, even when the output fits (which `output` leaves unsaid). `output` and
// `notice` are its two parts, so a renderer can show the output like a finished call's, then the notice.
export function interrupted(result: Result) {
  const capture = result.capture
  const stopping = result.info.status === "running" ? "; it is still being stopped" : ""
  const stopped = `Command interrupted by the user (shell ID: ${result.info.id})${stopping}.`
  const [output, notice] = !capture
    ? [unavailable.output, stopped]
    : capture.truncated
      ? [capture.output, stopped]
      : capture.output === "(no output)"
        ? ["", `[no output; output file: ${result.info.file}]\n\n${stopped}`]
        : [capture.output.replace(/\n$/, ""), `[full output saved to ${result.info.file}]\n\n${stopped}`]
  return { output, notice, message: output ? `${output}\n\n${notice}` : notice }
}

export function notice(output: Pick<Output, "exit" | "signal" | "timeout" | "killed">, timeout?: number) {
  if (output.killed !== undefined) return output.killed
  if (output.timeout)
    return `Command timed out${timeout ? ` after ${timeout / 1_000} seconds` : ""}. If it needs longer and isn't waiting for input, rerun with a larger timeout.\nExit code: ${exitCode(output)}`
  if (output.signal !== undefined || (output.exit !== undefined && output.exit !== 0))
    return `Exit code: ${exitCode(output)}`
}

// A signal reads as the shell's 128 + signal number convention, followed by its name.
function exitCode(output: Pick<Output, "exit" | "signal">) {
  if (output.exit !== undefined) return output.exit
  const signal = output.signal === undefined ? undefined : os.constants.signals[output.signal as NodeJS.Signals]
  return signal === undefined ? "unknown" : `${128 + signal} (${output.signal})`
}

export function metadata(output: Output) {
  return {
    truncated: output.truncated,
    ...(output.exit !== undefined ? { exit: output.exit } : {}),
    ...(output.signal !== undefined ? { signal: output.signal } : {}),
    ...(output.timeout !== undefined ? { timeout: output.timeout } : {}),
    ...(output.killed !== undefined ? { killed: true } : {}),
  }
}

export function notification(input: {
  shellID: string
  jobID?: string
  command: string
  state: "completed" | "cancelled" | "error"
  text: string
  output?: Output
}) {
  return {
    text: `<shell id="${input.jobID ?? input.shellID}" state="${input.state}" command="${input.command}">\n${input.text}\n</shell>`,
    metadata: {
      source: "shell",
      shellID: input.shellID,
      ...(input.jobID !== undefined ? { jobID: input.jobID } : {}),
      state: input.state,
      ...(input.output ? metadata(input.output) : {}),
    },
  }
}

export function userNotification(result: Result) {
  const captured = output(result)
  const status =
    result.info.status === "killed"
      ? "Cancelled"
      : captured.exit === 0
        ? undefined
        : (notice(captured) ?? "Exit code: unknown")
  const message = notification({
    shellID: result.info.id,
    command: result.info.command,
    state: result.info.status === "killed" ? "cancelled" : "completed",
    text: [captured.output, status].filter((item) => item !== undefined && item !== "").join("\n\n"),
    output: captured,
  })
  return { ...message, text: `The following shell command was executed by the user:\n${message.text}` }
}
