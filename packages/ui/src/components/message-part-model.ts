import type { Provider } from "@opencode-ai/sdk/v2"

export function formatModelLabel(
  providerID: string | undefined,
  modelID: string | undefined,
  provider: Provider | undefined,
): string {
  if (!providerID || !modelID) return ""
  const providerLabel = provider?.name ?? providerID
  const modelLabel = provider?.models?.[modelID]?.name ?? modelID
  return `${providerLabel}/${modelLabel}`
}
