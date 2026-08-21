export * as ConfigPolicyPlugin from "./policy.js"

import { define } from "@opencode-ai/plugin/effect/plugin"
import { Document } from "@opencode-ai/schema/config"
import { Effect } from "effect"
import { Config } from "../../config.js"
import { Wildcard } from "../../util/wildcard.js"
import { ConfigEntryObserver } from "./entry-observer.js"

export const Plugin = define({
  id: "opencode.config.policy",
  effect: Effect.fn(function* (ctx) {
    const config = yield* Config.Service
    const loaded = yield* ConfigEntryObserver.observe(config, ctx.event, ctx.catalog.reload())
    yield* ctx.catalog.transform((catalog) => {
      // User-global policy takes priority over policy authored by a repository.
      const policies = loaded.entries
        .filter((entry): entry is Document => entry.type === "document")
        .toReversed()
        .flatMap((entry) => entry.info.experimental?.policies ?? [])
      for (const record of catalog.provider.list()) {
        const policy = policies.findLast((policy) => Wildcard.match(record.provider.id, policy.resource))
        if (policy?.effect === "deny") catalog.provider.remove(record.provider.id)
      }
    })
  }),
})
