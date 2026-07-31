import { splitMessage } from "./sentence"
import type { GatewayEvent, GatewayEventInput, GatewayStore, GatewayTask, NewGatewayTask } from "./store"

type TraceTask = Pick<GatewayTask | NewGatewayTask, "conversationID" | "turnID" | "traceID">

type EventDetails = {
  eventType: string
  actor: GatewayEventInput["actor"]
  status: string
  content: unknown
  messageID?: string
  sentenceID?: string
  sentenceIndex?: number
  parentEventID?: string
  relatedEventID?: string
  durationMs?: number
}

type MessageDetails = {
  eventType: string
  actor: GatewayEventInput["actor"]
  status: string
  messageID: string
  text: string
  content?: Record<string, unknown>
  parentEventID?: string
  relatedEventID?: string
  durationMs?: number
}

export function createEventLog(input: {
  store: GatewayStore
  now?: () => number
  makeEventID?: () => string
}) {
  const now = input.now ?? Date.now
  const makeEventID = input.makeEventID ?? (() => `evt_${crypto.randomUUID()}`)
  const event = (task: TraceTask, details: EventDetails): GatewayEventInput => ({
    eventID: makeEventID(),
    eventType: details.eventType,
    occurredAt: now(),
    conversationID: task.conversationID,
    turnID: task.turnID,
    traceID: task.traceID,
    ...(details.messageID ? { messageID: details.messageID } : {}),
    ...(details.sentenceID ? { sentenceID: details.sentenceID } : {}),
    ...(details.sentenceIndex === undefined ? {} : { sentenceIndex: details.sentenceIndex }),
    ...(details.parentEventID ? { parentEventID: details.parentEventID } : {}),
    ...(details.relatedEventID ? { relatedEventID: details.relatedEventID } : {}),
    actor: details.actor,
    version: 1,
    status: details.status,
    ...(details.durationMs === undefined ? {} : { durationMs: details.durationMs }),
    content: details.content,
  })

  return {
    event,
    async message(task: TraceTask, details: MessageDetails) {
      const complete = event(task, {
        eventType: details.eventType,
        actor: details.actor,
        status: details.status,
        messageID: details.messageID,
        ...(details.parentEventID ? { parentEventID: details.parentEventID } : {}),
        ...(details.relatedEventID ? { relatedEventID: details.relatedEventID } : {}),
        ...(details.durationMs === undefined ? {} : { durationMs: details.durationMs }),
        content: { ...details.content, text: details.text },
      })
      const sentences = await splitMessage(details.messageID, details.text)
      return [
        complete,
        ...sentences.map((sentence) =>
          event(task, {
            eventType: `${details.eventType}_sentence`,
            actor: details.actor,
            status: details.status,
            messageID: details.messageID,
            sentenceID: sentence.id,
            sentenceIndex: sentence.index,
            parentEventID: complete.eventID,
            content: { text: sentence.text },
          }),
        ),
      ]
    },
    append(task: TraceTask, details: EventDetails): GatewayEvent {
      return input.store.appendEvent(event(task, details))
    },
  }
}
