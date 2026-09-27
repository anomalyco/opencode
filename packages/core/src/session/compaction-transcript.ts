export * as SessionCompactionTranscript from "./compaction-transcript"

import { Token } from "../util/token"

// Transcript-mode compaction engine.
//
// Instead of asking a model to rewrite the conversation head into a prose
// summary, transcript mode preserves user and assistant text word for word
// and condenses only tool calls, tool results, reasoning and system/synthetic
// notes into one-line summaries. One optional model call produces those lines;
// assembly is deterministic, and a failed call degrades to mechanical lines.
//
// The engine operates on Segments so both session pipelines (core and V1)
// can share it; each pipeline maps its own message model onto segments.

export const TOOL_OUTPUT_MAX_CHARS = 2_000
const SUMMARY_LINE_MAX_CHARS = 400

export type Segment =
  | { type: "text"; role: "user" | "assistant"; text: string }
  | { type: "file"; mime: string; filename?: string }
  | { type: "tool"; tool: string; input: unknown; status: string; output?: string; error?: string }
  | { type: "reasoning"; text: string }
  | { type: "note"; label: string; text: string }

type CondensedSegment = Extract<Segment, { type: "tool" | "reasoning" | "note" }>

export type CondensedItem = {
  readonly index: number
  readonly segment: CondensedSegment
}

const truncate = (value: string) =>
  value.length <= TOOL_OUTPUT_MAX_CHARS ? value : `${value.slice(0, TOOL_OUTPUT_MAX_CHARS)}\n[truncated]`

const renderInput = (input: unknown) => {
  const json = JSON.stringify(input) ?? ""
  return json.length > 200 ? `${json.slice(0, 200)}…` : json
}

/** Deterministic one-line rendering used when the model did not summarize an item. */
export function mechanicalSummary(segment: CondensedSegment): string {
  if (segment.type === "reasoning") {
    const text = segment.text.trim()
    return text.length > 120 ? `${text.slice(0, 120)}…` : text
  }
  if (segment.type === "note") {
    const text = segment.text.trim()
    const line = text.split("\n").slice(0, 2).join(" / ")
    return text.length > 120 ? `${segment.label}: ${line.slice(0, 120)}…` : `${segment.label}: ${text}`
  }
  const call = `${segment.tool}(${renderInput(segment.input)})`
  if (segment.status === "error") {
    const error = (segment.error ?? "").split("\n")[0] ?? ""
    return `${call} → error: ${error.slice(0, 160)}`
  }
  if (segment.status === "completed") {
    const output = (segment.output ?? "").trim().split("\n").slice(0, 2).join(" / ")
    if (!output) return `${call} → completed`
    return output.length > 120 ? `${call} → ${output.slice(0, 120)}…` : `${call} → ${output}`
  }
  return `${call} → ${segment.status}`
}

function renderItem(item: CondensedItem): string {
  const segment = item.segment
  if (segment.type === "reasoning") return `${item.index}. [thinking] ${truncate(segment.text)}`
  if (segment.type === "note") return `${item.index}. [${segment.label}] ${truncate(segment.text)}`
  const call = `${segment.tool}(${renderInput(segment.input)})`
  if (segment.status === "error") return `${item.index}. [tool] ${call} → error: ${segment.error ?? ""}`
  if (segment.status === "completed") return `${item.index}. [tool] ${call} → result: ${segment.output ?? ""}`
  return `${item.index}. [tool] ${call} — ${segment.status}`
}

/**
 * The one model call in transcript mode: condense each numbered item to one
 * line. The verbatim transcript itself never passes through the model.
 */
export function buildSummarizePrompt(items: readonly CondensedItem[]): string {
  return [
    "You are compressing the tool calls, tool results, internal reasoning and system notes from a coding-agent transcript. The user's and the assistant's visible messages are preserved verbatim elsewhere and are not restated here — do not restate them.",
    "",
    "For EACH numbered item below output exactly one line in the form `N. <summary>` — nothing else: no preamble, no headers, no markdown.",
    "",
    "Rules:",
    "- Max ~25 words per line. One line per item, same number, in order.",
    "- Keep exact file paths, commands, APIs, error strings and numbers.",
    "- Tool call: what it did and the outcome (what was read, changed or found, or the error).",
    "- Reasoning: the conclusion reached, not the process.",
    "- Note: the one fact worth keeping, if any.",
    "",
    "Items:",
    ...items.map(renderItem),
  ].join("\n")
}

/** Parse `N. <line>` output back into a map keyed by item index. */
export function parseSummaries(text: string): Map<number, string> {
  const result = new Map<number, string>()
  for (const match of text.matchAll(/^\s*(\d+)[.)\-]?\s+(.+)$/gm)) {
    const index = Number(match[1])
    const line = match[2].trim()
    if (Number.isNaN(index) || !line) continue
    result.set(index, line.length > SUMMARY_LINE_MAX_CHARS ? line.slice(0, SUMMARY_LINE_MAX_CHARS) : line)
  }
  return result
}

export const TRANSCRIPT_PREAMBLE =
  "The following is a compacted record of the conversation so far. User and assistant messages are preserved verbatim, word for word. Tool calls, tool results, internal reasoning and system notes have been condensed to one line each, marked [tool], [thinking] or [note]."

export function assembleTranscript(input: {
  readonly segments: readonly Segment[]
  readonly summaries: ReadonlyMap<number, string>
  readonly previousSummary?: string
  readonly context?: readonly string[]
}): string {
  const lines: string[] = [TRANSCRIPT_PREAMBLE]
  if (input.previousSummary) lines.push(`[Earlier compaction]\n${input.previousSummary}`)
  let index = 0
  for (const segment of input.segments) {
    if (segment.type === "text") {
      lines.push(`[${segment.role === "user" ? "User" : "Assistant"}]: ${segment.text}`)
      continue
    }
    if (segment.type === "file") {
      lines.push(`[Attached ${segment.mime}: ${segment.filename ?? "file"}]`)
      continue
    }
    index++
    const summary = input.summaries.get(index) ?? mechanicalSummary(segment)
    const marker = segment.type === "tool" ? "tool" : segment.type === "reasoning" ? "thinking" : "note"
    lines.push(`[${marker}]: ${summary}`)
  }
  for (const extra of input.context ?? []) if (extra) lines.push(extra)
  return lines.filter(Boolean).join("\n\n")
}

/**
 * Everything a pipeline needs to run transcript mode over a head: the
 * condensable items, the summarizer prompt (when there is anything to
 * condense), final assembly, and a worst-case token estimate.
 */
export function buildTranscriptCompaction(input: {
  readonly segments: readonly Segment[]
  readonly previousSummary?: string
  readonly context?: readonly string[]
}): {
  readonly items: readonly CondensedItem[]
  readonly prompt: string | undefined
  readonly assemble: (summaries: ReadonlyMap<number, string>) => string
  readonly estimateTokens: number
} {
  const items: CondensedItem[] = []
  for (const segment of input.segments) {
    if (segment.type === "tool" || segment.type === "reasoning" || segment.type === "note")
      items.push({ index: items.length + 1, segment })
  }
  const assemble = (summaries: ReadonlyMap<number, string>) =>
    assembleTranscript({
      segments: input.segments,
      summaries,
      previousSummary: input.previousSummary,
      context: input.context,
    })
  // Mechanical fallback lines bound the worst case for the model's one-liners.
  const estimateTokens = Token.estimate(assemble(new Map()))
  return { items, prompt: items.length > 0 ? buildSummarizePrompt(items) : undefined, assemble, estimateTokens }
}
