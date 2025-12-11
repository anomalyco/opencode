import { Log } from "../util/log"
import path from "path"
import fs from "fs/promises"

import type { MessageV2 } from "../session/message-v2"
import type { Session } from "../session"

// AG-UI Event type constants
export const AGUIEventType = {
  // Message events
  TEXT_MESSAGE_START: "TEXT_MESSAGE_START",
  TEXT_MESSAGE_CONTENT: "TEXT_MESSAGE_CONTENT",
  TEXT_MESSAGE_END: "TEXT_MESSAGE_END",

  // Tool events
  TOOL_CALL_START: "TOOL_CALL_START",
  TOOL_CALL_ARGS: "TOOL_CALL_ARGS",
  TOOL_CALL_END: "TOOL_CALL_END",

  // Run lifecycle
  RUN_STARTED: "RUN_STARTED",
  RUN_FINISHED: "RUN_FINISHED",
  RUN_ERROR: "RUN_ERROR",

  // Step lifecycle
  STEP_STARTED: "STEP_STARTED",
  STEP_FINISHED: "STEP_FINISHED",
} as const

export type AGUIEventType = (typeof AGUIEventType)[keyof typeof AGUIEventType]

// Event interface for AG-UI events
export interface AGUIEvent {
  timestamp: string
  type: AGUIEventType
  agent: string // "user" | "assistant" | agent name
  session_id: string
  data: Record<string, unknown>
}

// Metadata interface for run lifecycle
export interface RunMetadata {
  session_id: string
  project_id: string
  title: string
  start_time: string
  end_time: string | null
  duration_seconds: number | null
  status: "running" | "completed" | "error"
  error: string | null
  parent_session_id: string | null
}

// Journal message interface
export interface JournalMessage {
  role: "user" | "assistant"
  content: string
  tool_calls?: Array<{
    tool: string
    input: unknown
    output: unknown
  }>
}

// Journal interface for conversation history
export interface Journal {
  session_id: string
  written_at: string
  trigger: "compaction" | "session_end" | "manual"
  messages: JournalMessage[]
}

export namespace AgentMemory {
  const log = Log.create({ service: "agent-memory" })

  // Track agent name for each session
  const sessionAgentNames: Record<string, string> = {}

  // Get the agent name for a session, with fallback to "build"
  export function getSessionAgentName(sessionID: string): string {
    return sessionAgentNames[sessionID] || "build"
  }

  // Set the agent name for a session
  export function setSessionAgentName(sessionID: string, agentName: string): void {
    if (!sessionAgentNames[sessionID]) {
      sessionAgentNames[sessionID] = agentName
    }
  }

  // Get the runs directory for a session: {worktree}/.starfleet/runs/{agentName}/{sessionID}/
  async function getRunDir(sessionID: string, agentName: string): Promise<string | null> {
    try {
      const { Instance } = await import("../project/instance")
      const worktree = Instance.worktree
      if (worktree) {
        return path.join(worktree, ".starfleet", "runs", agentName, sessionID)
      }
    } catch {
      // Instance context not available
    }
    return null
  }

  // Ensure run directory exists
  async function ensureRunDir(sessionID: string, agentName: string): Promise<string | null> {
    const runDir = await getRunDir(sessionID, agentName)
    if (!runDir) return null
    await fs.mkdir(runDir, { recursive: true })
    return runDir
  }

  // Append event to events.jsonl
  export async function appendEvent(event: AGUIEvent, agentName: string): Promise<void> {
    const runDir = await ensureRunDir(event.session_id, agentName)
    if (!runDir) return
    const eventsFile = path.join(runDir, "events.jsonl")
    try {
      const line = JSON.stringify(event) + "\n"
      await fs.appendFile(eventsFile, line)
    } catch (e) {
      log.debug("appendEvent failed", { error: e })
    }
  }

  // Write metadata.json
  export async function writeMetadata(metadata: RunMetadata, agentName: string): Promise<void> {
    const runDir = await ensureRunDir(metadata.session_id, agentName)
    if (!runDir) return
    const metadataFile = path.join(runDir, "metadata.json")
    try {
      await fs.writeFile(metadataFile, JSON.stringify(metadata, null, 2))
    } catch (e) {
      log.debug("writeMetadata failed", { error: e })
    }
  }

