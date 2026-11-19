export * as LocationPin from "./location-pin.js"

import { Context, Effect, Layer, Option, Schema } from "effect"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { KV } from "./kv.js"
import { Location } from "./location.js"

const prefix = "location-pin:"
const decodeRef = Schema.decodeUnknownOption(Location.Ref)

/** Refs are canonical, as `LocationServiceMap` keys Locations: a Location's own ref, or one from its cache. */
export interface Interface {
  /**
   * Keeps `ref` loaded for `owner`, also across restarts, until `unpin`: `LocationActivity` neither evicts it when idle
   * nor waits for a request to load it at boot. For background work a Location's plugins do without a client, such as
   * renewing leases.
   */
  readonly pin: (owner: string, ref: Location.Ref) => Effect.Effect<void>
  readonly unpin: (owner: string, ref: Location.Ref) => Effect.Effect<void>
  readonly pinned: (ref: Location.Ref) => Effect.Effect<boolean>
  /** Every pinned Location, once each. */
  readonly list: Effect.Effect<readonly Location.Ref[]>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/LocationPin") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const kv = yield* KV.Service
    // One key per Location and owner; the Location's part ends unambiguously, so a prefix finds all of its owners.
    const place = (ref: Location.Ref) => `${prefix}${JSON.stringify([ref.directory, ref.workspaceID ?? null])}\0`

    return Service.of({
      pin: (owner, ref) =>
        kv.set(place(ref) + owner, {
          directory: ref.directory,
          ...(ref.workspaceID === undefined ? {} : { workspaceID: ref.workspaceID }),
        }),
      unpin: (owner, ref) => kv.remove(place(ref) + owner),
      pinned: (ref) => kv.scan({ prefix: place(ref), limit: 1 }).pipe(Effect.map((page) => page.entries.length > 0)),
      list: Effect.gen(function* () {
        const refs = new Map<string, Location.Ref>()
        let after: string | undefined
        do {
          const page = yield* kv.scan({ prefix, after, limit: 1000 })
          page.entries.forEach((entry) =>
            Option.map(decodeRef(entry.value), (ref) => refs.set(place(ref), ref)),
          )
          after = page.next
        } while (after !== undefined)
        return [...refs.values()]
      }),
    })
  }),
)

export const node = makeGlobalNode({ service: Service, layer, deps: [KV.node] })
