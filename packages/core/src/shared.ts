export * as Shared from "./shared.js"

import path from "node:path"
import { Context, Effect, Layer, Scope } from "effect"
import { LayerNode } from "@opencode-ai/util/effect/layer-node"
import { App } from "./app.js"
import { Database } from "./database/database.js"
import { Instance } from "./instance.js"
import { Job } from "./job.js"
import { PersistentPty } from "./persistent-pty.js"
import { Session } from "./session.js"
import { SessionBindings } from "./session/bindings.js"
import { SessionExecution } from "./session/execution.js"
import { SessionInstance } from "./session/instance.js"

export interface Options<Items extends Replacements = Replacements> {
  readonly database?: Database.Options
  readonly app?: Partial<App.Info>
  readonly replacements?: LayerNode.ComposableReplacements<Items>
}

/** Ready constructors accept only fully wired, infallible replacements. */
export type Replacements = readonly (readonly [
  LayerNode.Node<unknown, unknown, LayerNode.Tag | undefined>,
  LayerNode.Node<unknown, never, LayerNode.Tag | undefined> | Layer.Layer<never>,
])[]

export interface Interface {
  readonly scope: Scope.Scope
  readonly globals: Context.Context<Instance.Globals>
  readonly sessions: Session.Interface
  readonly bindings: SessionBindings.Interface
  readonly execution: SessionExecution.Interface
  readonly jobs: Job.Interface
  readonly persistentPty: PersistentPty.Interface
  readonly replacements: Replacements
}

/** Supplied once by the host; contains no location map or embedded HTTP server. */
export class Service extends Context.Service<Service, Interface>()("@opencode/Shared") {}

export function layer<const Items extends Replacements = readonly []>(options: Options<Items> = {}) {
  const replacements: Replacements = [
    [
      Database.node,
      Database.configured({
        path:
          options.database?.path && options.database.path !== ":memory:"
            ? path.resolve(options.database.path)
            : ":memory:",
      }),
    ],
    [App.node, App.configured(options.app)],
    ...(options.replacements ?? []),
    [SessionInstance.node, SessionBindings.instanceNode],
  ]
  const configured: LayerNode.Replacements = replacements
  return LayerNode.compile(
    LayerNode.group([
      Instance.globalsGraph,
      Session.node,
      SessionBindings.node,
      SessionExecution.node,
      Job.node,
      PersistentPty.node,
    ]),
    configured,
  ).pipe(
    Layer.flatMap((context) =>
      Layer.effect(
        Service,
        Effect.map(Scope.Scope, (scope) => ({
          scope,
          globals: context,
          sessions: Context.get(context, Session.Service),
          bindings: Context.get(context, SessionBindings.Service),
          execution: Context.get(context, SessionExecution.Service),
          jobs: Context.get(context, Job.Service),
          persistentPty: Context.get(context, PersistentPty.Service),
          replacements,
        })),
      ),
    ),
  )
}
