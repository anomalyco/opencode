/**
 * Kimi K2 Thinking model tool call parser
 *
 * Kimi K2 Thinking uses special tokens for tool calls:
 * - <|tool_calls_section_begin|> / <|tool_calls_section_end|> wraps all tool calls
 * - <|tool_call_begin|> / <|tool_call_end|> wraps each tool call
 * - <|tool_call_argument_begin|> separates tool ID from arguments
 *
 * Tool ID format: "functions.{func_name}:{idx}"
 *
 * Example:
 * <|tool_calls_section_begin|><|tool_call_begin|>functions.get_weather:0<|tool_call_argument_begin|>{"city":"Beijing"}<|tool_call_end|><|tool_calls_section_end|>
 */

export interface KimiToolCall {
  id: string
  type: "function"
  function: {
    name: string
    arguments: string
  }
}

const TOOL_CALLS_SECTION_BEGIN = "<|tool_calls_section_begin|>"
const TOOL_CALLS_SECTION_END = "<|tool_calls_section_end|>"

const TOOL_CALL_PATTERN =
  /<\|tool_call_begin\|>\s*(?<id>[\w\.:\-]+)\s*<\|tool_call_argument_begin\|>\s*(?<arguments>[\s\S]*?)\s*<\|tool_call_end\|>/g

/**
 * Check if content contains Kimi K2 special tool call tokens
 */
export function hasKimiToolCalls(content: string | null | undefined): boolean {
  if (!content) return false
  return content.includes(TOOL_CALLS_SECTION_BEGIN)
}

/**
 * Extract tool calls from Kimi K2 Thinking format
 *
 * @param content - Raw content that may contain Kimi tool call tokens
 * @returns Array of parsed tool calls in OpenAI format
 */
export function extractKimiToolCalls(content: string): KimiToolCall[] {
  if (!hasKimiToolCalls(content)) return []

  const toolCalls: KimiToolCall[] = []

  // Reset regex state
  TOOL_CALL_PATTERN.lastIndex = 0

  let match
  while ((match = TOOL_CALL_PATTERN.exec(content)) !== null) {
    const { id, arguments: args } = match.groups!

    // Parse function name from ID format: "functions.get_weather:0"
    const name = parseKimiFunctionName(id)
    if (!name) continue

    toolCalls.push({
      id,
      type: "function",
      function: {
        name,
        arguments: args.trim(),
      },
    })
  }

  return toolCalls
}

/**
 * Parse function name from Kimi tool call ID
 *
 * ID format: "functions.{func_name}:{idx}"
 * Example: "functions.get_weather:0" -> "get_weather"
 */
function parseKimiFunctionName(id: string): string | null {
  if (!id) return null

  // Handle format: functions.name:idx
  const parts = id.split(".")
  if (parts.length < 2) return null

  const nameWithIdx = parts.slice(1).join(".")
  const name = nameWithIdx.split(":")[0]

  return name || null
}

/**
 * Remove Kimi tool call tokens from content, leaving only regular text
 *
 * @param content - Raw content with potential Kimi tokens
 * @returns Content with tool call sections removed
 */
export function stripKimiToolCallTokens(content: string): string {
  if (!hasKimiToolCalls(content)) return content

  // Remove entire tool_calls_section
  const sectionPattern = /<\|tool_calls_section_begin\|>[\s\S]*?<\|tool_calls_section_end\|>/g
  return content.replace(sectionPattern, "").trim()
}

/**
 * Process Kimi K2 response content - extract tool calls and clean content
 *
 * @param content - Raw content from Kimi K2 Thinking model
 * @returns Object with cleaned content and extracted tool calls
 */
export function processKimiContent(content: string | null | undefined): {
  content: string
  toolCalls: KimiToolCall[]
} {
  if (!content) {
    return { content: "", toolCalls: [] }
  }

  const toolCalls = extractKimiToolCalls(content)
  const cleanedContent = stripKimiToolCallTokens(content)

  return {
    content: cleanedContent,
    toolCalls,
  }
}

export interface KimiStreamState {
  buffer: string
  emittedToolCallIndices: Set<number>
  isInToolCallSection: boolean
}

export function createKimiStreamParser() {
  const state: KimiStreamState = {
    buffer: "",
    emittedToolCallIndices: new Set(),
    isInToolCallSection: false,
  }

  return {
    append(content: string): {
      textToEmit: string
      toolCalls: Array<KimiToolCall & { index: number }>
      isComplete: boolean
    } {
      state.buffer += content

      const result: {
        textToEmit: string
        toolCalls: Array<KimiToolCall & { index: number }>
        isComplete: boolean
      } = {
        textToEmit: "",
        toolCalls: [],
        isComplete: false,
      }

      if (!state.isInToolCallSection && state.buffer.includes(TOOL_CALLS_SECTION_BEGIN)) {
        state.isInToolCallSection = true
        const idx = state.buffer.indexOf(TOOL_CALLS_SECTION_BEGIN)
        result.textToEmit = state.buffer.substring(0, idx)
        state.buffer = state.buffer.substring(idx)
      }

      if (!state.isInToolCallSection) {
        result.textToEmit = state.buffer
        state.buffer = ""
        return result
      }

      if (state.buffer.includes(TOOL_CALLS_SECTION_END)) {
        result.isComplete = true
        const toolCalls = extractKimiToolCalls(state.buffer)
        toolCalls.forEach((tc, idx) => {
          if (!state.emittedToolCallIndices.has(idx)) {
            state.emittedToolCallIndices.add(idx)
            result.toolCalls.push({ ...tc, index: idx })
          }
        })
        state.buffer = ""
        return result
      }

      TOOL_CALL_PATTERN.lastIndex = 0
      const matches = [...state.buffer.matchAll(TOOL_CALL_PATTERN)]
      matches.forEach((match, idx) => {
        if (!state.emittedToolCallIndices.has(idx)) {
          const { id, arguments: args } = match.groups!
          const name = id.split(".")[1]?.split(":")[0]
          if (name) {
            state.emittedToolCallIndices.add(idx)
            result.toolCalls.push({
              id,
              type: "function",
              function: { name, arguments: args.trim() },
              index: idx,
            })
          }
        }
      })

      return result
    },

    reset() {
      state.buffer = ""
      state.emittedToolCallIndices.clear()
      state.isInToolCallSection = false
    },
  }
}
