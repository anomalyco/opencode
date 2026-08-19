export type UsageScope = "current" | "all"

export function resolveUsageProvider(options: {
  scope: UsageScope
  providerOverride?: string | null
  modelProviderID?: string | null
}): string | null {
  if (options.providerOverride) return options.providerOverride
  if (options.scope !== "current") return null
  const modelProviderID = options.modelProviderID
  if (!modelProviderID) return null
  return modelProviderID.trim().toLowerCase()
}