  // Write journal.json
  // Note: Journal functions will be updated in Phase 3
  export async function writeJournal(journal: Journal): Promise<void> {
    const agentName = getSessionAgentName(journal.session_id)
    const runDir = await ensureRunDir(journal.session_id, agentName)
    if (!runDir) return
    const journalFile = path.join(runDir, "journal.json")
    try {
      await fs.writeFile(journalFile, JSON.stringify(journal, null, 2))
    } catch (e) {
      log.debug("writeJournal failed", { error: e })
    }
  }

  // Helper to create ISO timestamp
  export function timestamp(): string {
    return new Date().toISOString()
  }

  // Transform MessageV2.Part to AGUIEvent
  function partToAGUIEvent(sessionID: string, part: MessageV2.Part): AGUIEvent | null {
    const base = {
      timestamp: timestamp(),
      session_id: sessionID,
      agent: "assistant",
    }

    switch (part.type) {
      case "text":
        return {
          ...base,
          type: AGUIEventType.TEXT_MESSAGE_CONTENT,
          data: { content: part.text },
        }
      case "tool": {
        const state = part.state
        if (state.status === "pending") {
          return {
            ...base,
            type: AGUIEventType.TOOL_CALL_START,
            data: { tool: part.tool, id: part.id, call_id: part.callID },
          }
        }
        if (state.status === "running") {
          return {
            ...base,
            type: AGUIEventType.TOOL_CALL_ARGS,
            data: { tool: part.tool, id: part.id, call_id: part.callID, input: state.input },
          }
        }
        if (state.status === "completed") {
          return {
            ...base,
            type: AGUIEventType.TOOL_CALL_END,
            data: {
              tool: part.tool,
              id: part.id,
              call_id: part.callID,
              output: state.output,
              status: state.status,
            },
          }
        }
        if (state.status === "error") {
          return {
            ...base,
            type: AGUIEventType.TOOL_CALL_END,
            data: {
              tool: part.tool,
              id: part.id,
              call_id: part.callID,
              error: state.error,
              status: state.status,
            },
          }
        }
        return null
      }
      case "step-start":
        return {
          ...base,
          type: AGUIEventType.STEP_STARTED,
          data: { snapshot: part.snapshot },
        }
      case "step-finish":
        return {
          ...base,
          type: AGUIEventType.STEP_FINISHED,
          data: {
            reason: part.reason,
            cost: part.cost,
            tokens: part.tokens,
          },
        }
      default:
        // reasoning, file, patch, snapshot, agent, retry, subtask, compaction - skip for now
        return null
    }
  }

  // Extract text content from user message parts
  function getUserMessageText(parts: MessageV2.Part[]): string {
    return parts
      .filter((p): p is MessageV2.TextPart => p.type === "text")
      .map((p) => p.text)
      .join("\n")
  }

  // Track session start times for duration calculation
  const sessionStartTimes: Record<string, number> = {}

  // Track logged user messages to prevent duplicates
  const loggedUserMessages = new Set<string>()

  // Track logged tool call states to prevent duplicates (key: `${partId}:${status}`)
  const loggedToolStates = new Set<string>()

