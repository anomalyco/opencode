/**
 * OpenCode Room Agent
 *
 * An AI agent that joins LiveKit rooms to provide assistance:
 * - Transcribes conversations in real-time
 * - Generates notes and summaries
 * - Extracts and manages todos
 * - Answers questions using OpenCode tools
 * - Shares tools with other agents via data channels
 */

import { RoomManager } from "./room-manager"
import { TranscriptionService } from "./transcription"
import type {
  RoomAgentConfig,
  AgentCapabilities,
  ConversationNote,
  ConversationTodo,
  AgentEvents,
  LiveKitConfig,
  TranscriptionResult,
} from "./types"
import { Session } from "../session"
import { Agent } from "../agent/agent"
import { Provider } from "../provider/provider"

/**
 * AI agent that joins LiveKit rooms and provides assistance
 */
export class OpenCodeRoomAgent {
  private roomManager: RoomManager
  private transcription: TranscriptionService
  private config: RoomAgentConfig
  private session?: any
  private agent?: any

  // Conversation tracking
  private conversationHistory: TranscriptionResult[] = []
  private notes: ConversationNote[] = []
  private todos: ConversationTodo[] = []

  // Event handlers
  private eventHandlers: Partial<AgentEvents> = {}

  // State
  private isActive = false

  constructor(liveKitConfig: LiveKitConfig, agentConfig: RoomAgentConfig) {
    this.config = agentConfig
    this.roomManager = new RoomManager(liveKitConfig)
    this.transcription = new TranscriptionService({
      language: "en-US",
      interimResults: agentConfig.capabilities.transcribe,
      continuousMode: true,
    })

    this.setupEventHandlers()
  }

  // ============================================================================
  // Room Operations
  // ============================================================================

