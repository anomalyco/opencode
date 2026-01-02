import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"
import { Identifier } from "@/id/id"
import { Instance } from "@/project/instance"
import { fn } from "@/util/fn"
import { Log } from "@/util/log"
import z from "zod"

export namespace AskUserNext {
  const log = Log.create({ service: "askuser" })

  export const Option = z
    .object({
      label: z.string(),
      description: z.string(),
    })
    .meta({
      ref: "AskUserOption",
    })
  export type Option = z.infer<typeof Option>

  export const Question = z
    .object({
      question: z.string(),
      header: z.string().max(12),
      options: z.array(Option).min(2).max(4),
      multiSelect: z.boolean(),
    })
    .meta({
      ref: "AskUserQuestion",
    })
  export type Question = z.infer<typeof Question>

  export const Request = z
    .object({
      id: z.string(),
      sessionID: z.string(),
      questions: z.array(Question).min(1).max(4),
      tool: z
        .object({
          messageID: z.string(),
          callID: z.string(),
        })
        .optional(),
    })
    .meta({
      ref: "AskUserRequest",
    })
  export type Request = z.infer<typeof Request>

  export const Answer = z
    .object({
      questionIndex: z.number(),
      selectedIndices: z.array(z.number()),
      otherText: z.string().optional(),
    })
    .meta({
      ref: "AskUserAnswer",
    })
  export type Answer = z.infer<typeof Answer>

  export const Reply = z
    .object({
      answers: z.array(Answer),
    })
    .meta({
      ref: "AskUserReply",
    })
  export type Reply = z.infer<typeof Reply>

  export const Event = {
    Asked: BusEvent.define("askuser.asked", Request),
    Replied: BusEvent.define(
      "askuser.replied",
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
        resolve: (reply: Reply) => void
        reject: (e: any) => void
      }
    > = {}

    return {
      pending,
    }
  })

  export const ask = fn(
    z.object({
      id: z.string().optional(),
      sessionID: z.string(),
      questions: z.array(Question).min(1).max(4),
      tool: z
        .object({
          messageID: z.string(),
          callID: z.string(),
        })
        .optional(),
    }),
    async (input) => {
      const s = await state()
      const id = input.id ?? Identifier.ascending("askuser")
      log.info("asking", { id, questionCount: input.questions.length })

      return new Promise<Reply>((resolve, reject) => {
        const info: Request = {
          id,
          sessionID: input.sessionID,
          questions: input.questions,
          tool: input.tool,
        }
        s.pending[id] = {
          info,
          resolve,
          reject,
        }
        Bus.publish(Event.Asked, info)
      })
    },
  )

  export const reply = fn(
    z.object({
      requestID: z.string(),
      reply: Reply,
    }),
    async (input) => {
      const s = await state()
      const existing = s.pending[input.requestID]
      if (!existing) {
        log.warn("reply for unknown request", { requestID: input.requestID })
        return
      }
      delete s.pending[input.requestID]
      log.info("replied", { requestID: input.requestID })
      Bus.publish(Event.Replied, {
        sessionID: existing.info.sessionID,
        requestID: existing.info.id,
        reply: input.reply,
      })
      existing.resolve(input.reply)
    },
  )

  export const cancel = fn(
    z.object({
      requestID: z.string(),
    }),
    async (input) => {
      const s = await state()
      const existing = s.pending[input.requestID]
      if (!existing) return
      delete s.pending[input.requestID]
      log.info("cancelled", { requestID: input.requestID })
      existing.reject(new CancelledError())
    },
  )

  export class CancelledError extends Error {
    constructor() {
      super("The user cancelled the question prompt.")
    }
  }

  export async function list() {
    return state().then((x) => Object.values(x.pending).map((x) => x.info))
  }
}
