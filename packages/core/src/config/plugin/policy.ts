export * as ConfigPolicyPlugin from "./policy.js"

import { define } from "@opencode/plugin/effect/plugin"
import { Tool } from "@opencode/schema/tool"
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
    // Authored documents reverse so user-global policy outranks repository policy; organization statements
    // from the connected Console follow every authored one and have the final say.
    const policies = () => ManagedPolicy.statements(loaded.entries, managed.current())
    const runSync = Effect.runSyncWith(yield* Effect.context())
    yield* ctx.provider.transform((providers) => {
      const current = policies()
      const denied: string[] = []
      for (const record of providers.list()) {
        const policy = current.findLast(
          (policy) => policy.action === "provider.use" && Wildcard.match(record.provider.id, policy.resource),
        )
        if (policy?.effect !== "deny") continue
        providers.remove(record.provider.id)
        // Skip unconfigured catalog entries; deny-all policies would otherwise log the whole catalog.
        if (record.provider.activation === "enabled") denied.push(record.provider.id)
      }
      if (denied.length) runSync(Effect.logDebug("providers denied by policy", { providers: denied }))
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
    yield* ctx.tool.hook("execute.resolved", (event) =>
      Effect.gen(function* () {
        // Code Mode can run without calling a permission-checking child tool.
        // Use the resolved tool name after request aliases and input-repair hooks.
        // Enforce its tool-wide policy before any JavaScript or nested calls run.
        if (event.tool !== "execute") return
        const policy = policies().findLast(
          (policy) =>
            policy.action === "tool.use" &&
            (Wildcard.match("execute", policy.resource) || Wildcard.match("execute:*", policy.resource)),
        )
        if (policy?.effect === "deny") return yield* new Tool.Error({ message: policy.message })
      }),
    )
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
