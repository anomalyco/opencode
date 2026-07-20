export * as CodeMode from "./codemode"

import { Context, Effect, Layer, Scope } from "effect"
import { makeLocationNode } from "./effect/app-node"
import { PermissionV2 } from "./permission"
import { ExecuteTool } from "./tool/execute"
import { permission, registrationEntries, type AnyTool } from "./tool/tool"
import { Tools } from "./tool/tools"
import { Wildcard } from "./util/wildcard"

export interface Materialization {
  readonly tool?: AnyTool
  readonly instructions?: string
}

export interface Interface {
  readonly register: (
    tools: Readonly<Record<string, AnyTool>>,
    options?: Tools.RegisterOptions,
  ) => Effect.Effect<void, never, Scope.Scope>
  readonly materialize: (permissions?: PermissionV2.Ruleset) => Effect.Effect<Materialization>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/CodeMode") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const local = new Map<
      string,
      Array<{ readonly token: object; readonly registration: ExecuteTool.Registration }>
    >()

    return Service.of({
      register: Effect.fn("CodeMode.register")(function* (tools, options) {
        const entries = registrationEntries(tools, options?.namespace)
        if (entries.length === 0) return
        yield* Effect.uninterruptible(
          Effect.gen(function* () {
            const token = {}
            for (const entry of entries)
              local.set(entry.key, [
                ...(local.get(entry.key) ?? []),
                { token, registration: { tool: entry.tool, name: entry.name, namespace: entry.namespace } },
              ])
            yield* Effect.addFinalizer(() =>
              Effect.sync(() => {
                for (const entry of entries) {
                  const registrations = local.get(entry.key)?.filter((item) => item.token !== token) ?? []
                  if (registrations.length > 0) local.set(entry.key, registrations)
                  else local.delete(entry.key)
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
          const rule = rules.findLast((rule) => Wildcard.match(permission(registration.tool, name), rule.action))
          if (rule?.resource === "*" && rule.effect === "deny") continue
          registrations.set(name, registration)
        }
        if (registrations.size === 0) return {}
        const executeRule = rules.findLast((rule) => Wildcard.match("execute", rule.action))
        if (executeRule?.resource === "*" && executeRule.effect === "deny") return {}
        return {
          tool: ExecuteTool.create(registrations),
          instructions: ExecuteTool.instructions(registrations),
        }
      }),
    })
  }),
)

export const node = makeLocationNode({ service: Service, layer, deps: [] })
