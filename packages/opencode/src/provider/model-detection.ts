import z from "zod"
import { Provider } from "./provider"

export namespace ProviderModelDetection.OpenAICompatible {
  export const ListModelResponse = z.object({
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
  export type ListModelResponse = z.infer<typeof ListModelResponse>

  function filterModelID(modelID: string): boolean {
    return !(modelID.includes("embedding") || modelID.includes("embed"))
  }

  export async function getModelIDs(baseURL: string): Promise<string[]> {
    let res: Response
    let parsedRes: ListModelResponse

    try {
      res = await fetch(`${baseURL}/models`)
    } catch (error) {
      throw new Error(`failed to fetch: ${error}`)
    }
    if (!res.ok) {
      throw new Error(`failed to fetch: http status ${res.status}`)
    }
    try {
      parsedRes = ListModelResponse.parse(await res.json())
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw new Error(`failed to parse response: ${error.message}`)
      }
      throw new Error(`unknown error: ${error}`)
    }

    return parsedRes.data.map((model) => model.id).filter(filterModelID)
  }
}
