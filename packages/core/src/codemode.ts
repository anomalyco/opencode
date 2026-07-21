export * as CodeMode from "./codemode"

import { Context, Effect, Layer, Scope } from "effect"
import { CodeModeCatalog } from "./codemode/catalog"
import { makeLocationNode } from "@opencode-ai/util/effect/app-node"
import { PermissionV2 } from "./permission"
import { ExecuteTool } from "./tool/execute"
import type { Any, Registration } from "./tool/tool"
import { Wildcard } from "./util/wildcard"

export interface Materialization {
  readonly tool?: Any
  readonly catalog?: ReadonlyArray<CodeModeCatalog.Entry>
}

export interface Interface {
  readonly register: (
    registrations: ReadonlyArray<Registration & { readonly key: string }>,
  ) => Effect.Effect<void, never, Scope.Scope>
  readonly materialize: (permissions?: PermissionV2.Ruleset) => Effect.Effect<Materialization>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/CodeMode") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const local = new Map<string, Array<{ readonly token: object; readonly registration: ExecuteTool.Registration }>>()

    return Service.of({
      register: Effect.fn("CodeMode.register")(function* (registrations) {
        if (registrations.length === 0) return
        yield* Effect.uninterruptible(
          Effect.gen(function* () {
            const token = {}
            for (const registration of registrations)
              local.set(registration.key, [
                ...(local.get(registration.key) ?? []),
                {
                  token,
                  registration,
                },
              ])
            yield* Effect.addFinalizer(() =>
              Effect.sync(() => {
                for (const registration of registrations) {
                  const remaining = local.get(registration.key)?.filter((item) => item.token !== token) ?? []
                  if (remaining.length > 0) local.set(registration.key, remaining)
                  else local.delete(registration.key)
                }
              }),
            )
          }),
        )
      }),
      materialize: Effect.fn("CodeMode.materialize")(function* (permissions) {
        const registrations = new Map<string, ExecuteTool.Registration>()
        const rules = permissions ?? []
        for (const [name, entries] of local) {
          const registration = entries.at(-1)?.registration
          if (!registration) continue
          const rule = rules.findLast((rule) => Wildcard.match(registration.permission, rule.action))
          if (rule?.resource === "*" && rule.effect === "deny") continue
          registrations.set(name, registration)
        }
        if (registrations.size === 0) return {}
        const executeRule = rules.findLast((rule) => Wildcard.match("execute", rule.action))
        if (executeRule?.resource === "*" && executeRule.effect === "deny") return {}
        return {
          tool: ExecuteTool.create(registrations),
          catalog: ExecuteTool.catalog(registrations),
        }
      }),
    })
  }),
)

export const node = makeLocationNode({ service: Service, layer, deps: [] })
