export * as SessionRunnerFailover from "./failover.js"

import { Model } from "@opencode-ai/schema/model"
import { Effect } from "effect"
import { Catalog } from "../../catalog.js"
import { Credential } from "../../credential.js"
import { Integration } from "../../integration.js"

export interface Interface {
  /** Activates the next connected account for the model's integration.
   *  Returns the credential that was active (now exhausted), or undefined when
   *  auto-switch is off, the active connection is not a credential, or no
   *  un-exhausted candidate remains. */
  readonly next: (model: Model.Ref, exhausted: ReadonlySet<Credential.ID>) => Effect.Effect<Credential.ID | undefined>
}

export const make = (integrations: Integration.Interface, catalog: Catalog.Interface): Interface => ({
  next: Effect.fn("SessionRunnerFailover.next")(function* (model, exhausted) {
    const provider = yield* catalog.provider.get(model.providerID)
    const integrationID = provider?.integrationID ?? Integration.ID.make(model.providerID)
    const info = yield* integrations.get(integrationID)
    if (!info?.settings.autoSwitch) return undefined
    const active = yield* integrations.connection.active(integrationID)
    if (active?.type !== "credential") return undefined
    // Connections list the active account first, so the first remaining
    // candidate is the next account the user would have picked manually.
    const candidate = info.connections
      .filter((connection) => connection.type === "credential")
      .find((connection) => connection.id !== active.id && !exhausted.has(connection.id))
    if (!candidate) return undefined
    yield* integrations.connection.activate(candidate.id)
    yield* Effect.logInfo("account switched", { integrationID, from: active.id, to: candidate.id })
    return active.id
  }),
})
