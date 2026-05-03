import * as Log from "@opencode-ai/core/util/log"
import { ConcurrencyCache, type ConcurrencyCacheOptions } from "./concurrency-cache"
import { FeatherlessGate, type FeatherlessGateOptions } from "./gate"
import { wrapResponseWithRelease } from "./stream-release"

const log = Log.create({ service: "featherless.fetch" })

const CHAT_COMPLETIONS_RE = /\/chat\/completions(?:\?|$)/

export interface CreateFeatherlessFetchOptions {
  apiKey: string
  /** Override base fetch (tests). Defaults to `globalThis.fetch`. */
  baseFetch?: typeof fetch
  /** Forward extra options to the cost cache (tests / non-default base URLs). */
  cache?: Partial<Omit<ConcurrencyCacheOptions, "apiKey">>
  /** Forward extra options to the gate (tests / fake feed). */
  gate?: Omit<FeatherlessGateOptions, "apiKey">
}

function readBodyAsText(body: BodyInit | null | undefined): string | undefined {
  if (typeof body === "string") return body
  if (body instanceof Uint8Array) return new TextDecoder().decode(body)
  if (body instanceof ArrayBuffer) return new TextDecoder().decode(new Uint8Array(body))
  return undefined
}

function extractModelID(init: RequestInit | undefined): string | undefined {
  const text = readBodyAsText(init?.body as BodyInit | null | undefined)
  if (!text) return undefined
  try {
    const parsed = JSON.parse(text)
    return typeof parsed?.model === "string" ? parsed.model : undefined
  } catch {
    return undefined
  }
}

/**
 * Build a fetch-compatible function that gates outbound chat-completion
 * calls through a shared FeatherlessGate. Non-chat URLs pass through
 * untouched. Slots release when the response body ends, is canceled, or
 * errors — never on response-headers-received.
 *
 * Each call returns a fresh fetch backed by its own cache + gate. Intended
 * to be called once per provider lifetime (custom() hook in provider.ts).
 */
export function createFeatherlessFetch(opts: CreateFeatherlessFetchOptions): typeof fetch {
  const baseFetch = opts.baseFetch ?? globalThis.fetch
  const cache = new ConcurrencyCache({ apiKey: opts.apiKey, ...opts.cache })
  const gate = new FeatherlessGate({ apiKey: opts.apiKey, ...opts.gate })
  const started = gate.start().catch((err) => log.warn("gate start failed, fail-open", { error: String(err) }))

  return (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
    if (!CHAT_COMPLETIONS_RE.test(url)) return baseFetch(input, init)

    const modelID = extractModelID(init)
    if (!modelID) {
      log.warn("chat completion without parseable model id, passing through ungated", { url })
      return baseFetch(input, init)
    }

    let cost = 1
    try {
      cost = await cache.getCost(modelID)
    } catch (err) {
      log.warn("cost lookup failed, defaulting to 1", { modelID, error: String(err) })
    }

    await started
    const release = await gate.acquire(cost)

    let res: Response
    try {
      res = await baseFetch(input, init)
    } catch (err) {
      release()
      throw err
    }

    if (!res.ok) {
      release()
      // Cost re-tiering: server's math disagrees with ours → drop the
      // cache so the next request re-reads concurrency_cost.
      if (res.status === 429) {
        cache.invalidate().catch((err) => log.warn("cache invalidate failed", { error: String(err) }))
      }
      return res
    }

    return wrapResponseWithRelease(res, release)
  }) as typeof fetch
}

export { ConcurrencyCache } from "./concurrency-cache"
export { FeatherlessGate } from "./gate"
