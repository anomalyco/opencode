export * as ShellResult from "./result.js"

import type { Shell } from "@opencode/schema/shell"

export type Lines = { shown: number; total: number }

export type Result = {
  info: Shell.Info
  // `lines` counts the tail's lines (`shown`) and the file's (`total`), zero for an empty file.
  // `killed` says why a command was killed when no signal of its own tells, e.g. the process daemon stopped.
  capture: { output: string; truncated: boolean; lines?: Lines; killed?: string } | undefined
}

type Output = {
  output: string
  truncated: boolean
  exit?: number
  signal?: string
  timeout?: boolean
  // Killed without an exit code or signal of its own: stopped, or lost with the process daemon.
  killed?: string
}

const missing = "Shell command output is no longer available."
export const unavailable: Shell.Output = {
  output: missing,
  cursor: Buffer.byteLength(missing),
  size: Buffer.byteLength(missing),
  truncated: false,
}

export function output(result: Result, reportKilled = true): Output {
  return {
    output: result.capture?.output ?? unavailable.output,
    truncated: result.capture?.truncated ?? false,
    ...(result.info.exit !== undefined ? { exit: result.info.exit } : {}),
    ...(result.info.signal !== undefined ? { signal: result.info.signal } : {}),
    ...(result.info.status === "timeout" ? { timeout: true } : {}),
    // A removed command has no capture and keeps today's plain "unavailable" result.
    ...(reportKilled && result.info.status === "killed" && result.capture && result.info.signal === undefined
      ? { killed: result.capture.killed ?? "Command was killed" }
      : {}),
  }
}

export function savedNotice(lines: Lines, file: string) {
  if (lines.total === 0) return `[no output; output file: ${file}]`
  return `[showing lines ${lines.total - lines.shown + 1}-${lines.total} of ${lines.total}; full output saved to ${file}]`
}

// The result of a command stopped because the user interrupted its call. It always names the shell
// and its output file, which `output` leaves out when the output fits.
export function interrupted(result: Result): Output {
  // Saying it was interrupted already says it was killed.
  const captured = output(result, false)
  const lines = result.capture && !result.capture.truncated ? result.capture.lines : undefined
  // An empty capture is all notice: no "(no output)" before "[no output; …]".
  const text = lines?.total === 0 ? "" : `${captured.output.replace(/\n$/, "")}\n\n`
  return {
    ...captured,
    output: [
      lines ? `${text}${savedNotice(lines, result.info.file)}` : captured.output,
      `Command interrupted by the user (shell ID: ${result.info.id}).`,
    ].join("\n\n"),
  }
}

export function notice(output: Pick<Output, "exit" | "signal" | "timeout" | "killed">) {
  if (output.timeout) return "Timed out before completion"
  if (output.killed !== undefined) return output.killed
  if (output.signal !== undefined) return `Killed by ${output.signal}`
  if (output.exit !== undefined && output.exit !== 0) return `Exited with code ${output.exit}`
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
        : (notice(captured) ?? "Exited with code unknown")
  const message = notification({
    shellID: result.info.id,
    command: result.info.command,
    state: result.info.status === "killed" ? "cancelled" : "completed",
    text: [captured.output, status].filter((item) => item !== undefined && item !== "").join("\n\n"),
    output: captured,
  })
  return { ...message, text: `The following shell command was executed by the user:\n${message.text}` }
}
