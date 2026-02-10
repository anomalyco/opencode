import { Log } from "../util/log"
import { Bus } from "../bus"
import { Session } from "../session"
import { SessionPrompt } from "../session/prompt"
import { SessionStatus } from "../session/status"
import { Identifier } from "../id/id"
import { Team, TeamEvent } from "./index"
import { Inbox } from "./inbox"

const log = Log.create({ service: "team.messaging" })
const MAX_TEXT = 10 * 1024

function validateText(text: string) {
  if (text.length <= MAX_TEXT) return
  throw new Error(`Team message too large (${text.length} chars). Maximum is ${MAX_TEXT} chars.`)
}

function messageId(): string {
  return `im_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

export namespace TeamMessaging {
  /**
   * Send a message from one team member to another.
   * Writes to the recipient's inbox (source of truth), then injects
   * a synthetic user message into their session (delivery mechanism),
   * then auto-wakes if idle.
   */
  export async function send(input: { teamName: string; from: string; to: string; text: string }): Promise<void> {
    validateText(input.text)
    const team = await Team.get(input.teamName)
    if (!team) throw new Error(`Team "${input.teamName}" not found`)

    // Find recipient session
    let targetSessionID: string | undefined
    if (input.to === "lead") {
      targetSessionID = team.leadSessionID
    } else {
      const member = team.members.find((m) => m.name === input.to)
      if (!member) throw new Error(`Member "${input.to}" not found in team "${input.teamName}"`)
      if (member.status === "shutdown") throw new Error(`Member "${input.to}" has shut down`)
      targetSessionID = member.sessionID
    }

    if (!targetSessionID) throw new Error(`Could not find session for "${input.to}"`)

    // Write to inbox (source of truth)
    const inboxId = messageId()
    await Inbox.write(input.teamName, input.to, {
      id: inboxId,
      from: input.from,
      text: input.text,
      timestamp: Date.now(),
    })

    // Inject into session (delivery mechanism), tagged with inbox ID for dedup
    await injectMessage(targetSessionID, input.from, input.text, inboxId)

    log.info("message sent", { teamName: input.teamName, from: input.from, to: input.to })
    await Bus.publish(TeamEvent.Message, {
      teamName: input.teamName,
      from: input.from,
      to: input.to,
      text: input.text,
    })

    // Auto-wake: if the recipient session is idle, start its prompt loop
    // so the LLM processes the injected message.
    autoWake(targetSessionID, input.from)
  }

  /**
   * Broadcast a message from one member to all other members.
   */
  export async function broadcast(input: { teamName: string; from: string; text: string }): Promise<void> {
    validateText(input.text)
    const team = await Team.get(input.teamName)
    if (!team) throw new Error(`Team "${input.teamName}" not found`)

    // Send to all active members except the sender
    const memberTargets = team.members
      .filter((m) => m.name !== input.from && m.status !== "shutdown")
      .map((m) => ({ name: m.name, sessionID: m.sessionID }))

    const targets =
      input.from !== "lead" && team.leadSessionID
        ? [{ name: "lead", sessionID: team.leadSessionID }, ...memberTargets]
        : memberTargets

    const errors: Array<{ target: string; phase: string; error: string }> = []
    for (const target of targets) {
      const inboxId = messageId()

      // Write to inbox (source of truth)
      const wrote = await Inbox.write(input.teamName, target.name, {
        id: inboxId,
        from: input.from,
        text: input.text,
        timestamp: Date.now(),
      }).then(
        () => true,
        (err: unknown) => {
          const msg = err instanceof Error ? err.message : String(err)
          log.warn("broadcast inbox write failed", { target: target.name, error: msg })
          errors.push({ target: target.name, phase: "inbox", error: msg })
          return false
        },
      )

      // Only inject if inbox write succeeded — no point delivering a message
      // that won't survive recovery
      if (wrote) {
        await injectMessage(target.sessionID, input.from, input.text, inboxId).catch((err) => {
          const msg = err instanceof Error ? err.message : String(err)
          log.warn("broadcast inject failed", { target: target.name, error: msg })
          errors.push({ target: target.name, phase: "inject", error: msg })
        })
      }
    }

    const delivered = targets.length - errors.filter((e) => e.phase === "inbox").length
    log.info("broadcast sent", {
      teamName: input.teamName,
      from: input.from,
      targets: targets.length,
      delivered,
      errors: errors.length,
    })
    if (errors.length > 0) log.warn("broadcast partial failure", { teamName: input.teamName, errors })

    await Bus.publish(TeamEvent.Broadcast, {
      teamName: input.teamName,
      from: input.from,
      text: input.text,
    })

    // Auto-wake all idle recipient sessions
    for (const target of targets) {
      autoWake(target.sessionID, input.from)
    }
  }

  /**
   * Mark all messages as read in an agent's inbox, then send
   * delivery receipts back to each sender. Receipts are batched
   * per sender and flow through the same inbox + inject + auto-wake
   * path as regular team messages.
   */
  export async function markRead(teamName: string, agentName: string): Promise<number> {
    const read = await Inbox.markRead(teamName, agentName)
    if (read.length === 0) return 0

    // Group by sender for batched receipts
    const bySender = new Map<string, number>()
    for (const msg of read) {
      bySender.set(msg.from, (bySender.get(msg.from) ?? 0) + 1)
    }

    // Send a receipt to each distinct sender
    const team = await Team.get(teamName)
    if (team) {
      for (const [sender, count] of bySender) {
        // Find sender's session
        let senderSessionID: string | undefined
        if (sender === "lead") {
          senderSessionID = team.leadSessionID
        } else {
          const member = team.members.find((m) => m.name === sender)
          if (member && member.status !== "shutdown") senderSessionID = member.sessionID
        }
        if (!senderSessionID) continue

        const text = count === 1 ? `${agentName} has read your message` : `${agentName} has read your ${count} messages`

        const receiptId = messageId()
        await Inbox.write(teamName, sender, {
          id: receiptId,
          from: agentName,
          text: `[receipt] ${text}`,
          timestamp: Date.now(),
        }).catch((err: unknown) => {
          log.warn("receipt inbox write failed", {
            teamName,
            sender,
            error: err instanceof Error ? err.message : String(err),
          })
        })

        await injectMessage(senderSessionID, agentName, `[receipt] ${text}`, receiptId).catch((err: unknown) => {
          log.warn("receipt inject failed", {
            teamName,
            sender,
            error: err instanceof Error ? err.message : String(err),
          })
        })

        autoWake(senderSessionID, agentName)
      }
      log.info("delivery receipts sent", { teamName, from: agentName, senders: [...bySender.keys()] })
    }

    return read.length
  }

  /**
   * Reinject unread inbox messages that were never delivered to the session.
   * Deduplicates by inboxMessageId stored in part metadata.
   * Returns the number of messages reinjected.
   */
  export async function recoverInbox(teamName: string, agentName: string, sessionID: string): Promise<number> {
    const pending = await Inbox.unread(teamName, agentName)
    if (pending.length === 0) return 0

    // Find inbox message IDs already present in the session
    const msgs = await Session.messages({ sessionID })
    const delivered = new Set<string>()
    for (const msg of msgs) {
      for (const part of msg.parts) {
        const meta = (part as { metadata?: Record<string, unknown> }).metadata
        if (meta?.inboxMessageId) delivered.add(meta.inboxMessageId as string)
      }
    }

    let count = 0
    for (const msg of pending) {
      if (delivered.has(msg.id)) continue
      await injectMessage(sessionID, msg.from, msg.text, msg.id)
      count++
    }

    if (count > 0)
      log.info("inbox recovery", { teamName, agentName, reinjected: count, skipped: pending.length - count })
    return count
  }

  /**
   * Auto-wake an idle session after a team message is injected.
   * If the session is idle (no active prompt loop), starts a new loop
   * so the LLM picks up and processes the injected message.
   */
  async function autoWake(sessionID: string, from: string) {
    try {
      const status = SessionStatus.get(sessionID)
      if (status.type !== "idle") return
      // Don't wake a teammate that's fully shut down.
      // We DO wake for shutdown_requested — the teammate needs to process
      // the shutdown message and wrap up. The .then() handler below
      // transitions shutdown_requested → shutdown when the loop ends.
      const info = await Team.findBySession(sessionID)
      if (info && info.role === "member") {
        const member = info.team.members.find((m) => m.name === info.memberName)
        if (member?.status === "shutdown") return
      }
      log.info("auto-waking idle session", { sessionID, from })
      SessionPrompt.loop({ sessionID })
        .then(async () => {
          // When an auto-woken loop ends, check if shutdown was requested.
          // Shutdown is authoritative — the teammate gets one loop to wrap up
          // (summarize findings, send final messages) then transitions to shutdown.
          // Both this handler and the spawn .then() check for shutdown_requested;
          // transitionMemberStatus is idempotent (from === status returns early).
          const match = await Team.findBySession(sessionID)
          if (!match || match.role !== "member") return
          const team = await Team.get(match.team.name)
          const member = team?.members.find((m) => m.name === match.memberName)
          if (member?.status === "shutdown_requested") {
            await Team.transitionMemberStatus(match.team.name, match.memberName!, "shutdown")
            log.info("auto-wake loop completed shutdown", { teamName: match.team.name, name: match.memberName })
          }
        })
        .catch((err: unknown) => {
          log.warn("auto-wake loop failed", { sessionID, error: err instanceof Error ? err.message : String(err) })
        })
    } catch (err) {
      log.warn("auto-wake failed", { sessionID, error: err instanceof Error ? (err as Error).message : String(err) })
    }
  }

  /**
   * Inject a synthetic user message into a session from a teammate.
   * This is how teammates "receive" messages — as user messages
   * with a TeamMessagePart that the prompt loop will process.
   */
  async function injectMessage(
    sessionID: string,
    fromName: string,
    text: string,
    inboxMessageId?: string,
  ): Promise<void> {
    // Get the session to find the current agent and model
    // Don't limit — we need to find the last user message which may not be the most recent
    const msgs = await Session.messages({ sessionID })
    const lastUser = msgs.findLast((m) => m.info.role === "user")
    if (!lastUser) {
      throw new Error(`No user message found in session ${sessionID}`)
    }
    const userInfo = lastUser.info as { agent: string; model: { providerID: string; modelID: string } }

    const msgId = Identifier.ascending("message")
    await Session.updateMessage({
      id: msgId,
      sessionID,
      role: "user",
      agent: userInfo.agent,
      model: userInfo.model,
      time: { created: Date.now() },
    })

    await Session.updatePart({
      id: Identifier.ascending("part"),
      messageID: msgId,
      sessionID,
      type: "text",
      text: `[Team message from ${fromName}]: ${text}`,
      synthetic: true,
      ...(inboxMessageId ? { metadata: { inboxMessageId } } : {}),
    })
  }
}
