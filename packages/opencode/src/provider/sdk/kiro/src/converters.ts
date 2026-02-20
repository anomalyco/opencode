import type {
  LanguageModelV2FunctionTool,
  LanguageModelV2Prompt,
  LanguageModelV2ToolCallPart,
  LanguageModelV2ToolResultPart,
} from "@ai-sdk/provider"

export interface KiroTool {
  toolSpecification: {
    name: string
    description: string
    inputSchema: { json: object }
  }
}

export interface KiroToolResult {
  content: Array<{ text: string }>
  status: "success" | "error"
  toolUseId: string
}

export interface KiroEnvState {
  operatingSystem: string
  currentWorkingDirectory: string
}

export interface KiroHistoryItem {
  userInputMessage?: {
    content: string
    modelId: string
    origin: string
    userInputMessageContext?: {
      tools?: KiroTool[]
      toolResults?: KiroToolResult[]
      envState?: KiroEnvState
    }
  }
  assistantResponseMessage?: {
    content: string
    messageId?: string
    modelId?: string
    toolUses?: Array<{
      name: string
      toolUseId: string
      input: unknown
    }>
    reasoning?: {
      thinking?: string
    }
  }
}

export interface KiroPayload {
  conversationState: {
    chatTriggerType: "MANUAL"
    conversationId: string
    currentMessage: {
      userInputMessage: {
        content: string
        modelId: string
        origin: string
        userInputMessageContext?: {
          tools?: KiroTool[]
          toolResults?: KiroToolResult[]
          envState?: KiroEnvState
        }
      }
    }
    history: KiroHistoryItem[]
  }
  profileArn?: string
}

function extractTextContent(
  content:
    | string
    | Array<
        | { type: "text"; text: string }
        | { type: "image"; image: unknown; mimeType?: string }
        | { type: "file"; data: unknown; mimeType?: string }
      >,
): string {
  if (typeof content === "string") return content
  return content
    .filter((part): part is { type: "text"; text: string } => part.type === "text")
    .map((part) => part.text)
    .join("")
}

/**
 * Sanitizes JSON Schema from fields that Kiro API doesn't accept.
 *
 * Kiro API returns 400 "Improperly formed request" error if:
 * - required is an empty array []
 * - additionalProperties is present in schema
 */
function sanitizeJsonSchema(schema: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!schema) return {}

  const result: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(schema)) {
    // Skip empty required arrays
    if (key === "required" && Array.isArray(value) && value.length === 0) {
      continue
    }

    // Skip additionalProperties - Kiro API doesn't support it
    if (key === "additionalProperties") {
      continue
    }

    // Recursively process nested objects
    if (key === "properties" && typeof value === "object" && value !== null) {
      const properties: Record<string, unknown> = {}
      for (const [propName, propValue] of Object.entries(value as Record<string, unknown>)) {
        properties[propName] =
          typeof propValue === "object" && propValue !== null
            ? sanitizeJsonSchema(propValue as Record<string, unknown>)
            : propValue
      }
      result[key] = properties
    } else if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      result[key] = sanitizeJsonSchema(value as Record<string, unknown>)
    } else if (Array.isArray(value)) {
      // Process arrays (e.g., anyOf, oneOf)
      result[key] = value.map((item) =>
        typeof item === "object" && item !== null ? sanitizeJsonSchema(item as Record<string, unknown>) : item,
      )
    } else {
      result[key] = value
    }
  }

  return result
}

function convertTools(tools?: LanguageModelV2FunctionTool[]): KiroTool[] | undefined {
  if (!tools || tools.length === 0) return undefined

  return tools.map((tool) => ({
    toolSpecification: {
      name: tool.name,
      description: tool.description || `Tool: ${tool.name}`,
      inputSchema: { json: sanitizeJsonSchema(tool.inputSchema as Record<string, unknown>) },
    },
  }))
}

