export * as ManagedPolicy from "./managed-policy.js"

import { Document, type Entry } from "@opencode/schema/config"
import { ConfigIntegration } from "./config/integration.js"
import { Wildcard } from "./util/wildcard.js"
import { ignoresCase } from "./permission/policy.js"
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
  options?: { readonly ignoreCase?: boolean },
) {
  return policies.findLast(
    (policy) => policy.action === action && Wildcard.match(resource, policy.resource, options?.ignoreCase),
  )
}

/**
 * The statement denying `action` for a permission request, matched as `<permission>:<resource>`. A shell command the
 * scanner couldn't analyze (`metadata.reason`) may run anything anywhere, so any `tool.auto` deny on `shell:` or
 * `external_directory:` covers it.
 */
export function denying<Policy extends ConfigPolicy.Info>(
  policies: readonly Policy[],
  action: ConfigPolicy.Action,
  request: {
    readonly action: string
    readonly resources: readonly string[]
    readonly metadata?: Record<string, unknown>
  },
) {
  const ignoreCase = ignoresCase(request.action)
  return (
    request.resources
      .map((resource) => match(policies, action, `${request.action}:${resource}`, { ignoreCase }))
      .find((policy) => policy?.effect === "deny") ??
    (action === "tool.auto" && request.action === "shell" && typeof request.metadata?.reason === "string"
      ? policies.find(
          (policy) =>
            policy.action === action &&
            policy.effect === "deny" &&
            /^(shell|external_directory):/.test(policy.resource),
        )
      : undefined)
  )
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
