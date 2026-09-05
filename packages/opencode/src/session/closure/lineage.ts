import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Context, Effect, Layer } from "effect"
import type { SessionID } from "../schema"
import { Session } from "../session"
import type { SessionClosurePorts as Ports } from "./ports"

/**
 * Reads parent lineage only to fill an observed edge from validated reach. It stays downstream of
 * `Session` to avoid a layer cycle.
 */
export interface Interface extends Ports.LineageCapability {}

export class Service extends Context.Service<Service, Interface>()("@opencode/SessionClosureLineage") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const sessions = yield* Session.Service
    return Service.of({
      // Missing Sessions and absent parents are omitted; neither proves a relationship.
      parents: (ids) =>
        Effect.forEach(ids, (id) => sessions.get(id as SessionID).pipe(Effect.option), {
          concurrency: "unbounded",
        }).pipe(
          Effect.map((entries) =>
            entries.flatMap((entry) =>
              entry._tag === "Some" && entry.value.parentID
                ? [{ session: entry.value.id, parent: entry.value.parentID }]
                : [],
            ),
          ),
        ),
    })
  }),
)

export const node = LayerNode.make({ service: Service, layer, deps: [Session.node] })

export * as SessionClosureLineage from "./lineage"
