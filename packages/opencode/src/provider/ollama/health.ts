import { Log } from "../../util/log"

const log = Log.create({ service: "ollama-health" })

export async function checkOllamaConnection(baseURL: string): Promise<boolean> {
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 5000)

    const response = await fetch(`${baseURL}/models`, {
      signal: controller.signal
    })

    clearTimeout(timeout)

    if (response.ok) {
      const data = await response.json()
      log.debug("Ollama connection successful", {
        modelCount: data.data?.length ?? 0
      })
      return true
    }

    log.warn("Ollama returned error", {
      status: response.status
    })
    return false
  } catch (err) {
    log.debug("Ollama connection failed", {
      error: err instanceof Error ? err.message : String(err)
    })
    return false
  }
}
