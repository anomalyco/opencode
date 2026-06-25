import { Deferred, Effect, Layer, Schema, Context } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { EventV2Bridge } from "@/event-v2-bridge"
import { InstanceState } from "@/effect/instance-state"
import { McpEvent } from "@opencode-ai/schema/mcp-event"

export const ID = McpEvent.ElicitationID
export type ID = typeof ID.Type
export const BooleanProperty = McpEvent.ElicitationBooleanProperty
export type BooleanProperty = typeof BooleanProperty.Type
export const BooleanSchema = McpEvent.ElicitationBooleanSchema
export type BooleanSchema = typeof BooleanSchema.Type
export const Content = McpEvent.ElicitationContent
export type Content = typeof Content.Type
export const Request = McpEvent.ElicitationRequest
export type Request = typeof Request.Type
export const Result = McpEvent.ElicitationResult
export type Result = typeof Result.Type
export const Event = {
  Asked: McpEvent.ElicitationAsked,
  Replied: McpEvent.ElicitationReplied,
}

export class NotFoundError extends Schema.TaggedErrorClass<NotFoundError>()("McpElicitation.NotFoundError", {
  requestID: ID,
}) {}

interface PendingEntry {
  info: Request
  deferred: Deferred.Deferred<Result>
}

interface State {
  pending: Map<ID, PendingEntry>
}

export interface Interface {
  readonly ask: (input: { server: string; message: string; schema: BooleanSchema }) => Effect.Effect<Result>
  readonly reply: (input: { requestID: ID; content: Content }) => Effect.Effect<void, NotFoundError>
  readonly decline: (requestID: ID) => Effect.Effect<void, NotFoundError>
  readonly cancel: (requestID: ID) => Effect.Effect<void, NotFoundError>
  readonly cancelServer: (server: string) => Effect.Effect<void>
  readonly list: () => Effect.Effect<ReadonlyArray<Request>>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/McpElicitation") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const events = yield* EventV2Bridge.Service

    const settle = Effect.fn("McpElicitation.settle")(function* (pending: State["pending"], id: ID, result: Result) {
      const existing = pending.get(id)
      if (!existing) return false
      pending.delete(id)
      yield* events.publish(Event.Replied, {
        requestID: id,
        result,
      })
      yield* Deferred.succeed(existing.deferred, result)
      return true
    })

    const cancelAll = Effect.fn("McpElicitation.cancelAll")(function* (pending: State["pending"], server?: string) {
      const requests = Array.from(pending.entries()).filter(([, item]) => !server || item.info.server === server)
      for (const [id] of requests) {
        yield* settle(pending, id, { action: "cancel" })
      }
    })

    const state = yield* InstanceState.make<State>(
      Effect.fn("McpElicitation.state")(function* () {
        const state = {
          pending: new Map<ID, PendingEntry>(),
        }

        yield* Effect.addFinalizer(() => cancelAll(state.pending))

        return state
      }),
    )

    const complete = Effect.fn("McpElicitation.complete")(function* (requestID: ID, result: Result) {
      const pending = (yield* InstanceState.get(state)).pending
      const settled = yield* settle(pending, requestID, result)
      if (!settled) {
        yield* Effect.logWarning("MCP elicitation reply for unknown request", { requestID })
        return yield* new NotFoundError({ requestID })
      }
    })

    const ask = Effect.fn("McpElicitation.ask")(function* (input: {
      server: string
      message: string
      schema: BooleanSchema
    }) {
      const pending = (yield* InstanceState.get(state)).pending
      const id = ID.ascending()
      const deferred = yield* Deferred.make<Result>()
      const info: Request = {
        id,
        server: input.server,
        message: input.message,
        schema: input.schema,
      }
      pending.set(id, { info, deferred })
      yield* events.publish(Event.Asked, info)

      return yield* Effect.ensuring(Deferred.await(deferred), settle(pending, id, { action: "cancel" }))
    })

    const reply = Effect.fn("McpElicitation.reply")(function* (input: { requestID: ID; content: Content }) {
      yield* complete(input.requestID, {
        action: "accept",
        content: input.content,
      })
    })

    const decline = Effect.fn("McpElicitation.decline")(function* (requestID: ID) {
      yield* complete(requestID, { action: "decline" })
    })

    const cancel = Effect.fn("McpElicitation.cancel")(function* (requestID: ID) {
      yield* complete(requestID, { action: "cancel" })
    })

    const cancelServer = Effect.fn("McpElicitation.cancelServer")(function* (server: string) {
      const pending = (yield* InstanceState.get(state)).pending
      yield* cancelAll(pending, server)
    })

    const list = Effect.fn("McpElicitation.list")(function* () {
      const pending = (yield* InstanceState.get(state)).pending
      return Array.from(pending.values(), (x) => x.info)
    })

    return Service.of({ ask, reply, decline, cancel, cancelServer, list })
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(EventV2Bridge.defaultLayer))

export const node = LayerNode.make({ service: Service, layer: layer, deps: [EventV2Bridge.node] })

export * as McpElicitation from "./elicitation"
