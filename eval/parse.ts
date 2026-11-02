import type { Usage } from "./types"

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const number = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : 0)

function parseLine(line: string): Record<string, unknown> | undefined {
  const trimmed = line.trim()
  if (!trimmed.startsWith("{")) return undefined
  try {
    const value: unknown = JSON.parse(trimmed)
    return isRecord(value) ? value : undefined
  } catch {
    return undefined
  }
}

export type ParsedRun = {
  sessionID?: string
  steps: number
  toolCalls: number
  toolErrors: number
  errors: string[]
  finalText: string
  usage: Usage
}

/** Reads the JSONL emitted by `opencode run --format json`. */
export function parseRunOutput(stdout: string): ParsedRun {
  const events = stdout.split(/\r?\n/).flatMap((line) => {
    const event = parseLine(line)
    return event ? [event] : []
  })
  const usage: Usage = { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, total: 0, cost: 0 }
  const errors: string[] = []
  let sessionID: string | undefined
  let steps = 0
  let toolCalls = 0
  let toolErrors = 0
  let finalText = ""

  for (const event of events) {
    if (sessionID === undefined && typeof event.sessionID === "string") sessionID = event.sessionID
    if (event.type === "error") {
      const error = isRecord(event.error) ? event.error : undefined
      errors.push(typeof error?.message === "string" ? error.message : "unknown error")
      continue
    }
    const part = isRecord(event.part) ? event.part : undefined
    if (!part) continue
    if (event.type === "step_finish") {
      steps += 1
      usage.cost += number(part.cost)
      const tokens = isRecord(part.tokens) ? part.tokens : undefined
      const cache = isRecord(tokens?.cache) ? tokens.cache : undefined
      usage.input += number(tokens?.input)
      usage.output += number(tokens?.output)
      usage.reasoning += number(tokens?.reasoning)
      usage.cacheRead += number(cache?.read)
      usage.cacheWrite += number(cache?.write)
      continue
    }
    if (event.type === "text" && typeof part.text === "string") {
      finalText += part.text
      continue
    }
    if (event.type === "tool_use") {
      toolCalls += 1
      const state = isRecord(part.state) ? part.state : undefined
      if (state?.status === "error") toolErrors += 1
    }
  }

  usage.total = usage.input + usage.output + usage.reasoning + usage.cacheRead + usage.cacheWrite
  return { sessionID, steps, toolCalls, toolErrors, errors, finalText, usage }
}
