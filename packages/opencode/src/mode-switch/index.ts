import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"
import { Identifier } from "@/id/id"
import { Instance } from "@/project/instance"
import { Log } from "@/util/log"
import { Session } from "@/session"
import z from "zod"

export namespace ModeSwitch {
  const log = Log.create({ service: "mode-switch" })

  export const Request = z
    .object({
      id: Identifier.schema("modeswitch"),
      sessionID: Identifier.schema("session"),
      targetMode: z.string().describe("The mode to switch to"),
      reason: z.string().describe("Why the LLM wants to switch modes"),
      tool: z
        .object({
          messageID: z.string(),
          callID: z.string(),
        })
        .optional(),
    })
    .meta({
      ref: "ModeSwitchRequest",
    })
  export type Request = z.infer<typeof Request>

  export const Reply = z.enum(["approve", "reject"])
  export type Reply = z.infer<typeof Reply>

  export const Event = {
    Asked: BusEvent.define("modeswitch.asked", Request),
    Replied: BusEvent.define(
      "modeswitch.replied",
      z.object({
        sessionID: z.string(),
        requestID: z.string(),
        reply: Reply,
      }),
    ),
  }

  const state = Instance.state(async () => {
    const pending: Record<
      string,
      {
        info: Request
        resolve: (approved: boolean) => void
        reject: (e: any) => void
      }
    > = {}

    return {
      pending,
    }
  })

  export async function ask(input: {
    sessionID: string
    targetMode: string
    reason: string
    tool?: { messageID: string; callID: string }
  }): Promise<boolean> {
    const s = await state()
    const id = Identifier.ascending("modeswitch")

    log.info("asking", { id, targetMode: input.targetMode, reason: input.reason })

    return new Promise<boolean>((resolve, reject) => {
      const info: Request = {
        id,
        sessionID: input.sessionID,
        targetMode: input.targetMode,
        reason: input.reason,
        tool: input.tool,
      }
      s.pending[id] = {
        info,
        resolve,
        reject,
      }
      Bus.publish(Event.Asked, info)
    })
  }

  export async function reply(input: { requestID: string; reply: Reply }): Promise<void> {
    const s = await state()
    const existing = s.pending[input.requestID]
    if (!existing) {
      log.warn("reply for unknown request", { requestID: input.requestID })
      return
    }
    delete s.pending[input.requestID]

    log.info("replied", { requestID: input.requestID, reply: input.reply })

    if (input.reply === "approve") {
      const messages = await Session.messages({ sessionID: existing.info.sessionID })
      const lastUserMsg = messages.findLast((m) => m.info.role === "user")
      if (lastUserMsg?.info.role === "user") {
        await Session.updateMessage({
          ...lastUserMsg.info,
          agent: existing.info.targetMode,
        })
      }
    }

    Bus.publish(Event.Replied, {
      sessionID: existing.info.sessionID,
      requestID: existing.info.id,
      reply: input.reply,
    })

    existing.resolve(input.reply === "approve")
  }

  export class RejectedError extends Error {
    constructor() {
      super("The user rejected the mode switch request")
    }
  }

  export async function list() {
    return state().then((x) => Object.values(x.pending).map((x) => x.info))
  }
}
