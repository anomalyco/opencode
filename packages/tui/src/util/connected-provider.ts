import type { IntegrationInfo, ModelInfo, ProviderInfo } from "@opencode/client"

// Any stored or detected connection, or a listed provider with models beyond the keyless OpenCode catalog, such as
// one declared only in config. Matches `anyConnection` in packages/app/src/providers/catalog/providers.ts.
export function hasConnectedProvider(input: {
  integrations: readonly Pick<IntegrationInfo, "connections">[]
  providers: readonly Pick<ProviderInfo, "id">[]
  models: readonly Pick<ModelInfo, "providerID" | "status">[]
}) {
  if (input.integrations.some((integration) => integration.connections.length > 0)) return true
  const providers = new Set(input.providers.map((provider) => provider.id))
  return input.models.some(
    (model) => model.providerID !== "opencode" && model.status !== "deprecated" && providers.has(model.providerID),
  )
}
