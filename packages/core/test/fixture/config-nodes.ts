import { Effect, Layer } from "effect"
import { makeGlobalNode } from "@Mackery6969/util/effect/app-node"
import { Credential } from "@Mackery6969/core/credential"
import { WellKnown } from "@Mackery6969/core/wellknown"

export const emptyCredentialNode = makeGlobalNode({
  service: Credential.Service,
  layer: Layer.succeed(
    Credential.Service,
    Credential.Service.of({
      lock: () => Effect.die("unused Credential.lock"),
      all: () => Effect.succeed([]),
      list: () => Effect.succeed([]),
      get: () => Effect.undefined,
      create: () => Effect.die("unused Credential.create"),
      activate: () => Effect.die("unused Credential.activate"),
      update: () => Effect.die("unused Credential.update"),
      remove: () => Effect.die("unused Credential.remove"),
    }),
  ),
  deps: [],
})

export const emptyWellknownNode = makeGlobalNode({
  service: WellKnown.Service,
  layer: Layer.succeed(
    WellKnown.Service,
    WellKnown.Service.of({
      entries: () => Effect.succeed([]),
      snapshot: () => [],
      refresh: () => Effect.succeed(false),
      add: () => Effect.die("unused Wellknown.add"),
      remove: () => Effect.die("unused Wellknown.remove"),
      resolve: () => Effect.die("unused Wellknown.resolve"),
      cached: () => Effect.succeed([]),
    }),
  ),
  deps: [],
})
