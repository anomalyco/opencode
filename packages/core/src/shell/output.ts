export * as ShellOutput from "./output.js"

import { Effect } from "effect"
import type { Info } from "@opencode-ai/schema/shell"
import { Config } from "../config.js"
import { Shell } from "../shell.js"
import { ToolOutput } from "../tool-output.js"

export const preview = Effect.fn("ShellOutput.preview")(function* (info: Info, shell: Shell.Interface) {
  const config = yield* Config.Service
  const configured = Config.latest(yield* config.entries(), "tool_output")
  const maxLines = configured?.max_lines ?? ToolOutput.MAX_LINES
  const maxBytes = configured?.max_bytes ?? ToolOutput.MAX_BYTES
  const latest = yield* shell.output(info.id, { cursor: Number.MAX_SAFE_INTEGER })
  const page = yield* shell.output(info.id, {
    cursor: Math.max(0, latest.size - maxBytes),
    limit: maxBytes,
  })
  const lines = page.output.split("\n")
  if (page.output.endsWith("\n")) lines.pop()
  const truncated = latest.size > maxBytes || lines.length > maxLines
  const output = lines.length > maxLines ? lines.slice(-maxLines).join("\n") : page.output
  const notice = truncated ? `\n\n[output truncated; full output saved to: ${info.file}]` : ""
  return { ...page, output: `${output || "(no output)"}${notice}`, truncated }
})
