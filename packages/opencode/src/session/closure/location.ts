import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Context, Effect, Layer, Option } from "effect"
import { InstanceState } from "@/effect/instance-state"
import type { SessionID } from "../schema"
import { Session } from "../session"
import type { SessionClosureModel as Model } from "./model"

/**
 * Validates every claimed Session because Instance-local registries do not validate metadata strings.
 * It stays downstream of `Session` to avoid a layer cycle, and all failures return `false`.
 */
export interface Interface {
  readonly validate: (session: Model.SessionID) => Effect.Effect<boolean>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SessionClosureLocation") {}

/** Both paths are already platform-normalized; only Windows case folding remains necessary. */
const sameDirectory = (left: string, right: string) =>
  process.platform === "win32" ? left.toLowerCase() === right.toLowerCase() : left === right

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const sessions = yield* Session.Service

    return Service.of({
      validate: (session) =>
        Effect.gen(function* () {
          const ctx = yield* InstanceState.context
          const workspace = yield* InstanceState.workspaceID

          const found = yield* sessions.get(session as unknown as SessionID).pipe(Effect.option)
          if (Option.isNone(found)) return false

          if (!sameDirectory(found.value.directory, ctx.directory)) return false

          // Workspace is secondary to directory and is checked only when the Session persisted one.
          if (found.value.workspaceID !== undefined && found.value.workspaceID !== workspace) return false

          return true
        }).pipe(
          // Resolution defects fail closed at this admission boundary.
          Effect.catchCause(() => Effect.succeed(false)),
        ),
    })
  }),
)

export const node = LayerNode.make({ service: Service, layer, deps: [Session.node] })

export * as SessionClosureLocation from "./location"
