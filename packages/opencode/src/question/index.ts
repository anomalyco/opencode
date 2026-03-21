import { runPromiseInstance } from "@/effect/runtime"
import type { MessageID, SessionID } from "@/session/schema"
import type { QuestionID } from "./schema"
import * as Q from "./service"

const ask = async (input: {
  sessionID: SessionID
  questions: Question.Info[]
  tool?: { messageID: MessageID; callID: string }
}): Promise<Question.Answer[]> => {
  return runPromiseInstance(Q.Question.Service.use((s) => s.ask(input)))
}

const reply = async (input: { requestID: QuestionID; answers: Question.Answer[] }) => {
  return runPromiseInstance(Q.Question.Service.use((s) => s.reply(input)))
}

const reject = async (requestID: QuestionID) => {
  return runPromiseInstance(Q.Question.Service.use((s) => s.reject(requestID)))
}

const list = async () => {
  return runPromiseInstance(Q.Question.Service.use((s) => s.list()))
}

export const Question = {
  Option: Q.Question.Option,
  Info: Q.Question.Info,
  Request: Q.Question.Request,
  Answer: Q.Question.Answer,
  Reply: Q.Question.Reply,
  Event: Q.Question.Event,
  RejectedError: Q.Question.RejectedError,
  Service: Q.Question.Service,
  layer: Q.Question.layer,
  ask,
  reply,
  reject,
  list,
}

export namespace Question {
  export type Option = Q.Question.Option
  export type Info = Q.Question.Info
  export type Request = Q.Question.Request
  export type Answer = Q.Question.Answer
  export type Reply = Q.Question.Reply
  export type Interface = Q.Question.Interface
}
