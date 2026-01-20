import { spawn } from "node:child_process"
import { createInterface } from "node:readline"
import { EventEmitter } from "node:events"
import type {
  LanguageModelV2,
  LanguageModelV2CallWarning,
  LanguageModelV2Content,
  LanguageModelV2FinishReason,
  LanguageModelV2StreamPart,
  LanguageModelV2Usage,
} from "@ai-sdk/provider"
import { generateId } from "@ai-sdk/provider-utils"
import type { ClaudeCodeConfig, ClaudePermissionRequest } from "./claude-code-config"
import { Log } from "@/util/log"
import { Storage } from "@/storage/storage"

const log = Log.create({ service: "claude-code" })

/**
 * Persist Claude CLI session ID for an OpenCode session
 */
async function saveClaudeSessionId(openCodeSessionID: string, claudeSessionId: string) {
  log.info("attempting to persist claude session mapping", { openCodeSessionID, claudeSessionId })
  try {
    await Storage.write(["claude-code-session", openCodeSessionID], { claudeSessionId, timestamp: Date.now() })
    log.info("successfully persisted claude session mapping", { openCodeSessionID, claudeSessionId })
  } catch (e) {
    log.error("failed to persist claude session mapping", {
      openCodeSessionID,
      claudeSessionId,
      error: e instanceof Error ? e.message : String(e),
      stack: e instanceof Error ? e.stack : undefined,
    })
  }
}

/**
 * Load persisted Claude CLI session ID for an OpenCode session
 */
async function loadClaudeSessionId(openCodeSessionID: string): Promise<string | undefined> {
  log.info("attempting to load persisted claude session mapping", { openCodeSessionID })
  try {
    const data = await Storage.read<{ claudeSessionId: string; timestamp?: number }>(["claude-code-session", openCodeSessionID])
    if (data?.claudeSessionId) {
      log.info("successfully loaded persisted claude session mapping", {
        openCodeSessionID,
        claudeSessionId: data.claudeSessionId,
        savedAt: data.timestamp ? new Date(data.timestamp).toISOString() : "unknown",
      })
      return data.claudeSessionId
    }
    log.warn("persisted mapping found but claudeSessionId is missing", { openCodeSessionID, data })
  } catch (e) {
    // Check if it's a NotFoundError (expected for new sessions)
    if (e && typeof e === "object" && "name" in e && e.name === "NotFoundError") {
      log.info("no persisted session mapping found (new session)", { openCodeSessionID })
    } else {
      log.warn("unexpected error loading persisted session mapping", {
        openCodeSessionID,
        error: e instanceof Error ? e.message : String(e),
      })
    }
  }
  return undefined
}

/**
 * Claude CLI stream-json message types.
 * The CLI outputs various message types during a conversation.
 */
interface ClaudeStreamMessage {
  type: string
  subtype?: string

  // For assistant messages
  message?: {
    role?: string
    model?: string
    content?: Array<{
      type: string
      text?: string
      name?: string
      input?: unknown
      id?: string
      tool_use_id?: string
      content?: string | Array<{ type: string; text?: string }>
      thinking?: string
    }>
  }

  // For tool_use events
  tool?: {
    name?: string
    id?: string
    input?: unknown
  }

  // For tool_result events
  tool_result?: {
    tool_use_id?: string
    content?: string | Array<{ type: string; text?: string }>
    is_error?: boolean
  }

  // Session and metadata
  session_id?: string
  total_cost_usd?: number
  duration_ms?: number
  duration_api_ms?: number
  request_id?: string
  id?: string
  result?: string
  is_error?: boolean
  num_turns?: number

  // Permission denials (in result message)
  permission_denials?: Array<{
    tool_name: string
    tool_use_id: string
    tool_input: unknown
  }>

  // Permission requests
  permission?: {
    id?: string
    type?: string
    tool?: string
    path?: string
    command?: string
  }

  // Usage stats
  usage?: {
    input_tokens?: number
    output_tokens?: number
    cache_read_input_tokens?: number
    cache_creation_input_tokens?: number
  }

  // For content streaming
  content_block?: {
    type: string
    text?: string
    id?: string
    name?: string
    input?: string
    thinking?: string
  }
  delta?: {
    type: string
    text?: string
    partial_json?: string
    thinking?: string
  }
  index?: number
}

// Tools that should be handled by OpenCode, not Claude CLI
// This ensures proper permission handling and state tracking (e.g., read-before-write checks)
const OPENCODE_HANDLED_TOOLS = new Set([
  "Edit",
  "Write",
  "Bash",
  "NotebookEdit",
  "TodoWrite", // Route to OpenCode so todos appear in the UI
  "Read",      // Route to OpenCode so read-before-write checks work
  "Glob",
  "Grep",
])

/**
 * Convert Claude CLI tool input (snake_case) to OpenCode tool input (camelCase)
 */
function mapToolInput(name: string, input: any): any {
  if (!input) return input

  switch (name) {
    case "Write":
      return {
        filePath: input.file_path ?? input.filePath,
        content: input.content,
      }
    case "Edit":
      return {
        filePath: input.file_path ?? input.filePath,
        oldString: input.old_string ?? input.oldString,
        newString: input.new_string ?? input.newString,
        replaceAll: input.replace_all ?? input.replaceAll,
      }
    case "Read":
      return {
        filePath: input.file_path ?? input.filePath,
        offset: input.offset,
        limit: input.limit,
      }
    case "Bash":
      return {
        command: input.command,
        // Provide a default description if not given (OpenCode requires this field)
        description: input.description || `Execute: ${String(input.command || "").slice(0, 50)}${String(input.command || "").length > 50 ? "..." : ""}`,
        timeout: input.timeout,
      }
    case "NotebookEdit":
      return {
        notebookPath: input.notebook_path ?? input.notebookPath,
        cellNumber: input.cell_number ?? input.cellNumber,
        newSource: input.new_source ?? input.newSource,
        cellType: input.cell_type ?? input.cellType,
        editMode: input.edit_mode ?? input.editMode,
      }
    case "Glob":
      return {
        pattern: input.pattern,
        path: input.path,
      }
    case "Grep":
      return {
        pattern: input.pattern,
        path: input.path,
        include: input.include,
      }
    case "TodoWrite":
      // Claude CLI sends todos with: content, status, activeForm
      // OpenCode expects: content, status, priority, id
      if (Array.isArray(input.todos)) {
        const mappedTodos = input.todos.map((todo: any, index: number) => ({
          content: todo.content,
          status: todo.status || "pending",
          priority: todo.priority || "medium",
          // Generate an id if not provided
          id: todo.id || `todo_${Date.now()}_${index}`,
        }))

        // Log the full todo list for visibility
        log.info("TodoWrite - Full todo list from Claude CLI:", {
          count: mappedTodos.length,
          todos: mappedTodos.map((t: any) => `[${t.status}] ${t.content}`),
        })

        // Also log each todo with its status for better visibility
        const pending = mappedTodos.filter((t: any) => t.status === "pending").length
        const inProgress = mappedTodos.filter((t: any) => t.status === "in_progress").length
        const completed = mappedTodos.filter((t: any) => t.status === "completed").length
        log.info(`TodoWrite summary: ${pending} pending, ${inProgress} in progress, ${completed} completed`)

        return { todos: mappedTodos }
      }
      return input
    default:
      return input
  }
}

