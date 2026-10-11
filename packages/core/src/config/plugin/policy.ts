export * as ConfigPolicyPlugin from "./policy.js"

import { define } from "@opencode/plugin/effect/plugin"
import { Effect, Stream } from "effect"
import { Config } from "../../config.js"
import { ManagedPolicy } from "../../managed-policy.js"
import { State } from "../../state.js"
import { Wildcard } from "../../util/wildcard.js"
import { ConfigEntryObserver } from "./entry-observer.js"

export const Plugin = define({
  id: "opencode.config.policy",
  effect: Effect.fn(function* (ctx) {
    const config = yield* Config.Service
    const managed = yield* ManagedPolicy.Service
    const reload = State.batch(
      Effect.all([ctx.provider.reload(), ctx.mcp.reload(), ctx.skill.reload()], { discard: true }),
    )
    const loaded = yield* ConfigEntryObserver.observe(config, ctx.event, reload)
    yield* managed.changes().pipe(
      Stream.runForEach(() => reload),
      Effect.forkScoped({ startImmediately: true }),
    )
    const policies = () => ManagedPolicy.statements(loaded.entries, managed.current(), config.managed)
    yield* ctx.provider.transform((providers) => {
      const current = policies()
      for (const record of providers.list()) {
        const policy = current.findLast(
          (policy) => policy.action === "provider.use" && Wildcard.match(record.provider.id, policy.resource),
        )
        if (policy?.effect === "deny") providers.remove(record.provider.id)
      }
    })
    yield* ctx.mcp.transform((servers) => {
      const current = policies()
      for (const [name] of servers.list()) {
        if (ManagedPolicy.decision(current, "integration.use", `mcp:${name}`) === "deny") servers.remove(name)
      }
    })
    yield* ctx.skill.transform((skills) => {
      const current = policies()
      for (const skill of skills.list()) {
        if (ManagedPolicy.decision(current, "integration.use", `skill:${skill.id}`) === "deny") skills.remove(skill.id)
      }
    })
    yield* ctx.permission.hook("evaluate", (event) =>
      Effect.sync(() => {
        const current = policies()
        const denied = event.resources
          .map((resource) =>
            current.findLast(
              (policy) =>
                policy.action === "tool.use" && Wildcard.match(`${event.action}:${resource}`, policy.resource),
            ),
          )
          .find((policy) => policy?.effect === "deny")
        if (!denied) return
        event.effect = "deny"
        event.message = denied.message
      }),
    )
  }),
})
