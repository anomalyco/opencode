import z from "zod"
import { Log } from "../util/log"
import { Instance } from "../project/instance"
import { BusEvent } from "./bus-event"
import { GlobalBus } from "./global"

/**
 * Bus namespace providing event publish/subscribe functionality.
 *
 * Implements a typed event bus system for communication between components.
 * Events can be published and subscribed to with type safety provided by Zod schemas.
 * Supports wildcard subscriptions and one-time event handlers.
 *
 * @example
 * ```typescript
 * // Define an event
 * const MyEvent = BusEvent.define("my.event", z.object({ data: z.string() }))
 *
 * // Subscribe to an event
 * Bus.subscribe(MyEvent, (event) => {
 *   console.log(event.properties.data)
 * })
 *
 * // Publish an event
 * await Bus.publish(MyEvent, { data: "hello" })
 * ```
 */
export namespace Bus {
  const log = Log.create({ service: "bus" })
  type Subscription = (event: any) => void

  /**
   * Event published when a project instance is disposed.
   */
  export const InstanceDisposed = BusEvent.define(
    "server.instance.disposed",
    z.object({
      directory: z.string(),
    }),
  )

  const state = Instance.state(
    () => {
      const subscriptions = new Map<any, Subscription[]>()

      return {
        subscriptions,
      }
    },
    async (entry) => {
      const wildcard = entry.subscriptions.get("*")
      if (!wildcard) return
      const event = {
        type: InstanceDisposed.type,
        properties: {
          directory: Instance.directory,
        },
      }
      for (const sub of [...wildcard]) {
        sub(event)
      }
    },
  )

  /**
   * Publishes an event to all subscribers.
   *
   * The event is delivered to all subscribers of the specific event type
   * as well as any wildcard subscribers ("*").
   *
   * @param def - The event definition
   * @param properties - The event payload matching the definition schema
   * @returns A promise that resolves when all subscribers have processed the event
   */
  export async function publish<Definition extends BusEvent.Definition>(
    def: Definition,
    properties: z.output<Definition["properties"]>,
  ) {
    const payload = {
      type: def.type,
      properties,
    }
    log.info("publishing", {
      type: def.type,
    })
    const pending = []
    for (const key of [def.type, "*"]) {
      const match = state().subscriptions.get(key)
      for (const sub of match ?? []) {
        pending.push(sub(payload))
      }
    }
    GlobalBus.emit("event", {
      directory: Instance.directory,
      payload,
    })
    return Promise.all(pending)
  }

  /**
   * Subscribes to a specific event type.
   *
   * Returns an unsubscribe function that can be called to remove the subscription.
   *
   * @param def - The event definition to subscribe to
   * @param callback - The handler function called when the event is published
   * @returns An unsubscribe function
   */
  export function subscribe<Definition extends BusEvent.Definition>(
    def: Definition,
    callback: (event: { type: Definition["type"]; properties: z.infer<Definition["properties"]> }) => void,
  ) {
    return raw(def.type, callback)
  }

  /**
   * Subscribes to an event once, automatically unsubscribing after the first occurrence.
   *
   * The callback can return "done" to indicate it has processed the event and wants
   * to unsubscribe, or undefined to continue listening.
   *
   * @param def - The event definition to subscribe to
   * @param callback - The handler function called when the event is published
   */
  export function once<Definition extends BusEvent.Definition>(
    def: Definition,
    callback: (event: {
      type: Definition["type"]
      properties: z.infer<Definition["properties"]>
    }) => "done" | undefined,
  ) {
    const unsub = subscribe(def, (event) => {
      if (callback(event)) unsub()
    })
  }

  /**
   * Subscribes to all events via wildcard subscription.
   *
   * The callback will be invoked for every event published on the bus.
   *
   * @param callback - The handler function called for all events
   * @returns An unsubscribe function
   */
  export function subscribeAll(callback: (event: any) => void) {
    return raw("*", callback)
  }

  function raw(type: string, callback: (event: any) => void) {
    log.info("subscribing", { type })
    const subscriptions = state().subscriptions
    let match = subscriptions.get(type) ?? []
    match.push(callback)
    subscriptions.set(type, match)

    return () => {
      log.info("unsubscribing", { type })
      const match = subscriptions.get(type)
      if (!match) return
      const index = match.indexOf(callback)
      if (index === -1) return
      match.splice(index, 1)
    }
  }
}
