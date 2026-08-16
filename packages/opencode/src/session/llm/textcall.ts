import type { LanguageModelV3Middleware, LanguageModelV3StreamPart } from "@ai-sdk/provider"

// B6: text-format tool-call parsing for models that cannot emit native tool
// calls (capabilities.toolcall === false) or sit on the minimal tier, where
// prose-style calls are common. Ports the detection patterns from a
// production router-side prose-call lifting. Conservative by design: a text block
// converts only when the ENTIRE block is tool-call syntax naming a known
// tool; on any ambiguity the text passes through unchanged.

export type Call = { toolName: string; input: string }

const TOOL_CALL_BLOCK = /^<tool_call>\s*([\s\S]*?)\s*<\/tool_call>\s*/
const FENCE_BLOCK = /^```json\s*\n?([\s\S]*?)\n?```$/

// Returns the lifted calls only when the entire trimmed text is tool-call
// syntax: (a) one or more <tool_call>{json}</tool_call> blocks, (b) a fenced
// ```json block, or (c) a bare JSON object, each of the shape
// {"name"|"tool": string, "arguments"|"parameters"|"input": object} with a
// known tool name. Anything else returns undefined.
export function parse(text: string, tools: ReadonlySet<string>): Call[] | undefined {
  const trimmed = text.trim()
  if (trimmed.startsWith("<tool_call>")) {
    const calls: Call[] = []
    let rest = trimmed
    while (rest.length) {
      const match = TOOL_CALL_BLOCK.exec(rest)
      if (!match) return undefined
      const call = lift(json(match[1]), tools)
      if (!call) return undefined
      calls.push(call)
      rest = rest.slice(match[0].length)
    }
    return calls.length ? calls : undefined
  }
  if (trimmed.startsWith("```")) {
    const match = FENCE_BLOCK.exec(trimmed)
    if (!match) return undefined
    const call = lift(json(match[1]), tools)
    return call ? [call] : undefined
  }
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    const call = lift(json(trimmed), tools)
    return call ? [call] : undefined
  }
  return undefined
}

// A buffered text block is held back only while it can still become one of
// the detected shapes; the moment the prefix diverges it flushes as ordinary
// text so prose streams with minimal delay.
const PREFIXES = ["<tool_call>", "```json"]
export function plausible(buffer: string): boolean {
  const trimmed = buffer.trimStart()
  if (trimmed === "") return true
  if (trimmed.startsWith("{")) return true
  return PREFIXES.some((prefix) => prefix.startsWith(trimmed) || trimmed.startsWith(prefix))
}

export function middleware(tools: ReadonlySet<string>): LanguageModelV3Middleware {
  return {
    specificationVersion: "v3",
    wrapStream: async ({ doStream }) => {
      const result = await doStream()
      return { ...result, stream: result.stream.pipeThrough(transform(tools)) }
    },
  }
}

export function transform(tools: ReadonlySet<string>) {
  type Held = { start: LanguageModelV3StreamPart; buffer: string }
  const held = new Map<string, Held>()
  let lifted = 0
  const flush = (controller: TransformStreamDefaultController<LanguageModelV3StreamPart>, id: string, state: Held) => {
    controller.enqueue(state.start)
    if (state.buffer) controller.enqueue({ type: "text-delta", id, delta: state.buffer })
  }
  return new TransformStream<LanguageModelV3StreamPart, LanguageModelV3StreamPart>({
    transform(part, controller) {
      if (part.type === "text-start") {
        held.set(part.id, { start: part, buffer: "" })
        return
      }
      if (part.type === "text-delta") {
        const state = held.get(part.id)
        if (!state) {
          controller.enqueue(part)
          return
        }
        state.buffer += part.delta
        if (plausible(state.buffer)) return
        held.delete(part.id)
        flush(controller, part.id, state)
        return
      }
      if (part.type === "text-end") {
        const state = held.get(part.id)
        if (!state) {
          controller.enqueue(part)
          return
        }
        held.delete(part.id)
        const calls = parse(state.buffer, tools)
        if (calls) {
          for (const call of calls) {
            lifted += 1
            controller.enqueue({
              type: "tool-call",
              toolCallId: `textcall_${lifted}_${Date.now().toString(36)}`,
              toolName: call.toolName,
              input: call.input,
            })
          }
          return
        }
        flush(controller, part.id, state)
        controller.enqueue(part)
        return
      }
      if (part.type === "finish" && lifted > 0 && part.finishReason.unified === "stop") {
        // A native tool-calling model reports tool-calls here; mirror it so
        // the step loop continues into tool execution instead of ending the
        // turn on the source text's stop.
        controller.enqueue({ ...part, finishReason: { ...part.finishReason, unified: "tool-calls" } })
        return
      }
      controller.enqueue(part)
    },
    flush(controller) {
      // Aborted or truncated streams: never swallow held text.
      for (const [id, state] of held) flush(controller, id, state)
      held.clear()
    },
  })
}

function lift(value: unknown, tools: ReadonlySet<string>): Call | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  const name = record["name"] ?? record["tool"]
  if (typeof name !== "string" || !tools.has(name)) return undefined
  const args = record["arguments"] ?? record["parameters"] ?? record["input"] ?? {}
  if (typeof args !== "object" || args === null || Array.isArray(args)) return undefined
  return { toolName: name, input: JSON.stringify(args) }
}

function json(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

export * as LLMTextCall from "./textcall"
