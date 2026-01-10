import { Bus } from "@/bus"
import { Log } from "@/util/log"
import { Identifier } from "@/id/id"
import { Collaboration } from "./types"
import { CollaborationSession } from "./index"
import { CollaborationDirectives } from "./directives"

export namespace CollaborationQueue {
  const log = Log.create({ service: "collaboration.queue" })

  /**
   * Result of a flush check
   */
  export interface FlushCheckResult {
    flush: boolean
    reason: "empty_queue" | "no_pending_waits" | "all_waits_resolved" | "pending_waits"
    waitingFor?: string[]
  }

  /**
   * Combined message result from queue flush
   */
  export interface CombinedMessage {
    text: string
    participants: string[]
    attachments: unknown[]
  }

  /**
   * Add a message to the queue with directive parsing
   */
  export function enqueue(input: {
    sessionID: string
    participantID: string
    participantName: string
    text: string
    attachments?: unknown[]
  }): Collaboration.QueuedMessage {
    const session = CollaborationSession.getSession(input.sessionID)
    const directives = CollaborationDirectives.parse(input.text, session.participants)

    const message: Collaboration.QueuedMessage = {
      id: Identifier.ascending("message"),
      sessionID: input.sessionID,
      participantID: input.participantID,
      participantName: input.participantName,
      text: input.text,
      directives,
      time: { queued: Date.now() },
      attachments: input.attachments,
    }

    session.messageQueue.push(message)

    // Handle wait directives (~alice, ~all)
    for (const directive of directives) {
      if (directive.type === "wait") {
        addPendingWait(session, directive.target, input.participantID)
      }
    }

    Bus.publish(CollaborationSession.Event.MessageQueued, {
      sessionID: input.sessionID,
      message,
    })

    log.info("message queued", {
      sessionID: input.sessionID,
      participant: input.participantName,
      directives: directives.length,
    })

    // Record this participant's response (resolves any waits for them)
    recordResponse(input.sessionID, input.participantID)

    // Try to flush if conditions are met
    tryFlush(input.sessionID)

    return message
  }

  /**
   * Add a pending wait for a target
   */
  function addPendingWait(
    session: Collaboration.SessionState,
    target: string,
    triggeredBy: string,
  ): void {
    const waitingFor: string[] = []

    if (target === "all") {
      // Wait for all other participants
      for (const [id] of Object.entries(session.participants)) {
        if (id !== triggeredBy) {
          waitingFor.push(id)
        }
      }
    } else {
      // Wait for specific participant by name
      const targetParticipant = Object.values(session.participants).find(
        (p) => p.name.toLowerCase() === target.toLowerCase(),
      )

      if (targetParticipant && targetParticipant.id !== triggeredBy) {
        waitingFor.push(targetParticipant.id)
      }
    }

    if (waitingFor.length > 0) {
      session.pendingWaits.push({ target, waitingFor, triggeredBy })

      // Broadcast waiting status
      Bus.publish(CollaborationSession.Event.WaitingFor, {
        sessionID: session.sessionID,
        waitingFor: getWaitingForNames(session),
      })
    }
  }

  /**
   * Get names of participants being waited for
   */
  function getWaitingForNames(session: Collaboration.SessionState): string[] {
    const waitingIds = new Set<string>()
    for (const wait of session.pendingWaits) {
      for (const id of wait.waitingFor) {
        waitingIds.add(id)
      }
    }
    return Array.from(waitingIds)
      .map((id) => session.participants[id]?.name)
      .filter(Boolean) as string[]
  }

  /**
   * Determine if queue should be flushed
   *
   * Queue auto-flushes ONLY when:
   * - There were ~wait directives AND they're all resolved
   *
   * Queue does NOT auto-flush when:
   * - No ~directives used (driver must send to flush)
   * - There are still pending waits
   */
  export function shouldFlush(sessionID: string): FlushCheckResult {
    const session = CollaborationSession.getSession(sessionID)

    if (session.messageQueue.length === 0) {
      return { flush: false, reason: "empty_queue" }
    }

    // If no pending waits, DON'T auto-flush - wait for driver to send
    if (session.pendingWaits.length === 0) {
      return { flush: false, reason: "no_pending_waits" }
    }

    // Check if all pending waits are resolved - then auto-flush
    const allResolved = session.pendingWaits.every((wait) => wait.waitingFor.length === 0)
    if (allResolved) {
      return { flush: true, reason: "all_waits_resolved" }
    }

    return {
      flush: false,
      reason: "pending_waits",
      waitingFor: getWaitingForNames(session),
    }
  }

