export * as ManagedPolicy from "./managed-policy.js"

import { Document, type Entry } from "@opencode/schema/config"
import { ConfigIntegration } from "./config/integration.js"
import { Wildcard } from "./util/wildcard.js"
import { ConfigPolicy } from "@opencode/schema/config/policy"
import type { Credential } from "./credential.js"

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

/** The statement deciding `action` on `resource`: the last match, since statements are earliest-loaded last. */
export function match<Policy extends ConfigPolicy.Info>(
  policies: readonly Policy[],
  action: ConfigPolicy.Action,
  resource: string,
) {
  return policies.findLast((policy) => policy.action === action && Wildcard.match(resource, policy.resource))
}

export function decision(policies: readonly ConfigPolicy.Info[], action: ConfigPolicy.Action, resource: string) {
  return match(policies, action, resource)?.effect ?? "allow"
}

/**
 * The `integration.use` resource for what an integration supplies: `<integration>#<account>` when a connection with
 * a known account backs it, otherwise the bare integration ID (env keys, local config, the signed-out free tier).
 * A bare-ID pattern such as `opencode` therefore matches only connectionless use, never an org account. `#`
 * separates the two because integration IDs can be URLs.
 */
export function integrationResource(integrationID: string, account?: string) {
  return account ? `${integrationID}#${account}` : integrationID
}

/** The organization, or failing that the account, a stored credential belongs to. */
export function account(value: Credential.Value) {
  const metadata = value.metadata
  if (typeof metadata?.orgID === "string" && metadata.orgID) return metadata.orgID
  if (typeof metadata?.accountID === "string" && metadata.accountID) return metadata.accountID
  return undefined
}

/** The account behind each integration's active stored credential. */
export function accounts(credentials: readonly Credential.Info[]) {
  // Credentials list each integration's active credential last.
  return new Map<string, string | undefined>(
    credentials.map((credential) => [credential.integrationID, account(credential.value)]),
  )
}
