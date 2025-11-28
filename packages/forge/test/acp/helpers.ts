/**
 * Integration Test Helpers for ACP
 *
 * Utilities for managing claude-code-acp subprocesses, capturing events,
 * and cleaning up resources in integration tests.
 */

import { ACPClient } from "../../src/acp/client"
import type { SessionNotification } from "@agentclientprotocol/sdk"

/**
 * Check if ANTHROPIC_API_KEY is available for integration tests
 */
export function hasClaudeApiKey(): boolean {
  return !!process.env.ANTHROPIC_API_KEY
}

/**
 * Skip test if ANTHROPIC_API_KEY is not available
 */
export function requireClaudeApiKey(): void {
  if (hasClaudeApiKey()) return

  throw new Error(
    "ANTHROPIC_API_KEY not set. Integration tests require ANTHROPIC_API_KEY environment variable."
  )
}

/**
 * Event capture utility for collecting SessionNotifications
 */
export class EventCapture {
  private events: SessionNotification[] = []

  /**
   * Capture a session notification
   */
  capture(event: SessionNotification): void {
    this.events.push(event)
  }

  /**
   * Get all captured events
   */
  getAll(): SessionNotification[] {
    return [...this.events]
  }

  /**
   * Get events of a specific type
   */
  getByType(type: SessionNotification["update"]["sessionUpdate"]): SessionNotification[] {
    return this.events.filter(e => e.update.sessionUpdate === type)
  }

  /**
   * Get the first event of a specific type
   */
  getFirstByType(type: SessionNotification["update"]["sessionUpdate"]): SessionNotification | undefined {
    return this.events.find(e => e.update.sessionUpdate === type)
  }

  /**
   * Clear all captured events
   */
  clear(): void {
    this.events = []
  }

  /**
   * Get count of captured events
   */
  count(): number {
    return this.events.length
  }

  /**
   * Wait for a specific event type with timeout
   */
  async waitFor(
    type: SessionNotification["update"]["sessionUpdate"],
    timeoutMs: number = 5000
  ): Promise<SessionNotification> {
    const startTime = Date.now()

    while (Date.now() - startTime < timeoutMs) {
      const event = this.getFirstByType(type)
      if (event) return event

      await new Promise(resolve => setTimeout(resolve, 100))
    }

    throw new Error(`Timeout waiting for event type: ${type}`)
  }
}

/**
 * Claude Code ACP subprocess manager for integration tests
 */
export class ClaudeCliManager {
  private client: ACPClient.Instance | null = null
  private sessionId: string | null = null
  private eventCapture = new EventCapture()

  /**
   * Spawn and initialize claude-code-acp subprocess
   */
  async start(): Promise<void> {
    requireClaudeApiKey()

    this.client = await ACPClient.create({
      command: "npx",
      args: ["@zed-industries/claude-code-acp"],
      cwd: process.cwd(),
      env: {
        ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY!
      },
      onSessionUpdate: (update: SessionNotification) => {
        this.eventCapture.capture(update)
      }
    })

    // Initialize connection
    await this.client.initialize()

    // Create session
    const sessionResponse = await this.client.createSession()
    this.sessionId = sessionResponse.sessionId
  }

  /**
   * Send a prompt to the agent
   */
  async sendPrompt(prompt: string): Promise<void> {
    if (!this.client || !this.sessionId) {
      throw new Error("ClaudeCliManager not started")
    }

    await this.client.sendPrompt(this.sessionId, prompt)
  }

  /**
   * Get the event capture instance
   */
  getEventCapture(): EventCapture {
    return this.eventCapture
  }

  /**
   * Get the session ID
   */
  getSessionId(): string {
    if (!this.sessionId) {
      throw new Error("ClaudeCliManager not started")
    }
    return this.sessionId
  }

  /**
   * Get the client instance
   */
  getClient(): ACPClient.Instance {
    if (!this.client) {
      throw new Error("ClaudeCliManager not started")
    }
    return this.client
  }

  /**
   * Cleanup subprocess and clear state
   */
  async cleanup(): Promise<void> {
    if (this.client) {
      await this.client.dispose()
      this.client = null
    }
    this.sessionId = null
    this.eventCapture.clear()
  }

  /**
   * Check if manager is running
   */
  isRunning(): boolean {
    return this.client !== null && this.sessionId !== null
  }
}

/**
 * Create a disposable ClaudeCliManager for use in tests
 */
export async function createClaudeCli(): Promise<ClaudeCliManager & AsyncDisposable> {
  const manager = new ClaudeCliManager()
  await manager.start()

  const disposable = manager as ClaudeCliManager & AsyncDisposable

  ;(disposable as any)[Symbol.asyncDispose] = async () => {
    await manager.cleanup()
  }

  return disposable
}

/**
 * Helper to accumulate text from agent_message_chunk notifications
 */
export function accumulateText(events: SessionNotification[]): string {
  return events
    .filter(e => e.update.sessionUpdate === "agent_message_chunk")
    .map(e => {
      const update = e.update
      if (update.sessionUpdate === "agent_message_chunk" &&
          !Array.isArray(update.content) &&
          update.content?.type === "text") {
        return update.content.text
      }
      return ""
    })
    .join("")
}

/**
 * Helper to accumulate thoughts from agent_thought_chunk notifications
 */
export function accumulateThoughts(events: SessionNotification[]): string {
  return events
    .filter(e => e.update.sessionUpdate === "agent_thought_chunk")
    .map(e => {
      const update = e.update
      if (update.sessionUpdate === "agent_thought_chunk" &&
          !Array.isArray(update.content) &&
          update.content?.type === "text") {
        return update.content.text
      }
      return ""
    })
    .join("")
}

/**
 * Helper to extract tool calls from notifications
 */
export function extractToolCalls(events: SessionNotification[]): Array<{
  id: string
  kind?: string
  title: string
  status?: string
}> {
  return events
    .filter(e => e.update.sessionUpdate === "tool_call")
    .map(e => {
      const update = e.update
      if (update.sessionUpdate === "tool_call") {
        return {
          id: update.toolCallId,
          kind: update.kind,
          title: update.title,
          status: update.status
        }
      }
      return { id: "", kind: undefined, title: "", status: undefined }
    })
    .filter(call => call.id !== "")
}
