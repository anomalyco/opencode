import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import z from "zod"
import { Log } from "../util/log"
import { Identifier } from "../id/id"
import { Instance } from "../project/instance"

export namespace Question {
  const log = Log.create({ service: "question" })

  export const Option = z.object({
    value: z.string(),
    label: z.string(),
    recommended: z.boolean().optional(),
  })
  export type Option = z.infer<typeof Option>

  export const QuestionItem = z.object({
    id: z.string(),
    type: z.enum(["select", "multi-select", "confirm", "text"]),
    question: z.string(),
    options: z.array(Option).optional(),
    default: z.union([z.string(), z.array(z.string()), z.boolean()]).optional(),
  })
  export type QuestionItem = z.infer<typeof QuestionItem>

  export const Answer = z.object({
    value: z.union([z.string(), z.array(z.string()), z.boolean(), z.null()]),
    comment: z.string().optional(),
  })
  export type Answer = z.infer<typeof Answer>

  export const Answers = z.record(z.string(), Answer)
  export type Answers = z.infer<typeof Answers>

  export const Info = z
    .object({
      id: z.string(),
      sessionID: z.string(),
      messageID: z.string(),
      callID: z.string().optional(),
      questions: z.array(QuestionItem),
      time: z.object({
        created: z.number(),
      }),
    })
    .meta({
      ref: "Question",
    })
  export type Info = z.infer<typeof Info>

  export const Event = {
    Updated: BusEvent.define("question.updated", Info),
    Replied: BusEvent.define(
      "question.replied",
      z.object({
        sessionID: z.string(),
        questionID: z.string(),
        answers: Answers,
      }),
    ),
  }

  interface PendingQuestion {
    info: Info
    resolve: (answers: Answers) => void
    reject: (e: Error) => void
  }

  const state = Instance.state(
    () => {
      const pending: {
        [sessionID: string]: {
          [questionID: string]: PendingQuestion
        }
      } = {}

      return { pending }
    },
    async (state) => {
      for (const pending of Object.values(state.pending)) {
        for (const item of Object.values(pending)) {
          item.reject(new RejectedError(item.info.sessionID, item.info.id, item.info.callID))
        }
      }
    },
  )

  export function pending() {
    return state().pending
  }

  export async function ask(input: {
    sessionID: Info["sessionID"]
    messageID: Info["messageID"]
    callID?: Info["callID"]
    questions: Info["questions"]
  }): Promise<Answers> {
    const { pending } = state()
    log.info("asking", {
      sessionID: input.sessionID,
      messageID: input.messageID,
      callID: input.callID,
      questionCount: input.questions.length,
    })

    const info: Info = {
      id: Identifier.ascending("question"),
      sessionID: input.sessionID,
      messageID: input.messageID,
      callID: input.callID,
      questions: input.questions,
      time: {
        created: Date.now(),
      },
    }

    pending[input.sessionID] = pending[input.sessionID] || {}
    return new Promise<Answers>((resolve, reject) => {
      pending[input.sessionID][info.id] = {
        info,
        resolve,
        reject,
      }
      Bus.publish(Event.Updated, info)
    })
  }

  export function respond(input: { sessionID: Info["sessionID"]; questionID: Info["id"]; answers: Answers }) {
    log.info("response", input)
    const { pending } = state()
    const match = pending[input.sessionID]?.[input.questionID]
    if (!match) return
    delete pending[input.sessionID][input.questionID]
    Bus.publish(Event.Replied, {
      sessionID: input.sessionID,
      questionID: input.questionID,
      answers: input.answers,
    })
    match.resolve(input.answers)
  }

  export function reject(input: { sessionID: Info["sessionID"]; questionID: Info["id"] }) {
    log.info("reject", input)
    const { pending } = state()
    const match = pending[input.sessionID]?.[input.questionID]
    if (!match) return
    delete pending[input.sessionID][input.questionID]
    Bus.publish(Event.Replied, {
      sessionID: input.sessionID,
      questionID: input.questionID,
      answers: {},
    })
    match.reject(new RejectedError(input.sessionID, input.questionID, match.info.callID))
  }

  export function rejectAll(sessionID: string) {
    const { pending } = state()
    const questions = pending[sessionID]
    if (!questions) return
    for (const questionID of Object.keys(questions)) {
      reject({ sessionID, questionID })
    }
  }

  export class RejectedError extends Error {
    constructor(
      public readonly sessionID: string,
      public readonly questionID: string,
      public readonly callID?: string,
    ) {
      super("The user cancelled the question. You may ask again if needed.")
    }
  }
}