  /**
   * Notify that queue is ready to be committed, if conditions are met.
   *
   * Important: this does NOT clear the queue. The driver commits by calling `forceFlush()`.
   */
  export function tryFlush(sessionID: string): boolean {
    const { flush, reason } = shouldFlush(sessionID)

    if (flush) {
      const session = CollaborationSession.getSession(sessionID)
      log.info("queue ready", { sessionID, reason, messageCount: session.messageQueue.length })
      Bus.publish(CollaborationSession.Event.QueueReady, {
        sessionID,
        messageCount: session.messageQueue.length,
      })
      return true
    }

    return false
  }

  /**
   * Force flush by driver (override pending waits)
   */
  export function forceFlush(sessionID: string, participantID: string): boolean {
    const session = CollaborationSession.getSession(sessionID)
    const participant = session.participants[participantID]

    if (!participant || participant.role !== "driver") {
      throw new Error("Only drivers can force flush the queue")
    }

    log.info("driver force-flushing queue", { sessionID, participantID })
    return doFlush(sessionID)
  }

  /**
   * Execute the flush - prepare for AI processing
   */
  function doFlush(sessionID: string): boolean {
    const session = CollaborationSession.getSession(sessionID)

    if (session.messageQueue.length === 0) {
      return false
    }

    const messageCount = session.messageQueue.length

    // Clear the message queue
    session.messageQueue = []

    // Clear pending waits
    session.pendingWaits = []

    Bus.publish(CollaborationSession.Event.QueueFlushed, { sessionID, messageCount })
    log.info("queue flushed", { sessionID, messageCount })

    return true
  }

  /**
   * Get combined message text from queue for AI
   * Call this before clearing the queue
   */
  export function getCombinedMessage(sessionID: string): CombinedMessage {
    const session = CollaborationSession.getSession(sessionID)
    const participantNames = new Set<string>()
    const attachments: unknown[] = []

    // Format messages with participant attribution
    const lines = session.messageQueue.map((msg) => {
      participantNames.add(msg.participantName)
      if (msg.attachments) {
        attachments.push(...msg.attachments)
      }
      // Strip directives from the displayed text
      const cleanText = CollaborationDirectives.stripDirectives(msg.text)
      return `[${msg.participantName}]: ${cleanText}`
    })

    return {
      text: lines.join("\n\n"),
      participants: Array.from(participantNames),
      attachments,
    }
  }

  /**
   * Clear the queue after processing
   */
  export function clearQueue(sessionID: string): void {
    const session = CollaborationSession.getSession(sessionID)
    session.messageQueue = []
  }

  /**
   * Handle participant response to resolve waits
   */
  export function recordResponse(sessionID: string, participantID: string): void {
    const session = CollaborationSession.getSession(sessionID)

    for (const wait of session.pendingWaits) {
      const idx = wait.waitingFor.indexOf(participantID)
      if (idx !== -1) {
        wait.waitingFor.splice(idx, 1)

        if (wait.waitingFor.length === 0) {
          const participant = session.participants[participantID]
          Bus.publish(CollaborationSession.Event.WaitResolved, {
            sessionID,
            target: wait.target,
            resolvedBy: participant?.name ?? participantID,
          })
        }
      }
    }

    // Broadcast updated waiting status
    const waitingFor = getWaitingForNames(session)
    Bus.publish(CollaborationSession.Event.WaitingFor, {
      sessionID,
      waitingFor,
    })

    // If all waits are resolved, notify readiness.
    if (waitingFor.length === 0) {
      tryFlush(sessionID)
    }
  }

  /**
   * Get pending queue for display
   */
  export function getQueue(sessionID: string): Collaboration.QueuedMessage[] {
    return CollaborationSession.getSession(sessionID).messageQueue
  }

  /**
   * Get pending waits for display
   */
  export function getPendingWaits(sessionID: string): Collaboration.PendingWait[] {
    return CollaborationSession.getSession(sessionID).pendingWaits
  }

  /**
   * Get queue length
   */
  export function getQueueLength(sessionID: string): number {
    return CollaborationSession.getSession(sessionID).messageQueue.length
  }
}
