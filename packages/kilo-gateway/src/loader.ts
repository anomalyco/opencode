import type { CustomLoaderResult, ProviderInfo } from "./types.js"

export async function kiloCustomLoader(provider: ProviderInfo): Promise<CustomLoaderResult> {
  const hasKey = !!(provider.options?.apiKey || provider.options?.kilocodeToken || provider.key)

  if (!provider.models || Object.keys(provider.models).length === 0) {
    return {
      autoload: false,
      options: hasKey ? {} : { apiKey: "anonymous" },
    }
  }

  if (!hasKey) {
    for (const [key, value] of Object.entries(provider.models)) {
      if (value.cost?.input > 0 || value.cost?.output > 0) {
        delete provider.models[key]
      }
    }
  }

  return {
    autoload: Object.keys(provider.models).length > 0,
    options: hasKey ? {} : { apiKey: "anonymous" },
  }
}
