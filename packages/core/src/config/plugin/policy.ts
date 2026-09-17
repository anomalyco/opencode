export * as ConfigPolicyPlugin from "./policy.js"

import { define } from "@opencode/plugin/effect/plugin"
import { Document } from "@opencode/schema/config"
import { Effect } from "effect"
import { Config } from "../../config.js"
import { Wildcard } from "../../util/wildcard.js"
import { ConfigEntryObserver } from "./entry-observer.js"

export const Plugin = define({
  id: "opencode.config.policy",
  effect: Effect.fn(function* (ctx) {
    const config = yield* Config.Service
    const loaded = yield* ConfigEntryObserver.observe(config, ctx.event, ctx.provider.reload())
    const policies = () =>
      loaded.entries
        .filter((entry): entry is Document => entry.type === "document")
        .toReversed()
        .flatMap((entry) => entry.info.experimental?.policies ?? [])
    yield* ctx.provider.transform((providers) => {
      // User-global policy takes priority over policy authored by a repository.
      for (const record of providers.list()) {
        const policy = policies().findLast(
          (policy) => policy.action === "provider.use" && Wildcard.match(record.provider.id, policy.resource),
        )
        if (policy?.effect === "deny") providers.remove(record.provider.id)
      }
    })
    yield* ctx.permission.hook("evaluate", (event) =>
      Effect.sync(() => {
        const current = policies()
        const denied = event.resources.some((resource) => {
          const policy = current.findLast(
            (policy) =>
              policy.action === "permission" && Wildcard.match(`${event.action}:${resource}`, policy.resource),
          )
          return policy?.effect === "deny"
        })
        if (!denied) return
        event.effect = "deny"
        event.message = "Blocked by configuration policy"
      }),
    )
  }),
})