function convertToolResults(parts: LanguageModelV2ToolResultPart[]): KiroToolResult[] {
  return parts.map((part) => {
    let outputText: string

    // Handle LanguageModelV2ToolResultOutput format
    const output = part.output as unknown
    if (output && typeof output === "object" && "type" in output && "value" in output) {
      // Standard LanguageModelV2ToolResultOutput format: { type: 'text'|'json'|'error-text', value: ... }
      const typed = output as { type: string; value: unknown }
      if (typed.type === "text" || typed.type === "error-text") {
        outputText = String(typed.value)
      } else if (typed.type === "json") {
        outputText = JSON.stringify(typed.value)
      } else {
        outputText = JSON.stringify(typed.value)
      }
    } else if (Array.isArray(output)) {
      // Array of content parts (legacy format)
      outputText = output
        .map((item) => {
          if (typeof item === "string") return item
          if (item && typeof item === "object" && "text" in item) return String(item.text)
          if (item && typeof item === "object" && "value" in item) return String(item.value)
          return JSON.stringify(item)
        })
        .join("")
    } else if (typeof output === "string") {
      // Direct string (legacy format)
      outputText = output
    } else {
      // Fallback
      outputText = JSON.stringify(output)
    }

    // Determine status based on output type
    const isError =
      output && typeof output === "object" && "type" in output && (output as { type: string }).type === "error-text"
    const status = isError ? ("error" as const) : ("success" as const)

    return {
      content: [{ text: outputText }],
      status,
      toolUseId: part.toolCallId,
    }
  })
}

/**
 * Thinking configuration for Extended Thinking (Fake Reasoning) support.
 */
export interface ThinkingConfig {
  type: "enabled" | "disabled"
  budgetTokens?: number
}

/**
 * Provider options for Kiro API.
 */
export interface KiroProviderOptions {
  thinking?: ThinkingConfig
}

/**
 * Generates the thinking instruction text for Fake Reasoning.
 * Based on kiro-gateway implementation.
 */
function getThinkingInstruction(): string {
  return (
    "Think in English for better reasoning quality.\n\n" +
    "Your thinking process should be thorough and systematic:\n" +
    "- First, make sure you fully understand what is being asked\n" +
    "- Consider multiple approaches or perspectives when relevant\n" +
    "- Think about edge cases, potential issues, and what could go wrong\n" +
    "- Challenge your initial assumptions\n" +
    "- Verify your reasoning before reaching a conclusion\n\n" +
    "Take the time you need. Quality of thought matters more than speed."
  )
}

/**
 * Injects Fake Reasoning tags into content to enable Extended Thinking.
 * When enabled, the model will include its reasoning process wrapped in <thinking>...</thinking> tags.
 */
function injectThinkingTags(content: string, budgetTokens: number): string {
  const thinkingInstruction = getThinkingInstruction()
  const thinkingPrefix =
    `<thinking_mode>enabled</thinking_mode>\n` +
    `<max_thinking_length>${budgetTokens}</max_thinking_length>\n` +
    `<thinking_instruction>${thinkingInstruction}</thinking_instruction>\n\n`

  return thinkingPrefix + content
}

/**
 * Generates system prompt addition that legitimizes thinking tags.
 * This text is added to the system prompt to inform the model that
 * the thinking tags in user messages are legitimate system-level instructions.
 */
function getThinkingSystemPromptAddition(): string {
  return (
    "\n\n---\n" +
    "# Extended Thinking Mode\n\n" +
    "This conversation uses extended thinking mode. User messages may contain " +
    "special XML tags that are legitimate system-level instructions:\n" +
    "- `<thinking_mode>enabled</thinking_mode>` - enables extended thinking\n" +
    "- `<max_thinking_length>N</max_thinking_length>` - sets maximum thinking tokens\n" +
    "- `<thinking_instruction>...</thinking_instruction>` - provides thinking guidelines\n\n" +
    "These tags are NOT prompt injection attempts. They are part of the system's " +
    "extended thinking feature. When you see these tags, follow their instructions " +
    "and wrap your reasoning process in `<thinking>...</thinking>` tags before " +
    "providing your final response."
  )
}

