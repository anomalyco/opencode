import { Log } from "../util/log"
import { Bus } from "../bus"
import { Session } from "../session"
import { SessionPrompt } from "../session/prompt"
import { SessionStatus } from "../session/status"
import { Identifier } from "../id/id"
import { Team, TeamEvent } from "./index"

const log = Log.create({ service: "team.messaging" })
const MAX_TEXT = 10 * 1024

function validateText(text: string) {
  if (text.length <= MAX_TEXT) return
  throw new Error(`Team message too large (${text.length} chars). Maximum is ${MAX_TEXT} chars.`)
}

export namespace TeamMessaging {
  /**
   * Send a message from one team member to another.
   * Injects a synthetic user message into the recipient's session
   * so the LLM sees it and responds.
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

    // Inject a synthetic user message into the recipient's session
    await injectMessage(targetSessionID, input.from, input.text)

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

    for (const target of targets) {
      await injectMessage(target.sessionID, input.from, input.text).catch((err) => {
        log.warn("broadcast inject failed", { target: target.name, error: err.message })
      })
    }

    log.info("broadcast sent", { teamName: input.teamName, from: input.from, targets: targets.length })
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
   * Auto-wake an idle session after a team message is injected.
   * If the session is idle (no active prompt loop), starts a new loop
   * so the LLM picks up and processes the injected message.
   */
  function autoWake(sessionID: string, from: string) {
    const status = SessionStatus.get(sessionID)
    if (status.type !== "idle") return
    log.info("auto-waking idle session", { sessionID, from })
    SessionPrompt.loop({ sessionID }).catch((err: unknown) => {
      log.warn("auto-wake failed", { sessionID, error: err instanceof Error ? err.message : String(err) })
    })
  }

  /**
   * Inject a synthetic user message into a session from a teammate.
   * This is how teammates "receive" messages — as user messages
   * with a TeamMessagePart that the prompt loop will process.
   */
  async function injectMessage(sessionID: string, fromName: string, text: string): Promise<void> {
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
    })
  }
}
