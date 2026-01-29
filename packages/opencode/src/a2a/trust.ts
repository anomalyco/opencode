import { Config } from "../config/config"
import { PermissionNext } from "../permission/next"

const sessionTrusted = new Set<string>()

export type TrustAction = "allow" | "deny" | "ask"

export async function checkTrust(domain: string): Promise<TrustAction> {
  // Session trust takes precedence (user already approved this session)
  if (sessionTrusted.has(domain)) return "allow"

  const config = await Config.get()

  // Check permission config for remote_agent rules
  if (config.permission?.remote_agent) {
    const permissionConfig = config.permission.remote_agent
    // Convert to ruleset and evaluate
    const rules: PermissionNext.Ruleset = []
    if (typeof permissionConfig === "string") {
      rules.push({ permission: "remote_agent", pattern: "*", action: permissionConfig })
    } else {
      for (const [pattern, action] of Object.entries(permissionConfig)) {
        rules.push({ permission: "remote_agent", pattern, action })
      }
    }
    const result = PermissionNext.evaluate("remote_agent", domain, rules)
    if (result.action !== "ask") return result.action
  }

  // Fall back to legacy remoteAgents.domains list (treated as "allow")
  const configuredDomains = config.remoteAgents?.domains ?? []
  if (configuredDomains.includes(domain)) return "allow"

  // Default: ask
  return "ask"
}

/** @deprecated Use checkTrust() instead for full allow/deny/ask support */
export async function isTrusted(domain: string): Promise<boolean> {
  const action = await checkTrust(domain)
  return action === "allow"
}

export function trustForSession(domain: string): void {
  sessionTrusted.add(domain)
}

export function revokeSessionTrust(domain: string): void {
  sessionTrusted.delete(domain)
}

export function clearSessionTrust(): void {
  sessionTrusted.clear()
}

export function getSessionTrustedDomains(): string[] {
  return Array.from(sessionTrusted)
}
