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
      const year = timestamp.substring(0, 4)
      const month = timestamp.substring(4, 6)
      const day = timestamp.substring(6, 8)
      const hour = timestamp.substring(8, 10)
      const minute = timestamp.substring(10, 12)
      const second = timestamp.substring(12, 14)

      waitUntil(
        Resource.ZenDataNew.put(
          `data/${data.modelName}/${year}/${month}/${day}/${hour}/${minute}/${second}/${requestId}.json`,
          JSON.stringify({ timestamp, ...data }),
        ),
      )

      waitUntil(
        Resource.ZenDataNew.put(
          `meta/${data.modelName}/${sessionId}/${requestId}.json`,
          JSON.stringify({ timestamp, ...metadata }),
        ),
      )
    },
  }
}
