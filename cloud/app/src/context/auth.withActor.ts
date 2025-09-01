import { Actor } from "@opencode/cloud-core/actor.js"
import { getActor } from "./auth"
import { query } from "@solidjs/router"

export async function withActor<T>(fn: () => T) {
  const actor = await getActor()
  return Actor.provide(actor.type, actor.properties, fn)
}

export function actorQuery<T>(cb: () => T, name: string) {
  "use server"
  return query(async () => {
    const actor = await getActor()
    return withActor(cb)
  }, name)
}
