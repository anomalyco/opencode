/** A chat model that may be running on this machine. */
export type LocalChatModel = {
  readonly providerID: string
  readonly modelID: string
  readonly baseURL?: string
  readonly apiKey?: string
  /** A URL on this machine that frees the model. Used when the server is not Ollama or LM Studio. */
  readonly unload?: string
}

export type UnloadRequest = {
  readonly url: string
  readonly method: "POST"
  readonly headers: Readonly<Record<string, string>>
  readonly body: string
}

const defaultBaseURL = {
  ollama: "http://127.0.0.1:11434/v1",
  lmstudio: "http://127.0.0.1:1234/v1",
} as const

/**
 * The request that frees the model this chat is using.
 * A cloud model returns nothing, so /clear and /exit leave it alone.
 */
export function unloadRequest(model: LocalChatModel): UnloadRequest | undefined {
  const custom = customUnload(model)
  if (custom) return custom
  // Only these two names have a known unload call. A matching port is not enough:
  // another server on that port would receive the request and the API key.
  if (model.providerID === "ollama") return ollama(model)
  if (model.providerID === "lmstudio") return lmstudio(model)
  return
}

/** Asks the local server to drop the model. A missing server or a cloud model does not throw. */
export async function unloadLocalModel(model: LocalChatModel, fetchImpl: typeof fetch = fetch) {
  const request = unloadRequest(model)
  if (!request) return false
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 3_000)
  const response = await fetchImpl(request.url, {
    method: request.method,
    headers: request.headers,
    body: request.body,
    signal: controller.signal,
  }).catch(() => undefined)
  clearTimeout(timer)
  return response !== undefined
}

function customUnload(model: LocalChatModel): UnloadRequest | undefined {
  const url = httpUrl(model.unload)
  if (!url) return
  const base = httpUrl(model.baseURL)
  // The URL is one the user set. It has to be this machine, or the same host as the model server.
  if (!loopback(url.hostname) && url.hostname !== base?.hostname) return
  return post(url, {}, model.apiKey)
}

function ollama(model: LocalChatModel): UnloadRequest | undefined {
  const root = httpUrl(model.baseURL ?? defaultBaseURL.ollama)?.origin
  if (!root) return
  // keep_alive 0 is Ollama's unload. It does not generate a reply.
  return post(new URL("/api/generate", root), { model: model.modelID, keep_alive: 0 }, model.apiKey)
}

function lmstudio(model: LocalChatModel): UnloadRequest | undefined {
  const root = httpUrl(model.baseURL ?? defaultBaseURL.lmstudio)?.origin
  if (!root) return
  // LM Studio's default instance id is the model key.
  return post(new URL("/api/v1/models/unload", root), { instance_id: model.modelID }, model.apiKey)
}

function post(url: URL, body: Record<string, unknown>, apiKey: string | undefined): UnloadRequest {
  return {
    url: url.toString(),
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify(body),
  }
}

function httpUrl(value: string | undefined) {
  if (!value || !URL.canParse(value)) return
  const url = new URL(value)
  if (url.protocol !== "http:" && url.protocol !== "https:") return
  return url
}

function loopback(hostname: string) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1"
}
