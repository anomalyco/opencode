import z from "zod"
import { Log } from "../util/log"
import { Instance } from "../project/instance"
import { BusEvent } from "./bus-event"
import { SyncEvent } from "../sync"
import { GlobalBus } from "./global"

export namespace Bus {
  const log = Log.create({ service: "bus" })
  type Subscription = (event: any) => void

  type SubscribableProperties<Def> = Def extends { data: infer Data }
    ? z.infer<Data>
    : Def extends { properties: infer Properties }
      ? z.infer<Properties>
      : never

  type SubscribableDefinition = BusEvent.Definition | SyncEvent.Definition

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
      const match = [...(state().subscriptions.get(key) ?? [])]
      for (const sub of match) {
        pending.push(sub(payload))
      }
    }
    GlobalBus.emit("event", {
      directory: Instance.directory,
      payload,
    })
    return Promise.all(pending)
  }

  export function subscribe<Def extends SubscribableDefinition>(
    def: Def,
    callback: (event: { type: Def["type"]; properties: SubscribableProperties<Def> }) => void,
  ) {
    return raw(def.type, callback)
  }

  export function once<Definition extends SubscribableDefinition>(
    def: Definition,
    callback: (event: { type: Definition["type"]; properties: SubscribableProperties<Definition> }) => "done" | undefined,
  ) {
    const unsub = subscribe(def, (event) => {
      if (callback(event)) unsub()
    })
  }

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

  export function fromSyncDefinition(def: SyncEvent.Definition) {
    return {
      type: def.type,
      properties: def.data,
    }
  }
}