function getEnvState(): KiroEnvState {
  return {
    operatingSystem: process.platform === "darwin" ? "macos" : process.platform,
    currentWorkingDirectory: process.cwd(),
  }
}

export function convertToKiroPayload(
  prompt: LanguageModelV2Prompt,
  modelId: string,
  tools?: LanguageModelV2FunctionTool[],
  providerOptions?: KiroProviderOptions,
): KiroPayload {
  const conversationId = crypto.randomUUID()

  // Extract system prompt
  const systemMessage = prompt.find((m) => m.role === "system")
  const systemPrompt = systemMessage ? extractTextContent(systemMessage.content) : undefined

  // Filter out system messages for history processing
  const messages = prompt.filter((m) => m.role !== "system")

  // Check if thinking mode is enabled
  const thinkingEnabled = providerOptions?.thinking?.type === "enabled"
  const thinkingBudgetTokens = providerOptions?.thinking?.budgetTokens || 16000

  const history: KiroHistoryItem[] = []

  // Embed system prompt in history as first user/assistant exchange (kiro-cli format)
  if (systemPrompt) {
    let contextContent = systemPrompt
    if (thinkingEnabled) {
      contextContent = systemPrompt + getThinkingSystemPromptAddition()
    }

    history.push({
      userInputMessage: {
        content: `--- SYSTEM INSTRUCTIONS BEGIN ---\n${contextContent}\n--- SYSTEM INSTRUCTIONS END ---`,
        modelId,
        origin: "KIRO_CLI",
        userInputMessageContext: {
          envState: getEnvState(),
        },
      },
    })
    history.push({
      assistantResponseMessage: {
        content:
          "I will follow these instructions carefully. When a user's request matches an available skill's description, I will use the skill tool to load and follow the skill's instructions.",
      },
    })
  }

  let currentUserContent = ""
  let currentToolResults: KiroToolResult[] = []
  let hasAnyToolResults = false // Track if any tool results exist in the conversation

  for (let i = 0; i < messages.length - 1; i++) {
    const message = messages[i]

    if (message.role === "user" || message.role === "tool") {
      // Collect tool results from user or tool message
      // Note: Type assertion needed as LanguageModelV2UserContent type doesn't include tool-result
      // but the AI SDK actually sends tool results in user messages
      // Also, AI SDK sends tool role messages containing tool results
      const toolResultParts: LanguageModelV2ToolResultPart[] = []
      const contentArray = Array.isArray(message.content) ? message.content : [message.content]
      for (const part of contentArray as unknown as Array<{ type: string } & Record<string, unknown>>) {
        if (part.type === "tool-result") {
          toolResultParts.push(part as unknown as LanguageModelV2ToolResultPart)
        }
      }
      if (toolResultParts.length > 0) {
        currentToolResults.push(...convertToolResults(toolResultParts))
        hasAnyToolResults = true
      }

      // Collect text content (only for user role, tool role doesn't have text)
      if (message.role === "user") {
        const textContent = message.content
          .filter((part): part is { type: "text"; text: string } => part.type === "text")
          .map((part) => part.text)
          .join("")
        if (textContent) {
          currentUserContent = textContent
        }
      }
    } else if (message.role === "assistant") {
      // Flush pending user message before processing assistant response
      // Skip if content is empty/whitespace-only AND no tool results
      if ((currentUserContent && currentUserContent.trim()) || currentToolResults.length > 0) {
        // Check if the previous history item is also a user message
        // Kiro API requires alternating user/assistant messages, so we merge consecutive users
        const lastItem = history[history.length - 1]
        if (lastItem?.userInputMessage && !lastItem.assistantResponseMessage) {
          // Merge with previous user message
          const lastUser = lastItem.userInputMessage
          if (currentUserContent && currentUserContent.trim()) {
            lastUser.content = (lastUser.content ? lastUser.content + "\n\n" : "") + currentUserContent
          }
          // Merge toolResults if present
          if (currentToolResults.length > 0) {
            if (!lastUser.userInputMessageContext) lastUser.userInputMessageContext = {}
            if (!lastUser.userInputMessageContext.toolResults) lastUser.userInputMessageContext.toolResults = []
            lastUser.userInputMessageContext.toolResults.push(...currentToolResults)
          }
        } else {
          // Normal case: add new history item
          const historyItem: KiroHistoryItem = {
            userInputMessage: {
              content: currentUserContent,
              modelId,
              origin: "KIRO_CLI",
              userInputMessageContext: {
                ...(currentToolResults.length > 0 && { toolResults: currentToolResults }),
                ...(tools && { tools: convertTools(tools) }),
                envState: getEnvState(),
              },
            },
          }
          history.push(historyItem)
        }
        currentUserContent = ""
        currentToolResults = []
      }

      // Process assistant message
      const textContent = message.content
        .filter((part): part is { type: "text"; text: string } => part.type === "text")
        .map((part) => part.text)
        .join("")

      const toolCalls: LanguageModelV2ToolCallPart[] = []
      for (const part of message.content) {
        if (part.type === "tool-call") {
          toolCalls.push(part as LanguageModelV2ToolCallPart)
        }
      }

      const reasoningParts = message.content.filter(
        (part): part is { type: "reasoning"; text: string } => part.type === "reasoning",
      )

      const assistantItem: KiroHistoryItem = {
        assistantResponseMessage: {
          content: textContent || "(empty)",
          messageId: crypto.randomUUID(),
          modelId,
          ...(toolCalls.length > 0 && {
            toolUses: toolCalls.map((tc) => {
              // input can be a JSON string or object - ensure it's an object
              let inputObj: unknown
              if (typeof tc.input === "string") {
                try {
                  inputObj = JSON.parse(tc.input)
                } catch {
                  inputObj = {}
                }
              } else {
                inputObj = tc.input ?? {}
              }
              return {
                name: tc.toolName,
                toolUseId: tc.toolCallId,
                input: inputObj,
              }
            }),
          }),
          ...(reasoningParts.length > 0 && {
            reasoning: {
              thinking: reasoningParts.map((r) => r.text).join("\n"),
            },
          }),
        },
      }

      // Check if the previous history item is also an assistant message
      // Kiro API requires alternating user/assistant messages, so we merge consecutive assistants
      const lastItem = history[history.length - 1]
      if (lastItem?.assistantResponseMessage) {
        // Merge with previous assistant message
        const lastAssistant = lastItem.assistantResponseMessage
        lastAssistant.content += "\n\n" + (textContent || "(empty)")

        // Merge toolUses if present
        if (toolCalls.length > 0) {
          if (!lastAssistant.toolUses) lastAssistant.toolUses = []
          lastAssistant.toolUses.push(
            ...toolCalls.map((tc) => {
              let inputObj: unknown
              if (typeof tc.input === "string") {
                try {
                  inputObj = JSON.parse(tc.input)
                } catch {
                  inputObj = {}
                }
              } else {
                inputObj = tc.input ?? {}
              }
              return {
                name: tc.toolName,
                toolUseId: tc.toolCallId,
                input: inputObj,
              }
            }),
          )
        }

        // Merge reasoning if present
        if (reasoningParts.length > 0) {
          if (!lastAssistant.reasoning) lastAssistant.reasoning = { thinking: "" }
          lastAssistant.reasoning.thinking =
            (lastAssistant.reasoning.thinking ? lastAssistant.reasoning.thinking + "\n" : "") +
            reasoningParts.map((r) => r.text).join("\n")
        }
      } else {
        // Normal case: add new history item
        history.push(assistantItem)
      }
    }
  }

  // Process the last message as current message
  const lastMessage = messages[messages.length - 1]
  let lastUserContent = ""
  let lastToolResults: KiroToolResult[] = []

  if (lastMessage?.role === "user" || lastMessage?.role === "tool") {
    const toolResultParts: LanguageModelV2ToolResultPart[] = []
    const contentArray = Array.isArray(lastMessage.content) ? lastMessage.content : [lastMessage.content]
    for (const part of contentArray as unknown as Array<{ type: string } & Record<string, unknown>>) {
      if (part.type === "tool-result") {
        toolResultParts.push(part as unknown as LanguageModelV2ToolResultPart)
      }
    }
    if (toolResultParts.length > 0) {
      lastToolResults = convertToolResults(toolResultParts)
      hasAnyToolResults = true
    }

    // Collect text content (only for user role, tool role doesn't have text)
    if (lastMessage.role === "user") {
      const textContent = lastMessage.content
        .filter((part): part is { type: "text"; text: string } => part.type === "text")
        .map((part) => part.text)
        .join("")
      lastUserContent = textContent
    }
  }

  // Build userInputMessageContext - only include if has content
  const userInputMessageContext: {
    tools?: KiroTool[]
    toolResults?: KiroToolResult[]
    envState?: KiroEnvState
  } = {}

  const kiroTools = convertTools(tools)
  if (kiroTools) {
    userInputMessageContext.tools = kiroTools
  }

  if (lastToolResults.length > 0) {
    userInputMessageContext.toolResults = lastToolResults
  }

  userInputMessageContext.envState = getEnvState()

  // Inject thinking tags into user content if thinking mode is enabled
  let finalUserContent = lastUserContent || "."
  if (thinkingEnabled && lastUserContent) {
    finalUserContent = injectThinkingTags(lastUserContent, thinkingBudgetTokens)
  }

  // Build userInputMessage
  const userInputMessage: {
    content: string
    modelId: string
    origin: string
    userInputMessageContext?: typeof userInputMessageContext
  } = {
    content: finalUserContent, // Use minimal content to avoid triggering AI to "continue"
    modelId,
    origin: "KIRO_CLI",
  }

  // Only add userInputMessageContext if it has content
  if (Object.keys(userInputMessageContext).length > 0) {
    userInputMessage.userInputMessageContext = userInputMessageContext
  }

  // If no tools are defined in this request, strip all toolUses/toolResults from history.
  // Kiro API rejects requests with toolUses in history but no tools definition (e.g. compaction).
  if (!kiroTools) {
    for (const item of history) {
      if (item.assistantResponseMessage?.toolUses) delete item.assistantResponseMessage.toolUses
      if (item.userInputMessage?.userInputMessageContext?.toolResults)
        delete item.userInputMessage.userInputMessageContext.toolResults
    }
    const filtered = history.filter((item) => {
      if (
        item.assistantResponseMessage &&
        item.assistantResponseMessage.content === "(empty)" &&
        !item.assistantResponseMessage.reasoning?.thinking?.trim()
      ) {
        delete item.assistantResponseMessage
      }
      if (
        item.userInputMessage &&
        (!item.userInputMessage.content || item.userInputMessage.content === ".") &&
        !item.userInputMessage.userInputMessageContext?.toolResults?.length
      ) {
        delete item.userInputMessage
      }
      return Boolean(item.assistantResponseMessage || item.userInputMessage)
    })
    history.length = 0
    history.push(...filtered)

    // After filtering, consecutive same-role messages can appear (e.g. two assistants
    // when a "." user between them was removed). Kiro API requires alternating roles,
    // so merge consecutive items of the same role.
    for (let i = history.length - 1; i > 0; i--) {
      const prev = history[i - 1]
      const curr = history[i]
      const prevIsUser = !!prev.userInputMessage && !prev.assistantResponseMessage
      const currIsUser = !!curr.userInputMessage && !curr.assistantResponseMessage
      const prevIsAssistant = !!prev.assistantResponseMessage && !prev.userInputMessage
      const currIsAssistant = !!curr.assistantResponseMessage && !curr.userInputMessage

      if (prevIsUser && currIsUser) {
        const p = prev.userInputMessage!
        const c = curr.userInputMessage!
        p.content = [p.content, c.content].filter((t) => t && t !== ".").join("\n\n") || "."
        history.splice(i, 1)
      } else if (prevIsAssistant && currIsAssistant) {
        const p = prev.assistantResponseMessage!
        const c = curr.assistantResponseMessage!
        p.content = [p.content, c.content].filter((t) => t && t !== "(empty)").join("\n\n") || "(empty)"
        if (c.reasoning?.thinking) {
          p.reasoning = p.reasoning ?? { thinking: "" }
          p.reasoning.thinking = [p.reasoning.thinking, c.reasoning.thinking].filter(Boolean).join("\n")
        }
        history.splice(i, 1)
      }
    }
    lastToolResults = []
    delete userInputMessageContext.toolResults
  }

  // Validate entire history: toolUses/toolResults must be paired.
  // After compaction/pruning, these pairs can become mismatched
  // causing "Improperly formed request" error from Kiro API.
  // Strategy: delete orphan toolUses/toolResults to avoid model retrying completed tools.
  for (let i = 0; i < history.length - 1; i++) {
    const item = history[i]
    const next = history[i + 1]
    const uses = item.assistantResponseMessage?.toolUses ?? []
    const results = next?.userInputMessage?.userInputMessageContext?.toolResults ?? []

    if (uses.length > 0 && results.length === 0) {
      delete item.assistantResponseMessage!.toolUses
    } else if (uses.length === 0 && results.length > 0) {
      delete next.userInputMessage!.userInputMessageContext!.toolResults
    } else if (uses.length > 0 && results.length > 0) {
      const resultIds = new Set(results.map((r) => r.toolUseId))
      const useIds = new Set(uses.map((u) => u.toolUseId))
      item.assistantResponseMessage!.toolUses = uses.filter((u) => resultIds.has(u.toolUseId))
      next.userInputMessage!.userInputMessageContext!.toolResults = results.filter((r) => useIds.has(r.toolUseId))
      if (item.assistantResponseMessage!.toolUses.length === 0) delete item.assistantResponseMessage!.toolUses
      if (next.userInputMessage!.userInputMessageContext!.toolResults!.length === 0)
        delete next.userInputMessage!.userInputMessageContext!.toolResults
    }
  }

  // Validate last history item against current message's toolResults
  const lastHistoryItem = history[history.length - 1]
  const lastUses = lastHistoryItem?.assistantResponseMessage?.toolUses ?? []
  if (lastUses.length > 0 && lastToolResults.length === 0) {
    delete lastHistoryItem.assistantResponseMessage!.toolUses
  } else if (lastUses.length === 0 && lastToolResults.length > 0) {
    lastToolResults = []
    delete userInputMessageContext.toolResults
  } else if (lastUses.length > 0 && lastToolResults.length > 0) {
    const resultIds = new Set(lastToolResults.map((r) => r.toolUseId))
    const useIds = new Set(lastUses.map((u) => u.toolUseId))
    lastHistoryItem.assistantResponseMessage!.toolUses = lastUses.filter((u) => resultIds.has(u.toolUseId))
    lastToolResults = lastToolResults.filter((r) => useIds.has(r.toolUseId))
    if (lastHistoryItem.assistantResponseMessage!.toolUses.length === 0)
      delete lastHistoryItem.assistantResponseMessage!.toolUses
    if (lastToolResults.length === 0) delete userInputMessageContext.toolResults
    else userInputMessageContext.toolResults = lastToolResults
  }

  // First history user item should not have orphan toolResults
  if (history.length > 0 && history[0].userInputMessage?.userInputMessageContext?.toolResults?.length) {
    delete history[0].userInputMessage.userInputMessageContext.toolResults
  }

  // Build conversationState
  const conversationState: KiroPayload["conversationState"] = {
    chatTriggerType: "MANUAL",
    conversationId,
    currentMessage: { userInputMessage },
    history,
  }

  return { conversationState }
}
