import { Effect, Layer } from "effect"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { Credential } from "@opencode/core/credential"
import { WellKnown } from "@opencode/core/wellknown"

export const emptyCredentialNode = makeGlobalNode({
  service: Credential.Service,
  layer: Layer.succeed(
    Credential.Service,
    Credential.Service.of({
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
    }),
  ),
  deps: [],
})