  // Initialize AgentMemory event subscriptions
  export async function init(): Promise<void> {
    // Use dynamic import to avoid circular dependencies at module load time
    const { Bus } = await import("../bus")
    const { MessageV2: MsgV2 } = await import("../session/message-v2")
    const { Session: Sess } = await import("../session")
    const { SessionStatus } = await import("../session/status")
    const { Storage } = await import("./storage")

    // Helper to get agent name from a message
    async function getAgentNameFromMessage(sessionID: string, messageID: string): Promise<string> {
      try {
        const msgInfo = await Storage.read<MessageV2.Info>(["message", sessionID, messageID])
        if (msgInfo) {
          if (msgInfo.role === "assistant") {
            return msgInfo.mode
          } else if (msgInfo.role === "user") {
            return msgInfo.agent
          }
        }
      } catch {
        // Ignore errors
      }
      return getSessionAgentName(sessionID)
    }

    // Subscribe to part updates (assistant responses, tool calls, steps)
    Bus.subscribe(MsgV2.Event.PartUpdated, async (payload) => {
      const { part } = payload.properties

      // Skip text parts entirely:
      // - User text is handled via MessageV2.Event.Updated
      // - Assistant text streaming deltas are too noisy (30+ events per response)
      // - Full conversation content is preserved in journal.json
      if (part.type === "text") return

      // Deduplicate tool call states (each state fires multiple times)
      if (part.type === "tool") {
        const stateKey = `${part.id}:${part.state.status}`
        if (loggedToolStates.has(stateKey)) return
        loggedToolStates.add(stateKey)
      }

      // Get agent name from the message
      const agentName = await getAgentNameFromMessage(part.sessionID, part.messageID)
      setSessionAgentName(part.sessionID, agentName)

      const event = partToAGUIEvent(part.sessionID, part)
      if (event) {
        appendEvent(event, agentName).catch(() => {})
      }
    })

    // Subscribe to session created
    Bus.subscribe(Sess.Event.Created, async (payload) => {
      const { info } = payload.properties

      // Track start time for duration calculation
      sessionStartTimes[info.id] = info.time.created

      // Determine agent name:
      // - For main sessions (no parentID), default to "build"
      // - For subagent sessions, we'll set it later when we receive the first message
      // The agent name will be properly set when we receive the first user message
      const agentName = info.parentID ? getSessionAgentName(info.id) : "build"
      setSessionAgentName(info.id, agentName)

      // Write RUN_STARTED event
      appendEvent({
        timestamp: timestamp(),
        type: AGUIEventType.RUN_STARTED,
        agent: "system",
        session_id: info.id,
        data: {
          title: info.title,
          parent_id: info.parentID || null,
          project_id: info.projectID,
        },
      }, agentName).catch(() => {})

      // Write initial metadata
      writeMetadata({
        session_id: info.id,
        project_id: info.projectID || "",
        title: info.title,
        start_time: new Date(info.time.created).toISOString(),
        end_time: null,
        duration_seconds: null,
        status: "running",
        error: null,
        parent_session_id: info.parentID || null,
      }, agentName).catch(() => {})
    })

    // Subscribe to message updates (for user messages)
    Bus.subscribe(MsgV2.Event.Updated, async (payload) => {
      const { info } = payload.properties
      if (info.role === "user") {
        // Skip if already logged (Event.Updated fires multiple times per message)
        if (loggedUserMessages.has(info.id)) return
        loggedUserMessages.add(info.id)

        // Set the agent name from the user message's agent field
        const agentName = info.agent
        setSessionAgentName(info.sessionID, agentName)

        // For user messages, we need to fetch parts to get text content
        try {
          const parts = await MsgV2.parts(info.id)
          const text = getUserMessageText(parts)
          if (text) {
            appendEvent({
              timestamp: timestamp(),
              type: AGUIEventType.TEXT_MESSAGE_CONTENT,
              agent: "user",
              session_id: info.sessionID,
              data: { content: text, message_id: info.id },
            }, agentName).catch(() => {})
          }
        } catch {
          // Ignore errors fetching parts
        }
      }
    })

    // Subscribe to session errors (RUN_ERROR)
    Bus.subscribe(Sess.Event.Error, async (payload) => {
      const { sessionID, error } = payload.properties
      if (!sessionID) return

      const endTime = Date.now()
      const startTime = sessionStartTimes[sessionID]
      const durationSeconds = startTime ? Math.round((endTime - startTime) / 1000) : null

      // Extract error message from the discriminated union error type
      // Error has shape: { name: string, data: { message?: string, ... } }
      const errorMessage = error?.data && "message" in error.data ? error.data.message : error?.name || "Unknown error"

      // Get the tracked agent name for this session
      const agentName = getSessionAgentName(sessionID)

      // Write RUN_ERROR event
      appendEvent({
        timestamp: timestamp(),
        type: AGUIEventType.RUN_ERROR,
        agent: "system",
        session_id: sessionID,
        data: {
          error: errorMessage,
        },
      }, agentName).catch(() => {})

      // Update metadata with error status
      try {
        const { Session } = await import("../session")
        const session = await Session.get(sessionID)
        if (session) {
          writeMetadata({
            session_id: sessionID,
            project_id: session.projectID || "",
            title: session.title,
            start_time: new Date(session.time.created).toISOString(),
            end_time: new Date(endTime).toISOString(),
            duration_seconds: durationSeconds,
            status: "error",
            error: errorMessage,
            parent_session_id: session.parentID || null,
          }, agentName).catch(() => {})
        }
      } catch {
        // Ignore errors fetching session
      }

      // Clean up start time tracking
      delete sessionStartTimes[sessionID]
    })

    // Subscribe to session status changes (RUN_FINISHED when idle)
    Bus.subscribe(SessionStatus.Event.Status, async (payload) => {
      const { sessionID, status } = payload.properties
      if (status.type !== "idle") return

      const endTime = Date.now()
      const startTime = sessionStartTimes[sessionID]
      const durationSeconds = startTime ? Math.round((endTime - startTime) / 1000) : null

      // Get the tracked agent name for this session
      const agentName = getSessionAgentName(sessionID)

      // Write RUN_FINISHED event
      appendEvent({
        timestamp: timestamp(),
        type: AGUIEventType.RUN_FINISHED,
        agent: "system",
        session_id: sessionID,
        data: {},
      }, agentName).catch(() => {})

      // Update metadata with completed status
      try {
        const { Session } = await import("../session")
        const session = await Session.get(sessionID)
        if (session) {
          writeMetadata({
            session_id: sessionID,
            project_id: session.projectID || "",
            title: session.title,
            start_time: new Date(session.time.created).toISOString(),
            end_time: new Date(endTime).toISOString(),
            duration_seconds: durationSeconds,
            status: "completed",
            error: null,
            parent_session_id: session.parentID || null,
          }, agentName).catch(() => {})
        }
      } catch {
        // Ignore errors fetching session
      }

      // Clean up start time tracking
      delete sessionStartTimes[sessionID]
    })

    log.info("AgentMemory initialized")
  }

