// OpenCode Browser Agent Bootstrap
// Wires up the AI SDK with browser-compatible shims
// This is a standalone agent loop that doesn't depend on the full opencode server

import { streamText, type CoreMessage, type CoreTool, type ToolCallPart, type ToolResultPart } from "ai"
import { createAnthropic } from "@ai-sdk/anthropic"
import type { TerminalAdapter } from "./terminal-adapter"
import { createProxiedFetch, CORS_PROXY_URL } from "./cors-proxy"
import {
  readFileTool,
  writeFileTool,
  editFileTool,
  globTool,
  grepTool,
  listTool,
  bashTool,
} from "./browser-tools"

const SYSTEM_PROMPT = `You are OpenCode, an AI-powered development assistant running in the browser.
You have access to a virtual filesystem with a demo TypeScript project at /workspace.

Available tools:
- read: Read file contents
- write: Write/create files
- edit: Edit files with find-and-replace
- glob: Find files by pattern
- grep: Search file contents
- list: List directory contents
- bash: Run basic shell commands (echo, cat, ls, pwd, mkdir)

Guidelines:
- Always read files before editing them
- Use relative paths from /workspace when possible
- Show your reasoning briefly before making changes
- After making edits, explain what you changed and why
- Keep responses concise and focused

The project at /workspace is a TypeScript project with some intentional bugs in src/utils/helpers.ts.`

const MODEL = "claude-sonnet-4-20250514"

export class BrowserAgent {
  private apiKey: string
  private terminal: TerminalAdapter
  private messages: CoreMessage[] = []
  private anthropic: ReturnType<typeof createAnthropic>
  private tools: Record<string, CoreTool>

  constructor(apiKey: string, terminal: TerminalAdapter) {
    this.apiKey = apiKey
    this.terminal = terminal

    // Create Anthropic provider
    // If CORS proxy is configured, use it; otherwise use direct browser access
    const fetchFn = CORS_PROXY_URL
      ? createProxiedFetch(apiKey)
      : undefined

    this.anthropic = createAnthropic({
      apiKey,
      ...(fetchFn ? { fetch: fetchFn } : {}),
      // Enable direct browser access when no proxy
      ...(!CORS_PROXY_URL ? { headers: { "anthropic-dangerous-direct-browser-access": "true" } } : {}),
    })

    // Set up tools
    this.tools = {
      read: readFileTool,
      write: writeFileTool,
      edit: editFileTool,
      glob: globTool,
      grep: grepTool,
      list: listTool,
      bash: bashTool,
    }
  }

  async sendMessage(userMessage: string, signal: AbortSignal): Promise<void> {
    // Add user message
    this.messages.push({ role: "user", content: userMessage })

    // Agent loop - keep going until no more tool calls
    let continueLoop = true
    while (continueLoop) {
      continueLoop = false

      const result = streamText({
        model: this.anthropic(MODEL),
        system: SYSTEM_PROMPT,
        messages: this.messages,
        tools: this.tools,
        maxSteps: 25,
        abortSignal: signal,
        maxTokens: 16384,
      })

      let assistantText = ""
      let toolCalls: ToolCallPart[] = []
      let toolResults: ToolResultPart[] = []
      let headerShown = false

      for await (const part of result.fullStream) {
        if (signal.aborted) throw new DOMException("Aborted", "AbortError")

        switch (part.type) {
          case "text-delta": {
            if (!headerShown) {
              this.terminal.writeAgentHeader("assistant", MODEL)
              headerShown = true
            }
            assistantText += part.textDelta
            this.terminal.writeStreaming(part.textDelta)
            break
          }

          case "tool-call": {
            if (!headerShown) {
              this.terminal.writeAgentHeader("assistant", MODEL)
              headerShown = true
            }
            toolCalls.push({
              type: "tool-call",
              toolCallId: part.toolCallId,
              toolName: part.toolName,
              args: part.args,
            })

            // Execute tool and display result
            const toolResult = await this.executeTool(part.toolName, part.args, part.toolCallId)
            toolResults.push(toolResult)
            break
          }

          case "error": {
            this.terminal.writeError(String(part.error))
            break
          }

          case "finish": {
            if (assistantText.trim()) {
              this.terminal.writeln("") // End streaming line
            }
            break
          }
        }
      }

      // Build assistant message
      const assistantContent: (
        | { type: "text"; text: string }
        | ToolCallPart
      )[] = []

      if (assistantText.trim()) {
        assistantContent.push({ type: "text", text: assistantText })
      }
      assistantContent.push(...toolCalls)

      if (assistantContent.length > 0) {
        this.messages.push({ role: "assistant", content: assistantContent })
      }

      // Add tool results
      if (toolResults.length > 0) {
        this.messages.push({ role: "tool", content: toolResults })
        // Continue the loop if there were tool calls (agent may want to do more)
        continueLoop = true
      }
    }
  }

  private async executeTool(
    toolName: string,
    args: any,
    toolCallId: string,
  ): Promise<ToolResultPart> {
    try {
      const tool = this.tools[toolName]
      if (!tool || !("execute" in tool) || !tool.execute) {
        throw new Error(`Unknown tool: ${toolName}`)
      }

      const result = await tool.execute(args, {
        toolCallId,
        messages: this.messages,
        abortSignal: new AbortController().signal,
      })

      // Display tool result in terminal
      this.displayToolResult(toolName, args, result)

      return {
        type: "tool-result",
        toolCallId,
        toolName,
        result: typeof result === "string" ? result : JSON.stringify(result),
      }
    } catch (e: any) {
      const errorMsg = e.message || "Tool execution failed"
      this.terminal.writeToolResult("✗", `${toolName} failed`, errorMsg)

      return {
        type: "tool-result",
        toolCallId,
        toolName,
        result: `Error: ${errorMsg}`,
        isError: true,
      }
    }
  }

  private displayToolResult(toolName: string, args: any, result: any) {
    const output = typeof result === "string" ? result : JSON.stringify(result, null, 2)

    switch (toolName) {
      case "read":
        this.terminal.writeToolResult("→", `Read ${args.filePath}`)
        break
      case "write":
        this.terminal.writeToolResult("←", `Write ${args.filePath}`, undefined, output)
        break
      case "edit":
        this.terminal.writeToolResult("←", `Edit ${args.filePath}`, undefined, output)
        break
      case "glob":
        this.terminal.writeToolResult("✱", `Glob "${args.pattern}"`, output)
        break
      case "grep":
        this.terminal.writeToolResult("✱", `Grep "${args.pattern}"`, output)
        break
      case "list":
        this.terminal.writeToolResult("→", `List ${args.path || "/workspace"}`, output)
        break
      case "bash":
        this.terminal.writeToolResult("$", args.command, undefined, output)
        break
      default:
        this.terminal.writeToolResult("⚙", toolName, undefined, output)
    }
  }
}
