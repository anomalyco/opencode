export * as LocationRetention from "./location-retention.js"

import { Context, Effect, Layer, SynchronizedRef } from "effect"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { Location } from "./location.js"
import { LocationServiceMap } from "./location-service-map.js"

export interface Snapshot {
  readonly ref: Location.Ref
  readonly count: number
}

export interface Interface {
  readonly retain: (ref: Location.Ref) => Effect.Effect<void>
  readonly release: (ref: Location.Ref) => Effect.Effect<void>
  readonly live: () => Effect.Effect<Snapshot[]>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/LocationRetention") {}

/**
 * Single identity for one placement. LocationActivity keys its expiry map the
 * same way; both must agree or pins silently miss their location.
 */
export function keyOf(ref: Location.Ref) {
  return `${LocationServiceMap.canonical(ref).directory}\0${ref.workspaceID ?? ""}`
}

/**
 * Tracks locations that own live child processes. Location-scoped services
 * spawning a child that outlives the requesting effect retain while it runs
 * and release when it settles. Foreground work already holds a location
 * reference for its whole duration and needs nothing here.
 */
export const make = Effect.gen(function* () {
  const entries = yield* SynchronizedRef.make(new Map<string, Snapshot>())

  const retain: Interface["retain"] = Effect.fn("LocationRetention.retain")(function* (ref) {
    const canonical = LocationServiceMap.canonical(ref)
    const pinned = yield* SynchronizedRef.modify(entries, (map) => {
      const id = keyOf(canonical)
      const current = map.get(id)
      const next = new Map(map).set(id, { ref: canonical, count: (current?.count ?? 0) + 1 })
      return [current === undefined, next] as [boolean, Map<string, Snapshot>]
    })
    if (!pinned) return
    yield* Effect.logInfo("location pinned by live processes", {
      directory: canonical.directory,
      workspaceID: canonical.workspaceID,
    })
  })

  const release: Interface["release"] = Effect.fn("LocationRetention.release")(function* (ref) {
    const canonical = LocationServiceMap.canonical(ref)
    const unpinned = yield* SynchronizedRef.modify(entries, (map) => {
      const id = keyOf(canonical)
      const current = map.get(id)
      if (!current) return [false, map] as [boolean, Map<string, Snapshot>]
      const next = new Map(map)
      if (current.count <= 1) next.delete(id)
      else next.set(id, { ref: canonical, count: current.count - 1 })
      return [current.count <= 1, next] as [boolean, Map<string, Snapshot>]
    })
    if (!unpinned) return
    yield* Effect.logInfo("location unpinned, idle eviction resumed", {
      directory: canonical.directory,
      workspaceID: canonical.workspaceID,
    })
  })

  const live: Interface["live"] = Effect.fn("LocationRetention.live")(function* () {
    return Array.from((yield* SynchronizedRef.get(entries)).values())
  })

  return { retain, release, live }
})

const layer = Layer.effect(Service, make)

export const node = makeGlobalNode({ service: Service, layer, deps: [] })
