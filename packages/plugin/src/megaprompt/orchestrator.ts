import type { ModelResponse } from "./evaluator"

export type ModelConfig = {
  providerID: string
  modelID: string
}

export type OrchestrationInput = {
  prompt: string
  models: ModelConfig[]
  generate: (model: ModelConfig, prompt: string) => Promise<string>
  timeout?: number
}

export async function orchestrate(input: OrchestrationInput): Promise<ModelResponse[]> {
  const timeout = input.timeout ?? 120000 // 2 minutes default

  const promises = input.models.map(async (model): Promise<ModelResponse> => {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), timeout)

    try {
      const text = await Promise.race([
        input.generate(model, input.prompt),
        new Promise<never>((_, reject) => {
          controller.signal.addEventListener("abort", () => reject(new Error("Request timed out")))
        }),
      ])

      return {
        modelID: model.modelID,
        providerID: model.providerID,
        text,
        success: true,
      }
    } catch (error) {
      return {
        modelID: model.modelID,
        providerID: model.providerID,
        text: "",
        success: false,
        error: error instanceof Error ? error.message : String(error),
      }
    } finally {
      clearTimeout(timeoutId)
    }
  })

  const results = await Promise.allSettled(promises)

  return results.map((result, i) => {
    if (result.status === "fulfilled") {
      return result.value
    }
    return {
      modelID: input.models[i].modelID,
      providerID: input.models[i].providerID,
      text: "",
      success: false,
      error: result.reason instanceof Error ? result.reason.message : String(result.reason),
    }
  })
}

export function filterSuccessfulResponses(responses: ModelResponse[]): ModelResponse[] {
  return responses.filter((r) => r.success)
}

export function formatFailures(responses: ModelResponse[]): string {
  const failures = responses.filter((r) => !r.success)
  if (failures.length === 0) return ""

  return (
    "\n\n---\n**Note:** The following models failed to respond:\n" +
    failures.map((f) => `- ${f.providerID}/${f.modelID}: ${f.error}`).join("\n")
  )
}
