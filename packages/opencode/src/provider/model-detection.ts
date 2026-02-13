import z from "zod"
import { iife } from "@/util/iife"
import { Log } from "@/util/log"
import { OAUTH_DUMMY_KEY } from "@/auth"
import { Provider } from "./provider"
import { LocalProvider, type LocalModel } from "./local"
import { ModelsDev } from "./models"

export namespace ProviderModelDetection {
  const log = Log.create({ service: "provider.model-detection" })

  export async function detect(provider: Provider.Info): Promise<string[] | Provider.Model[] | undefined> {
    const modelsDev = await ModelsDev.get()
    delete modelsDev["lmstudio"] // LMStudio is not a cloud provider

    // provider.models.length can be 0 for local providers that rely on detection only
    const model = Object.values(provider.models).at(0)
    const providerNPM = model?.api?.npm ?? "@ai-sdk/openai-compatible"
    const providerBaseURL = provider.options["baseURL"] ?? model?.api?.url ?? ""

    log.debug("starting model detection", { providerID: provider.id, providerNPM, providerBaseURL })

    // Skip local detection for known cloud providers
    const localProvider = provider.id in modelsDev ? null : await LocalProvider.detect_provider(providerBaseURL)

    const detectedModels = await iife(async () => {
      try {
        if (localProvider !== null) {
          log.info("using local provider method", { providerID: provider.id, localProvider })
          const localModels = await LocalProvider.probe_provider(localProvider, providerBaseURL)
          return expandLocalModels(provider, localModels)
        }

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
    data: z.array(
      z.object({
        id: z.string(),
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

function expandLocalModels(provider: Provider.Info, localModels: LocalModel[]): Provider.Model[] {
  return localModels.map((localModel) => {
    return {
      id: localModel.id,
      providerID: provider.id,
      name: localModel.id,
      status: "active",
      api: {
        id: localModel.id,
        npm: provider.options["npm"] ?? "@ai-sdk/openai-compatible",
        url: provider.options["baseURL"] ?? "",
      },
      limit: {
        context: localModel.context_length,
        // TODO: can we drop this field?
        // properly detect the value?
        output: 16 * 1024,
      },
      capabilities: {
        temperature: true,
        toolcall: localModel.tool_call,
        input: {
          text: true,
          image: localModel.vision,
        },
        output: {
          text: true,
        },
      },
    } as Provider.Model
  })
}
