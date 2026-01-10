import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import { Identifier } from "@/id/id"
import { Instance } from "@/project/instance"
import { Log } from "@/util/log"
import z from "zod"
import { Collaboration } from "./types"

export namespace CollaborationSession {
  const log = Log.create({ service: "collaboration" })

  // Participant colors for UI differentiation
  const COLORS = [
    "#FF6B6B",
    "#4ECDC4",
    "#45B7D1",
    "#96CEB4",
    "#FFEAA7",
    "#DDA0DD",
    "#98D8C8",
    "#F7DC6F",
  ]

  // Events for real-time updates
  export const Event = {
    ParticipantJoined: BusEvent.define(
      "collaboration.participant.joined",
      z.object({
        sessionID: z.string(),
        participant: Collaboration.Participant,
      }),
    ),
    ParticipantLeft: BusEvent.define(
      "collaboration.participant.left",
      z.object({
        sessionID: z.string(),
        participantID: z.string(),
      }),
    ),
    ParticipantUpdated: BusEvent.define(
      "collaboration.participant.updated",
      z.object({
        sessionID: z.string(),
        participant: Collaboration.Participant,
      }),
    ),
    TypingChanged: BusEvent.define("collaboration.typing.changed", Collaboration.TypingStatus),
    MessageQueued: BusEvent.define(
      "collaboration.message.queued",
      z.object({
        sessionID: z.string(),
        message: Collaboration.QueuedMessage,
      }),
    ),
    QueueFlushed: BusEvent.define(
      "collaboration.queue.flushed",
      z.object({
        sessionID: z.string(),
        messageCount: z.number(),
      }),
    ),
    QueueReady: BusEvent.define(
      "collaboration.queue.ready",
      z.object({
        sessionID: z.string(),
        messageCount: z.number(),
      }),
    ),
    WaitResolved: BusEvent.define(
      "collaboration.wait.resolved",
      z.object({
        sessionID: z.string(),
        target: z.string(),
        resolvedBy: z.string(),
      }),
    ),
    WaitingFor: BusEvent.define(
      "collaboration.waiting.for",
      z.object({
        sessionID: z.string(),
        waitingFor: z.string().array(),
      }),
    ),
    JoinCodeCreated: BusEvent.define(
      "collaboration.joincode.created",
      z.object({
        sessionID: z.string(),
        code: z.string(),
      }),
    ),
  }

  // Memory-only state per instance (directory)
  const state = Instance.state(
    () => {
      const sessions = new Map<string, Collaboration.SessionState>()
      return { sessions }
    },
    async (current) => {
      // Cleanup on instance dispose - notify all participants
      for (const [sessionID, session] of current.sessions) {
        for (const participantID of Object.keys(session.participants)) {
          Bus.publish(Event.ParticipantLeft, { sessionID, participantID })
        }
      }
      current.sessions.clear()
    },
  )

  /**
   * Get or create collaborative state for a session
   */
  export function getSession(sessionID: string): Collaboration.SessionState {
    const s = state()
    let session = s.sessions.get(sessionID)
    if (!session) {
      session = {
        sessionID,
        participants: {},
        messageQueue: [],
        typingStatuses: {},
        pendingWaits: [],
      }
      s.sessions.set(sessionID, session)
    }
    return session
  }

  /**
   * Check if a session has collaborative mode enabled (has participants)
   */
  export function isCollaborative(sessionID: string): boolean {
    const session = state().sessions.get(sessionID)
    return session !== undefined && Object.keys(session.participants).length > 0
  }

  /**
   * Join a session with a name and optional role
   */
  export function join(input: {
    sessionID: string
    name: string
    role?: Collaboration.Role
  }): Collaboration.Participant {
    const session = getSession(input.sessionID)

    // Check for name collision (case-insensitive)
    const existingNames = Object.values(session.participants).map((p) => p.name.toLowerCase())
    if (existingNames.includes(input.name.toLowerCase())) {
      throw new Error(`Name "${input.name}" is already taken in this session`)
    }

    // First participant becomes driver, others are participants
    const isFirstParticipant = Object.keys(session.participants).length === 0
    const role = input.role ?? (isFirstParticipant ? "driver" : "participant")

    const participant: Collaboration.Participant = {
      id: Identifier.ascending("collab"),
      sessionID: input.sessionID,
      name: input.name,
      role,
      color: COLORS[Object.keys(session.participants).length % COLORS.length],
      time: {
        joined: Date.now(),
        lastSeen: Date.now(),
      },
    }

    session.participants[participant.id] = participant
    Bus.publish(Event.ParticipantJoined, { sessionID: input.sessionID, participant })
    log.info("participant joined", { sessionID: input.sessionID, name: input.name, role })

    return participant
  }

  /**
   * Leave a session
   */
  export function leave(sessionID: string, participantID: string): void {
    const session = state().sessions.get(sessionID)
    if (!session) return

    const participant = session.participants[participantID]
    if (!participant) return

    delete session.participants[participantID]
    delete session.typingStatuses[participantID]

    Bus.publish(Event.ParticipantLeft, { sessionID, participantID })
    log.info("participant left", { sessionID, participantID, name: participant.name })

    // If driver left, promote the next participant
    if (participant.role === "driver") {
      const remaining = Object.values(session.participants)
      if (remaining.length > 0) {
        remaining[0].role = "driver"
        Bus.publish(Event.ParticipantUpdated, { sessionID, participant: remaining[0] })
        log.info("new driver promoted", { sessionID, name: remaining[0].name })
      }
    }

    // If all participants left, clean up the session state
    if (Object.keys(session.participants).length === 0) {
      state().sessions.delete(sessionID)
    }
  }

