export * as ConfigPolicyPlugin from "./policy"

import { define } from "@opencode-ai/plugin/v2/effect/plugin"
import { Effect, Stream } from "effect"
import { Config } from "../../config"
import { Wildcard } from "../../util/wildcard"

export const Plugin = define({
  id: "opencode.config.policy",
  effect: Effect.fn(function* (ctx) {
    const config = yield* Config.Service
    const loaded = { entries: yield* config.entries() }
    yield* ctx.catalog.transform((catalog) => {
      // User-global policy takes priority over policy authored by a repository.
      const policies = loaded.entries
        .filter((entry): entry is Config.Document => entry.type === "document")
        .toReversed()
        .flatMap((entry) => entry.info.experimental?.policies ?? [])
      for (const record of catalog.provider.list()) {
        const policy = policies.findLast((policy) => Wildcard.match(record.provider.id, policy.resource))
        if (policy?.effect === "deny") catalog.provider.remove(record.provider.id)
      }
    })
    yield* ctx.event.subscribe().pipe(
      Stream.filter((event) => event.type === "config.updated"),
      Stream.runForEach(() =>
        config.entries().pipe(
          Effect.tap((entries) => Effect.sync(() => (loaded.entries = entries))),
          Effect.andThen(ctx.catalog.reload()),
        ),
      ),
      Effect.forkScoped({ startImmediately: true }),
    )
  }),
})
