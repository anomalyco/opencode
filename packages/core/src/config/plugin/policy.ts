export * as ConfigPolicyPlugin from "./policy"

import { define } from "@opencode-ai/plugin/effect/plugin"
import { Document, type Entry } from "@opencode-ai/schema/config"
import { ConfigPolicy } from "@opencode-ai/schema/config/policy"
import { Effect, Stream } from "effect"
import { Config } from "../../config"
import { Wildcard } from "../../util/wildcard"

export function effective(entries: readonly Entry[]) {
  // User-global policy takes priority over policy authored by a repository.
  return entries
    .filter((entry): entry is Document => entry.type === "document")
    .toReversed()
    .flatMap((entry) => entry.info.experimental?.policies ?? [])
}

export function evaluate(policies: readonly ConfigPolicy.Info[], resource: string) {
  return policies.findLast((policy) => Wildcard.match(resource, policy.resource))
}

export function compatibility(policies: readonly ConfigPolicy.Info[], source: string, target: string) {
  const targetPolicy = evaluate(policies, target)
  if (targetPolicy?.effect === "deny") return "target-denied" as const
  const sourcePolicy = evaluate(policies, source)
  if (sourcePolicy?.effect === "deny" && !Wildcard.match(target, sourcePolicy.resource)) return "source-denied" as const
  return "allowed" as const
}

export const Plugin = define({
  id: "opencode.config.policy",
  effect: Effect.fn(function* (ctx) {
    const config = yield* Config.Service
    const loaded = { entries: yield* config.entries() }
    yield* ctx.catalog.transform((catalog) => {
      const policies = effective(loaded.entries)
      for (const record of catalog.provider.list()) {
        const policy = evaluate(policies, record.provider.id)
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