  /**
   * Update typing status for a participant
   */
  export function setTyping(input: {
    sessionID: string
    participantID: string
    isTyping: boolean
    preview?: string
  }): void {
    const session = state().sessions.get(input.sessionID)
    if (!session) return
    if (!session.participants[input.participantID]) return

    const status: Collaboration.TypingStatus = {
      participantID: input.participantID,
      sessionID: input.sessionID,
      isTyping: input.isTyping,
      preview: input.preview?.slice(0, 50),
      time: Date.now(),
    }

    if (input.isTyping) {
      session.typingStatuses[input.participantID] = status
    } else {
      delete session.typingStatuses[input.participantID]
    }

    Bus.publish(Event.TypingChanged, status)
  }

  /**
   * Get all participants in a session
   */
  export function participants(sessionID: string): Collaboration.Participant[] {
    const session = state().sessions.get(sessionID)
    return session ? Object.values(session.participants) : []
  }

  /**
   * Get a specific participant by ID
   */
  export function getParticipant(
    sessionID: string,
    participantID: string,
  ): Collaboration.Participant | undefined {
    const session = state().sessions.get(sessionID)
    return session?.participants[participantID]
  }

  /**
   * Get a participant by name (case-insensitive)
   */
  export function getParticipantByName(
    sessionID: string,
    name: string,
  ): Collaboration.Participant | undefined {
    const session = state().sessions.get(sessionID)
    if (!session) return undefined
    return Object.values(session.participants).find(
      (p) => p.name.toLowerCase() === name.toLowerCase(),
    )
  }

  /**
   * Get typing statuses for a session
   */
  export function typingStatuses(sessionID: string): Collaboration.TypingStatus[] {
    const session = state().sessions.get(sessionID)
    return session ? Object.values(session.typingStatuses) : []
  }

  /**
   * Get the current driver of a session
   */
  export function getDriver(sessionID: string): Collaboration.Participant | undefined {
    const session = state().sessions.get(sessionID)
    if (!session) return undefined
    return Object.values(session.participants).find((p) => p.role === "driver")
  }

  /**
   * Promote a participant to driver
   */
  export function promoteToDriver(sessionID: string, participantID: string): void {
    const session = state().sessions.get(sessionID)
    if (!session) return

    const newDriver = session.participants[participantID]
    if (!newDriver) return

    // Demote current driver
    const currentDriver = Object.values(session.participants).find((p) => p.role === "driver")
    if (currentDriver) {
      currentDriver.role = "participant"
      Bus.publish(Event.ParticipantUpdated, { sessionID, participant: currentDriver })
    }

    // Promote new driver
    newDriver.role = "driver"
    Bus.publish(Event.ParticipantUpdated, { sessionID, participant: newDriver })
    log.info("driver changed", { sessionID, newDriver: newDriver.name })
  }

  /**
   * Handoff driver role to another participant
   */
  export function handoffDriver(
    sessionID: string,
    currentDriverID: string,
    newDriverID: string,
  ): void {
    const session = state().sessions.get(sessionID)
    if (!session) return

    const currentDriver = session.participants[currentDriverID]
    if (!currentDriver || currentDriver.role !== "driver") {
      throw new Error("Current participant is not a driver")
    }

    const newDriver = session.participants[newDriverID]
    if (!newDriver) {
      throw new Error("New driver not found in session")
    }

    currentDriver.role = "participant"
    newDriver.role = "driver"

    Bus.publish(Event.ParticipantUpdated, { sessionID, participant: currentDriver })
    Bus.publish(Event.ParticipantUpdated, { sessionID, participant: newDriver })
    log.info("driver handoff", {
      sessionID,
      from: currentDriver.name,
      to: newDriver.name,
    })
  }

  /**
   * Update participant's last seen time (heartbeat)
   */
  export function heartbeat(sessionID: string, participantID: string): void {
    const session = state().sessions.get(sessionID)
    if (!session) return

    const participant = session.participants[participantID]
    if (participant) {
      participant.time.lastSeen = Date.now()
    }
  }

  /**
   * Remove stale participants (not seen in timeout period)
   */
  export function cleanupStale(sessionID: string, timeoutMs: number = 30_000): string[] {
    const session = state().sessions.get(sessionID)
    if (!session) return []

    const now = Date.now()
    const removed: string[] = []

    for (const [participantID, participant] of Object.entries(session.participants)) {
      if (now - participant.time.lastSeen > timeoutMs) {
        leave(sessionID, participantID)
        removed.push(participantID)
      }
    }

    return removed
  }
}

// Re-export types and modules
export { Collaboration } from "./types"
export { CollaborationDirectives } from "./directives"
export { CollaborationQueue } from "./queue"
export { CollaborationJoinCode } from "./join-code"
