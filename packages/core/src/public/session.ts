export * as Session from "./session"

import { Effect, Stream } from "effect"
import { SessionV2 } from "../session"
import { MessageDecodeError } from "../session/error"
import { SessionEvent } from "../session/event"
import { SessionInput } from "../session/input"
import { SessionMessage } from "../session/message"
import { Prompt } from "../session/prompt"
import { Agent } from "./agent"
import { Location } from "./location"
import { Model } from "./model"

export const ID = SessionV2.ID
export type ID = SessionV2.ID

export const Info = SessionV2.Info
export type Info = SessionV2.Info

export const MessageID = SessionMessage.ID
export type MessageID = SessionMessage.ID

export const Message = SessionMessage.Message
export type Message = SessionMessage.Message

export const Admission = SessionInput.Admitted
export type Admission = SessionInput.Admitted

export const Delivery = SessionInput.Delivery
export type Delivery = SessionInput.Delivery

export const ListInput = SessionV2.ListInput
export type ListInput = SessionV2.ListInput

export type Event = SessionEvent.DurableEvent

export const NotFoundError = SessionV2.NotFoundError
export type NotFoundError = SessionV2.NotFoundError

export const PromptConflictError = SessionV2.PromptConflictError
export type PromptConflictError = SessionV2.PromptConflictError

export { MessageDecodeError }

export interface CreateInput {
  readonly id?: ID
  readonly agent?: Agent.ID
  readonly model?: Model.Ref
  readonly location: Location.Ref
}

export interface PromptInput {
  readonly id?: MessageID
  readonly sessionID: ID
  readonly prompt: Prompt
  readonly delivery?: Delivery
}

export interface SwitchModelInput {
  readonly sessionID: ID
  readonly model: Model.Ref
}

export interface MessagesInput {
  readonly sessionID: ID
  readonly limit?: number
  readonly order?: "asc" | "desc"
  readonly cursor?: {
    readonly id: MessageID
    readonly direction: "previous" | "next"
  }
}

export interface MessageInput {
  readonly sessionID: ID
  readonly messageID: MessageID
}

export interface EventsInput {
  readonly sessionID: ID
  readonly after?: number
}

export interface Interface {
  readonly create: (input: CreateInput) => Effect.Effect<Info>
  readonly get: (sessionID: ID) => Effect.Effect<Info, NotFoundError>
  readonly list: (input?: ListInput) => Effect.Effect<Info[]>
  readonly prompt: (input: PromptInput) => Effect.Effect<Admission, NotFoundError | PromptConflictError>
  readonly switchModel: (input: SwitchModelInput) => Effect.Effect<void, NotFoundError>
  /** Interrupt the active V2 execution chain for one Session on this process. Interrupting an idle or missing Session is a no-op. */
  readonly interrupt: (sessionID: ID) => Effect.Effect<void>
  readonly messages: (input: MessagesInput) => Effect.Effect<Message[], NotFoundError | MessageDecodeError>
  readonly message: (input: MessageInput) => Effect.Effect<Message | undefined>
  readonly context: (sessionID: ID) => Effect.Effect<Message[], NotFoundError | MessageDecodeError>
  readonly events: (input: EventsInput) => Stream.Stream<Event, NotFoundError>
}
