import { Resource, waitUntil } from "@opencode-ai/console-resource"

export function createDataDumper(sessionId: string, requestId: string, projectId: string) {
  if (Resource.App.stage !== "production") return
  if (sessionId === "") return

  let data: Record<string, any> = { sessionId, requestId, projectId }
  let metadata: Record<string, any> = { sessionId, requestId, projectId }

  return {
    provideModel: (model?: string) => {
      data.modelName = model
      metadata.modelName = model
    },
    provideRequest: (request: string) => (data.request = request),
    provideResponse: (response: string) => (data.response = response),
    provideStream: (chunk: string) => (data.response = (data.response ?? "") + chunk),
    flush: () => {
      if (!data.modelName) return

      const timestamp = new Date().toISOString().replace(/[^0-9]/g, "")

      waitUntil(
        Resource.ZenData.put(
          `data/${data.modelName}/${sessionId}/${requestId}.json`,
          JSON.stringify({ timestamp, ...data }),
        ),
      )

      waitUntil(
        Resource.ZenData.put(
          `meta/${data.modelName}/${timestamp}/${requestId}.json`,
          JSON.stringify({ timestamp, ...metadata }),
        ),
      )
    },
  }
}
