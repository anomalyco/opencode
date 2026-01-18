import { Log } from "../util/log"
import { Provider } from "./provider"

export namespace OpenAICompact {
  const log = Log.create({ service: "openai.compact" })

  function withoutTrailingSlash(url: string) {
    return url.endsWith("/") ? url.slice(0, -1) : url
  }

  function extractResponseId(payload: unknown): string | undefined {
    if (!payload || typeof payload !== "object") return undefined
    const obj: any = payload
    const direct = obj.id ?? obj.response_id ?? obj.responseId
    if (typeof direct === "string" && direct.length > 0) return direct
    const nested = obj.response?.id ?? obj.response?.response_id
    if (typeof nested === "string" && nested.length > 0) return nested
    return undefined
  }

  async function postJSON(fetchFn: typeof fetch, url: string, body: any, headers: Headers, abort?: AbortSignal) {
    const res = await fetchFn(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: abort,
    })
    const text = await res.text().catch(() => "")
    return { res, text }
  }

  export async function compact(input: { model: Provider.Model; responseId: string; abort?: AbortSignal }) {
    const provider = await Provider.getProvider(input.model.providerID)
    const fetchFn: typeof fetch = provider.options?.fetch ?? fetch
    const baseURL = withoutTrailingSlash(provider.options?.baseURL ?? input.model.api.url ?? "https://api.openai.com/v1")

    const headers = new Headers(provider.options?.headers ?? {})
    if (!headers.has("content-type")) headers.set("content-type", "application/json")
    if (!headers.has("authorization")) {
      const apiKey = provider.options?.apiKey ?? provider.key
      if (apiKey) headers.set("authorization", `Bearer ${apiKey}`)
    }

    const url1 = `${baseURL}/responses/${input.responseId}/compact`
    const attempt1 = await postJSON(fetchFn, url1, {}, headers, input.abort)
    if (attempt1.res.ok) {
      try {
        const json = JSON.parse(attempt1.text)
        return extractResponseId(json) ?? input.responseId
      } catch {
        return input.responseId
      }
    }

    const url2 = `${baseURL}/responses/compact`
    const attempt2 = await postJSON(fetchFn, url2, { response_id: input.responseId }, headers, input.abort)
    if (attempt2.res.ok) {
      try {
        const json = JSON.parse(attempt2.text)
        return extractResponseId(json) ?? input.responseId
      } catch {
        return input.responseId
      }
    }

    log.error("compact failed", {
      status1: attempt1.res.status,
      body1: attempt1.text.slice(0, 500),
      status2: attempt2.res.status,
      body2: attempt2.text.slice(0, 500),
    })
    return input.responseId
  }
}

