export * as ShellOutput from "./output.js"

import { Effect } from "effect"
import type { Shell } from "../shell.js"
import { ToolOutput } from "../tool-output.js"

/** The same bounded tail for user shells and agent shell results. */
export const capture = Effect.fn("ShellOutput.capture")(function* (info: {
  shell: Shell.Interface
  id: Parameters<Shell.Interface["output"]>[0]
  file: string
  limits?: { max_lines?: number; max_bytes?: number }
}) {
  const maxLines = info.limits?.max_lines ?? ToolOutput.MAX_LINES
  const maxBytes = info.limits?.max_bytes ?? ToolOutput.MAX_BYTES
  const latest = yield* info.shell.output(info.id, { cursor: Number.MAX_SAFE_INTEGER })
  const page = yield* info.shell.output(info.id, {
    cursor: Math.max(0, latest.size - maxBytes),
    limit: maxBytes,
  })
  const lines = page.output.split("\n")
  if (page.output.endsWith("\n")) lines.pop()
  const truncated = latest.size > maxBytes || lines.length > maxLines
  const output = lines.length > maxLines ? lines.slice(-maxLines).join("\n") : page.output
  const notice = truncated ? `\n\n[output truncated; full output saved to: ${info.file}]` : ""
  return { output: `${output || "(no output)"}${notice}`, truncated }
})