// Map Claude CLI tool names to OpenCode equivalents
const TOOL_NAME_MAPPING: Record<string, string> = {
  // Claude CLI uses WebSearch, OpenCode might have websearch_web_search_exa or webfetch
  WebSearch: "websearch_web_search_exa",
  web_search: "websearch_web_search_exa",
  // Plan mode
  EnterPlanMode: "plan_enter",
  ExitPlanMode: "plan_exit",
  // Other potential mappings
  AskUserQuestion: "question",
  ask_user_question: "question",
}

function mapTool(
  name: string,
  input?: any,
  forceOpenCodeExecution?: boolean,
): { name: string; input?: any; executed: boolean } {
  // Check for direct tool name mappings first
  if (name === "EnterPlanMode") return { name: "plan_enter", input: {}, executed: false }
  if (name === "ExitPlanMode") return { name: "plan_exit", input: {}, executed: false }

  // Map WebSearch to the available web search tool
  if (name === "WebSearch" || name === "web_search") {
    const mappedInput = input?.query ? { query: input.query } : input
    log.info("mapping WebSearch to websearch_web_search_exa", { originalInput: input, mappedInput })
    return { name: "websearch_web_search_exa", input: mappedInput, executed: false }
  }

  if (name === "TaskOutput") {
    if (!input) return { name: "bash", executed: false }

    // TaskOutput might have 'content' or 'output' or be the object itself
    const output = input?.content || input?.output || JSON.stringify(input)
    return {
      name: "bash",
      input: {
        command: `echo "TASK OUTPUT: ${String(output).replace(/"/g, '\\"')}"`,
        description: "Displaying task output",
      },
      executed: false,
    }
  }

  // Map MCP tools from Claude CLI format to OpenCode format
  // Claude CLI: mcp__<server-name>__<tool-name>
  // OpenCode:   <server-name>_<tool-name>
  if (name.startsWith("mcp__")) {
    const parts = name.slice(5).split("__") // Remove "mcp__" prefix and split by "__"
    if (parts.length >= 2) {
      const serverName = parts[0]
      const toolName = parts.slice(1).join("_") // Join remaining parts with "_"
      const openCodeName = `${serverName}_${toolName}`
      log.info("mapping MCP tool", { original: name, mapped: openCodeName })
      return { name: openCodeName, input, executed: false }
    }
  }

  // If forceOpenCodeExecution is true, have OpenCode handle permission-requiring tools
  if (forceOpenCodeExecution && OPENCODE_HANDLED_TOOLS.has(name)) {
    const mappedInput = mapToolInput(name, input)
    // Map tool names to OpenCode's expected names (lowercase)
    // Claude CLI uses PascalCase (Edit, Write, Bash), OpenCode uses lowercase (edit, write, bash)
    const openCodeName = name.toLowerCase()
    log.info("routing tool to OpenCode for permission handling", { name, openCodeName, hasInput: !!input, hasMappedInput: !!mappedInput })
    return { name: openCodeName, input: mappedInput, executed: false }
  }

  // Check if there's a mapping for this tool name
  const mappedName = TOOL_NAME_MAPPING[name]
  if (mappedName) {
    log.info("mapped tool name", { original: name, mapped: mappedName })
    return { name: mappedName, input, executed: false }
  }

  return { name, input, executed: true }
}

const handledToolCalls = new Set<string>()

