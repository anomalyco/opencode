import { z } from "zod"
import { getKiloUrlFromToken } from "../auth/token.js"
import { DEFAULT_HEADERS } from "../headers.js"
import { KILO_API_BASE, KILO_OPENROUTER_BASE, MODELS_FETCH_TIMEOUT_MS } from "./constants.js"

/**
 * OpenRouter model schema
 */
const openRouterArchitectureSchema = z.object({
  input_modalities: z.array(z.string()).nullish(),
  output_modalities: z.array(z.string()).nullish(),
  tokenizer: z.string().nullish(),
})

const openRouterPricingSchema = z.object({
  prompt: z.string().nullish(),
  completion: z.string().nullish(),
  input_cache_write: z.string().nullish(),
  input_cache_read: z.string().nullish(),
})

const openRouterModelSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  context_length: z.number(),
  max_completion_tokens: z.number().nullish(),
  pricing: openRouterPricingSchema.optional(),
  architecture: openRouterArchitectureSchema.optional(),
  top_provider: z.object({ max_completion_tokens: z.number().nullish() }).optional(),
  supported_parameters: z.array(z.string()).optional(),
})

const openRouterModelsResponseSchema = z.object({
  data: z.array(openRouterModelSchema),
})

type OpenRouterModel = z.infer<typeof openRouterModelSchema>

/**
 * Parse API price string to number (e.g. "0.00001" -> 0.00001)
 */
function parseApiPrice(price: string | null | undefined): number | undefined {
  if (!price) return undefined
  const parsed = parseFloat(price)
  return isNaN(parsed) ? undefined : parsed
}

/**
 * Fetch models from Kilo API (OpenRouter-compatible endpoint)
 *
 * @param options - Configuration options
 * @returns Record of models in ModelsDev.Model format
 */
export async function fetchKiloModels(options?: {
  kilocodeToken?: string
  kilocodeOrganizationId?: string
  baseURL?: string
}): Promise<Record<string, any>> {
  const token = options?.kilocodeToken
  const organizationId = options?.kilocodeOrganizationId

  // Construct base URL
  const defaultBaseURL = organizationId ? `${KILO_API_BASE}/api/organizations/${organizationId}` : KILO_OPENROUTER_BASE

  const baseURL = options?.baseURL ?? defaultBaseURL

  // Transform URL with token if available
  const finalBaseURL = token ? getKiloUrlFromToken(baseURL, token) : baseURL

  // Construct models endpoint
  const modelsURL = `${finalBaseURL}/models`

  try {
    // Fetch models with timeout
    const response = await fetch(modelsURL, {
      headers: {
        ...DEFAULT_HEADERS,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      signal: AbortSignal.timeout(MODELS_FETCH_TIMEOUT_MS),
    })

    if (!response.ok) {
      throw new Error(`Failed to fetch models: ${response.status} ${response.statusText}`)
    }

    const json = await response.json()

    // Validate response schema
    const result = openRouterModelsResponseSchema.safeParse(json)

    if (!result.success) {
      console.error("Kilo models response validation failed:", result.error.format())
      return {}
    }

    // Transform models to ModelsDev.Model format
    const models: Record<string, any> = {}

    for (const model of result.data.data) {
      // Skip image generation models
      if (model.architecture?.output_modalities?.includes("image")) {
        continue
      }

      const transformedModel = transformToModelDevFormat(model)
      models[model.id] = transformedModel
    }

    return models
  } catch (error) {
    console.error("Error fetching Kilo models:", error)
    return {}
  }
}

/**
 * Transform OpenRouter model to ModelsDev.Model format
 */
function transformToModelDevFormat(model: OpenRouterModel): any {
  const inputModalities = model.architecture?.input_modalities || []
  const outputModalities = model.architecture?.output_modalities || []
  const supportedParameters = model.supported_parameters || []

  // Parse pricing
  const inputPrice = parseApiPrice(model.pricing?.prompt)
  const outputPrice = parseApiPrice(model.pricing?.completion)
  const cacheWritePrice = parseApiPrice(model.pricing?.input_cache_write)
  const cacheReadPrice = parseApiPrice(model.pricing?.input_cache_read)

  // Determine capabilities
  const supportsImages = inputModalities.includes("image")
  const supportsTools = supportedParameters.includes("tools")
  const supportsReasoning = supportedParameters.includes("reasoning")
  const supportsTemperature = supportedParameters.includes("temperature")

  // Calculate max output tokens
  const maxOutputTokens =
    model.top_provider?.max_completion_tokens || model.max_completion_tokens || Math.ceil(model.context_length * 0.2)

  return {
    id: model.id,
    name: model.name,
    family: model.id === "kilo/auto" ? "kilo/auto" : extractFamily(model.id), // kilocode_change
    release_date: new Date().toISOString().split("T")[0], // Default to today
    attachment: supportsImages,
    reasoning: supportsReasoning,
    temperature: supportsTemperature,
    tool_call: supportsTools,
    ...(inputPrice !== undefined &&
      outputPrice !== undefined && {
        cost: {
          input: inputPrice,
          output: outputPrice,
          ...(cacheReadPrice !== undefined && { cache_read: cacheReadPrice }),
          ...(cacheWritePrice !== undefined && { cache_write: cacheWritePrice }),
        },
      }),
    limit: {
      context: model.context_length,
      output: maxOutputTokens,
    },
    ...((inputModalities.length > 0 || outputModalities.length > 0) && {
      modalities: {
        input: mapModalities(inputModalities),
        output: mapModalities(outputModalities),
      },
    }),
    options: {
      ...(model.description && { description: model.description }),
    },
  }
}

/**
 * Extract family name from model ID
 * e.g., "anthropic/claude-3-opus" -> "claude"
 */
function extractFamily(modelId: string): string | undefined {
  const parts = modelId.split("/")
  if (parts.length < 2) return undefined

  const modelName = parts[1]

  // Try to extract family from common patterns
  if (modelName.includes("claude")) return "claude"
  if (modelName.includes("gpt")) return "gpt"
  if (modelName.includes("gemini")) return "gemini"
  if (modelName.includes("llama")) return "llama"
  if (modelName.includes("mistral")) return "mistral"

  return undefined
}

/**
 * Map OpenRouter modalities to ModelsDev modalities
 */
function mapModalities(modalities: string[]): Array<"text" | "audio" | "image" | "video" | "pdf"> {
  const result: Array<"text" | "audio" | "image" | "video" | "pdf"> = []

  for (const modality of modalities) {
    if (modality === "text") result.push("text")
    if (modality === "image") result.push("image")
    if (modality === "audio") result.push("audio")
    if (modality === "video") result.push("video")
    if (modality === "pdf") result.push("pdf")
  }

  // Always include text if not present
  if (!result.includes("text")) {
    result.unshift("text")
  }

  return result
}
