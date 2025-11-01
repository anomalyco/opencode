export * from "./gen/types.gen.js"
export { type Config as OpencodeClientConfig, OpencodeClient }

import { createClient } from "./gen/client/client.gen.js"
import { type Config } from "./gen/client/types.gen.js"
import { OpencodeClient } from "./gen/sdk.gen.js"

export type OpencodeDebugEvent = {
  name: string
  step: "request" | "response" | "error" | "requestHeaders" | "responseHeaders"
  method: string
  url: string
  ms: number
  time: number
  status?: number
  err?: unknown
  headers?: Record<string, string>
}

export function createOpencodeClient(config?: Config) {
  const name = "opencode"
  const log = (event: OpencodeDebugEvent) => {
    console.debug(`[${event.name}]`, event)
  }
  const toHeaders = (value: Headers) =>
    Object.fromEntries(value.entries()) as Record<string, string>
  type FetchFn = NonNullable<Config["fetch"]>
  const bunEnv = globalThis as unknown as { Bun?: { nanoseconds?: () => number } }
  const bun = bunEnv.Bun
  const bunTick = bun?.nanoseconds
  const perf = typeof globalThis.performance !== "undefined" ? globalThis.performance : undefined
  const ns = bunTick
    ? () => BigInt(Math.round(bunTick()))
    : () => {
        const now = perf ? perf.now() : Date.now()
        return BigInt(Math.round(now * 1_000_000))
      }
  const span = (start: bigint) => Number(ns() - start) / 1_000_000
  const fallbackFetch: FetchFn = (request) => globalThis.fetch(request)
  const baseFetch = (config?.fetch as FetchFn) ?? fallbackFetch
  const wrap = (fn: FetchFn): FetchFn => (request) => {
    const start = ns()
    log({
      err: undefined,
      headers: undefined,
      method: request.method,
      ms: 0,
      name,
      status: undefined,
      step: "request",
      time: Date.now(),
      url: request.url,
    })
    const run = fn(request)
    return run
      .then((response) => {
        const ms = span(start)
        log({
          err: undefined,
          headers: undefined,
          method: request.method,
          ms,
          name,
          status: response.status,
          step: "response",
          time: Date.now(),
          url: request.url,
        })
        return response
      })
      .catch((error) => {
        const ms = span(start)
        log({
          err: error,
          headers: undefined,
          method: request.method,
          ms,
          name,
          status: undefined,
          step: "error",
          time: Date.now(),
          url: request.url,
        })
        throw error
      })
  }
  const fetchWrap = wrap(baseFetch)
  const cfg: Config = config ? { ...config, fetch: fetchWrap } : { fetch: fetchWrap }
  const client = createClient(cfg)
  client.interceptors.request.use((request) => {
    log({
      err: undefined,
      headers: toHeaders(request.headers),
      method: request.method,
      ms: 0,
      name,
      status: undefined,
      step: "requestHeaders",
      time: Date.now(),
      url: request.url,
    })
    return request
  })
  client.interceptors.response.use((response, request) => {
    log({
      err: undefined,
      headers: toHeaders(response.headers),
      method: request.method,
      ms: 0,
      name,
      status: response.status,
      step: "responseHeaders",
      time: Date.now(),
      url: request.url,
    })
    return response
  })
  client.interceptors.error.use((error, response, request) => {
    log({
      err: error,
      headers: response ? toHeaders(response.headers) : undefined,
      method: request.method,
      ms: 0,
      name,
      status: response?.status,
      step: "error",
      time: Date.now(),
      url: request.url,
    })
    return error
  })
  return new OpencodeClient({ client })
}
