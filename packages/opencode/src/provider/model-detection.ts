import z from "zod"
import { iife } from "@/util/iife"
import { Log } from "@/util/log"
import { OAUTH_DUMMY_KEY } from "@/auth"
import { Provider } from "./provider"

export namespace ProviderModelDetection {
  export async function detect(provider: Provider.Info): Promise<string[] | undefined> {
    const log = Log.create({ service: "provider.model-detection" })

    const model = Object.values(provider.models)[0]
    const providerNPM = model?.api?.npm ?? "@ai-sdk/openai-compatible"
    const providerBaseURL = provider.options["baseURL"] ?? model?.api?.url ?? ""

    const detectedModels = await iife(async () => {
      try {
        if (providerNPM === "@ai-sdk/openai-compatible" && providerBaseURL) {
          log.info("using OpenAI-compatible method", { providerID: provider.id })
          return await ProviderModelDetection.OpenAICompatible.listModels(providerBaseURL, provider)
        }
      } catch (error) {
        log.warn(`failed to detect models\n${error}`, { providerID: provider.id })
      }
    })

    if (!detectedModels || detectedModels.length === 0) return

    log.info("detected models", { providerID: provider.id, count: detectedModels.length })
    return detectedModels
  }
}

export namespace ProviderModelDetection.OpenAICompatible {
  const OpenAICompatibleResponse = z.object({
    object: z.string(),
    data: z.array(
      z.object({
        id: z.string(),
        object: z.string().optional(),
        created: z.number().optional(),
        owned_by: z.string().optional(),
      }),
    ),
  })
  type OpenAICompatibleResponse = z.infer<typeof OpenAICompatibleResponse>

  export async function listModels(baseURL: string, provider: Provider.Info): Promise<string[]> {
    const fetchFn = provider.options["fetch"] ?? fetch
    const apiKey = provider.options["apiKey"] ?? provider.key ?? ""
    const headers = new Headers()
    if (apiKey && apiKey !== OAUTH_DUMMY_KEY) headers.append("Authorization", `Bearer ${apiKey}`)

    const res = await fetchFn(`${baseURL}/models`, {
      headers,
      signal: AbortSignal.timeout(3 * 1000),
    })
    if (!res.ok) throw new Error(`bad http status ${res.status}`)
    const parsed = OpenAICompatibleResponse.parse(await res.json())

    return parsed.data
      .filter((model) => model.id && !model.id.includes("embedding") && !model.id.includes("embed"))
      .map((model) => model.id)
  }
}