// Permission denial patterns to detect in Claude CLI output
const PERMISSION_DENIAL_PATTERNS = [
  /Claude requested permissions? to (?:write|edit|modify|create|delete) (?:to )?(?:the file )?[`"']?([^`"'\n]+)[`"']?/i,
  /but you haven'?t granted (?:it|permission) yet/i,
  /Could you grant me permission to (?:edit|write|modify|create|delete)/i,
  /I (?:don'?t|do not) have permission to/i,
  /Permission denied/i,
  /I need permission to (?:edit|write|modify|create|delete)/i,
  /I'?ll need (?:your )?permission to/i,
  /waiting for (?:your )?permission/i,
]

interface DetectedPermissionRequest {
  type: "write" | "read" | "execute" | "unknown"
  path?: string
  description: string
}

function detectPermissionDenial(text: string): DetectedPermissionRequest | null {
  if (!text) return null

  // Check if any denial pattern matches
  let hasPermissionIssue = false
  for (const pattern of PERMISSION_DENIAL_PATTERNS) {
    if (pattern.test(text)) {
      hasPermissionIssue = true
      break
    }
  }

  if (!hasPermissionIssue) return null

  // Try to extract the file path
  const filePatterns = [
    /(?:write|edit|modify|create|delete) (?:to )?(?:the file )?[`"']?([^\s`"']+\.[a-z]+)[`"']?/i,
    /file [`"']?([^\s`"']+\.[a-z]+)[`"']?/i,
    /path [`"']?([^\s`"']+)[`"']?/i,
  ]

  let path: string | undefined
  for (const pattern of filePatterns) {
    const match = text.match(pattern)
    if (match && match[1]) {
      path = match[1]
      break
    }
  }

  // Determine type from text
  let type: "write" | "read" | "execute" | "unknown" = "unknown"
  if (/write|edit|modify|create|delete/i.test(text)) {
    type = "write"
  } else if (/read|view|access/i.test(text)) {
    type = "read"
  } else if (/execute|run|command/i.test(text)) {
    type = "execute"
  }

  log.info("detected permission denial in text", { type, path, textSnippet: text.slice(0, 200) })

  return {
    type,
    path,
    description: text.slice(0, 500),
  }
}

async function handleDetectedPermissionDenial(
  detected: DetectedPermissionRequest,
  stdin: NodeJS.WritableStream | null,
  config: ClaudeCodeConfig,
  sessionID?: string,
): Promise<boolean> {
  log.info("handling detected permission denial", {
    type: detected.type,
    path: detected.path,
    hasHandler: !!config.permissionHandler,
    sessionID,
  })

  let approved = true

  if (config.permissionHandler) {
    try {
      // Create a permission request from the detected info
      const permissionRequest: ClaudePermissionRequest = {
        id: `detected-${Date.now()}`,
        type: detected.type,
        tool: detected.type === "write" ? "Edit" : detected.type === "execute" ? "Bash" : "Read",
        path: detected.path,
        description: detected.description,
      }

      approved = await config.permissionHandler(permissionRequest, sessionID)
      log.info("permission decision for detected denial", {
        type: detected.type,
        path: detected.path,
        approved,
        sessionID,
      })
    } catch (e) {
      log.error("permission handler error for detected denial", { error: e })
      approved = false
    }
  }

  if (approved && stdin) {
    // Send approval message to Claude CLI
    const approvalMessage = JSON.stringify({
      type: "user",
      message: {
        role: "user",
        content: [{ type: "text", text: "Yes, I grant permission. Please proceed." }],
      },
    })
    stdin.write(approvalMessage + "\n")
    log.info("sent permission approval to Claude CLI", { sessionID })
  }

  return approved
}

async function handleQuestion(
  rawInput: any,
  config: ClaudeCodeConfig,
  sessionID: string | undefined,
  proc: import("child_process").ChildProcess,
  toolCallId: string,
) {
  handledToolCalls.add(toolCallId)

  // Log the raw input to see exactly what Claude CLI sends
  log.info("handleQuestion: raw input received", {
    toolCallId,
    rawInputType: typeof rawInput,
    rawInputKeys: rawInput ? Object.keys(rawInput) : [],
    rawInputStringified: JSON.stringify(rawInput)?.slice(0, 500),
  })

  // Normalize input - Claude CLI might send different formats
  // Format 1: { question: string, options?: array }
  // Format 2: { questions: [{ question: string, header?: string, options?: array, multiSelect?: boolean }] }
  let input: { question: string; options?: any[]; custom?: boolean; multiple?: boolean }

  if (rawInput?.questions && Array.isArray(rawInput.questions) && rawInput.questions.length > 0) {
    // Format 2: questions array (Claude CLI's AskUserQuestion tool uses this format)
    const q = rawInput.questions[0]
    input = {
      question: q.question || q.text || "Question?",
      options: q.options || q.answers,
      custom: q.custom ?? true,
      multiple: q.multiple ?? q.multiSelect,
    }
    log.info("handleQuestion: using questions array format", {
      question: input.question,
      optionsCount: input.options?.length,
      hasCustom: input.custom,
      hasMultiple: input.multiple,
    })
  } else {
    // Format 1: direct question field
    input = {
      question: rawInput?.question || rawInput?.text || "Question?",
      options: rawInput?.options || rawInput?.answers,
      custom: rawInput?.custom ?? true,
      multiple: rawInput?.multiple ?? rawInput?.multiSelect,
    }
    log.info("handleQuestion: using direct question format", {
      question: input.question,
      rawKeys: Object.keys(rawInput || {}),
      optionsCount: input.options?.length,
    })
  }

  let answer = ""
  if (config.questionHandler) {
    try {
      answer = await config.questionHandler(input, sessionID)
    } catch {
      // Ignore error
    }
  }

  const response = JSON.stringify({
    type: "user",
    message: {
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: toolCallId,
          content: answer,
        },
      ],
    },
  })
  proc.stdin?.write(response + "\n")
  return answer
}

/**
 * Compact conversation history into a context summary for when we need to
 * start a fresh Claude CLI session but want to preserve OpenCode's conversation context.
 */
function compactConversationHistory(prompt: Parameters<LanguageModelV2["doGenerate"]>[0]["prompt"]): string | null {
  // Skip system messages, only include user/assistant exchanges
  const conversationMessages = prompt.filter((m) => m.role === "user" || m.role === "assistant")

  if (conversationMessages.length <= 1) {
    // No prior conversation to compact
    return null
  }

  // Build a summary of the conversation (excluding the current message)
  const historyParts: string[] = []

  for (let i = 0; i < conversationMessages.length - 1; i++) {
    const msg = conversationMessages[i]
    const role = msg.role === "user" ? "User" : "Assistant"

    let text = ""
    if (typeof msg.content === "string") {
      text = msg.content
    } else if (Array.isArray(msg.content)) {
      const textParts = (msg.content as any[])
        .filter((p) => p.type === "text" && p.text)
        .map((p) => p.text)
      text = textParts.join("\n")

      // Also note tool calls/results briefly
      const toolCalls = (msg.content as any[]).filter((p) => p.type === "tool-call")
      const toolResults = (msg.content as any[]).filter((p) => p.type === "tool-result")

      if (toolCalls.length > 0) {
        text += `\n[Called ${toolCalls.length} tool(s): ${toolCalls.map((t: any) => t.toolName).join(", ")}]`
      }
      if (toolResults.length > 0) {
        text += `\n[Received ${toolResults.length} tool result(s)]`
      }
    }

    if (text.trim()) {
      // Truncate very long messages
      const truncated = text.length > 2000 ? text.slice(0, 2000) + "..." : text
      historyParts.push(`${role}: ${truncated}`)
    }
  }

  if (historyParts.length === 0) {
    return null
  }

  return historyParts.join("\n\n")
}

function getClaudeUserMessage(
  prompt: Parameters<LanguageModelV2["doGenerate"]>[0]["prompt"],
  includeHistoryContext: boolean = false,
): string {
  const content: any[] = []

  // If this is a new Claude CLI session but we have prior OpenCode conversation history,
  // include it as context so Claude understands the conversation so far
  if (includeHistoryContext) {
    const historyContext = compactConversationHistory(prompt)
    if (historyContext) {
      log.info("including conversation history context for new Claude CLI session", {
        historyLength: historyContext.length,
      })
      content.push({
        type: "text",
        text: `<conversation_history>
The following is a summary of our conversation so far (from a previous session that couldn't be resumed):

${historyContext}

</conversation_history>

Now continuing with the current message:

`,
      })
    }
  }

  // Find messages since last assistant message
  const messages: typeof prompt = []
  for (let i = prompt.length - 1; i >= 0; i--) {
    if (prompt[i].role === "assistant") break
    messages.unshift(prompt[i])
  }

  log.debug("getClaudeUserMessage", {
    totalPromptMessages: prompt.length,
    messagesSinceLastAssistant: messages.length,
    messageTypes: messages.map(
      (m) => `${m.role}:${Array.isArray(m.content) ? m.content.length + " parts" : typeof m.content}`,
    ),
    includeHistoryContext,
  })

  for (const msg of messages) {
    if (msg.role === "user") {
      if (typeof msg.content === "string") {
        content.push({ type: "text", text: msg.content })
      } else if (Array.isArray(msg.content)) {
        for (const part of msg.content as any[]) {
          if (part.type === "text") {
            content.push({ type: "text", text: part.text })
          } else if (part.type === "tool-result") {
            const p = part as any
            if (handledToolCalls.has(p.toolCallId)) continue

            let resultText = ""
            if (typeof p.result === "string") {
              resultText = p.result
            } else if (typeof p.result === "object" && p.result && "output" in p.result) {
              resultText = String(p.result.output)
            } else {
              resultText = JSON.stringify(p.result)
            }

            content.push({
              type: "tool_result",
              tool_use_id: p.toolCallId,
              content: resultText,
            })
          }
        }
      }
    }
  }

  if (content.length === 0) {
    return JSON.stringify({
      type: "user",
      message: {
        role: "user",
        content: [{ type: "text", text: "" }],
      },
    })
  }

  const result = JSON.stringify({
    type: "user",
    message: {
      role: "user",
      content,
    },
  })

  log.debug("getClaudeUserMessage result", {
    contentParts: content.length,
    contentSizeBytes: result.length,
    hasToolResults: content.some((c) => c.type === "tool_result"),
    includeHistoryContext,
  })

  return result
}

async function handlePermissionRequest(
  msg: ClaudeStreamMessage,
  stdin: NodeJS.WritableStream | null,
  config: ClaudeCodeConfig,
  sessionID?: string,
): Promise<void> {
  // Check for permission-related message types (handle both underscore and hyphen variants)
  const isPermissionRequest =
    msg.type === "permission_request" ||
    msg.type === "permission-request" ||
    msg.type === "control_request" ||
    msg.type === "control-request"

  if (!isPermissionRequest) {
    // Log when we see messages that might be permission-related but don't match our expected types
    if (msg.type?.toLowerCase().includes("permission") || msg.type?.toLowerCase().includes("control")) {
      log.warn("received potential permission message with unexpected type", {
        type: msg.type,
        hasPermissionField: !!msg.permission,
        sessionID,
      })
    }
    return
  }

  const requestId = msg.request_id || msg.id || msg.permission?.id
  if (!requestId) {
    log.warn("permission request missing request ID", {
      type: msg.type,
      hasRequestId: !!msg.request_id,
      hasId: !!msg.id,
      hasPermissionId: !!msg.permission?.id,
      sessionID,
    })
    return
  }

  log.info("handling permission request", {
    type: msg.type,
    requestId,
    permissionType: msg.permission?.type,
    tool: msg.permission?.tool,
    sessionID,
  })

  const permissionRequest: ClaudePermissionRequest = {
    id: requestId,
    type: msg.permission?.type ?? "unknown",
    tool: msg.permission?.tool,
    path: msg.permission?.path,
    command: msg.permission?.command,
    description: msg.message?.content?.[0]?.text,
  }

  let approved = true
  if (config.permissionHandler) {
    try {
      approved = await config.permissionHandler(permissionRequest, sessionID)
      log.info("permission decision from handler", {
        requestId,
        permissionType: permissionRequest.type,
        tool: permissionRequest.tool,
        approved,
        sessionID,
      })
    } catch (e) {
      log.error("permission handler error", { error: e })
      approved = false
    }
  } else {
    log.info("auto-approving permission (no handler)", {
      requestId,
      permissionType: permissionRequest.type,
      tool: permissionRequest.tool,
    })
  }

  const response = JSON.stringify({
    type: "permission_response",
    id: requestId,
    approved,
  })
  stdin?.write(response + "\n")
}

interface ActiveProcess {
  proc: import("child_process").ChildProcess
  lineEmitter: import("events").EventEmitter
}

const activeProcesses = new Map<string, ActiveProcess>()

export class ClaudeCodeLanguageModel implements LanguageModelV2 {
  readonly specificationVersion = "v2"
  readonly modelId: string
  private readonly config: ClaudeCodeConfig
  private static claudeSessions = new Map<string, string>()

  constructor(modelId: string, config: ClaudeCodeConfig) {
    this.modelId = modelId
    this.config = config
  }

  readonly supportedUrls: Record<string, RegExp[]> = {}

  get provider(): string {
    return this.config.provider
  }

  async doGenerate(
    options: Parameters<LanguageModelV2["doGenerate"]>[0],
  ): Promise<Awaited<ReturnType<LanguageModelV2["doGenerate"]>>> {
    const warnings: LanguageModelV2CallWarning[] = []
    const cwd = this.config.cwd ?? process.cwd()
    const config = this.config
    const sessionID = (options.providerOptions as any)?.["claude-code"]?.sessionID as string | undefined

    // Check if we need to include conversation history context
    // This happens when we have an existing OpenCode session but no Claude CLI session
    const hasExistingClaudeSession = sessionID ? ClaudeCodeLanguageModel.claudeSessions.has(sessionID) : false
    const hasPriorConversation = options.prompt.filter((m) => m.role === "user" || m.role === "assistant").length > 1
    const includeHistoryContext = !hasExistingClaudeSession && hasPriorConversation

    const userMsg = getClaudeUserMessage(options.prompt, includeHistoryContext)

    // Log all providerOptions to debug sessionID extraction
    const providerOpts = options.providerOptions as any
    log.info("doGenerate starting", {
      cwd,
      textLength: userMsg.length,
      sessionID,
      hasProviderOptions: !!providerOpts,
      providerOptionsKeys: providerOpts ? Object.keys(providerOpts) : [],
      claudeCodeOptions: providerOpts?.["claude-code"],
      rawSessionID: providerOpts?.["claude-code"]?.sessionID,
      inMemorySession: sessionID ? ClaudeCodeLanguageModel.claudeSessions.get(sessionID) : undefined,
      includeHistoryContext,
      hasPriorConversation,
    })

    // NOTE: We no longer try to restore persisted Claude CLI sessions across OpenCode restarts
    // because Claude CLI sessions can become locked/invalid, causing "Session ID already in use" errors.
    // Instead, we include conversation history context when starting a new Claude CLI session.

    const cliArgs = ["--output-format", "stream-json", "--input-format", "stream-json", "--verbose"]
    if (sessionID && ClaudeCodeLanguageModel.claudeSessions.has(sessionID)) {
      cliArgs.push("--session-id", ClaudeCodeLanguageModel.claudeSessions.get(sessionID)!)
    }
    // Add permission mode if specified
    if (this.config.permissionMode) {
      cliArgs.push("--permission-mode", this.config.permissionMode)
    }
    // Use --dangerously-skip-permissions if explicitly requested OR if OpenCode is handling tools
    // (when OpenCode handles tools, we don't want Claude CLI to block on its own permission prompts)
    if (this.config.skipPermissions === true || this.config.handleToolsInOpenCode === true) {
      cliArgs.push("--dangerously-skip-permissions")
    }

    log.info("spawning claude cli (doGenerate)", {
      cliPath: this.config.cliPath,
      cliArgs,
      skipPermissions: this.config.skipPermissions,
      handleToolsInOpenCode: this.config.handleToolsInOpenCode,
      permissionMode: this.config.permissionMode,
      hasPermissionHandler: !!this.config.permissionHandler,
      sessionID,
    })

    const proc = spawn(this.config.cliPath, cliArgs, {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, TERM: "xterm-256color" },
    })

    const rl = createInterface({ input: proc.stdout })

    let responseText = ""
    let thinkingText = ""
    let resultMeta: {
      sessionId?: string
      costUsd?: number
      durationMs?: number
      usage?: ClaudeStreamMessage["usage"]
    } = {}
    const toolCalls: Array<{ id: string; name: string; args: unknown }> = []

    const result = await new Promise<
      typeof resultMeta & { text: string; thinking: string; toolCalls: typeof toolCalls }
    >((resolve, reject) => {
      rl.on("line", (line) => {
        if (!line.trim()) return
        try {
          const msg: ClaudeStreamMessage = JSON.parse(line)

          log.debug("received message", { type: msg.type, subtype: msg.subtype })

          handlePermissionRequest(msg, proc.stdin, config, sessionID)

          // Handle system init message
          if (msg.type === "system" && msg.subtype === "init") {
            if (msg.session_id && sessionID) {
              ClaudeCodeLanguageModel.claudeSessions.set(sessionID, msg.session_id)
              // Note: Not persisting session IDs across restarts due to "already in use" errors
            }
          }

          // Handle assistant messages with content
          if (msg.type === "assistant" && msg.message?.content) {
            for (const block of msg.message.content) {
              if (block.type === "text" && block.text) {
                responseText += block.text
              }
              if (block.type === "thinking" && block.thinking) {
                thinkingText += block.thinking
              }
              if (block.type === "tool_use" && block.id && block.name) {
                if (block.name === "AskUserQuestion" || block.name === "ask_user_question") {
                  const parsedInput = (block.input ?? {}) as Record<string, unknown>
                  const question = (parsedInput?.question as string) || "Question?"
                  handleQuestion(
                    {
                      question,
                      options: parsedInput.options as any[],
                      custom: parsedInput.custom as boolean,
                      multiple: parsedInput.multiple as boolean,
                    },
                    config,
                    sessionID,
                    proc,
                    block.id,
                  )
                  continue
                }

                toolCalls.push({
                  id: block.id,
                  name: block.name,
                  args: block.input ?? {},
                })
                log.info("tool_use", { name: block.name, id: block.id })
              }
            }
          }

          // Handle content_block events (streaming)
          if (msg.type === "content_block_start" && msg.content_block) {
            if (msg.content_block.type === "tool_use" && msg.content_block.id && msg.content_block.name) {
              toolCalls.push({
                id: msg.content_block.id,
                name: msg.content_block.name,
                args: {},
              })
            }
          }

          if (msg.type === "content_block_delta" && msg.delta) {
            if (msg.delta.type === "text_delta" && msg.delta.text) {
              responseText += msg.delta.text
            }
            if (msg.delta.type === "thinking_delta" && msg.delta.thinking) {
              thinkingText += msg.delta.thinking
            }
            if (msg.delta.type === "input_json_delta" && msg.delta.partial_json && msg.index !== undefined) {
              // Update tool call args incrementally
              const tc = toolCalls[msg.index]
              if (tc) {
                try {
                  tc.args = JSON.parse(msg.delta.partial_json)
                } catch {
                  // Partial JSON, accumulate
                }
              }
            }
          }

          // Handle result
          if (msg.type === "result") {
            if (msg.session_id && sessionID) {
              ClaudeCodeLanguageModel.claudeSessions.set(sessionID, msg.session_id)
              // Note: Not persisting session IDs across restarts due to "already in use" errors
            }
            resultMeta = {
              sessionId: msg.session_id,
              costUsd: msg.total_cost_usd,
              durationMs: msg.duration_ms,
              usage: msg.usage,
            }
            log.info("result received", {
              sessionId: msg.session_id,
              durationMs: msg.duration_ms,
              numTurns: msg.num_turns,
            })
            resolve({ ...resultMeta, text: responseText, thinking: thinkingText, toolCalls })
          }
        } catch {
          // Ignore non-JSON lines
        }
      })

      rl.on("close", () => {
        resolve({ ...resultMeta, text: responseText, thinking: thinkingText, toolCalls })
      })

      proc.on("error", (err) => {
        log.error("process error", { error: err.message })
        reject(err)
      })

      proc.stderr?.on("data", (data) => {
        log.debug("stderr", { data: data.toString().slice(0, 200) })
      })

      const msg = userMsg
      proc.stdin?.write(msg + "\n")
    })

    const content: LanguageModelV2Content[] = []

    // Add thinking/reasoning first if present
    if (result.thinking) {
      content.push({
        type: "reasoning",
        text: result.thinking,
      } as any)
    }

    if (result.text) {
      content.push({
        type: "text",
        text: result.text,
        providerMetadata: {
          "claude-code": {
            sessionId: result.sessionId ?? null,
            costUsd: result.costUsd ?? null,
            durationMs: result.durationMs ?? null,
          },
        },
      })
    }

    for (const tc of result.toolCalls) {
      const { name: mappedName, input: mappedInput, executed } = mapTool(tc.name, tc.args, config.handleToolsInOpenCode)
      content.push({
        type: "tool-call",
        toolCallId: tc.id,
        toolName: mappedName,
        input: JSON.stringify(mappedInput),
        providerExecuted: executed,
      } as any)
    }

    const usage: LanguageModelV2Usage = {
      inputTokens: result.usage?.input_tokens,
      outputTokens: result.usage?.output_tokens,
      totalTokens:
        result.usage?.input_tokens && result.usage?.output_tokens
          ? result.usage.input_tokens + result.usage.output_tokens
          : undefined,
    }

    return {
      content,
      finishReason: (result.toolCalls.length > 0 ? "tool-calls" : "stop") as LanguageModelV2FinishReason,
      usage,
      request: { body: { text: userMsg } },
      response: {
        id: result.sessionId ?? generateId(),
        timestamp: new Date(),
        modelId: this.modelId,
      },
      providerMetadata: {
        "claude-code": {
          sessionId: result.sessionId ?? null,
          costUsd: result.costUsd ?? null,
          durationMs: result.durationMs ?? null,
        },
      },
      warnings,
    }
  }

  async doStream(
    options: Parameters<LanguageModelV2["doStream"]>[0],
  ): Promise<Awaited<ReturnType<LanguageModelV2["doStream"]>>> {
    const warnings: LanguageModelV2CallWarning[] = []
    const cwd = this.config.cwd ?? process.cwd()
    const cliPath = this.config.cliPath
    const config = this.config
    const sessionID = (options.providerOptions as any)?.["claude-code"]?.sessionID as string | undefined

    // Check if we need to include conversation history context
    // This happens when we have an existing OpenCode session but no Claude CLI session
    // (e.g., after OpenCode restart, or when Claude CLI session expired)
    const hasExistingClaudeSession = sessionID ? ClaudeCodeLanguageModel.claudeSessions.has(sessionID) : false
    const hasActiveProcess = sessionID ? activeProcesses.has(sessionID) : false
    const hasPriorConversation = options.prompt.filter((m) => m.role === "user" || m.role === "assistant").length > 1
    const includeHistoryContext = !hasExistingClaudeSession && !hasActiveProcess && hasPriorConversation

    const userMsg = getClaudeUserMessage(options.prompt, includeHistoryContext)

    // Log all providerOptions to debug sessionID extraction
    const providerOpts = options.providerOptions as any
    log.info("doStream starting", {
      cwd,
      textLength: userMsg.length,
      sessionID,
      hasProviderOptions: !!providerOpts,
      providerOptionsKeys: providerOpts ? Object.keys(providerOpts) : [],
      claudeCodeOptions: providerOpts?.["claude-code"],
      rawSessionID: providerOpts?.["claude-code"]?.sessionID,
      inMemorySession: sessionID ? ClaudeCodeLanguageModel.claudeSessions.get(sessionID) : undefined,
      includeHistoryContext,
      hasPriorConversation,
      hasActiveProcess,
    })

    log.debug("userMsg content", { userMsg })

    // NOTE: We include conversation history as context when starting a new Claude CLI session
    // for an existing OpenCode conversation. This provides continuity even when Claude CLI
    // sessions can't be resumed (due to "Session ID already in use" errors after restart).

    const cliArgs = ["--output-format", "stream-json", "--input-format", "stream-json", "--verbose"]
    if (sessionID && ClaudeCodeLanguageModel.claudeSessions.has(sessionID)) {
      cliArgs.push("--session-id", ClaudeCodeLanguageModel.claudeSessions.get(sessionID)!)
    }
    // Add permission mode if specified
    if (config.permissionMode) {
      cliArgs.push("--permission-mode", config.permissionMode)
    }
    // Use --dangerously-skip-permissions if explicitly requested OR if OpenCode is handling tools
    // (when OpenCode handles tools, we don't want Claude CLI to block on its own permission prompts)
    if (config.skipPermissions === true || config.handleToolsInOpenCode === true) {
      cliArgs.push("--dangerously-skip-permissions")
    }

    log.info("spawning claude cli (doStream)", {
      cliPath,
      cliArgs,
      skipPermissions: config.skipPermissions,
      handleToolsInOpenCode: config.handleToolsInOpenCode,
      permissionMode: config.permissionMode,
      hasPermissionHandler: !!config.permissionHandler,
      sessionID,
    })

    const stream = new ReadableStream<LanguageModelV2StreamPart>({
      start(controller) {
        let activeProcess = sessionID ? activeProcesses.get(sessionID) : undefined
        let proc: import("child_process").ChildProcess
        let lineEmitter: import("events").EventEmitter

        if (activeProcess) {
          proc = activeProcess.proc
          lineEmitter = activeProcess.lineEmitter
          log.debug("reusing active process", { sessionID })
        } else {
          log.debug("spawning new process", { sessionID })
          proc = spawn(cliPath, cliArgs, {
            cwd,
            stdio: ["pipe", "pipe", "pipe"],
            env: { ...process.env, TERM: "xterm-256color" },
          })

          // EventEmitter is imported at the top of the file
          lineEmitter = new EventEmitter()

          const rl = createInterface({ input: proc.stdout! })
          rl.on("line", (line: string) => {
            lineEmitter.emit("line", line)
          })
          rl.on("close", () => {
            lineEmitter.emit("close")
          })

          if (sessionID) {
            activeProcesses.set(sessionID, { proc, lineEmitter })
          }

          proc.on("exit", (code, signal) => {
            log.info("claude-code process exited", { code, signal, sessionID })
            if (sessionID) {
              activeProcesses.delete(sessionID)
              // If process exited unexpectedly (not from our abort handler),
              // also clear the session to ensure a clean restart
              if (code !== 0 && code !== null) {
                log.info("process exited with error, clearing session for clean restart", { code, sessionID })
                ClaudeCodeLanguageModel.claudeSessions.delete(sessionID)
              }
            }
          })

          proc.stderr?.on("data", (data: Buffer) => {
            const stderr = data.toString()
            log.debug("stderr", { data: stderr.slice(0, 200) })

            // Check for session ID errors - if session is invalid or in use, clear it and retry
            if (stderr.includes("Session ID") && (stderr.includes("already in use") || stderr.includes("not found") || stderr.includes("invalid"))) {
              log.warn("claude session ID error, clearing persisted session", {
                sessionID,
                error: stderr.slice(0, 200),
              })
              // Clear the persisted session so next request starts fresh
              if (sessionID) {
                ClaudeCodeLanguageModel.claudeSessions.delete(sessionID)
                Storage.remove(["claude-code-session", sessionID]).catch(() => {})
              }
            }
          })
        }

        controller.enqueue({ type: "stream-start", warnings })

        // Track state for streaming
        const textId = generateId()
        let textStarted = false

        // Track reasoning/thinking
        const reasoningIds = new Map<number, string>() // index -> id
        const reasoningStarted = new Map<number, boolean>()

        // Track if turn completed normally (so we don't kill on abort after completion)
        let turnCompleted = false
        // Track if controller is closed to avoid "controller already closed" errors
        let controllerClosed = false

        // Track tool calls by index (for streaming) and by id (for result matching)
        const toolCallMap = new Map<number, { id: string; name: string; inputJson: string }>()
        // Track tool calls by ID for matching with tool_result
        const toolCallsById = new Map<string, { id: string; name: string; input: unknown }>()
        // Track which tools are being handled by OpenCode (don't emit their results from Claude CLI)
        const toolsHandledByOpenCode = new Set<string>()

        let resultMeta: {
          sessionId?: string
          costUsd?: number
          durationMs?: number
          usage?: ClaudeStreamMessage["usage"]
        } = {}

        // Track accumulated text for permission denial detection
        let accumulatedText = ""
        let handlingPermissionDenial = false

        const lineHandler = async (line: string) => {
          if (!line.trim()) return
          // Skip processing if controller is already closed (turn completed)
          if (controllerClosed) {
            log.debug("skipping message - controller closed", { lineLength: line.length })
            return
          }
          try {
            const msg: ClaudeStreamMessage = JSON.parse(line)

            log.debug("stream message", { type: msg.type, subtype: msg.subtype })

            handlePermissionRequest(msg, proc.stdin, config, sessionID)

            // Handle system init message
            if (msg.type === "system" && msg.subtype === "init") {
              log.info("claude-code session initialized", {
                claudeSessionId: msg.session_id,
                openCodeSessionID: sessionID,
                willPersist: !!(msg.session_id && sessionID),
              })
              if (msg.session_id && sessionID) {
                ClaudeCodeLanguageModel.claudeSessions.set(sessionID, msg.session_id)
                log.info("stored session mapping in memory", {
                  openCodeSessionID: sessionID,
                  claudeSessionId: msg.session_id,
                })
                // Note: Not persisting session IDs across restarts due to "already in use" errors
              } else {
                log.warn("cannot persist session mapping - missing IDs", {
                  hasClaudeSessionId: !!msg.session_id,
                  hasOpenCodeSessionID: !!sessionID,
                })
              }
            }

            // Handle content_block_start - beginning of a new content block
            if (msg.type === "content_block_start" && msg.content_block && msg.index !== undefined) {
              const block = msg.content_block
              const idx = msg.index

              if (block.type === "thinking") {
                const reasoningId = generateId()
                reasoningIds.set(idx, reasoningId)
                controller.enqueue({
                  type: "reasoning-start",
                  id: reasoningId,
                } as any)
                reasoningStarted.set(idx, true)
              }

              if (block.type === "text") {
                if (!textStarted) {
                  controller.enqueue({
                    type: "text-start",
                    id: textId,
                  } as any)
                  textStarted = true
                }
              }

              if (block.type === "tool_use" && block.id && block.name) {
                toolCallMap.set(idx, { id: block.id, name: block.name, inputJson: "" })

                if (block.name !== "AskUserQuestion" && block.name !== "ask_user_question") {
                  const { name: mappedName } = mapTool(block.name, undefined, config.handleToolsInOpenCode)

                  controller.enqueue({
                    type: "tool-input-start",
                    id: block.id,
                    toolName: mappedName,
                  } as any)
                  log.info("tool started", { name: block.name, mappedName, id: block.id })
                }
              }
            }

            // Handle content_block_delta - streaming content
            if (msg.type === "content_block_delta" && msg.delta && msg.index !== undefined) {
              const delta = msg.delta
              const idx = msg.index

              if (delta.type === "thinking_delta" && delta.thinking) {
                const reasoningId = reasoningIds.get(idx)
                if (reasoningId) {
                  controller.enqueue({
                    type: "reasoning-delta",
                    id: reasoningId,
                    text: delta.thinking,
                  } as any)
                }
              }

              if (delta.type === "text_delta" && delta.text) {
                if (!textStarted) {
                  controller.enqueue({
                    type: "text-start",
                    id: textId,
                  } as any)
                  textStarted = true
                }
                controller.enqueue({
                  type: "text-delta",
                  id: textId,
                  delta: delta.text,
                })
                // Accumulate text for permission denial detection
                accumulatedText += delta.text
              }

              if (delta.type === "input_json_delta" && delta.partial_json) {
                const tc = toolCallMap.get(idx)
                if (tc) {
                  tc.inputJson += delta.partial_json
                  controller.enqueue({
                    type: "tool-input-delta",
                    id: tc.id,
                    delta: delta.partial_json,
                  } as any)
                }
              }
            }

            // Handle content_block_stop - end of a content block
            if (msg.type === "content_block_stop" && msg.index !== undefined) {
              const idx = msg.index

              const reasoningId = reasoningIds.get(idx)
              if (reasoningId && reasoningStarted.get(idx)) {
                controller.enqueue({
                  type: "reasoning-end",
                  id: reasoningId,
                } as any)
                reasoningStarted.delete(idx)
              }

              const tc = toolCallMap.get(idx)
              if (tc) {
                let parsedInput: any = {}
                try {
                  parsedInput = JSON.parse(tc.inputJson || "{}")
                } catch {}

                if (tc.name === "AskUserQuestion" || tc.name === "ask_user_question") {
                  // Extract question from different possible formats
                  // Format 1: { question: string }
                  // Format 2: { questions: [{ question: string, header: string, options: [...] }] }
                  let question = "Question?"
                  if (parsedInput?.questions && Array.isArray(parsedInput.questions) && parsedInput.questions.length > 0) {
                    const q = parsedInput.questions[0]
                    question = q.question || q.text || "Question?"
                    log.info("AskUserQuestion - extracted from questions array", { question, optionsCount: q.options?.length })
                  } else {
                    question = parsedInput?.question || parsedInput?.text || "Question?"
                    log.info("AskUserQuestion - extracted from direct field", { question })
                  }

                  if (!textStarted) {
                    controller.enqueue({
                      type: "text-start",
                      id: textId,
                      providerMetadata: {
                        "claude-code": { sessionId: msg.session_id ?? null },
                      },
                    } as any)
                    textStarted = true
                  }
                  controller.enqueue({
                    type: "text-delta",
                    id: textId,
                    delta: "\n\n_Asking: " + question + "_\n\n",
                  })

                  // Await the question - this blocks message processing until user answers
                  // Claude CLI will wait for our tool_result before continuing
                  log.info("waiting for user to answer question before continuing", { question, toolId: tc.id })
                  const answer = await handleQuestion(
                    parsedInput,
                    config,
                    sessionID,
                    proc,
                    tc.id,
                  )
                  if (!answer) {
                    log.warn("AskUserQuestion received empty answer", { question })
                  }
                  log.info("user answered question, continuing", { question, hasAnswer: !!answer })
                } else {
                  const { name: mappedName, input: mappedInput, executed } = mapTool(tc.name, parsedInput, config.handleToolsInOpenCode)

                  toolCallsById.set(tc.id, { id: tc.id, name: tc.name, input: parsedInput })
                  // Track tools that OpenCode will handle (don't emit their results from Claude CLI)
                  if (!executed) {
                    toolsHandledByOpenCode.add(tc.id)
                  }
                  controller.enqueue({
                    type: "tool-call",
                    toolCallId: tc.id,
                    toolName: mappedName,
                    input: JSON.stringify(mappedInput),
                    providerExecuted: executed,
                  } as any)
                  log.info("tool call complete", { name: tc.name, mappedName, id: tc.id, executed, handledByOpenCode: !executed })
                }
              }
            }

            // Handle assistant message (complete message, not streaming)
            if (msg.type === "assistant" && msg.message?.content) {
              for (const block of msg.message.content) {
                if (block.type === "text" && block.text) {
                  if (!textStarted) {
                    controller.enqueue({
                      type: "text-start",
                      id: textId,
                      providerMetadata: {
                        "claude-code": { sessionId: msg.session_id ?? null },
                      },
                    } as any)
                    textStarted = true
                  }
                  controller.enqueue({
                    type: "text-delta",
                    id: textId,
                    delta: block.text,
                  })
                }

                if (block.type === "thinking" && block.thinking) {
                  const thinkingId = generateId()
                  controller.enqueue({ type: "reasoning-start", id: thinkingId } as any)
                  controller.enqueue({
                    type: "reasoning-delta",
                    id: thinkingId,
                    text: block.thinking,
                  } as any)
                  controller.enqueue({ type: "reasoning-end", id: thinkingId } as any)
                }

                if (block.type === "tool_use" && block.id && block.name) {
                  const parsedInput = (block.input ?? {}) as Record<string, unknown>
                  toolCallsById.set(block.id, { id: block.id, name: block.name, input: parsedInput })

                  if (block.name === "AskUserQuestion" || block.name === "ask_user_question") {
                    // Extract question from different possible formats
                    // Format 1: { question: string }
                    // Format 2: { questions: [{ question: string, header: string, options: [...] }] }
                    let question = "Question?"
                    if (parsedInput?.questions && Array.isArray(parsedInput.questions) && parsedInput.questions.length > 0) {
                      const q = parsedInput.questions[0]
                      question = q.question || q.text || "Question?"
                      log.info("AskUserQuestion (assistant) - extracted from questions array", { question, optionsCount: q.options?.length })
                    } else {
                      question = (parsedInput?.question as string) || (parsedInput?.text as string) || "Question?"
                      log.info("AskUserQuestion (assistant) - extracted from direct field", { question })
                    }

                    if (!textStarted) {
                      controller.enqueue({
                        type: "text-start",
                        id: textId,
                        providerMetadata: {
                          "claude-code": { sessionId: msg.session_id ?? null },
                        },
                      } as any)
                      textStarted = true
                    }
                    controller.enqueue({
                      type: "text-delta",
                      id: textId,
                      delta: "\n\n_Asking: " + question + "_\n\n",
                    })

                    // Await the question - this blocks message processing until user answers
                    // Claude CLI will wait for our tool_result before continuing
                    log.info("waiting for user to answer question before continuing", { question, toolId: block.id })
                    const answer = await handleQuestion(
                      parsedInput,
                      config,
                      sessionID,
                      proc,
                      block.id,
                    )
                    if (!answer) {
                      log.warn("AskUserQuestion received empty answer", { question })
                    }
                    log.info("user answered question, continuing", { question, hasAnswer: !!answer })
                  } else {
                    const { name: mappedName, input: mappedInput, executed } = mapTool(block.name, parsedInput, config.handleToolsInOpenCode)

                    // Track tools that OpenCode will handle (don't emit their results from Claude CLI)
                    if (!executed) {
                      toolsHandledByOpenCode.add(block.id)
                    }
                    controller.enqueue({
                      type: "tool-input-start",
                      id: block.id,
                      toolName: mappedName,
                    } as any)
                    controller.enqueue({
                      type: "tool-call",
                      toolCallId: block.id,
                      toolName: mappedName,
                      input: JSON.stringify(mappedInput),
                      providerExecuted: executed,
                    } as any)
                    log.info("tool_use from assistant message", { name: block.name, mappedName, id: block.id, executed, handledByOpenCode: !executed })
                  }
                }

                if (block.type === "tool_result") {
                  // Tool results are handled internally by Claude CLI
                  log.debug("tool_result", { toolUseId: block.tool_use_id })
                }
              }
            }

            // Handle user message (shows tool results)
            if (msg.type === "user" && msg.message?.content) {
              for (const block of msg.message.content) {
                if (block.type === "tool_result" && block.tool_use_id) {
                  // Skip emitting results for tools being handled by OpenCode
                  if (toolsHandledByOpenCode.has(block.tool_use_id)) {
                    log.info("skipping tool result for OpenCode-handled tool", {
                      toolUseId: block.tool_use_id,
                    })
                    toolsHandledByOpenCode.delete(block.tool_use_id)
                    toolCallsById.delete(block.tool_use_id)
                    continue
                  }

                  const toolCall = toolCallsById.get(block.tool_use_id)
                  if (toolCall) {
                    let resultText = ""
                    if (typeof block.content === "string") {
                      resultText = block.content
                    } else if (Array.isArray(block.content)) {
                      resultText = block.content
                        .filter(
                          (c): c is { type: string; text: string } => c.type === "text" && typeof c.text === "string",
                        )
                        .map((c) => c.text)
                        .join("\n")
                    }

                    controller.enqueue({
                      type: "tool-result",
                      toolCallId: block.tool_use_id,
                      toolName: toolCall.name,
                      result: {
                        output: resultText,
                        title: toolCall.name,
                        metadata: {},
                      },
                      providerExecuted: true,
                    } as any)
                    log.info("tool result emitted", { toolUseId: block.tool_use_id, name: toolCall.name })
                    toolCallsById.delete(block.tool_use_id)
                  } else {
                    log.debug("tool result for unknown tool", { toolUseId: block.tool_use_id })
                  }
                }
              }
            }

            // Handle result - end of conversation turn
            if (msg.type === "result") {
              // Only check for permission denials if OpenCode is NOT handling tools
              // When handleToolsInOpenCode is true, OpenCode handles permissions through its own UI
              // and we don't want the text-based detection to cause hanging
              if (!config.handleToolsInOpenCode) {
                // Check for structured permission denials first (preferred)
                if (msg.permission_denials && msg.permission_denials.length > 0) {
                  log.info("found structured permission denials in result", {
                    count: msg.permission_denials.length,
                    denials: msg.permission_denials.map((d) => ({
                      tool: d.tool_name,
                      id: d.tool_use_id,
                    })),
                    sessionID,
                  })

                  // Handle each permission denial
                  for (const denial of msg.permission_denials) {
                    const detected: DetectedPermissionRequest = {
                      type: denial.tool_name.toLowerCase().includes("bash") ? "execute" : "write",
                      path:
                        typeof denial.tool_input === "object" && denial.tool_input
                          ? (denial.tool_input as any).file_path ||
                            (denial.tool_input as any).path ||
                            (denial.tool_input as any).filePath
                          : undefined,
                      description: `Permission denied for ${denial.tool_name}`,
                    }

                    if (!handlingPermissionDenial) {
                      handlingPermissionDenial = true
                      handleDetectedPermissionDenial(detected, proc.stdin, config, sessionID)
                        .then((approved) => {
                          if (approved) {
                            log.info("permission approved via structured denial", {
                              tool: denial.tool_name,
                              sessionID,
                            })
                            accumulatedText = ""
                            handlingPermissionDenial = false
                          } else {
                            log.info("permission denied by user via structured denial", { sessionID })
                            handlingPermissionDenial = false
                          }
                        })
                        .catch((e) => {
                          log.error("error handling structured permission denial", { error: e })
                          handlingPermissionDenial = false
                        })
                      return // Don't close stream yet
                    }
                  }
                }

                // Fallback: Check for permission denial in accumulated text
                if (!handlingPermissionDenial && accumulatedText) {
                  const detected = detectPermissionDenial(accumulatedText)
                  if (detected) {
                    log.info("detected permission denial at end of turn (text-based)", {
                      type: detected.type,
                      path: detected.path,
                      sessionID,
                    })
                    handlingPermissionDenial = true
                    // Handle the permission denial asynchronously
                    handleDetectedPermissionDenial(detected, proc.stdin, config, sessionID)
                      .then((approved) => {
                        if (approved) {
                          log.info("permission approved, waiting for Claude CLI to continue", { sessionID })
                          // Reset state for continued conversation
                          accumulatedText = ""
                          handlingPermissionDenial = false
                          // Don't close the stream - Claude CLI should continue
                        } else {
                          log.info("permission denied by user", { sessionID })
                          handlingPermissionDenial = false
                        }
                      })
                      .catch((e) => {
                        log.error("error handling detected permission denial", { error: e })
                        handlingPermissionDenial = false
                      })
                    // Return early - don't close the stream yet
                    return
                  }
                }
              }

              if (msg.session_id && sessionID) {
                ClaudeCodeLanguageModel.claudeSessions.set(sessionID, msg.session_id)
                // Note: Not persisting session IDs across restarts due to "already in use" errors
              }
              resultMeta = {
                sessionId: msg.session_id,
                costUsd: msg.total_cost_usd,
                durationMs: msg.duration_ms,
                usage: msg.usage,
              }

              log.info("conversation result", {
                sessionId: msg.session_id,
                durationMs: msg.duration_ms,
                numTurns: msg.num_turns,
                isError: msg.is_error,
                inputTokens: msg.usage?.input_tokens,
                outputTokens: msg.usage?.output_tokens,
              })

              turnCompleted = true

              // Close any open text stream
              if (textStarted) {
                controller.enqueue({ type: "text-end", id: textId })
              }

              // Close any open reasoning streams
              for (const [idx, reasoningId] of reasoningIds) {
                if (reasoningStarted.get(idx)) {
                  controller.enqueue({ type: "reasoning-end", id: reasoningId } as any)
                }
              }

              controller.enqueue({
                type: "finish",
                finishReason: toolCallMap.size > 0 ? "tool-calls" : "stop",
                usage: {
                  inputTokens: msg.usage?.input_tokens,
                  outputTokens: msg.usage?.output_tokens,
                  totalTokens:
                    msg.usage?.input_tokens && msg.usage?.output_tokens
                      ? msg.usage.input_tokens + msg.usage.output_tokens
                      : undefined,
                },
                providerMetadata: {
                  "claude-code": resultMeta,
                },
              })

              // Mark controller as closed and remove handlers for this turn
              // The process stays alive for reuse, but this turn's handlers are done
              controllerClosed = true
              lineEmitter.off("line", lineHandler)
              lineEmitter.off("close", closeHandler)

              try {
                controller.close()
              } catch {}
            }
          } catch (e) {
            log.debug("failed to parse line", { error: e instanceof Error ? e.message : String(e) })
          }
        }

        const closeHandler = () => {
          log.debug("readline closed")
          if (controllerClosed) return // Already handled
          controllerClosed = true
          lineEmitter.off("line", lineHandler)
          lineEmitter.off("close", closeHandler)
          if (textStarted) {
            controller.enqueue({ type: "text-end", id: textId })
          }
          controller.enqueue({
            type: "finish",
            finishReason: "stop",
            usage: {
              inputTokens: undefined,
              outputTokens: undefined,
              totalTokens: undefined,
            },
            providerMetadata: {
              "claude-code": resultMeta,
            },
          })
          try {
            controller.close()
          } catch {}
        }

        lineEmitter.on("line", lineHandler)
        lineEmitter.on("close", closeHandler)

        proc.on("error", (err: Error) => {
          log.error("process error", { error: err.message })
          if (controllerClosed) return
          controllerClosed = true
          controller.enqueue({ type: "error", error: err })
          try {
            controller.close()
          } catch {}
        })

        if (options.abortSignal) {
          options.abortSignal.addEventListener("abort", () => {
            // Don't kill the process on interrupt - keep it alive for the next message.
            // Just close the stream controller to stop the current response.
            // The process will continue running and can receive the next user message.
            if (!turnCompleted) {
              log.info("abort signal received mid-turn, keeping process alive for next message", { sessionID })
            } else {
              log.debug("abort signal received after turn completed, process stays alive")
            }
            if (!controllerClosed) {
              controllerClosed = true
              // Remove handlers so they don't fire for subsequent messages on this process
              lineEmitter.off("line", lineHandler)
              lineEmitter.off("close", closeHandler)
              try {
                controller.close()
              } catch {}
            }
          })
        }

        // Send the user message to start the conversation
        proc.stdin?.write(userMsg + "\n")
        log.debug("sent user message", { textLength: userMsg.length })
      },
      cancel() {
        // Called when the consumer cancels the stream
      },
    })

    return {
      stream,
      request: { body: { text: userMsg } },
      response: { headers: {} },
    }
  }
}
