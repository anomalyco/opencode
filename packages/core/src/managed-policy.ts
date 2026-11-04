export * as ManagedPolicy from "./managed-policy.js"

import { Document, type Entry } from "@opencode/schema/config"
import { Mcp } from "@opencode/schema/mcp"
import { Schema } from "effect"
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
 * The decision on an MCP server. A resource starting with `http://` or `https://` matches the server's URL, so it
 * holds whatever local config names the server; any other resource matches the name. Local servers have no URL.
 */
export function mcpDecision(
  policies: readonly ConfigPolicy.Info[],
  action: Extract<ConfigPolicy.Action, `mcp.${string}`>,
  server: { readonly name: string; readonly url?: string },
) {
  return (
    policies.findLast(
      (policy) =>
        policy.action === action &&
        (/^https?:\/\//i.test(policy.resource.trim())
          ? Mcp.matchUrl(server.url, policy.resource)
          : Wildcard.match(server.name, policy.resource)),
    )?.effect ?? "allow"
  )
}

/**
 * The `tool.use` statement deciding a permission check. `mcp:<url>#<tool>` matches an MCP tool by its server's URL
 * and its own name; any other resource matches `<action>:<resource>`.
 */
export function toolMatch<Policy extends ConfigPolicy.Info>(
  policies: readonly Policy[],
  check: { readonly action: string; readonly resource: string; readonly mcp?: McpIdentity },
) {
  return policies.findLast((policy) => {
    if (policy.action !== "tool.use") return false
    const resource = policy.resource.trim()
    if (!resource.startsWith("mcp:")) return Wildcard.match(`${check.action}:${check.resource}`, policy.resource)
    const target = resource.slice(4)
    const separator = target.indexOf("#")
    return (
      check.mcp !== undefined &&
      separator !== -1 &&
      Mcp.matchUrl(check.mcp.url, target.slice(0, separator)) &&
      Wildcard.match(check.mcp.tool, target.slice(separator + 1))
    )
  })
}

/** What an MCP tool's permission check carries so `tool.use` can match it by URL: the tool and its server's URL. */
export const McpIdentity = Schema.Struct({ tool: Schema.String, url: Schema.optional(Schema.String) })
export type McpIdentity = typeof McpIdentity.Type

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
