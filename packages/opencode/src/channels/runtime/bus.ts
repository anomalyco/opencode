import { Context, Effect, Layer, Queue } from "effect"
import type { InboundMessage } from "../contracts/inbound"

// ---------------------------------------------------------------------------
// MessageBus — central inbound message channel
//
// Channels publish normalized InboundMessage instances.
// Consumers (agent loop, session router) take from the queue.
// ---------------------------------------------------------------------------

export interface Interface {
  /** Publish an inbound message to the bus */
  readonly publish: (message: InboundMessage) => Effect.Effect<void>
  /** Take the next inbound message (blocks until available) */
  readonly take: Effect.Effect<InboundMessage>
  /** Peek at the next message without consuming it */
  readonly peek: Effect.Effect<InboundMessage | null>
  /** Number of messages waiting */
  readonly size: Effect.Effect<number>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/MessageBus") {}

const BUS_CAPACITY = 64

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const queue = yield* Queue.sliding<InboundMessage>(BUS_CAPACITY)

    return Service.of({
      publish: (message) => Queue.offer(queue, message),
      take: Queue.take(queue),
      peek: Queue.peek(queue),
      size: Queue.size(queue),
    })
  }),
)

export const defaultLayer = layer

export * as MessageBus from "./bus"
