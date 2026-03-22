import { Session } from "."
import { MessageV2 } from "./message-v2"
import { SessionID, MessageID, PartID } from "./schema"
import { Bus } from "../bus"
import { Log } from "../util/log"
import { BusEvent } from "@/bus/bus-event"
import z from "zod"

const log = Log.create({ service: "session.inject" })

export namespace SessionInject {
  export const Event = {
    MessageInjected: BusEvent.define(
      "session.message.injected",
      z.object({
        sessionID: SessionID.zod,
        from: z.string(),
        fromSessionID: SessionID.zod,
      }),
    ),
  }

  /**
   * Inject a message into a session from another agent/session.
   * This creates a synthetic user message that the prompt loop
   * picks up on its next iteration.
   *
   * For sessions that have already completed their loop, we publish
   * an injection event that the prompt loop can listen for to wake up.
   */
  export async function send(input: {
    sessionID: SessionID
    from: string
    fromSessionID: SessionID
    content: string
    teamID?: string
  }) {
    const id = MessageID.ascending()
    log.info("injecting", {
      sessionID: input.sessionID,
      from: input.from,
    })

    // Resolve the target session's agent from its last user message
    const agent = await lastAgent(input.sessionID)

    // Create a synthetic user message tagged as injected
    const msg: MessageV2.User = {
      id,
      sessionID: input.sessionID,
      role: "user",
      time: { created: Date.now() },
      agent,
      model: await lastModel(input.sessionID),
      system: undefined,
      injected: {
        from: input.from,
        fromSessionID: input.fromSessionID,
        teamID: input.teamID,
      },
    }

    await Session.updateMessage(msg)
    await Session.updatePart({
      id: PartID.ascending(),
      messageID: id,
      sessionID: input.sessionID,
      type: "text",
      text: `[Message from @${input.from}]\n\n${input.content}`,
      synthetic: true,
    } satisfies MessageV2.TextPart)

    Bus.publish(Event.MessageInjected, {
      sessionID: input.sessionID,
      from: input.from,
      fromSessionID: input.fromSessionID,
    })

    log.info("injected", {
      sessionID: input.sessionID,
      messageID: id,
    })
  }

  async function lastModel(sessionID: SessionID) {
    for await (const item of MessageV2.stream(sessionID)) {
      if (item.info.role === "user" && item.info.model) return item.info.model
    }
    // Fallback: use a placeholder that will be resolved by the prompt loop
    const { Provider } = await import("../provider/provider")
    return Provider.defaultModel()
  }

  async function lastAgent(sessionID: SessionID): Promise<string> {
    for await (const item of MessageV2.stream(sessionID)) {
      if (item.info.role === "user" && item.info.agent) return item.info.agent
    }
    return "build"
  }
}
