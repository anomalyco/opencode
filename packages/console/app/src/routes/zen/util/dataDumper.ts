import { Resource, waitUntil } from "@opencode-ai/console-resource"

export function createDataDumper(sessionId: string, requestId: string) {
  if (Resource.App.stage !== "production") return

  let data: Record<string, any> = {}
  let modelName: string | undefined

  return {
    provideModel: (model?: string) => (modelName = model),
    provideRequest: (request: string) => (data.request = request),
    provideResponse: (response: string) => (data.response = response),
    provideStream: (chunk: string) => (data.response = (data.response ?? "") + chunk),
    flush: () => {
      if (!modelName) return

      const str = new Date().toISOString().replace(/[^0-9]/g, "")
      const yyyymmdd = str.substring(0, 8)
      const hh = str.substring(8, 10)

      waitUntil(
        Resource.ConsoleData.put(`${yyyymmdd}/${hh}/${modelName}/${sessionId}/${requestId}.json`, JSON.stringify(data)),
      )
    },
  }
}
