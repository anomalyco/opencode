export * as SessionAttention from "./attention.js"

import { SessionAttention } from "@opencode/schema/session-attention"
import { SessionID } from "@opencode/schema/session-id"
import { SessionMessage } from "@opencode/schema/session-message"
import { makeLocationNode } from "@opencode/util/effect/app-node"
import { Context, Effect, Layer, Option, Schema, Stream } from "effect"
import { Bus } from "../bus.js"
import { Form } from "../form.js"
import { Permission } from "../permission.js"
import { SessionEvent } from "./event.js"
import { SessionSchema } from "./schema.js"

export const Entry = SessionAttention.Entry
export type Entry = SessionAttention.Entry
export type PluginInput = SessionAttention.PluginInput
export type PluginEntry = SessionAttention.PluginEntry
export { Event } from "@opencode/schema/session-attention"

export interface SetPluginInput {
  readonly sessionID: SessionSchema.ID
  readonly messageID: SessionMessage.ID
  readonly attention: ReadonlyArray<PluginInput>
}

export interface Interface {
  /**
   * Attention for every Session in this Location: pending permissions, then pending forms, then plugin attention.
   * Built-in entries are read from the live Permission and Form owners, never stored here.
   */
  readonly list: () => Effect.Effect<ReadonlyArray<Entry>>
  /** Replaces only the Session's plugin attention; built-in entries are unaffected. */
  readonly setPlugin: (input: SetPluginInput) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SessionAttention") {}

const isSessionID = Schema.is(SessionID)
const isMessageID = Schema.is(SessionMessage.ID)
// Tool-created forms, such as the question tool's, record the asking tool call in their metadata.
const decodeToolForm = Schema.decodeUnknownOption(
  Schema.Struct({ tool: Schema.Struct({ messageID: SessionMessage.ID }) }),
)

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const bus = yield* Bus.Service
    const permission = yield* Permission.Service
    const forms = yield* Form.Service
    const plugin = new Map<SessionSchema.ID, ReadonlyArray<PluginEntry>>()

    yield* bus.subscribe([SessionEvent.Deleted, SessionEvent.Moved]).pipe(
      Stream.runForEach((event) => Effect.sync(() => plugin.delete(event.data.sessionID))),
      Effect.forkScoped({ startImmediately: true }),
    )

    const list = Effect.fn("SessionAttention.list")(function* () {
      const permissions = (yield* permission.list()).map(
        (request): Entry => ({
          type: "permission",
          sessionID: request.sessionID,
          requestID: request.id,
          ...(request.source && isMessageID(request.source.messageID) ? { messageID: request.source.messageID } : {}),
        }),
      )
      // Forms not owned by a Session, such as unattributed MCP elicitations, are not Session attention.
      const questions = (yield* forms.list()).flatMap((form): Entry[] => {
        if (!isSessionID(form.sessionID)) return []
        const tool = decodeToolForm(form.metadata)
        return [
          {
            type: "question",
            sessionID: form.sessionID,
            requestID: form.id,
            ...(Option.isSome(tool) ? { messageID: tool.value.tool.messageID } : {}),
          },
        ]
      })
      return [...permissions, ...questions, ...Array.from(plugin.values()).flat()]
    })

    const setPlugin = Effect.fn("SessionAttention.setPlugin")(function* (input: SetPluginInput) {
      const previous = plugin.get(input.sessionID) ?? []
      const next = input.attention.map(
        (item): PluginEntry => ({
          type: "plugin",
          sessionID: input.sessionID,
          messageID: input.messageID,
          reason: item.reason,
        }),
      )
      if (previous.length === 0 && next.length === 0) return
      if (next.length === 0) plugin.delete(input.sessionID)
      else plugin.set(input.sessionID, next)
      yield* bus.publish(SessionAttention.Event.Updated, { sessionID: input.sessionID, attention: next })
    })

    return Service.of({ list, setPlugin })
  }),
)

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [Bus.node, Permission.node, Form.node],
})
