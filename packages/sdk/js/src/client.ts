export * from "./gen/types.gen.js"
export { type Config as OpencodeClientConfig, OpencodeClient }

import { createClient } from "./gen/client/client.gen.js"
import { type Config } from "./gen/client/types.gen.js"
import { OpencodeClient } from "./gen/sdk.gen.js"

export function createOpencodeClient(config?: Config) {
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
  const baseFetch = (config?.fetch as FetchFn) ?? ((request) => globalThis.fetch(request))
  const wrap: FetchFn = (request) => {
    const start = ns()
    console.debug("[opencode][request]", {
      method: request.method,
      url: request.url,
      time: Date.now(),
    })
    return baseFetch(request)
      .then((response) => {
        console.debug("[opencode][response]", {
          method: request.method,
          url: request.url,
          status: response.status,
          ms: span(start),
          time: Date.now(),
        })
        return response
      })
      .catch((error) => {
        console.debug("[opencode][error]", {
          method: request.method,
          url: request.url,
          ms: span(start),
          time: Date.now(),
          err: error,
        })
        throw error
      })
  }
  const client = createClient(config ? { ...config, fetch: wrap } : { fetch: wrap })
  return new OpencodeClient({ client })
}
