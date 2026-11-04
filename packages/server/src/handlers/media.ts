import { Database } from "@opencode/core/database/database"
import { SessionBlob } from "@opencode/core/session/blob"
import { FileNotFoundError } from "@opencode/protocol/errors"
import { Effect } from "effect"
import { type HttpServerRequest, HttpServerResponse } from "effect/http"

const INLINE_IMAGE_MIMES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"])
const CACHE_CONTROL = "private, max-age=31536000, immutable"
const SECURITY_HEADERS = {
  "x-content-type-options": "nosniff",
  "content-security-policy": "default-src 'none'; sandbox",
}

/** `media.get` in the `server.experimental` group; serves only blobs a message or inbox item still references. */
export const makeMediaGet = Effect.gen(function* () {
  const { db } = yield* Database.Service
  return (hash: string, request: HttpServerRequest.HttpServerRequest) =>
    Effect.gen(function* () {
      const path = `/api/experimental/media/${hash}`
      const blob = yield* SessionBlob.read(db, hash)
      if (!blob) return yield* new FileNotFoundError({ path, message: `Media blob not found: ${hash}` })
      const etag = `"${hash}"`
      const inline = INLINE_IMAGE_MIMES.has(blob.mime)
      const headers = {
        "cache-control": CACHE_CONTROL,
        etag,
        ...SECURITY_HEADERS,
        ...(inline ? {} : { "content-disposition": "attachment" }),
      }
      if (matchesIfNoneMatch(request.headers["if-none-match"], etag))
        return HttpServerResponse.empty({ status: 304, headers })
      return HttpServerResponse.uint8Array(blob.data, {
        status: 200,
        contentType: inline ? blob.mime : "application/octet-stream",
        headers,
      })
    })
})

function matchesIfNoneMatch(ifNoneMatch: string | undefined, etag: string) {
  if (ifNoneMatch === undefined) return false
  return ifNoneMatch.split(",").some((tag) => {
    const trimmed = tag.trim()
    return trimmed === "*" || trimmed.replace(/^w\//i, "") === etag
  })
}