  /**
   * Join a LiveKit room and start assisting
   */
  async joinRoom(): Promise<void> {
    if (this.isActive) {
      throw new Error("Agent already active in a room")
    }

    try {
      // Create OpenCode session for the agent
      this.session = await Session.create({
        title: `LiveKit Room: ${this.config.roomName}`,
      })

      // Get agent configuration
      this.agent = this.config.agent ? await Agent.get(this.config.agent) : await Agent.get("build")

      // Connect to room
      await this.roomManager.connect({
        name: this.config.roomName,
        participantName: this.config.name,
        autoSubscribe: true,
      })

      // Start transcription if enabled
      if (this.config.capabilities.transcribe) {
        await this.transcription.startTranscription()
      }

      this.isActive = true
    } catch (error) {
      throw new Error(
        `Failed to join room: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  /**
   * Leave the current room and cleanup
   */
  async leaveRoom(): Promise<void> {
    if (!this.isActive) return

    try {
      // Stop transcription
      if (this.transcription.isActive()) {
        await this.transcription.stopTranscription()
      }

      // Disconnect from room
      await this.roomManager.disconnect()

      this.isActive = false
      this.conversationHistory = []
    } catch (error) {
      console.error("Error leaving room:", error)
    }
  }

  /**
   * Check if agent is currently active
   */
  isAgentActive(): boolean {
    return this.isActive
  }

  // ============================================================================
  // Conversation Processing
  // ============================================================================

  /**
   * Process incoming speech and generate insights
   */
  async onSpeech(text: string, speaker: string): Promise<void> {
    if (!this.config.capabilities.transcribe) return

    const result: TranscriptionResult = {
      text,
      isFinal: true,
      confidence: 1.0,
      speaker,
      timestamp: Date.now(),
    }

    this.conversationHistory.push(result)

    // Extract notes if enabled
    if (this.config.capabilities.takeNotes) {
      await this.processForNotes(result)
    }

    // Extract todos if enabled
    if (this.config.capabilities.manageTodos) {
      await this.processForTodos(result)
    }
  }

  /**
   * Generate summary of conversation so far
   */
  async summarizeConversation(): Promise<string> {
    if (this.conversationHistory.length === 0) {
      return "No conversation to summarize yet."
    }

    try {
      const conversationText = this.conversationHistory
        .map((r) => `[${r.speaker}]: ${r.text}`)
        .join("\n")

      const prompt = `Summarize this conversation concisely:\n\n${conversationText}`

      // Use OpenCode session to generate summary
      const summary = await this.generateAIResponse(prompt)

      this.emit("summaryGenerated", summary)
      return summary
    } catch (error) {
      throw new Error(
        `Failed to generate summary: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  /**
   * Generate notes from conversation
   */
  async generateNotes(): Promise<ConversationNote[]> {
    return this.notes
  }

  /**
   * Extract todos from conversation
   */
  async extractTodos(): Promise<ConversationTodo[]> {
    return this.todos
  }

  /**
   * Get conversation history
   */
  getConversationHistory(): TranscriptionResult[] {
    return [...this.conversationHistory]
  }

  /**
   * Clear conversation history
   */
  clearHistory(): void {
    this.conversationHistory = []
    this.notes = []
    this.todos = []
  }

  // ============================================================================
  // AI Processing
  // ============================================================================

  /**
   * Process transcription result for note-worthy content
   */
  private async processForNotes(result: TranscriptionResult): Promise<void> {
    // Detect important phrases that should become notes
    const importantPhrases = [
      /important/i,
      /remember/i,
      /note that/i,
      /key point/i,
      /decision/i,
      /agreed/i,
    ]

    const isImportant = importantPhrases.some((pattern) => pattern.test(result.text))

    if (isImportant) {
      const note: ConversationNote = {
        id: `note_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`,
        timestamp: result.timestamp,
        speaker: result.speaker,
        content: result.text,
        type: this.detectNoteType(result.text),
        tags: this.extractTags(result.text),
      }

      this.notes.push(note)
      this.emit("noteCreated", note)
    }
  }

  /**
   * Process transcription result for action items
   */
  private async processForTodos(result: TranscriptionResult): Promise<void> {
    // Detect action items
    const actionPhrases = [
      /(?:need to|should|must|have to|will)\s+(.+)/i,
      /(?:todo|to-do|action item):\s*(.+)/i,
      /(?:task|assignment):\s*(.+)/i,
    ]

    for (const pattern of actionPhrases) {
      const match = result.text.match(pattern)
      if (match) {
        const todo: ConversationTodo = {
          id: `todo_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`,
          timestamp: result.timestamp,
          content: match[1] || result.text,
          assignee: result.speaker,
          priority: this.detectPriority(result.text),
          status: "pending",
        }

        this.todos.push(todo)
        this.emit("todoCreated", todo)
        break
      }
    }
  }

  /**
   * Generate AI response using OpenCode
   */
  private async generateAIResponse(prompt: string): Promise<string> {
    // TODO: Use actual OpenCode session to generate response
    // For now, return a placeholder
    return "AI response generation not yet implemented"
  }

  /**
   * Detect type of note from content
   */
  private detectNoteType(text: string): ConversationNote["type"] {
    if (/\?/.test(text)) return "question"
    if (/decision|agreed|decided/i.test(text)) return "decision"
    if (/summary|overview/i.test(text)) return "summary"
    return "note"
  }

  /**
   * Detect todo priority from content
   */
  private detectPriority(text: string): ConversationTodo["priority"] {
    if (/urgent|asap|critical|immediately/i.test(text)) return "high"
    if (/soon|important/i.test(text)) return "medium"
    return "low"
  }

  /**
   * Extract hashtags or keywords as tags
   */
  private extractTags(text: string): string[] {
    const tags: string[] = []

    // Extract hashtags
    const hashtagMatches = text.match(/#(\w+)/g)
    if (hashtagMatches) {
      tags.push(...hashtagMatches.map((tag) => tag.slice(1)))
    }

    return tags
  }

  // ============================================================================
  // Event Handling
  // ============================================================================

  /**
   * Setup internal event handlers
   */
  private setupEventHandlers(): void {
    // Handle room events
    this.roomManager.on("participantJoined", (participant) => {
      console.log(`Participant joined: ${participant.name}`)
    })

    this.roomManager.on("participantLeft", (participant) => {
      console.log(`Participant left: ${participant.name}`)
    })

    this.roomManager.on("dataReceived", (message, participant) => {
      console.log(`Data received from ${participant.name}:`, message)
      // TODO: Handle tool requests and other data messages
    })

    // Handle transcription events
    this.transcription.on("final", (result) => {
      this.onSpeech(result.text, result.speaker)
    })

    this.transcription.on("interim", (result) => {
      // Could show interim results in UI
      console.log(`Interim: ${result.text}`)
    })

    this.transcription.on("error", (error) => {
      this.emit("error", error)
    })
  }

  /**
   * Register event handler
   */
  on<K extends keyof AgentEvents>(event: K, handler: AgentEvents[K]): void {
    this.eventHandlers[event] = handler as any
  }

  /**
   * Unregister event handler
   */
  off<K extends keyof AgentEvents>(event: K): void {
    delete this.eventHandlers[event]
  }

  /**
   * Emit event to registered handlers
   */
  private emit<K extends keyof AgentEvents>(event: K, ...args: Parameters<AgentEvents[K]>): void {
    const handler = this.eventHandlers[event]
    if (handler) {
      ;(handler as any)(...args)
    }
  }

  // ============================================================================
  // Public Accessors
  // ============================================================================

  /**
   * Get room manager instance
   */
  getRoomManager(): RoomManager {
    return this.roomManager
  }

  /**
   * Get transcription service instance
   */
  getTranscriptionService(): TranscriptionService {
    return this.transcription
  }

  /**
   * Get agent configuration
   */
  getConfig(): RoomAgentConfig {
    return { ...this.config }
  }

  /**
   * Get current capabilities
   */
  getCapabilities(): AgentCapabilities {
    return { ...this.config.capabilities }
  }
}

/**
 * Create an OpenCode room agent instance
 */
export function createRoomAgent(
  liveKitConfig: LiveKitConfig,
  agentConfig: RoomAgentConfig,
): OpenCodeRoomAgent {
  return new OpenCodeRoomAgent(liveKitConfig, agentConfig)
}
