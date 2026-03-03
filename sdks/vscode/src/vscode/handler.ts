import * as vscode from "vscode"
import { AcpClient, PromptPart, SessionUpdate, AcpError, AcpErrorCode } from "../acp/client"

const limit = 10

export type ChatInput = {
  prompt: string
  references: readonly vscode.ChatPromptReference[]
  command?: string
}

export class OpenCodeRequestHandler {
  private client: AcpClient
  private sessionId: string | undefined

  constructor(client: AcpClient) {
    this.client = client
  }

  async handle(
    request: ChatInput,
    context: vscode.ChatContext,
    stream: vscode.ChatResponseStream,
    token: vscode.CancellationToken,
  ): Promise<vscode.ChatResult & { reply: string }> {
    // Get or create session
    const sessionId = await this.getOrCreateSession()
    const state = { buffer: [] as string[], reply: "" }

    // Build prompt from history + current request
    const prompt = this.buildPrompt(context.history, request)

    // Set up cancellation handling
    const drops: Array<() => void> = []
    const cancelDispose = token.onCancellationRequested(() => {
      void this.client.cancel({ sessionId }).catch(() => {
        // Ignore cancellation failures to avoid noisy user-facing errors.
      })
    })
    drops.push(() => cancelDispose.dispose())

    // Set up streaming handler - returns a disposable
    const streamingDispose = this.setupStreaming(sessionId, stream, state)
    drops.push(() => streamingDispose())

    // Show initial progress
    stream.progress("OpenCode is thinking...")

    try {
      // Send prompt to ACP
      const response = await this.client.sendPrompt({
        sessionId,
        prompt,
      })

      // Flush any remaining buffered content
      this.flushBuffer(state, stream)

      // Return result with metadata
      return {
        metadata: {
          stopReason: response.stopReason,
          usage: response.usage,
        },
        reply: state.reply,
      }
    } catch (error) {
      throw this.handleError(error)
    } finally {
      this.flushBuffer(state, stream)
      for (const drop of drops) {
        try {
          drop()
        } catch {
          // Ignore cleanup failures.
        }
      }
    }
  }

  reset(): void {
    this.sessionId = undefined
  }

  private async getOrCreateSession(): Promise<string> {
    if (this.sessionId) {
      return this.sessionId
    }

    const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd()
    const response = await this.client.createSession({ cwd })
    this.sessionId = response.sessionId

    return this.sessionId
  }

  private buildPrompt(
    history: readonly (vscode.ChatRequestTurn | vscode.ChatResponseTurn)[],
    currentRequest: ChatInput,
  ): PromptPart[] {
    const prompt: PromptPart[] = []

    // Add previous messages from history
    for (const turn of history) {
      if (this.isRequestTurn(turn)) {
        // ChatRequestTurn - user message
        prompt.push({
          type: "text",
          text: turn.prompt,
          annotations: { audience: ["user"] },
        })

        // Add file references from the turn
        if (turn.references) {
          for (const ref of turn.references) {
            const uri = this.extractUriFromReference(ref)
            if (uri) {
              prompt.push({
                type: "resource_link",
                uri: uri.toString(),
              })
            }
          }
        }
      }

      if (this.isResponseTurn(turn)) {
        // ChatResponseTurn - assistant message
        // Extract text content from response parts
        const textContent = this.extractTextFromResponse(turn.response)
        if (textContent) {
          prompt.push({
            type: "text",
            text: textContent,
            annotations: { audience: ["assistant"] },
          })
        }
      }
    }

    // Add current request
    prompt.push({
      type: "text",
      text: currentRequest.prompt,
      annotations: { audience: ["user"] },
    })

    // Add file references from current request
    for (const ref of currentRequest.references) {
      const uri = this.extractUriFromReference(ref)
      if (uri) {
        prompt.push({
          type: "resource_link",
          uri: uri.toString(),
        })
      }
    }

    return prompt
  }

  private isRequestTurn(turn: vscode.ChatRequestTurn | vscode.ChatResponseTurn): turn is vscode.ChatRequestTurn {
    return "prompt" in turn && typeof turn.prompt === "string"
  }

  private isResponseTurn(turn: vscode.ChatRequestTurn | vscode.ChatResponseTurn): turn is vscode.ChatResponseTurn {
    return "response" in turn && Array.isArray(turn.response)
  }

