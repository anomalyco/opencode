export * as ManagedPolicy from "./managed-policy.js"

import { Document, type Entry } from "@opencode/schema/config"
import { ConfigIntegration } from "./config/integration.js"
import { Wildcard } from "./util/wildcard.js"
import { ConfigPolicy } from "@opencode/schema/config/policy"

/** Every policy statement in config, earliest-loaded first so it wins, each with the message a denial shows. */
export function statements(entries: readonly Entry[]) {
  return entries
    .filter((entry): entry is Document => entry.type === "document")
    .toReversed()
    .flatMap((entry) =>
      (entry.info.policies ?? []).map((policy) => ({
        ...policy,
        // An integration document's policies are those of the organization behind its connection.
        message:
          entry instanceof ConfigIntegration.Document ? blocked(entry.organization) : "Blocked by configuration policy",
      })),
    )
}

function blocked(organization: string | undefined) {
  return organization ? `Blocked by ${organization}'s policy` : "Blocked by your organization's policy"
}

export function decision(
  policies: readonly ConfigPolicy.Info[],
  action: ConfigPolicy.Info["action"],
  resource: string,
) {
  return (
    policies.findLast((policy) => policy.action === action && Wildcard.match(resource, policy.resource))?.effect ??
    "allow"
  )
}
