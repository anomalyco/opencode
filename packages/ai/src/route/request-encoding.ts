import { Clock, Effect, Option } from "effect"
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/http"
import type { RequestEncoding } from "../schema/options.js"
import type { HttpMiddleware } from "./executor-service.js"

type Encoding = "gzip" | "zstd"

export function compress(text: string | Uint8Array, encoding: RequestEncoding | undefined) {
  if (encoding === undefined || encoding === "none" || encoding === "auto") return undefined
  // Keep browser and workerd bundles loadable without node:zlib.
  const zlib = globalThis.process?.getBuiltinModule?.("node:zlib")
  try {
    const body = encoding === "zstd" ? zlib?.zstdCompressSync?.(text) : zlib?.gzipSync(text)
    return body && { encoding, body }
  } catch {
    return undefined
  }
}

// RFC 7694 advertisements apply to the associated resource and can change over time.
const TTL = 5 * 60_000
const CAPACITY = 128

export const middleware = (): HttpMiddleware => {
  const cache = new Map<string, { encoding: Encoding; expires: number }>()
  const execute: HttpMiddleware = (request, next) =>
    Effect.gen(function* () {
      if (
        request.method !== "POST" ||
        request.headers["content-type"]?.split(";")[0].trim().toLowerCase() !== "application/json" ||
        request.headers["content-encoding"] !== undefined ||
        request.body._tag !== "Uint8Array" ||
        signed(request)
      )
        return yield* next(request)

      const url = Option.getOrUndefined(HttpClientRequest.toUrl(request))
      if (!url || (url.protocol !== "https:" && url.protocol !== "http:")) return yield* next(request)
      url.hash = ""
      // Header scoping also separates credentials, tenants and API versions. Length changes each turn.
      const key = JSON.stringify([
        request.method,
        url.href,
        Object.entries(request.headers)
          .filter(([name]) => name !== "content-length")
          .sort(([left], [right]) => left.localeCompare(right)),
      ])
      const now = yield* Clock.currentTimeMillis
      const known = cache.get(key)
      if (known && known.expires <= now) cache.delete(key)
      const compressed =
        known && known.expires > now && request.body.body.length >= 1024
          ? compress(request.body.body, known.encoding)
          : undefined
      const outgoing =
        compressed && compressed.body.length < request.body.body.length
          ? request.pipe(
              HttpClientRequest.bodyUint8Array(compressed.body, request.body.contentType),
              HttpClientRequest.setHeader("content-encoding", compressed.encoding),
            )
          : request

      const response = yield* next(outgoing)
      const advertised = response.headers["accept-encoding"]
      if (response.status === 415 || (outgoing !== request && response.status >= 400 && response.status < 500))
        cache.delete(key)
      if (response.status >= 200 && response.status < 300 && advertised !== undefined) {
        const encoding = select(advertised)
        cache.delete(key)
        if (encoding) {
          if (cache.size >= CAPACITY) {
            const oldest = cache.keys().next().value
            if (oldest !== undefined) cache.delete(oldest)
          }
          cache.set(key, { encoding, expires: (yield* Clock.currentTimeMillis) + TTL })
        }
      }
      return response
    })
  return (request, next) =>
    Effect.gen(function* () {
      if (!globalThis.process?.getBuiltinModule?.("node:zlib")) return yield* next(request)
      const init = Option.getOrUndefined(yield* Effect.serviceOption(FetchHttpClient.RequestInit))
      if (init?.redirect !== undefined && init.redirect !== "follow") return yield* execute(request, next)
      // Follow from the original JSON request, so every redirect chooses its own encoding and credentials.
      const client = HttpClient.makeWith<never, never, Error, never>(
        Effect.flatMap((input: HttpClientRequest.HttpClientRequest) => execute(input, next)),
        Effect.succeed,
      )
      return yield* HttpClient.followRedirects(client, 20)
        .execute(request)
        .pipe(Effect.provideService(FetchHttpClient.RequestInit, { ...init, redirect: "manual" }))
    })
}

function signed(request: HttpClientRequest.HttpClientRequest) {
  return (
    request.headers.authorization?.startsWith("AWS4-") ||
    ["x-amz-content-sha256", "content-md5", "content-digest", "digest", "signature", "signature-input"].some(
      (name) => request.headers[name] !== undefined,
    )
  )
}

function select(header: string): Encoding | undefined {
  const accepted = new Map<string, number>()
  for (const part of header.split(",")) {
    const match = /^([!#$%&'*+.^_`|~\w-]+)(?:\s*;\s*q=(0(?:\.\d{0,3})?|1(?:\.0{0,3})?))?$/i.exec(part.trim())
    if (!match) return undefined
    const name = match[1].toLowerCase()
    const quality = match[2] === undefined ? 1 : Number(match[2])
    accepted.set(name, Math.min(accepted.get(name) ?? 1, quality))
  }
  const zlib = globalThis.process?.getBuiltinModule?.("node:zlib")
  const supported: Encoding[] = ["zstd", "gzip"]
  return supported
    .filter((name) => (name === "zstd" ? zlib?.zstdCompressSync : zlib?.gzipSync))
    .filter((name) => (accepted.get(name) ?? 0) > 0 && (accepted.get(name) ?? 0) >= (accepted.get("identity") ?? 0))
    .sort((left, right) => (accepted.get(right) ?? 0) - (accepted.get(left) ?? 0))[0]
}

export * as RequestBodyEncoding from "./request-encoding.js"