  private extractUriFromReference(ref: vscode.ChatPromptReference): vscode.Uri | undefined {
    const value = ref.value
    if (value instanceof vscode.Uri) {
      return value
    }
    if (typeof value === "object" && value !== null && "uri" in value) {
      // Location object
      return (value as vscode.Location).uri
    }
    return undefined
  }

  private extractTextFromResponse(
    response: readonly (
      | vscode.ChatResponseMarkdownPart
      | vscode.ChatResponseFileTreePart
      | vscode.ChatResponseAnchorPart
      | vscode.ChatResponseCommandButtonPart
    )[],
  ): string {
    return response
      .map((part) => {
        // Check for markdown part with value property
        if ("value" in part && part.value) {
          if (typeof part.value === "string") {
            return part.value
          }
          if (typeof part.value === "object" && "value" in part.value) {
            // MarkdownString
            return (part.value as { value: string }).value
          }
        }
        return ""
      })
      .filter((text) => text.length > 0)
      .join("\n")
  }

  private setupStreaming(
    sessionId: string,
    stream: vscode.ChatResponseStream,
    state: { buffer: string[]; reply: string },
  ): () => void {
    const handler = (updateSessionId: string, update: SessionUpdate) => {
      if (updateSessionId !== sessionId) {
        return
      }

      this.handleSessionUpdate(update, stream, state)
    }
    return this.client.onSessionUpdate(handler)
  }

  private handleSessionUpdate(
    update: SessionUpdate,
    stream: vscode.ChatResponseStream,
    state: { buffer: string[]; reply: string },
  ): void {
    switch (update.sessionUpdate) {
      case "agent_message_chunk":
        this.bufferMessage(state, update.content.text, stream, true)
        break

      case "agent_thought_chunk":
        // Buffer thought content as well (may be displayed differently in future)
        this.bufferMessage(state, update.content.text, stream, false)
        break

      case "user_message_chunk":
        // User messages are already in history, don't duplicate
        break

      case "tool_call":
        stream.progress(`${update.title}...`)
        break

      case "tool_call_update":
        if (update.status === "completed") {
          stream.progress(`${update.title ?? "Tool"} completed`)
        } else if (update.status === "failed") {
          stream.progress(`${update.title ?? "Tool"} failed`)
        } else if (update.status === "in_progress") {
          stream.progress(`${update.title ?? "Tool"} in progress...`)
        }
        break

      case "usage_update":
        // Usage updates are collected and returned in metadata
        break

      case "plan":
        // Plan updates can be shown as progress
        if (update.entries.length > 0) {
          const firstEntry = update.entries[0]
          if (firstEntry) {
            stream.progress(`Plan: ${firstEntry.content}`)
          }
        }
        break

      case "available_commands_update":
        // Commands updates don't need to be streamed
        break
    }
  }

  private bufferMessage(
    state: { buffer: string[]; reply: string },
    text: string,
    stream: vscode.ChatResponseStream,
    record: boolean,
  ): void {
    if (record) {
      state.reply += text
    }
    state.buffer.push(text)

    // Flush buffer periodically to avoid long delays
    if (state.buffer.length > limit) {
      this.flushBuffer(state, stream)
    }
  }

  private flushBuffer(state: { buffer: string[] }, stream: vscode.ChatResponseStream): void {
    if (state.buffer.length === 0) {
      return
    }

    const content = state.buffer.join("")
    state.buffer = []

    stream.markdown(content)
  }

  private handleError(error: unknown): Error {
    if (error instanceof AcpError) {
      switch (error.code) {
        case AcpErrorCode.AuthRequired:
          return new Error("Authentication required. Please authenticate with OpenCode.")
        case AcpErrorCode.SessionNotFound:
          this.sessionId = undefined
          return new Error("Session not found. Starting a new session...")
        case AcpErrorCode.SessionExpired:
          this.sessionId = undefined
          return new Error("Session expired. Please start a new conversation.")
        case AcpErrorCode.RateLimitExceeded:
          return new Error("Rate limit exceeded. Please wait a moment and try again.")
        default:
          return new Error(`OpenCode error: ${error.message}`)
      }
    }

    if (error instanceof Error) {
      return new Error(`Failed to communicate with OpenCode: ${error.message}`)
    }

    return new Error("An unexpected error occurred while processing your request.")
  }
}

export default OpenCodeRequestHandler
