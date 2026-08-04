import { Shell } from "@opencode-ai/core/shell"
import { spawn } from "child_process"
import type { Readable } from "stream"
import stripAnsi from "strip-ansi"

export const LOCAL_COMMAND_TIMEOUT = 30_000
export const LOCAL_COMMAND_OUTPUT_LIMIT = 64 * 1024

export type LocalCommandResult = {
  exitCode: number
  outputTruncated: boolean
  stderr: string
  stdout: string
  timedOut: boolean
}

export async function executeLocalCommand(input: { command: string; directory: string; timeout?: number }) {
  const shell = Shell.preferred()
  if (!shell) throw new Error("No local shell is available")

  const child = spawn(shell, Shell.args(shell, input.command, input.directory), {
    cwd: input.directory,
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  })
  let timedOut = false
  const timeout = setTimeout(() => {
    timedOut = true
    void Shell.killTree(child, { exited: () => child.exitCode !== null })
  }, input.timeout ?? LOCAL_COMMAND_TIMEOUT)
  try {
    const [exitCode, stdout, stderr] = await Promise.all([
      new Promise<number>((resolve, reject) => {
        child.once("error", reject)
        child.once("close", (code) => resolve(code ?? 1))
      }),
      readOutput(child.stdout),
      readOutput(child.stderr),
    ])
    return {
      exitCode,
      outputTruncated: stdout.truncated || stderr.truncated,
      stdout: stdout.output,
      stderr: stderr.output,
      timedOut,
    }
  } finally {
    clearTimeout(timeout)
  }
}

export function formatLocalCommandResult(result: LocalCommandResult) {
  if (result.timedOut) return "Command stopped after reaching the local time limit."
  const output = [result.stdout, result.stderr].map(sanitizeLocalCommandOutput).filter(Boolean).join("\n")
  const limit = result.outputTruncated ? `Output truncated after ${LOCAL_COMMAND_OUTPUT_LIMIT / 1024} KiB.` : undefined
  if (result.exitCode !== 0)
    return [`Command exited with code ${result.exitCode}.`, output, limit].filter(Boolean).join("\n\n")
  return [output || "Command completed with no output.", limit].filter(Boolean).join("\n\n")
}

function sanitizeLocalCommandOutput(value: string) {
  return stripAnsi(value).replace(/[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/g, "")
}

async function readOutput(stream: Readable | null) {
  if (!stream) return { output: "", truncated: false }
  let output = ""
  let truncated = false
  for await (const chunk of stream) {
    const text = chunk.toString()
    const remaining = LOCAL_COMMAND_OUTPUT_LIMIT - output.length
    if (text.length > remaining) {
      output += text.slice(0, remaining)
      truncated = true
      continue
    }
    output += text
  }
  return { output, truncated }
}
