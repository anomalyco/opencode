/** Delta builder for extraction (spec Part A §7.2). Pure function. */
import type { NMessage } from "./types"
import { estimateTokens } from "./tokens"

export interface DeltaResult {
  text: string
  lastUserMessageId: string
  turnMessageId: string
  truncatedToolLines: number
}

export interface BuildDeltaOpts {
  maxTokens: number
}

const USER_CAP = 6000
const ASSISTANT_CAP = 3000
const CMD_CAP = 200
const ARGS_CAP = 150
const BASH_OUTPUT_LINES = 15
const BASH_OUTPUT_CAP = 600
const ERROR_CAP = 200

function middleTruncate(s: string, cap: number): string {
  if (s.length <= cap) return s
  const head = Math.floor((cap - 5) / 2)
  const tail = cap - 5 - head
  return s.slice(0, head) + "[...]" + s.slice(s.length - tail)
}

function isBackgroundCommand(cmd: string): boolean {
  const trimmed = cmd.trim()
  return trimmed.includes("nohup") || trimmed.endsWith("&") || trimmed.includes("--background")
}

function bashLine(cmd: string, status: string | undefined, output: string | undefined): string {
  const cmdShort = middleTruncate(cmd, CMD_CAP)
  // status is 'completed'/'error'/'pending'/'running' in NPart terms; no numeric exit code is stored,
  // so we approximate: completed -> 0, error -> 1, otherwise the raw status string (or ?).
  const exitLabel = status === "completed" ? "0" : status === "error" ? "1" : (status ?? "?")
  const lines = (output ?? "").split("\n")
  const last = lines.slice(-BASH_OUTPUT_LINES).join("\n")
  const outShort = middleTruncate(last, BASH_OUTPUT_CAP)
  const bg = isBackgroundCommand(cmd) ? " [BACKGROUND]" : ""
  return `bash${bg}: ${cmdShort} → exit ${exitLabel} | ${outShort}`
}

function toolLine(part: NMessage["parts"][number]): string {
  const tool = part.tool ?? "tool"
  const input = part.input
  if (tool === "read" || tool === "glob" || tool === "grep" || tool === "list") {
    const path = typeof input === "object" && input !== null && "path" in input ? String((input as { path: unknown }).path) : ""
    return `read: ${path}`
  }
  if (tool === "edit" || tool === "write" || tool === "patch" || tool === "multiedit") {
    const path = typeof input === "object" && input !== null && "path" in input ? String((input as { path: unknown }).path) : ""
    return `edit: ${path}`
  }
  if (tool === "shell" || tool === "bash") {
    const cmd = typeof input === "object" && input !== null && "command" in input ? String((input as { command: unknown }).command) : String(input ?? "")
    return bashLine(cmd, part.status, part.output)
  }
  const args = input === undefined ? "" : (typeof input === "string" ? input : JSON.stringify(input)).slice(0, ARGS_CAP)
  const status = part.status ?? "completed"
  let line = `${tool}: ${args} → ${status}`
  if (status === "error" && part.output) {
    line += `; ${part.output.slice(0, ERROR_CAP)}`
  }
  return line
}

function hasOpenTool(m: NMessage): boolean {
  return m.parts.some((p) => p.type === "tool" && (p.status === "pending" || p.status === "running"))
}

function isCompletedAssistant(m: NMessage): boolean {
  if (m.role !== "assistant") return false
  return !hasOpenTool(m)
}

export function buildDelta(msgs: NMessage[], cursorId: string | null, opts: BuildDeltaOpts): DeltaResult {
  const startIdx = cursorId ? msgs.findIndex((m) => m.id === cursorId) + 1 : 0
  const safeStart = startIdx < 0 ? 0 : startIdx

  // find last completed assistant from safeStart
  let endIdx = safeStart - 1
  for (let i = msgs.length - 1; i >= safeStart; i--) {
    if (isCompletedAssistant(msgs[i])) {
      endIdx = i
      break
    }
  }
  if (endIdx < safeStart) endIdx = msgs.length - 1

  const slice = msgs.slice(safeStart, endIdx + 1)
  const lastUser = [...slice].reverse().find((m) => m.role === "user")
  const lastAssistant = [...slice].reverse().find((m) => m.role === "assistant")

  // Build blocks
  const blocks: string[] = []
  let truncatedToolLines = 0
  for (const m of slice) {
    if (m.role === "user") {
      const text = m.parts
        .filter((p) => p.type === "text")
        .map((p) => p.text ?? "")
        .join("\n")
      blocks.push(`[USER ${m.id}]\n${middleTruncate(text, USER_CAP)}`)
    } else if (m.role === "assistant") {
      const text = m.parts
        .filter((p) => p.type === "text")
        .map((p) => p.text ?? "")
        .join("\n")
      blocks.push(`[ASSISTANT ${m.id}]\n${middleTruncate(text, ASSISTANT_CAP)}`)
      const toolParts = m.parts.filter((p) => p.type === "tool")
      if (toolParts.length > 0) {
        const lines = toolParts.map(toolLine)
        const block = `[TOOLS ${m.id}]\n` + lines.map((l) => `- ${l}`).join("\n")
        blocks.push(block)
      }
    }
  }

  let text = blocks.join("\n")
  // Budget handling: keep user messages untouched; trim tool lines if over budget.
  if (estimateTokens(text) > opts.maxTokens) {
    // Collect all tool bullet lines with their block index.
    // Rebuild: for each [TOOLS ...] block, keep first 30% + last 70% of its tool lines.
    const rebuilt: string[] = []
    for (const block of blocks) {
      if (!block.startsWith("[TOOLS")) {
        rebuilt.push(block)
        continue
      }
      const header = block.split("\n")[0]
      const toolLines = block.split("\n").slice(1)
      const n = toolLines.length
      if (n === 0) {
        rebuilt.push(block)
        continue
      }
      const keepFirst = Math.floor(n * 0.3)
      const keepLast = Math.floor(n * 0.7)
      if (keepFirst + keepLast >= n) {
        rebuilt.push(block)
        continue
      }
      const omitted = n - keepFirst - keepLast
      truncatedToolLines += omitted
      const kept = [...toolLines.slice(0, keepFirst), `[... ${omitted} tool lines omitted]`, ...toolLines.slice(n - keepLast)]
      rebuilt.push([header, ...kept].join("\n"))
    }
    text = rebuilt.join("\n")
  }

  return {
    text,
    lastUserMessageId: lastUser?.id ?? slice[0]?.id ?? "",
    turnMessageId: lastAssistant?.id ?? slice[slice.length - 1]?.id ?? "",
    truncatedToolLines,
  }
}
