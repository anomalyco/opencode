import { Effect, Layer, Context, Queue, Schedule, Stream, Fiber } from "effect"

export enum EventPriority {
  CRITICAL = 0,
  HIGH = 1,
  NORMAL = 2,
  LOW = 3,
  BACKGROUND = 4,
}

export const EventType = {
  TASK_START: "task_start",
  TOOL_CALL: "tool_call",
  TOOL_RESULT: "tool_result",
  STATE_TRANSITION: "state_transition",
  CHECKPOINT_CREATE: "checkpoint_create",
  USER_INPUT: "user_input",
  AGENT_OUTPUT: "agent_output",
  ARCHIVE_SUMMARY: "archive_summary",
  FILESYSTEM_COMMITTED: "filesystem_committed",
  FILESYSTEM_CONFLICT: "filesystem_conflict",
  REPAIR_SUCCESS: "repair_success",
  PLANNING_FAILED: "planning_failed",
  DAG_GENERATED: "dag_generated",
  VALIDATION_PASSED: "validation_passed",
  VALIDATION_FAILED: "validation_failed",
  DAG_NODE_FAILED: "dag_node_failed",
  ERROR_OCCURRED: "error_occurred",
  SESSION_PAUSED: "session_paused",
  ENTROPY_ALERT: "entropy_alert",
  METRICS_SAMPLE: "metrics_sample",
} as const

export type EventType = (typeof EventType)[keyof typeof EventType]

export interface BusEvent {
  type: EventType
  source: string
  session_id: string
  data: Record<string, unknown>
  priority: EventPriority
  timestamp: number
  require_persistence: boolean
  parent_event_id?: string
}

export interface PersistentEvent {
  event_id: string
  session_id: string
  parent_event_id: string | null
  event_type: EventType
  payload: string
  status: string
  token_cost: number
  duration_ms: number
  sequence_index: number
  timestamp: number
}

export type EventHandler = (event: BusEvent) => void

/** Single-event persist (legacy). Prefer EventBusPersistBatchFn for production use. */
export interface EventBusPersistFn {
  (event: BusEvent): void | Promise<void>
}

/** Batch persist — called with up to BATCH_SIZE events inside a single SQLite transaction. */
export interface EventBusPersistBatchFn {
  (events: PersistentEvent[]): void | Promise<void>
}

export interface EventBus {
  readonly publish: (event: BusEvent) => Promise<void>
  /** Enqueue with priority — CRITICAL/HIGH events flush immediately if persistence is required */
  readonly enqueuePriority: (event: BusEvent) => Promise<void>
  readonly subscribe: (eventType: EventType, handler: EventHandler) => void
  readonly unsubscribe: (eventType: EventType, handler: EventHandler) => void
  readonly waitForEvent: (
    eventType: EventType,
    timeoutMs: number,
    predicate?: (event: BusEvent) => boolean,
  ) => Promise<BusEvent | null>
  readonly shutdown: () => Promise<void>
}

export class EventBusService extends Context.Service<EventBusService, EventBus>()("@fengru/EventBus") {}

const BATCH_SIZE = 500
const FLUSH_INTERVAL_MS = 50
const QUEUE_MAX_SIZE = 10_000

