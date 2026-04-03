/**
 * OpenCode Adapter
 *
 * Wraps the @opencode-ai/sdk to provide a clean interface for the OpenAgent
 * orchestrator to create, manage, and communicate with OpenCode sessions.
 *
 * OpenCode runs as a separate process exposing an HTTP API. This adapter
 * manages the lifecycle of that server and sessions running inside it.
 */

import { createOpencode, type OpencodeClient } from "@opencode-ai/sdk"

export type SessionRole = "build" | "plan" | "explore" | "general" | string

export interface SessionHandle {
  id: string
  role: SessionRole
  createdAt: Date
  lastUsedAt: Date
}

export interface PromptResult {
  sessionId: string
  text: string
  toolCalls: Array<{ tool: string; title: string; status: string }>
  durationMs: number
}

export interface OpenCodeAdapterOptions {
  /** Port for the opencode server. 0 = auto-assign */
  port?: number
  /** Signal to shut down the server */
  signal?: AbortSignal
  /** Project directory for opencode to work in */
  directory?: string
}

/**
 * OpenCodeAdapter manages a single OpenCode server instance and all sessions
 * created within it. The orchestrator uses this adapter to interact with
 * OpenCode as if it were a powerful coding tool.
 */
export class OpenCodeAdapter {
  private client!: OpencodeClient
  private server!: { url: string; close: () => void }
  private sessions = new Map<string, SessionHandle>()
  private ready = false

  static async create(options: OpenCodeAdapterOptions = {}): Promise<OpenCodeAdapter> {
    const adapter = new OpenCodeAdapter()
    await adapter.init(options)
    return adapter
  }

  private async init(options: OpenCodeAdapterOptions) {
    const instance = await createOpencode({
      port: options.port ?? 0,
      signal: options.signal,
    })
    this.server = instance.server
    this.client = instance.client
    this.ready = true
  }

  get url() {
    return this.server.url
  }

  /**
   * Create a new OpenCode session with the given role (agent type).
   * Each session is an isolated conversation context with its own tool access.
   */
  async createSession(role: SessionRole, title?: string): Promise<SessionHandle> {
    if (!this.ready) throw new Error("OpenCodeAdapter not initialized")

    const result = await this.client.session.create({
      body: { title: title ?? `OpenAgent ${role} session` },
    })

    if (result.error) {
      throw new Error(`Failed to create session: ${JSON.stringify(result.error)}`)
    }

    const handle: SessionHandle = {
      id: result.data.id,
      role,
      createdAt: new Date(),
      lastUsedAt: new Date(),
    }

    this.sessions.set(handle.id, handle)
    return handle
  }

  /**
   * Send a prompt to an existing session and collect the result.
   * Streams events internally and returns the full synthesized response.
   */
  async prompt(sessionId: string, text: string): Promise<PromptResult> {
    if (!this.ready) throw new Error("OpenCodeAdapter not initialized")

    const session = this.sessions.get(sessionId)
    if (!session) throw new Error(`Session not found: ${sessionId}`)

    session.lastUsedAt = new Date()
    const start = Date.now()

    // Collect tool calls while the prompt runs
    const toolCalls: PromptResult["toolCalls"] = []
    const eventStream = this.client.event.subscribe()

    // Fire-and-forget event listener that tracks tool usage
    const collectEvents = async () => {
      try {
        const stream = await eventStream
        for await (const event of stream.stream) {
          if (event.type === "message.part.updated") {
            const part = event.properties.part
            if (part.type === "tool" && part.sessionID === sessionId) {
              if (part.state.status === "completed") {
                toolCalls.push({
                  tool: part.tool,
                  title: part.state.title ?? part.tool,
                  status: part.state.status,
                })
              }
            }
          }
        }
      } catch {
        // Event stream closed when prompt completes - expected
      }
    }
    collectEvents()

    const result = await this.client.session.prompt({
      path: { id: sessionId },
      body: { parts: [{ type: "text", text }] },
    })

    if (result.error) {
      throw new Error(`Prompt failed: ${JSON.stringify(result.error)}`)
    }

    // Extract final text from response parts
    const parts = result.data?.parts ?? []
    const text_parts = parts.filter((p: any) => p.type === "text")
    const responseText = text_parts.map((p: any) => p.text ?? "").join("\n")

    return {
      sessionId,
      text: responseText,
      toolCalls,
      durationMs: Date.now() - start,
    }
  }

  /**
   * Get a shareable URL for a session (for linking in Slack/GitHub comments)
   */
  async shareSession(sessionId: string): Promise<string | null> {
    const result = await this.client.session.share({ path: { id: sessionId } })
    if (result.error || !result.data?.share?.url) return null
    return result.data.share.url
  }

  /**
   * List all active sessions managed by this adapter
   */
  listSessions(): SessionHandle[] {
    return Array.from(this.sessions.values())
  }

  /**
   * Delete a session (free resources)
   */
  async deleteSession(sessionId: string): Promise<void> {
    await this.client.session.delete({ path: { id: sessionId } })
    this.sessions.delete(sessionId)
  }

  /**
   * Shut down the OpenCode server
   */
  close() {
    this.server.close()
    this.ready = false
  }
}
