type IntegrationLike = { connections?: readonly unknown[] }
type ProviderLike = { id: string }
type ModelLike = { providerID: string }

interface ConnectedInput {
  integrations?: readonly IntegrationLike[]
  providers?: readonly ProviderLike[]
  models?: readonly ModelLike[]
}

function integrationConnected(integration: IntegrationLike): boolean {
  return (integration.connections?.length ?? 0) > 0
}

export function hasConnectedProvider(
  input: readonly IntegrationLike[] | ConnectedInput = [],
  providersArg?: readonly ProviderLike[],
  modelsArg?: readonly ModelLike[],
): boolean {
  let integrations: readonly IntegrationLike[] = []
  let providers: readonly ProviderLike[] | undefined
  let models: readonly ModelLike[] | undefined

  if (Array.isArray(input)) {
    integrations = input
    providers = providersArg
    models = modelsArg
  } else {
    const obj = input as ConnectedInput
    integrations = obj.integrations ?? []
    providers = obj.providers ?? providersArg
    models = obj.models ?? modelsArg
  }

  if (integrations.some(integrationConnected)) return true

  if (!providers || !models) return false

  const modelCounts = new Map<string, number>()
  for (const model of models) {
    modelCounts.set(model.providerID, (modelCounts.get(model.providerID) ?? 0) + 1)
  }

  return providers.some(
    (provider) => provider.id !== "opencode" && (modelCounts.get(provider.id) ?? 0) > 0,
  )
}