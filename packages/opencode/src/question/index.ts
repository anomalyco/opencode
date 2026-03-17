import { runPromiseInstance } from "@/effect/runtime"
import * as S from "./service"
import type { QuestionID } from "./schema"
import type { SessionID, MessageID } from "@/session/schema"

export namespace Question {
  export const Option = S.Option
  export type Option = S.Option
  export const Info = S.Info
  export type Info = S.Info
  export const Request = S.Request
  export type Request = S.Request
  export const Answer = S.Answer
  export type Answer = S.Answer
  export const Reply = S.Reply
  export type Reply = S.Reply
  export const Event = S.Event
  export const RejectedError = S.RejectedError

  export async function ask(input: {
    sessionID: SessionID
    questions: Info[]
    tool?: { messageID: MessageID; callID: string }
  }): Promise<Answer[]> {
    return runPromiseInstance(S.QuestionService.use((service) => service.ask(input)))
  }

  export async function reply(input: { requestID: QuestionID; answers: Answer[] }): Promise<void> {
    return runPromiseInstance(S.QuestionService.use((service) => service.reply(input)))
  }

  export async function reject(requestID: QuestionID): Promise<void> {
    return runPromiseInstance(S.QuestionService.use((service) => service.reject(requestID)))
  }

  export async function list(): Promise<Request[]> {
    return runPromiseInstance(S.QuestionService.use((service) => service.list()))
  }
}
