import { Effect, Queue } from "effect"

/**
 * Pending driver-answered LLM exchanges.
 *
 * When the simulated network receives a provider request it opens an
 * exchange: the parsed request body plus a queue of response chunks. The
 * simulation control WebSocket notifies the external driver, and the driver
 * pushes chunks back until it finishes the exchange. The driver is the
 * model; nothing is scripted or enqueued server-side.
 *
 * Process-global by design (plain module state, like the network route
 * table): the simulated network and the control server must observe the same
 * exchanges regardless of which layer instance touched them.
 */

/** One response item the driver sends back. Compiled to provider wire chunks by the endpoint. */
export type Item =
  | { readonly type: "textDelta"; readonly text: string }
  | { readonly type: "reasoningDelta"; readonly text: string }
  | {
      readonly type: "toolCall"
      readonly index: number
      readonly id: string
      readonly name: string
      readonly input: unknown
    }
  | { readonly type: "raw"; readonly chunk: unknown }

export type FinishReason = "stop" | "tool-calls" | "length" | "content-filter"

export type Chunk =
  | { readonly type: "item"; readonly item: Item }
  | { readonly type: "finish"; readonly reason: FinishReason }

export interface Exchange {
  readonly id: string
  readonly url: string
  readonly body: unknown
  readonly queue: Queue.Queue<Chunk>
}

export interface OpenedExchange {
  readonly id: string
  readonly url: string
  readonly body: unknown
}

const state = {
  counter: 0,
  exchanges: new Map<string, Exchange>(),
  listeners: new Set<(exchange: OpenedExchange) => void>(),
}

export class ExchangeNotFoundError extends Error {
  constructor(id: string) {
    super(`Simulation LLM exchange not found or already finished: ${id}`)
  }
}

/** Opens an exchange and notifies listeners. Called by the simulated provider endpoint. */
export const open = (input: { readonly url: string; readonly body: unknown }) =>
  Effect.gen(function* () {
    const id = `ex_${++state.counter}`
    const queue = yield* Queue.unbounded<Chunk>()
    const exchange: Exchange = { id, url: input.url, body: input.body, queue }
    state.exchanges.set(id, exchange)
    for (const listener of state.listeners) listener({ id, url: input.url, body: input.body })
    return exchange
  })

/** Closes an exchange without consuming remaining chunks (response interrupted or finished). */
export const close = (id: string) =>
  Effect.suspend(() => {
    const exchange = state.exchanges.get(id)
    state.exchanges.delete(id)
    if (!exchange) return Effect.void
    return Queue.shutdown(exchange.queue).pipe(Effect.asVoid)
  })

/** Appends response chunks to an open exchange. Driver-facing. */
export const push = (id: string, chunks: readonly Chunk[]) =>
  Effect.gen(function* () {
    const exchange = state.exchanges.get(id)
    if (!exchange) return yield* Effect.fail(new ExchangeNotFoundError(id))
    yield* Queue.offerAll(exchange.queue, chunks)
  })

/** Abruptly ends the provider body without a finish chunk or SSE sentinel. */
export const disconnect = (id: string) =>
  Effect.gen(function* () {
    const exchange = state.exchanges.get(id)
    if (!exchange) return yield* Effect.fail(new ExchangeNotFoundError(id))
    yield* Queue.shutdown(exchange.queue)
  })

/**
 * Registers a listener for newly opened exchanges and immediately replays
 * currently-pending ones, so a late-attaching driver observes requests that
 * arrived before it connected. Returns an unsubscribe function.
 */
export function subscribe(listener: (exchange: OpenedExchange) => void) {
  state.listeners.add(listener)
  for (const exchange of pending()) listener(exchange)
  return () => {
    state.listeners.delete(listener)
  }
}

/** Snapshot of currently open exchanges, for control-surface inspection. */
export function pending(): OpenedExchange[] {
  return [...state.exchanges.values()].map((exchange) => ({
    id: exchange.id,
    url: exchange.url,
    body: exchange.body,
  }))
}

export * as SimulationLLMExchange from "./llm-exchange"