function generateUUID(): string {
  return crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`
}

export interface EventBusLayerOptions {
  readonly persistBatch?: EventBusPersistBatchFn
  readonly persistFn?: EventBusPersistFn
}

export function createLayer(options: EventBusLayerOptions = {}) {
  return Layer.effect(
    EventBusService,
    Effect.gen(function* () {
    const handlers = new Map<EventType, Set<EventHandler>>()
    const sequenceCounters = new Map<string, number>()

    const eventQueue = yield* Queue.bounded<BusEvent>(QUEUE_MAX_SIZE)

    const flushQueue = Effect.fnUntraced(function* (pending: BusEvent[]) {
      if (pending.length === 0) return

      // Dispatch to in-memory subscribers
      for (const event of pending) {
        yield* Effect.sync(() => {
          const subs = handlers.get(event.type)
          if (subs) {
            for (const handler of subs) {
              try {
                handler(event)
              } catch (err) {
                // Handler errors must not propagate
              }
            }
          }
        })
      }

      // Persist events that require persistence via batch callback
      const persistable = pending.filter((e) => e.require_persistence)
      if (persistable.length > 0 && options.persistBatch) {
        const persistentEvents: PersistentEvent[] = persistable.map((event) => {
          const seq = (sequenceCounters.get(event.session_id) ?? 0)
          return {
            event_id: generateUUID(),
            session_id: event.session_id,
            parent_event_id: event.parent_event_id ?? null,
            event_type: event.type,
            payload: JSON.stringify(event.data),
            status: (event.data as Record<string, unknown>).status as string ?? "success",
            token_cost: ((event.data as Record<string, unknown>).token_cost as number) ?? 0,
            duration_ms: ((event.data as Record<string, unknown>).duration_ms as number) ?? 0,
            sequence_index: seq,
            timestamp: event.timestamp,
          }
        })
        yield* Effect.tryPromise({
          try: async () => { await options.persistBatch!(persistentEvents) },
          catch: () => new Error("persistBatch failed"),
        }).pipe(Effect.catch(() => Effect.void))
      } else if (persistable.length > 0 && options.persistFn) {
        // Legacy single-event persist fallback
        for (const event of persistable) {
          yield* Effect.tryPromise({
            try: async () => { await options.persistFn!(event) },
            catch: () => new Error("persistFn failed"),
          }).pipe(Effect.catch(() => Effect.void))
        }
      }
    })

    const writerFiber = yield* Effect.forkScoped(
      Effect.gen(function* () {
        const scope = yield* Effect.scope
        let batch: BusEvent[] = []
        let flushTimer: Fiber.Fiber<void, never> | null = null

        while (true) {
          const collected = yield* Queue.takeAll(eventQueue)
          for (const event of collected) {
            batch.push(event)
            if (event.require_persistence) {
              const current = sequenceCounters.get(event.session_id) ?? 0
              sequenceCounters.set(event.session_id, current + 1)
            }
          }

          if (batch.length >= BATCH_SIZE) {
            const toFlush = batch.splice(0)
            if (flushTimer) {
              yield* Fiber.interrupt(flushTimer)
              flushTimer = null
            }
            yield* flushQueue(toFlush)
          } else if (batch.length > 0 && !flushTimer) {
            flushTimer = yield* Effect.forkIn(
              Effect.gen(function* () {
                yield* Effect.sleep(FLUSH_INTERVAL_MS)
                if (batch.length > 0) {
                  const toFlush = batch.splice(0)
                  yield* flushQueue(toFlush)
                }
              }),
              scope,
            )
          }
        }
      }),
    )

    const getSequence = (sessionId: string): number => {
      const current = sequenceCounters.get(sessionId) ?? 0
      return current
    }

    const eventBus: EventBus = {
      publish: async (event: BusEvent) => {
        await Effect.runPromise(
          Queue.offer(eventQueue, event).pipe(Effect.catch(() => Effect.void)),
        )
      },

      enqueuePriority: async (event: BusEvent) => {
        // CRITICAL/HIGH events: flush immediately, bypass batch queue
        // This ensures critical state transitions and errors are persisted without delay
        if (event.priority <= EventPriority.HIGH && event.require_persistence) {
          await Effect.runPromise(
            Effect.gen(function* () {
              // Assign sequence index for this session
              const current = sequenceCounters.get(event.session_id) ?? 0
              sequenceCounters.set(event.session_id, current + 1)
              // Flush this single event immediately
              yield* flushQueue([event])
            }).pipe(Effect.catch(() => Effect.void)),
          )
        } else {
          // Lower-priority events go through normal queue+batch path
          await Effect.runPromise(
            Queue.offer(eventQueue, event).pipe(Effect.catch(() => Effect.void)),
          )
        }
      },

      subscribe: (eventType: EventType, handler: EventHandler) => {
        const subs = handlers.get(eventType) ?? new Set()
        subs.add(handler)
        handlers.set(eventType, subs)
      },

      unsubscribe: (eventType: EventType, handler: EventHandler) => {
        const subs = handlers.get(eventType)
        if (subs) {
          subs.delete(handler)
          if (subs.size === 0) handlers.delete(eventType)
        }
      },

      waitForEvent: async (
        eventType: EventType,
        timeoutMs: number = 30000,
        predicate?: (event: BusEvent) => boolean,
      ): Promise<BusEvent | null> => {
        let timeoutId: ReturnType<typeof setTimeout>

        const promise = new Promise<BusEvent | null>((resolve) => {
          const handler = (event: BusEvent) => {
            if (predicate && !predicate(event)) return
            clearTimeout(timeoutId)
            eventBus.unsubscribe(eventType, handler)
            resolve(event)
          }

          timeoutId = setTimeout(() => {
            eventBus.unsubscribe(eventType, handler)
            resolve(null)
          }, timeoutMs)

          eventBus.subscribe(eventType, handler)
        })

        return promise
      },

      shutdown: async () => {
        await Effect.runPromise(Queue.shutdown(eventQueue))
      },
    }

    return EventBusService.of(eventBus)
  }),
  )
}

/** Default layer with no persistence */
export const layer = createLayer()
export const defaultLayer = layer

export function calculateSpecificity(condition: string, tool: string): number {
  let score = 0
  if (condition.includes("AND")) score += 10
  if (condition.includes("context.contains")) score += 5
  if (condition.includes("tool=") && tool !== "any") score += 3
  if (condition !== "always") score += 1
  return score
}

export * as EventBus from "./event-bus"

export function createSimpleEventBus(persistFn?: EventBusPersistFn): EventBus {
  const handlers = new Map<EventType, Set<EventHandler>>()
  let sequenceCounter = 0
  const pendingBuffer: BusEvent[] = []
  const MAX_BUFFER = QUEUE_MAX_SIZE

  function dispatchEvent(event: BusEvent): void {
    const subs = handlers.get(event.type)
    if (subs) {
      for (const handler of subs) {
        try { handler(event) } catch { /* swallow */ }
      }
    }
  }

  /** Priority-based backpressure: when buffer is full, CRITICAL events evict lowest-priority; otherwise drop with warning */
  function enqueueWithBackpressure(event: BusEvent): boolean {
    if (pendingBuffer.length < MAX_BUFFER) {
      pendingBuffer.push(event)
      return true
    }
    // Buffer full — apply backpressure
    if (event.priority <= EventPriority.HIGH) {
      // Find lowest-priority event in buffer and evict it
      let lowestIdx = 0
      let lowestPriority = pendingBuffer[0].priority
      for (let i = 1; i < pendingBuffer.length; i++) {
        if (pendingBuffer[i].priority > lowestPriority) {
          lowestPriority = pendingBuffer[i].priority
          lowestIdx = i
        }
      }
      // Only evict if the incoming event has higher priority
      if (event.priority < lowestPriority) {
        pendingBuffer.splice(lowestIdx, 1)
        pendingBuffer.push(event)
        return true
      }
    }
    // Drop non-critical event when buffer is full
    console.warn(`[EventBus] Backpressure: dropping ${event.type} event (priority=${event.priority}, buffer=${pendingBuffer.length}/${MAX_BUFFER})`)
    return false
  }

  return {
    publish: async (event: BusEvent) => {
      if (!enqueueWithBackpressure(event)) return

      if (event.require_persistence && persistFn) {
        try { await persistFn(event) } catch { /* persistence errors must not block */ }
      }

      dispatchEvent(event)
    },

    /** Per whitepaper §4: CRITICAL/HIGH events flush immediately, bypassing batch delay */
    enqueuePriority: async (event: BusEvent) => {
      // CRITICAL/HIGH bypass buffer limits
      if (event.require_persistence && persistFn) {
        try { await persistFn(event) } catch { /* must not block */ }
      }

      dispatchEvent(event)
    },

    subscribe: (eventType: EventType, handler: EventHandler) => {
      const subs = handlers.get(eventType) ?? new Set()
      subs.add(handler)
      handlers.set(eventType, subs)
    },

    unsubscribe: (eventType: EventType, handler: EventHandler) => {
      const subs = handlers.get(eventType)
      if (subs) {
        subs.delete(handler)
        if (subs.size === 0) handlers.delete(eventType)
      }
    },

    waitForEvent: async (eventType: EventType, timeoutMs: number = 30000, predicate?: (event: BusEvent) => boolean) => {
      let timeoutId: ReturnType<typeof setTimeout>
      return new Promise<BusEvent | null>((resolve) => {
        const handler = (event: BusEvent) => {
          if (predicate && !predicate(event)) return
          clearTimeout(timeoutId)
          // Unsubscribe from THIS bus instance, not a new one
          const subs = handlers.get(eventType)
          if (subs) {
            subs.delete(handler)
            if (subs.size === 0) handlers.delete(eventType)
          }
          resolve(event)
        }
        timeoutId = setTimeout(() => {
          const subs = handlers.get(eventType)
          if (subs) {
            subs.delete(handler)
            if (subs.size === 0) handlers.delete(eventType)
          }
          resolve(null)
        }, timeoutMs)
        const subs = handlers.get(eventType) ?? new Set()
        subs.add(handler)
        handlers.set(eventType, subs)
      })
    },

    shutdown: async () => {
      handlers.clear()
      pendingBuffer.length = 0
    },
  }
}
