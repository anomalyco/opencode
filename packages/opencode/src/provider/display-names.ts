/**
 * Display name overrides for providers.
 * Used to show user-friendly names instead of provider IDs.
 */
export const PROVIDER_DISPLAY_NAMES: Record<string, string> = {
  "google-vertex": "Google Vertex AI",
  "google-vertex-anthropic": "Google Vertex AI (Anthropic)",
}

/**
 * Get the display name for a provider, falling back to the provider's name or ID.
 */
export function getProviderDisplayName(provider: { id: string; name?: string }): string {
  return PROVIDER_DISPLAY_NAMES[provider.id] ?? provider.name ?? provider.id
}
