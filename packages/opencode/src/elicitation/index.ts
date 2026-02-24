import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"
import { Identifier } from "@/id/id"
import { Instance } from "@/project/instance"
import { Log } from "@/util/log"
import z from "zod"

export namespace Elicitation {
  const log = Log.create({ service: "elicitation" })

  export const Request = z
    .object({
      id: Identifier.schema("elicitation"),
      sessionID: Identifier.schema("session"),
      mode: z.enum(["form", "url"]),
      message: z.string(),
      requestedSchema: z.record(z.string(), z.any()).optional(),
      url: z.string().optional(),
      elicitationId: z.string().optional(),
      tool: z
        .object({
          messageID: z.string(),
          callID: z.string(),
        })
        .optional(),
    })
    .meta({
      ref: "ElicitationRequest",
    })
  export type Request = z.infer<typeof Request>

  export const Reply = z
    .object({
      action: z.enum(["accept", "decline", "cancel"]),
      content: z.record(z.string(), z.unknown()).optional(),
    })
    .meta({
      ref: "ElicitationReply",
    })
  export type Reply = z.infer<typeof Reply>

  export const Event = {
    Asked: BusEvent.define("elicitation.asked", Request),
    Replied: BusEvent.define(
      "elicitation.replied",
      z.object({
        sessionID: z.string(),
        requestID: z.string(),
        action: z.enum(["accept", "decline", "cancel"]),
        content: z.record(z.string(), z.unknown()).optional(),
      }),
    ),
  }

  const state = Instance.state(async () => {
    const pending: Record<
      string,
      {
        info: Request
        resolve: (reply: Reply) => void
        reject: (e: any) => void
      }
    > = {}

    return {
      pending,
    }
  })

  export async function ask(input: {
    sessionID: string
    mode: "form" | "url"
    message: string
    requestedSchema?: Record<string, any>
    url?: string
    elicitationId?: string
    tool?: { messageID: string; callID: string }
  }): Promise<Reply> {
    const s = await state()
    const id = Identifier.ascending("elicitation")

    log.info("asking", { id, mode: input.mode })

    return new Promise<Reply>((resolve, reject) => {
      const info: Request = {
        id,
        sessionID: input.sessionID,
        mode: input.mode,
        message: input.message,
        requestedSchema: input.requestedSchema,
        url: input.url,
        elicitationId: input.elicitationId,
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

  export async function reply(input: { requestID: string; action: Reply["action"]; content?: Record<string, unknown> }): Promise<void> {
    const s = await state()
    const existing = s.pending[input.requestID]
    if (!existing) {
      log.warn("reply for unknown request", { requestID: input.requestID })
      return
    }
    delete s.pending[input.requestID]

    log.info("replied", { requestID: input.requestID, action: input.action })

    Bus.publish(Event.Replied, {
      sessionID: existing.info.sessionID,
      requestID: existing.info.id,
      action: input.action,
      content: input.content,
    })

    if (input.action === "cancel") {
      existing.reject(new CancelledError())
      return
    }

    if (input.action === "decline") {
      existing.reject(new DeclinedError())
      return
    }

    existing.resolve({ action: input.action, content: input.content })
  }

  export async function reject(requestID: string): Promise<void> {
    return reply({ requestID, action: "cancel" })
  }

  export class CancelledError extends Error {
    constructor() {
      super("The user cancelled this elicitation")
    }
  }

  export class DeclinedError extends Error {
    constructor() {
      super("The user declined this elicitation")
    }
  }

  export async function list() {
    return state().then((x) => Object.values(x.pending).map((x) => x.info))
  }
}
