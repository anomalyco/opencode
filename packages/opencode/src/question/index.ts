import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"
import { SessionID, MessageID } from "@/session/schema"
import { Instance } from "@/project/instance"
import { Log } from "@/util/log"
import z from "zod"
import { QuestionID } from "./schema"

export namespace Question {
  const log = Log.create({ service: "question" })

  export const Option = z
    .object({
      label: z.string().describe("Display text (1-5 words, concise)"),
      description: z.string().describe("Explanation of choice"),
    })
    .meta({
      ref: "QuestionOption",
    })
  export type Option = z.infer<typeof Option>

  export const Info = z
    .object({
      question: z.string().describe("Complete question"),
      header: z.string().describe("Very short label (max 30 chars)"),
      options: z.array(Option).describe("Available choices"),
      multiple: z.boolean().optional().describe("Allow selecting multiple choices"),
      custom: z.boolean().optional().describe("Allow typing a custom answer (default: true)"),
    })
    .meta({
      ref: "QuestionInfo",
    })
  export type Info = z.infer<typeof Info>

  export const Request = z
    .object({
      id: QuestionID.zod,
      sessionID: SessionID.zod,
      questions: z.array(Info).describe("Questions to ask"),
      tool: z
        .object({
          messageID: MessageID.zod,
          callID: z.string(),
        })
        .optional(),
    })
    .meta({
      ref: "QuestionRequest",
    })
  export type Request = z.infer<typeof Request>

  export const Answer = z.array(z.string()).meta({
    ref: "QuestionAnswer",
  })
  export type Answer = z.infer<typeof Answer>

  export const Reply = z.object({
    answers: z
      .array(Answer)
      .describe("User answers in order of questions (each answer is an array of selected labels)"),
  })
  export type Reply = z.infer<typeof Reply>

  export const Event = {
    Asked: BusEvent.define("question.asked", Request),
    Replied: BusEvent.define(
      "question.replied",
      z.object({
        sessionID: SessionID.zod,
        requestID: QuestionID.zod,
        answers: z.array(Answer),
      }),
    ),
    Rejected: BusEvent.define(
      "question.rejected",
      z.object({
        sessionID: SessionID.zod,
        requestID: QuestionID.zod,
      }),
    ),
  }

  interface PendingEntry {
    info: Request
    resolve: (answers: Answer[]) => void
    reject: (e: any) => void
  }

  const state = Instance.state(async () => ({
    pending: new Map<QuestionID, PendingEntry>(),
  }))

  export async function ask(input: {
    sessionID: SessionID
    questions: Info[]
    tool?: { messageID: MessageID; callID: string }
  }): Promise<Answer[]> {
    const s = await state()
    const id = QuestionID.ascending()

    log.info("asking", { id, questions: input.questions.length })

    return new Promise<Answer[]>((resolve, reject) => {
      const info: Request = {
        id,
        sessionID: input.sessionID,
        questions: input.questions,
        tool: input.tool,
      }
      s.pending.set(id, {
        info,
        resolve,
        reject,
      })
      Bus.publish(Event.Asked, info)
    })
  }

  export async function reply(input: { requestID: QuestionID; answers: Answer[] }): Promise<void> {
    const s = await state()
    const existing = s.pending.get(input.requestID)
    if (!existing) {
      log.warn("reply for unknown request", { requestID: input.requestID })
      return
    }
    s.pending.delete(input.requestID)

    log.info("replied", { requestID: input.requestID, answers: input.answers })

    Bus.publish(Event.Replied, {
      sessionID: existing.info.sessionID,
      requestID: existing.info.id,
      answers: input.answers,
    })

    existing.resolve(input.answers)
  }

  export async function reject(requestID: QuestionID): Promise<void> {
    const s = await state()
    const existing = s.pending.get(requestID)
    if (!existing) {
      log.warn("reject for unknown request", { requestID })
      return
    }
    s.pending.delete(requestID)

    log.info("rejected", { requestID })

    Bus.publish(Event.Rejected, {
      sessionID: existing.info.sessionID,
      requestID: existing.info.id,
    })

    existing.reject(new RejectedError())
  }

  export class RejectedError extends Error {
    constructor() {
      super("The user dismissed this question")
    }
  }

  export async function list() {
    return state().then((x) => Array.from(x.pending.values(), (x) => x.info))
  }
}
