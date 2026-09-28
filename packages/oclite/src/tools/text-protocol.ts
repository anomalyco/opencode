import { Option, Schema } from "effect"
import type { ToolDefinition } from "@opencode-ai/llm"

// Fallback for servers without a tool-call parser (SPEC §10): one JSON call per turn in the reply text.
const GRAMMAR = `To use a tool, reply with exactly one block and nothing after it:
\`\`\`json
{"tool": "<name>", "args": {<arguments>}}
\`\`\`
Use only the argument names listed. One tool per turn; wait for its result before the next call. To answer without a tool, reply in plain text with no JSON block.
Tools:`

const decodeJson = Schema.decodeUnknownOption(Schema.UnknownFromJsonString)
const CALL_KEY = /"(tool|name)"\s*:/

export function grammar(tools: readonly ToolDefinition[]) {
  return [GRAMMAR, ...tools.map(signature)].join("\n")
}

/**
 * Tolerant parse of a text-protocol reply: Hermes/Qwen `<tool_call>` tags, fenced ```json blocks, then bare JSON.
 * Only the first call is used. No call and no call-shaped block → `{}` (a plain answer).
 */
export function parse(text: string): { call?: { name: string; input: unknown }; error?: string } {
  const tagged = [...text.matchAll(/<tool_call>([\s\S]*?)<\/tool_call>/g)].map((match) => match[1])
  const fenced = [...text.matchAll(/```(?:json)?[ \t]*\n([\s\S]*?)```/g)]
    .map((match) => match[1])
    .filter((block) => CALL_KEY.test(block))
  const blocks = tagged.length || fenced.length ? [...tagged, ...fenced] : bare(text)
  if (blocks.length === 0) return {}
  const results = blocks.map(toCall)
  const first = results.find((result) => result.call)
  if (first) return { call: first.call }
  return { error: results[0].error }
}

function toCall(block: string): { call?: { name: string; input: unknown }; error?: string } {
  const source = block.trim()
  const value = Option.getOrUndefined(Option.orElse(decodeJson(source), () => decodeJson(repair(source))))
  if (!isRecord(value))
    return { error: `Malformed tool call: invalid JSON. Reply with {"tool": "<name>", "args": {...}}.` }
  const name = typeof value.tool === "string" ? value.tool : value.name
  if (typeof name !== "string" || !name)
    return { error: `Malformed tool call: missing "tool". Reply with {"tool": "<name>", "args": {...}}.` }
  const args = value.args ?? value.arguments ?? value.parameters ?? {}
  // OpenAI-style `arguments` arrive as a JSON string.
  const input = typeof args === "string" ? Option.getOrUndefined(decodeJson(args)) : args
  if (!isRecord(input)) return { error: `Malformed tool call: "args" must be an object.` }
  return { call: { name, input } }
}

/** Removes commas before `}` or `]` outside strings. It only deletes characters, so no key or value is added. */
export function repair(json: string) {
  const state = { string: false, escaped: false }
  const out: string[] = []
  for (const [index, char] of json.split("").entries()) {
    if (state.string) {
      if (state.escaped) state.escaped = false
      else if (char === "\\") state.escaped = true
      else if (char === '"') state.string = false
      out.push(char)
      continue
    }
    if (char === '"') state.string = true
    if (char === "," && /^\s*[}\]]/.test(json.slice(index + 1))) continue
    out.push(char)
  }
  return out.join("")
}

// Balanced `{…}` spans (string-aware) that look like a call, for replies without tags or fences.
function bare(text: string) {
  const spans: string[] = []
  const state = { depth: 0, start: -1, string: false, escaped: false }
  for (const [index, char] of text.split("").entries()) {
    if (state.string) {
      if (state.escaped) state.escaped = false
      else if (char === "\\") state.escaped = true
      else if (char === '"') state.string = false
      continue
    }
    if (char === '"' && state.depth > 0) state.string = true
    if (char === "{" && state.depth++ === 0) state.start = index
    if (char === "}" && state.depth > 0 && --state.depth === 0) spans.push(text.slice(state.start, index + 1))
  }
  return spans.filter((span) => CALL_KEY.test(span))
}

function signature(tool: ToolDefinition) {
  type Property = { type?: unknown; anyOf?: Property[] }
  const schema = tool.inputSchema as { properties?: Record<string, Property>; required?: readonly string[] }
  // Optional fields render as `anyOf: [T, null]`; show T.
  const type = (property: Property) => property.type ?? property.anyOf?.find((item) => item.type !== "null")?.type
  const args = Object.entries(schema.properties ?? {}).map(([key, property]) => {
    const name = type(property)
    return `${key}${schema.required?.includes(key) ? "" : "?"}: ${typeof name === "string" ? name : "any"}`
  })
  return `- ${tool.name}(${args.join(", ")}): ${tool.description}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
