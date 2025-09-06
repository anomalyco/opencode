import { Actor } from "@opencode/cloud-core/actor.js"
import { getActor } from "./auth"

export async function withActor<T>(fn: () => T, workspace?: string) {
  const actor = await getActor(workspace)
  return Actor.provide(actor.type, actor.properties, fn)
}
