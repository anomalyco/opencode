import type { OpenRouterConfig } from "./config"
import type { ProviderInfo, ProviderModel } from "./types"

const OPENROUTER_FREE_ROUTER_ID = "openrouter/free"

export function isOpenRouterFreeModelId(modelID: string) {
  return modelID === OPENROUTER_FREE_ROUTER_ID || modelID.endsWith(":free")
}

export function isOpenRouterFreeModel(model: ProviderModel) {
  return model.providerID === "openrouter" && isOpenRouterFreeModelId(model.id)
}

function zeroCost(cost: ProviderModel["cost"]): ProviderModel["cost"] {
  return {
    input: 0,
    output: 0,
    cache: {
      read: 0,
      write: 0,
    },
    experimentalOver200K: cost.experimentalOver200K
      ? {
          input: 0,
          output: 0,
          cache: {
            read: 0,
            write: 0,
          },
        }
      : undefined,
  }
}

function intersectOpenRouterCapabilities(models: ProviderModel[]): ProviderModel["capabilities"] {
  const input = {
    text: models.every((m) => m.capabilities.input.text),
    audio: models.every((m) => m.capabilities.input.audio),
    image: models.every((m) => m.capabilities.input.image),
    video: models.every((m) => m.capabilities.input.video),
    pdf: models.every((m) => m.capabilities.input.pdf),
  }
  const output = {
    text: models.every((m) => m.capabilities.output.text),
    audio: models.every((m) => m.capabilities.output.audio),
    image: models.every((m) => m.capabilities.output.image),
    video: models.every((m) => m.capabilities.output.video),
    pdf: models.every((m) => m.capabilities.output.pdf),
  }

  if (!Object.values(input).some(Boolean)) {
    input.text = true
  }
  if (!Object.values(output).some(Boolean)) {
    output.text = true
  }

  let interleavedField: "reasoning_content" | "reasoning_details" | undefined
  let interleavedAll = true
  for (const model of models) {
    const interleaved = model.capabilities.interleaved
    if (!interleaved) {
      interleavedAll = false
      break
    }
    if (typeof interleaved === "object") {
      if (!interleavedField) {
        interleavedField = interleaved.field
      } else if (interleavedField !== interleaved.field) {
        interleavedAll = false
        break
      }
    }
  }

  return {
    temperature: models.every((m) => m.capabilities.temperature),
    reasoning: models.every((m) => m.capabilities.reasoning),
    attachment: models.every((m) => m.capabilities.attachment),
    toolcall: models.every((m) => m.capabilities.toolcall),
    input,
    output,
    interleaved: interleavedAll ? (interleavedField ? { field: interleavedField } : true) : false,
  }
}

function minLimitValue(values: Array<number | undefined>) {
  const candidates = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value))
  if (candidates.length === 0) return undefined
  return Math.min(...candidates)
}

function inferOpenRouterFreeModel(provider: ProviderInfo): ProviderModel | undefined {
  const baseModels = Object.values(provider.models).filter((model) => !isOpenRouterFreeModelId(model.id))
  if (baseModels.length === 0) return undefined

  const reference = baseModels[0]
  const minContext = Math.min(...baseModels.map((model) => model.limit.context))
  const minOutput = Math.min(...baseModels.map((model) => model.limit.output))
  const minInput = minLimitValue(baseModels.map((model) => model.limit.input))
  const releaseDates = baseModels.map((model) => model.release_date).filter(Boolean).sort()
  const releaseDate = releaseDates[0] ?? "1970-01-01"

  return {
    id: OPENROUTER_FREE_ROUTER_ID,
    providerID: "openrouter",
    name: "OpenRouter Free",
    family: "openrouter-free",
    api: {
      ...reference.api,
      id: OPENROUTER_FREE_ROUTER_ID,
    },
    status: "active",
    headers: { ...reference.headers },
    options: { ...reference.options },
    cost: zeroCost(reference.cost),
    limit: {
      context: minContext,
      output: minOutput,
      ...(minInput !== undefined ? { input: minInput } : {}),
    },
    capabilities: intersectOpenRouterCapabilities(baseModels),
    release_date: releaseDate,
    variants: {},
  }
}

export function augmentOpenRouterModels(provider: ProviderInfo, openrouterConfig?: OpenRouterConfig) {
  const freeRouterEnabled = !!openrouterConfig?.freeRouter
  const freeVariantsEnabled = !!openrouterConfig?.freeVariants

  if (!freeRouterEnabled) {
    delete provider.models[OPENROUTER_FREE_ROUTER_ID]
  }

  if (!freeVariantsEnabled) {
    for (const modelID of Object.keys(provider.models)) {
      if (modelID.endsWith(":free")) {
        delete provider.models[modelID]
      }
    }
  }

  const baseModels = Object.values(provider.models).filter((model) => !isOpenRouterFreeModelId(model.id))
  if (freeRouterEnabled && !provider.models[OPENROUTER_FREE_ROUTER_ID]) {
    const synthetic = inferOpenRouterFreeModel(provider)
    if (synthetic) {
      provider.models[OPENROUTER_FREE_ROUTER_ID] = synthetic
    }
  }

  if (freeVariantsEnabled) {
    for (const model of baseModels) {
      const freeId = `${model.id}:free`
      if (provider.models[freeId]) continue
      provider.models[freeId] = {
        ...model,
        id: freeId,
        name: `${model.name} (free)`,
        api: {
          ...model.api,
          id: freeId,
        },
        cost: zeroCost(model.cost),
      }
    }
  }
}

export function getOpenRouterPreferredModels(provider: ProviderInfo): ProviderModel[] | undefined {
  if (provider.id !== "openrouter") return undefined
  const models = Object.values(provider.models)
  const freeModels = models.filter((model) => isOpenRouterFreeModel(model))
  if (freeModels.length === 0) return undefined
  return freeModels
}
