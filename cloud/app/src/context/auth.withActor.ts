import { Actor } from "@opencode/cloud-core/actor.js"
import { getActor } from "./auth"

export async function withActor<T>(fn: () => T) {
  const actor = await getActor()
  return Actor.provide(actor.type, actor.properties, fn)
}
