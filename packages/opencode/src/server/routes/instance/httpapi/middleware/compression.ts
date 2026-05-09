import { deflateSync, gzipSync } from "node:zlib"
import { Effect } from "effect"
import { HttpBody, HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http"

// Mirror of Hono's compressible content-type set so wire behavior matches.
const COMPRESSIBLE_CONTENT_TYPE_REGEX =
  /^\s*(?:text\/(?!event-stream(?:[;\s]|$))[^;\s]+|application\/(?:javascript|json|xml|xml-dtd|ecmascript|dart|postscript|rtf|tar|toml|vnd\.dart|vnd\.ms-fontobject|vnd\.ms-opentype|wasm|x-httpd-php|x-javascript|x-ns-proxy-autoconfig|x-sh|x-tar|x-www-form-urlencoded)|font\/(?:otf|ttf)|image\/(?:bmp|vnd\.adobe\.photoshop|vnd\.microsoft\.icon|vnd\.ms-dds|x-icon|x-ms-bmp)|message\/rfc822|model\/gltf-binary|x-shader\/x-fragment|x-shader\/x-vertex|[^;\s]+?\+(?:json|text|xml|yaml))(?:[;\s]|$)/i

const NO_TRANSFORM_REGEX = /(?:^|,)\s*?no-transform\s*?(?:,|$)/i

const STREAMING_PATHS = new Set(["/event", "/global/event"])
const STREAMING_POST_REGEX = /^\/session\/[^/]+\/(?:message|prompt_async)$/

const THRESHOLD_BYTES = 1024

type Encoding = "gzip" | "deflate"

function pickEncoding(acceptEncoding: string | undefined): Encoding | undefined {
  if (!acceptEncoding) return undefined
  const lower = acceptEncoding.toLowerCase()
  if (lower.includes("gzip")) return "gzip"
  if (lower.includes("deflate")) return "deflate"
  return undefined
}

function pathOf(url: string): string {
  const queryIndex = url.indexOf("?")
  return queryIndex === -1 ? url : url.slice(0, queryIndex)
}

export const compressionLayer = HttpRouter.middleware<{ handles: unknown }>()((effect) =>
  Effect.gen(function* () {
    const response = yield* effect
    const request = yield* HttpServerRequest.HttpServerRequest

    if (request.method === "HEAD") return response
    if (response.headers["content-encoding"]) return response
    if (response.headers["transfer-encoding"]) return response

    const body = response.body
    if (body._tag !== "Uint8Array") return response
    if (body.body.byteLength < THRESHOLD_BYTES) return response

    const cacheControl = response.headers["cache-control"]
    if (cacheControl && NO_TRANSFORM_REGEX.test(cacheControl)) return response

    const path = pathOf(request.url)
    if (STREAMING_PATHS.has(path)) return response
    if (request.method === "POST" && STREAMING_POST_REGEX.test(path)) return response

    const contentType = body.contentType
    if (!COMPRESSIBLE_CONTENT_TYPE_REGEX.test(contentType)) return response

    const encoding = pickEncoding(request.headers["accept-encoding"])
    if (!encoding) return response

    const compressed = encoding === "gzip" ? gzipSync(body.body) : deflateSync(body.body)
    return HttpServerResponse.setHeader(
      HttpServerResponse.setBody(response, HttpBody.uint8Array(compressed, contentType)),
      "content-encoding",
      encoding,
    )
  }),
).layer
