/**
 * Model keys (`providerID:modelID`) explicitly declared in the user's config
 * (`provider.<id>.models`). The user added these on purpose, so they are
 * visible in the model picker by default — regardless of whether they are the
 * latest release of their family. User visibility preferences (show/hide)
 * still take precedence.
 */
export function customModelKeysFromConfig(config: unknown): Set<string> {
  const keys = new Set<string>()
  const cfg = config as { provider?: Record<string, { models?: unknown }> } | null | undefined
  const provider = cfg?.provider
  if (!provider || typeof provider !== "object") return keys
  for (const [providerID, value] of Object.entries(provider)) {
    const models = value?.models
    if (!models || typeof models !== "object") continue
    for (const modelID of Object.keys(models as Record<string, unknown>)) {
      keys.add(`${providerID}:${modelID}`)
    }
  }
  return keys
}
