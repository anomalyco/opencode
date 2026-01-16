import z from "zod"
import { iife } from "@/util/iife"
import { Config } from "../config/config"
import { ModelsDev } from "./models"
import { Provider } from "./provider"

export namespace ProviderModelDetection {
  function mergeModel(
    detectedModel: Partial<Provider.Model> | undefined,
    providerModel: Provider.Model | undefined,
    providerID: string,
    providerBaseURL: string,
    modelID: string,
  ): Provider.Model {
    return {
      id: detectedModel?.id ?? providerModel?.id ?? modelID,
      providerID: detectedModel?.providerID ?? providerModel?.providerID ?? providerID,
      api: {
        id: modelID,
        url: detectedModel?.api?.url ?? providerModel?.api?.url ?? providerBaseURL,
        npm: detectedModel?.api?.npm ?? providerModel?.api?.npm ?? "@ai-sdk/openai-compatible",
      },
      name: detectedModel?.name ?? providerModel?.name ?? modelID,
      family: detectedModel?.family ?? providerModel?.family ?? "",
      capabilities: {
        temperature: detectedModel?.capabilities?.temperature ?? providerModel?.capabilities?.temperature ?? false,
        reasoning: detectedModel?.capabilities?.reasoning ?? providerModel?.capabilities?.reasoning ?? false,
        attachment: detectedModel?.capabilities?.attachment ?? providerModel?.capabilities?.attachment ?? false,
        toolcall: detectedModel?.capabilities?.toolcall ?? providerModel?.capabilities?.toolcall ?? true,
        input: {
          text: detectedModel?.capabilities?.input?.text ?? providerModel?.capabilities?.input?.text ?? true,
          audio: detectedModel?.capabilities?.input?.audio ?? providerModel?.capabilities?.input?.audio ?? false,
          image: detectedModel?.capabilities?.input?.image ?? providerModel?.capabilities?.input?.image ?? false,
          video: detectedModel?.capabilities?.input?.video ?? providerModel?.capabilities?.input?.video ?? false,
          pdf: detectedModel?.capabilities?.input?.pdf ?? providerModel?.capabilities?.input?.pdf ?? false,
        },
        output: {
          text: detectedModel?.capabilities?.output?.text ?? providerModel?.capabilities?.output?.text ?? true,
          audio: detectedModel?.capabilities?.output?.audio ?? providerModel?.capabilities?.output?.audio ?? false,
          image: detectedModel?.capabilities?.output?.image ?? providerModel?.capabilities?.output?.image ?? false,
          video: detectedModel?.capabilities?.output?.video ?? providerModel?.capabilities?.output?.video ?? false,
          pdf: detectedModel?.capabilities?.output?.pdf ?? providerModel?.capabilities?.output?.pdf ?? false,
        },
        interleaved: detectedModel?.capabilities?.interleaved ?? providerModel?.capabilities?.interleaved ?? false,
      },
      cost: {
        input: detectedModel?.cost?.input ?? providerModel?.cost?.input ?? 0,
        output: detectedModel?.cost?.output ?? providerModel?.cost?.output ?? 0,
        cache: {
          read: detectedModel?.cost?.cache?.read ?? providerModel?.cost?.cache?.read ?? 0,
          write: detectedModel?.cost?.cache?.write ?? providerModel?.cost?.cache?.write ?? 0,
        },
      },
      limit: {
        context: detectedModel?.limit?.context ?? providerModel?.limit?.context ?? 0,
        output: detectedModel?.limit?.output ?? providerModel?.limit?.output ?? 0,
      },
      status: detectedModel?.status ?? providerModel?.status ?? "active",
      options: detectedModel?.options ?? providerModel?.options ?? {},
      headers: detectedModel?.headers ?? providerModel?.headers ?? {},
      release_date: detectedModel?.release_date ?? providerModel?.release_date ?? "",
      variants: detectedModel?.variants ?? providerModel?.variants ?? {},
    }
  }

  export async function populateModels(
    provider: Provider.Info,
    configProvider?: Config.Provider,
    modelsDevProvider?: ModelsDev.Provider,
  ): Promise<void> {
    const providerNPM = configProvider?.npm ?? modelsDevProvider?.npm ?? "@ai-sdk/openai-compatible"
    const providerBaseURL = configProvider?.options?.baseURL ?? configProvider?.api ?? modelsDevProvider?.api

    const detectedModels = await iife(async () => {
      if (providerNPM === "@ai-sdk/openai-compatible" && providerBaseURL) {
        return await ProviderModelDetection.OpenAICompatible.listModels(providerBaseURL, provider)
      }
    })
    if (!detectedModels) return

    // Models detected from provider and config are kept
    const modelIDs = Array.from(new Set([
      ...Object.keys(detectedModels),
      ...Object.keys(configProvider?.models ?? {}),
    ]))
    // Use detected metadata -> config metadata (-> Models.dev metadata)
    provider.models = Object.fromEntries(modelIDs.map((modelID) => [
      modelID,
      mergeModel(
        detectedModels[modelID],
        provider.models[modelID],
        provider.id,
        providerBaseURL!,
        modelID,
      ),
    ]))
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

  export async function listModels(baseURL: string, provider: Provider.Info): Promise<Record<string, Partial<Provider.Model>>> {
    const fetchFn = provider.options["fetch"] ?? fetch
    const apiKey = provider.options["apiKey"] ?? provider.key ?? ""
    const headers = new Headers()
    if (apiKey) headers.append("Authorization", `Bearer ${apiKey}`)

    const res = await fetchFn(`${baseURL}/models`, {
      headers,
      signal: AbortSignal.timeout(3 * 1000),
    })
    if (!res.ok) throw new Error(`bad http status ${res.status}`)
    const parsed = OpenAICompatibleResponse.parse(await res.json())

    return Object.fromEntries(
      parsed.data
        .filter((model) => model.id && !model.id.includes("embedding") && !model.id.includes("embed"))
        .map((model) => [
          model.id,
          {
            id: model.id,
            providerID: provider.id,
            api: {
              id: model.id,
              url: baseURL,
              npm: "@ai-sdk/openai-compatible",
            },
            name: model.id,
          },
        ])
    )
  }
}
