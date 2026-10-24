import { Database } from "@opencode/core/database/database"
import { SessionMediaBlob } from "@opencode/core/session/media-blob"
import { FileNotFoundError, InvalidRequestError } from "@opencode/protocol/errors"
import { Effect } from "effect"
import { HttpServerResponse } from "effect/http"
import { HttpApiBuilder } from "effect/http-api"
import { Api } from "../api"

const HASH_PATTERN = /^[0-9a-f]{64}$/
const INLINE_IMAGE_MIMES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"])
const CACHE_CONTROL = "private, max-age=31536000, immutable"
const SECURITY_HEADERS = {
  "x-content-type-options": "nosniff",
  "content-security-policy": "default-src 'none'; sandbox",
} as const

export const MediaHandler = HttpApiBuilder.group(Api, "server.media", (handlers) =>
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    return handlers.handleRaw("media.get", (ctx) =>
      Effect.gen(function* () {
        const hash = ctx.params.hash
        if (!HASH_PATTERN.test(hash))
          return yield* new InvalidRequestError({
            message: `Invalid media hash: ${hash}`,
          })
        const blob = yield* SessionMediaBlob.get(db, hash)
        if (!blob)
          return yield* new FileNotFoundError({
            path: `${SessionMediaBlob.URI_PREFIX}${hash}`,
            message: `Media blob not found: ${hash}`,
          })
        const etag = `"${blob.hash}"`
        const inline = INLINE_IMAGE_MIMES.has(blob.mime)
        const contentType = inline ? blob.mime : "application/octet-stream"
        const headers = {
          "cache-control": CACHE_CONTROL,
          etag,
          ...SECURITY_HEADERS,
          ...(inline ? {} : { "content-disposition": "attachment" }),
        }
        if (matchesIfNoneMatch(ctx.request.headers["if-none-match"], etag))
          return HttpServerResponse.empty({ status: 304, headers })
        const body = new Uint8Array(blob.data.buffer, blob.data.byteOffset, blob.data.byteLength)
        return HttpServerResponse.uint8Array(body, {
          status: 200,
          contentType,
          headers,
        })
      }),
    )
  }),
)

function matchesIfNoneMatch(ifNoneMatch: string | undefined, etag: string) {
  if (ifNoneMatch === undefined) return false
  return ifNoneMatch.split(",").some((tag) => {
    const trimmed = tag.trim()
    return trimmed === "*" || stripWeak(trimmed) === stripWeak(etag)
  })
}

function stripWeak(etag: string) {
  return etag.replace(/^w\//i, "")
}