  // Create and write journal for a session
  export async function createJournal(
    sessionID: string,
    trigger: "compaction" | "session_end" | "manual",
  ): Promise<void> {
    try {
      // Dynamic import to avoid circular dependencies
      const { Session } = await import("../session")

      // Fetch all messages with their parts (returns in chronological order)
      const messagesWithParts = await Session.messages({ sessionID })

      // Transform to journal format
      const journalMessages: JournalMessage[] = []

      for (const msg of messagesWithParts) {
        const journalMsg: JournalMessage = {
          role: msg.info.role as "user" | "assistant",
          content: "",
        }

        // Extract text content
        const textParts = msg.parts.filter((p): p is MessageV2.TextPart => p.type === "text")
        journalMsg.content = textParts.map((p) => p.text).join("\n")

        // Extract tool calls for assistant messages
        if (msg.info.role === "assistant") {
          const toolParts = msg.parts.filter((p): p is MessageV2.ToolPart => p.type === "tool")
          const completedToolCalls: Array<{ tool: string; input: unknown; output: unknown }> = []

          for (const p of toolParts) {
            if (p.state.status === "completed") {
              completedToolCalls.push({
                tool: p.tool,
                input: p.state.input,
                output: p.state.output,
              })
            } else if (p.state.status === "error") {
              completedToolCalls.push({
                tool: p.tool,
                input: p.state.input,
                output: p.state.error,
              })
            }
          }

          if (completedToolCalls.length > 0) {
            journalMsg.tool_calls = completedToolCalls
          }
        }

        // Only add if there's content
        if (journalMsg.content || journalMsg.tool_calls?.length) {
          journalMessages.push(journalMsg)
        }
      }

      // Create journal object
      const journal: Journal = {
        session_id: sessionID,
        written_at: timestamp(),
        trigger,
        messages: journalMessages,
      }

      // Write to file
      await writeJournal(journal)
      log.info("Journal created", { sessionID, trigger, messageCount: journalMessages.length })
    } catch (e) {
      log.debug("createJournal failed", { sessionID, error: e })
    }
  }
}
