export * as Recorder from "./recorder"

import { readFileSync } from "node:fs"
import path from "node:path"
import type { SDKResultMessage } from "@anthropic-ai/claude-agent-sdk"

const DIRECTORY = path.join(import.meta.dir, "../fixtures/recordings")

export type Line =
  | { readonly from: "spawn"; readonly process?: number; readonly args: readonly string[] }
  | { readonly from: "sdk"; readonly process?: number; readonly message: any }
  | { readonly from: "claude"; readonly process?: number; readonly message: any }

// Never retain thinking, including signed or redacted blocks and echoed input history.
export function parse(line: string) {
  return JSON.parse(line, (_key, value) => {
    if (!value || typeof value !== "object") return value
    if (Array.isArray(value)) return value.filter((item) => item !== undefined)
    if (
      value.type === "thinking" ||
      value.type === "thinking_delta" ||
      value.type === "redacted_thinking" ||
      value.type === "signature_delta"
    )
      return undefined
    if (
      value.type === "reasoning" ||
      value.type === "reasoning-start" ||
      value.type === "reasoning-delta" ||
      value.type === "reasoning-end"
    )
      return undefined
    if (value.type === "content_block_start" && value.content_block === undefined) return undefined
    if (value.type === "content_block_delta" && value.delta === undefined) return undefined
    if (value.type === "stream_event" && value.event === undefined) return undefined
    return value
  })
}

// What `claude` answered to the SDK's first start-up request
export function startupReply(lines: readonly Line[]) {
  const line = lines.find((line) => line.from === "claude" && line.message.type === "control_response")
  return line?.from === "claude" ? line.message.response.response : undefined
}

export function load(name: string): Line[] {
  const text = readFileSync(path.join(DIRECTORY, `${name}.jsonl`), "utf8")
  // The first line is the header
  return text
    .trim()
    .split("\n")
    .slice(1)
    .map((line) => JSON.parse(line))
}

// An independent usage oracle for tests: the CLI's result, rather than our stream converter.
export function result(name: string, index = 0): SDKResultMessage {
  const line = load(name).filter((line) => line.from === "claude" && line.message.type === "result")[index]
  if (line?.from === "claude") return line.message
  throw new Error(`No result ${index} in ${name}`)
}
