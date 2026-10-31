import { EOL } from "node:os"
import { OpenCode } from "@opencode/client"
import { Service } from "@opencode/client/effect/service"
import { Marketplace } from "@opencode/schema/marketplace"
import { Effect, Option, Schema } from "effect"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { ServerConnection } from "../../../services/server-connection"

export default Runtime.handler(
  Commands.commands.plugin.commands.marketplace,
  Effect.fn("cli.plugin.marketplace")(function* (input) {
    const endpoint = (yield* ServerConnection.resolve()).endpoint
    const client = OpenCode.make({ baseUrl: endpoint.url, headers: Service.headers(endpoint) }).experimental.marketplace
    const location = { directory: process.cwd() }
    const target = Option.getOrUndefined(input.target)
    const required = () => {
      if (!target) throw new Error(`${input.action} requires a target`)
      return target
    }
    const output = (value: unknown) => process.stdout.write(`${JSON.stringify(value, null, 2)}${EOL}`)
    const state = () => client.get({ location }).then((result) => result.data)
    const flags = { force: input.force, accept_untrusted: input.acceptUntrusted }
    const done = (result: { ok: boolean; message?: string }) => {
      output(result)
      if (!result.ok) process.exitCode = 1
    }

    if (input.action === "list") return output(yield* Effect.promise(state))
    if (input.action === "audit") return output((yield* Effect.promise(() => client.audit({ location }))).data)
    if (input.action === "prune") return output((yield* Effect.promise(() => client.cachePrune({ location }))).data)
    if (input.action === "export" || input.action === "lock") {
      const value =
        input.action === "export"
          ? (yield* Effect.promise(() => client.profileExport({ location }))).data
          : (yield* Effect.promise(() => client.lockExport({ location }))).data
      yield* Effect.promise(() => Bun.write(required(), JSON.stringify(value, null, 2) + EOL))
      return
    }
    if (input.action === "verify") {
      const lock = yield* Effect.promise(() => Bun.file(required()).json())
      const decoded = yield* Schema.decodeUnknownEffect(Marketplace.Lock)(lock)
      const result = (yield* Effect.promise(() => client.lockVerify({ location, lock: decoded }))).data
      output(result)
      if (!result.ok) process.exitCode = 1
      return
    }
    const view = yield* Effect.promise(state)
    const revision = view.state.revision ?? 0
    if (input.action === "add") {
      const headerEnv = Object.fromEntries(
        input.headerEnv.map((binding) => {
          const index = binding.indexOf("=")
          if (index < 1 || index === binding.length - 1) throw new Error(`Invalid header binding: ${binding}`)
          return [binding.slice(0, index), binding.slice(index + 1)]
        }),
      )
      return done(
        (yield* Effect.promise(() =>
          client.sourceAdd({
            location,
            expected_revision: revision,
            url: required(),
            trust: input.trust,
            header_env: headerEnv,
          }),
        )).data,
      )
    }
    if (input.action === "remove-source")
      return done(
        (yield* Effect.promise(() => client.sourceRemove({ location, expected_revision: revision, id: required() })))
          .data,
      )
    if (input.action === "uninstall")
      return done(
        (yield* Effect.promise(() => client.uninstall({ location, expected_revision: revision, key: required() })))
          .data,
      )
    if (input.action === "install") {
      const plan = (yield* Effect.promise(() => client.plan({ location, key: required() }))).data
      if (!plan.ok) return done(plan)
      output(plan)
      return done(
        (yield* Effect.promise(() =>
          client.install({ location, plan_id: plan.plan_id, expected_revision: plan.revision, ...flags }),
        )).data,
      )
    }
    if (input.action === "update") {
      const plan = (yield* Effect.promise(() => client.updatePlan({ location }))).data
      if (!plan.ok) return done(plan)
      output(plan)
      return done(
        (yield* Effect.promise(() =>
          client.updateApply({ location, plan_id: plan.plan_id, expected_revision: plan.revision, ...flags }),
        )).data,
      )
    }
    const profile = yield* Effect.promise(() => Bun.file(required()).json())
    const decoded = yield* Schema.decodeUnknownEffect(Marketplace.ProfileDocument)(profile)
    const plan = (yield* Effect.promise(() => client.profilePlan({ location, profile: decoded, mode: input.mode })))
      .data
    if (!plan.ok) return done(plan)
    output(plan)
    return done(
      (yield* Effect.promise(() =>
        client.profileApply({ location, plan_id: plan.plan_id, expected_revision: plan.revision, ...flags }),
      )).data,
    )
  }),
)
