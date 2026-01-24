import { Config } from "../config/config"

const sessionTrusted = new Set<string>()

export async function isTrusted(domain: string): Promise<boolean> {
  if (sessionTrusted.has(domain)) return true

  const config = await Config.get()
  const configuredDomains = config.remoteAgents?.domains ?? []
  return configuredDomains.includes(domain)
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
