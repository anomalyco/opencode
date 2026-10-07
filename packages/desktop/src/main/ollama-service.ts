import { listOllama, showOllama, mutateOllama } from "@opencode-ai/app/ollama/transport"
import {
  ollamaURL,
  type OllamaConnection,
  type OllamaMutation,
  type OllamaProgress,
  type OllamaResult,
} from "@opencode-ai/app/ollama/types"

export function createOllamaService(
  emit: (owner: string, progress: OllamaProgress) => void,
  resolveVoice: (id: string) => OllamaConnection | undefined,
) {
  const jobs = new Map<string, AbortController>()
  const valid = (connection: OllamaConnection) => {
    try {
      ollamaURL(connection.baseURL)
      return (
        !connection.headers ||
        (typeof connection.headers === "object" &&
          Object.entries(connection.headers).every(
            ([key, value]) => typeof value === "string" && !/[\r\n]/.test(key + value),
          ))
      )
    } catch {
      return false
    }
  }
  const resolve = (connection: OllamaConnection) => {
    if (!connection.voiceProviderID) return connection
    const configured = resolveVoice(connection.voiceProviderID)
    if (!configured || ollamaURL(configured.baseURL) !== ollamaURL(connection.baseURL)) throw new Error("configuration")
    return { ...connection, headers: { ...connection.headers, ...configured.headers } }
  }
  return {
    async list(connection: OllamaConnection) {
      if (!valid(connection)) return { ok: false, error: "configuration" } as const
      try {
        return await listOllama(resolve(connection), AbortSignal.timeout(15000))
      } catch {
        return { ok: false, error: "authentication" } as const
      }
    },
    async show(connection: OllamaConnection, model: string) {
      if (!valid(connection)) return { ok: false, error: "configuration" } as const
      try {
        return await showOllama(resolve(connection), model, AbortSignal.timeout(15000))
      } catch {
        return { ok: false, error: "authentication" } as const
      }
    },
    async mutate(
      connection: OllamaConnection,
      mutation: OllamaMutation,
      id: string,
      owner: string,
    ): Promise<OllamaResult<void>> {
      if (
        !valid(connection) ||
        !mutation ||
        typeof id !== "string" ||
        id.length > 100 ||
        !["pull", "copy", "create", "context", "delete"].includes(mutation.action)
      )
        return { ok: false, error: "configuration" }
      const key = `${owner}:${id}`
      if (jobs.has(key)) return { ok: false, error: "busy" }
      const controller = new AbortController()
      jobs.set(key, controller)
      const timeout = setTimeout(() => controller.abort(), 30 * 60 * 1000)
      try {
        return await mutateOllama({
          connection: resolve(connection),
          mutation,
          id,
          signal: controller.signal,
          progress: (progress) => emit(owner, progress),
        })
      } catch {
        return { ok: false, error: "authentication" }
      } finally {
        clearTimeout(timeout)
        jobs.delete(key)
      }
    },
    cancel(owner: string, id?: string) {
      jobs.forEach((controller, key) => {
        if (id ? key === `${owner}:${id}` : key.startsWith(`${owner}:`)) controller.abort()
      })
    },
    close() {
      jobs.forEach((controller) => controller.abort())
    },
  }
}
