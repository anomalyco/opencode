import { z, type ZodType } from "zod"
import { Log } from "../util/log"
import { Instance } from "../project/instance"

export namespace Bus {
  const log = Log.create({ service: "bus" })
  type Subscription = (event: any) => void

  const state = Instance.state(() => {
    const subscriptions = new Map<any, Subscription[]>()

    return {
      subscriptions,
    }
  })

  export type EventDefinition = ReturnType<typeof event>

  const registry = new Map<string, EventDefinition>()

  export function event<Type extends string, Properties extends ZodType>(type: Type, properties: Properties) {
    const result = {
      type,
      properties,
    }
    registry.set(type, result)
    return result
  }

  export function payloads() {
    return z.discriminatedUnion(
      "type",
      registry
        .entries()
        .map(([type, def]) =>
          z
            .object({
              type: z.literal(type),
              properties: def.properties,
            })
            .openapi({
              ref: "Event" + "." + def.type,
            }),
        )
        .toArray() as any,
    )
  }

  export async function publish<Definition extends EventDefinition>(
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
    return Promise.all(pending)
  }

  export function subscribe<Definition extends EventDefinition>(
    def: Definition,
    callback: (event: { type: Definition["type"]; properties: z.infer<Definition["properties"]> }) => void,
  ) {
    return raw(def.type, callback)
  }

  export function once<Definition extends EventDefinition>(
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
