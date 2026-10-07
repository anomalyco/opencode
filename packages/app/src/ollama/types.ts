export type OllamaConnection = { baseURL: string; headers?: Record<string, string>; voiceProviderID?: string }
export type OllamaError =
  | "configuration"
  | "network"
  | "authentication"
  | "response"
  | "cancelled"
  | "busy"
  | "exists"
  | "context"
export type OllamaResult<T> = { ok: true; value: T } | { ok: false; error: OllamaError }
export type OllamaModel = { name: string; size: number; digest: string; family: string; quantization: string }
export type OllamaDetails = {
  context?: number
  maxContext?: number
  capabilities: string[]
  family: string
  quantization: string
}
export type OllamaMutation =
  | { action: "pull"; model: string }
  | { action: "copy"; source: string; model: string }
  | { action: "create"; source: string; model: string; context: number }
  // Only this operation updates an installed tag; copy/create still require a new destination.
  | { action: "context"; model: string; context: number }
  | { action: "delete"; model: string }
export type OllamaProgress = { id: string; completed: number; total: number; stage: "download" | "prepare" }
export type OllamaPlatform = {
  list(connection: OllamaConnection): Promise<OllamaResult<OllamaModel[]>>
  show(connection: OllamaConnection, model: string): Promise<OllamaResult<OllamaDetails>>
  mutate(connection: OllamaConnection, mutation: OllamaMutation, id: string): Promise<OllamaResult<void>>
  cancel(id: string): Promise<void>
  subscribe(callback: (progress: OllamaProgress) => void): () => void
}

export function ollamaURL(baseURL: string) {
  const url = new URL(baseURL)
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash)
    throw new Error("configuration")
  url.pathname = url.pathname.replace(/\/+$/, "").replace(/\/v1$/, "")
  return url.toString().replace(/\/+$/, "")
}

export function validOllamaTag(tag: string) {
  return typeof tag === "string" && tag.length > 0 && tag.length <= 240 && /^[a-zA-Z0-9][a-zA-Z0-9._:/-]*$/.test(tag)
}

export function ollamaTagKey(tag: string) {
  return tag.slice(tag.lastIndexOf("/") + 1).includes(":") ? tag : `${tag}:latest`
}

export function isOllamaRuntimeTag(tag: string) {
  // Ollama's GGUF migration stores a runner manifest under this internal tag.
  // The original model references it; it is not a separate user model to manage or delete.
  return /^llamacpp:[a-f0-9]{64}$/.test(tag)
}

export function ollamaUserModels(models: OllamaModel[]) {
  const seen = new Set<string>()
  return models.filter((model) => {
    if (isOllamaRuntimeTag(model.name)) return false
    // Multi-runner manifests can appear more than once under the same public tag.
    const key = ollamaTagKey(model.name)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
