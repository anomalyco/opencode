import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"
import { Identifier } from "@/id/id"
import { Instance } from "@/project/instance"
import { Log } from "@/util/log"
import z from "zod"

export namespace ReproductionSteps {
  const log = Log.create({ service: "reproduction.steps" })

  export const Action = z.enum(["proceed", "fixed", "skipped"]).meta({
    ref: "ReproductionStepsAction",
  })
  export type Action = z.infer<typeof Action>

  export const Request = z
    .object({
      id: Identifier.schema("reproduction_steps"),
      sessionID: Identifier.schema("session"),
      steps: z.array(z.string()).min(1).describe("Numbered reproduction steps"),
      tool: z
        .object({
          messageID: z.string(),
          callID: z.string(),
        })
        .optional(),
    })
    .meta({
      ref: "ReproductionStepsRequest",
    })
  export type Request = z.infer<typeof Request>

  export const Reply = z
    .object({
      action: Action.describe("Selected action"),
    })
    .meta({
      ref: "ReproductionStepsReply",
    })
  export type Reply = z.infer<typeof Reply>

  export const Event = {
    Asked: BusEvent.define("reproduction.steps.asked", Request),
    Replied: BusEvent.define(
      "reproduction.steps.replied",
      z.object({
        sessionID: z.string(),
        requestID: z.string(),
        action: Action,
      }),
    ),
    Rejected: BusEvent.define(
      "reproduction.steps.rejected",
      z.object({
        sessionID: z.string(),
        requestID: z.string(),
      }),
    ),
  }

  const state = Instance.state(async () => {
    const pending: Record<
      string,
      {
        info: Request
        resolve: (action: Action) => void
        reject: (e: any) => void
      }
    > = {}

    return {
      pending,
    }
  })

  export async function ask(input: { sessionID: string; steps: string[]; tool?: Request["tool"] }): Promise<Action> {
    const s = await state()
    const id = Identifier.ascending("reproduction_steps")

    log.info("asking", { id, sessionID: input.sessionID, steps: input.steps.length })

    return new Promise<Action>((resolve, reject) => {
      const info: Request = {
        id,
        sessionID: input.sessionID,
        steps: input.steps,
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

  export async function reply(input: { requestID: string; action: Action }): Promise<void> {
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
    })

    existing.resolve(input.action)
  }

  export async function reject(requestID: string): Promise<void> {
    const s = await state()
    const existing = s.pending[requestID]
    if (!existing) {
      log.warn("reject for unknown request", { requestID })
      return
    }
    delete s.pending[requestID]

    log.info("rejected", { requestID })

    Bus.publish(Event.Rejected, {
      sessionID: existing.info.sessionID,
      requestID: existing.info.id,
    })

    existing.reject(new RejectedError())
  }

  export class RejectedError extends Error {
    constructor() {
      super("The user dismissed the reproduction steps")
    }
  }

  export async function list() {
    return state().then((x) => Object.values(x.pending).map((x) => x.info))
  }
}
