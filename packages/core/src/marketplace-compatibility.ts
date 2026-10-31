import semver from "semver"

export type MarketplaceCompatibility = {
  opencode?: string
  platforms?: string[]
  architectures?: string[]
  runtimes?: string[]
  capabilities?: string[]
}

export type MarketplaceCompatibilityContext = {
  opencode?: string
  platform?: string
  architecture?: string
  runtimes?: Iterable<string>
  capabilities?: Iterable<string>
}

export type MarketplaceCompatibilityResult = { compatible: boolean; reasons: string[] }

function normalizedSet(values?: Iterable<string>) {
  return new Set(Array.from(values ?? [], (value) => value.trim().toLowerCase()).filter(Boolean))
}

export function evaluateMarketplaceCompatibility(
  requirement: MarketplaceCompatibility | undefined,
  context: MarketplaceCompatibilityContext = {},
): MarketplaceCompatibilityResult {
  if (!requirement) return { compatible: true, reasons: [] }
  const reasons: string[] = []
  if (requirement.opencode && context.opencode) {
    const version = semver.coerce(context.opencode)?.version
    if (!version || !semver.satisfies(version, requirement.opencode, { includePrerelease: true })) {
      reasons.push(`Requires OpenCode ${requirement.opencode}; current version is ${context.opencode}`)
    }
  }
  if (requirement.platforms?.length && context.platform) {
    if (!normalizedSet(requirement.platforms).has(context.platform.toLowerCase())) {
      reasons.push(`Requires platform ${requirement.platforms.join(" or ")}; current platform is ${context.platform}`)
    }
  }
  if (requirement.architectures?.length && context.architecture) {
    if (!normalizedSet(requirement.architectures).has(context.architecture.toLowerCase())) {
      reasons.push(
        `Requires architecture ${requirement.architectures.join(" or ")}; current architecture is ${context.architecture}`,
      )
    }
  }
  const runtimes = normalizedSet(context.runtimes)
  for (const runtime of requirement.runtimes ?? []) {
    if (!runtimes.has(runtime.toLowerCase())) reasons.push(`Requires runtime ${runtime}`)
  }
  const capabilities = normalizedSet(context.capabilities)
  for (const capability of requirement.capabilities ?? []) {
    if (!capabilities.has(capability.toLowerCase())) reasons.push(`Requires capability ${capability}`)
  }
  return { compatible: reasons.length === 0, reasons }
}
