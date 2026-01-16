import { Config } from "@/config/config"
import { Provider } from "@/provider/provider"
import { Log } from "@/util/log"

export namespace SessionFallback {
  const log = Log.create({ service: "session.fallback" })

  interface FallbackResult {
    model: Provider.Model
    isProviderLevel: boolean
  }

  export async function getFallback(
    providerID: string,
    modelID: string,
    attempted: Set<string>,
  ): Promise<FallbackResult | null> {
    const config = await Config.get()
    const fallbacks = config.fallbacks

    if (!fallbacks) {
      return null
    }

    // Check model-specific fallbacks first (higher priority)
    const modelKey = `${providerID}/${modelID}`
    if (fallbacks.models) {
      const modelFallbacks = fallbacks.models[modelKey]
      if (modelFallbacks && modelFallbacks.length > 0) {
        for (const fallback of modelFallbacks) {
          const attemptKey = `model:${fallback}`
          if (attempted.has(attemptKey)) {
            continue
          }

          try {
            const [fallbackProvider, fallbackModel] = fallback.split("/")
            if (!fallbackProvider || !fallbackModel) {
              log.warn("invalid fallback model format", { fallback })
              continue
            }

            const nextModel = await Provider.getModel(fallbackProvider, fallbackModel)
            log.info("using model-specific fallback", {
              from: modelKey,
              to: nextModel.id,
              provider: nextModel.providerID,
            })
            return { model: nextModel, isProviderLevel: false }
          } catch (loadError) {
            log.error("failed to load model-specific fallback", {
              error: loadError,
              fallback,
              from: modelKey,
            })
            attempted.add(attemptKey)
          }
        }
      }
    }

    // Check provider-level fallbacks
    if (fallbacks.provider) {
      const providerFallbacks = fallbacks.provider[providerID]
      if (providerFallbacks && providerFallbacks.length > 0) {
        for (const fallbackProvider of providerFallbacks) {
          const attemptKey = `provider:${fallbackProvider}`
          if (attempted.has(attemptKey)) {
            continue
          }

          try {
            // For provider fallbacks, use the provider's first available model
            const providers = await Provider.list()
            const fallbackProviderInfo = providers[fallbackProvider]
            if (!fallbackProviderInfo) {
              log.warn("fallback provider not found", { provider: fallbackProvider })
              attempted.add(attemptKey)
              continue
            }

            const models = Object.values(fallbackProviderInfo.models)
            if (models.length === 0) {
              log.warn("fallback provider has no models", { provider: fallbackProvider })
              attempted.add(attemptKey)
              continue
            }

            const nextModel = models[0]
            log.info("using provider-level fallback", {
              fromProvider: providerID,
              toProvider: fallbackProvider,
              toModel: nextModel.id,
            })
            return { model: nextModel, isProviderLevel: true }
          } catch (loadError) {
            log.error("failed to load provider fallback", {
              error: loadError,
              provider: fallbackProvider,
              fromProvider: providerID,
            })
            attempted.add(attemptKey)
          }
        }
      }
    }

    return null
  }
}
