import { BlobStore } from "@opencode/core/blob-store"
import { Database } from "@opencode/core/database/database"
import { SessionBlob } from "@opencode/core/session/blob"
import { FileNotFoundError } from "@opencode/protocol/errors"
import { FSUtil } from "@opencode/util/fs-util"
import { Effect, Stream } from "effect"
import { type HttpServerRequest, HttpServerResponse } from "effect/http"
import { ContentHeaders } from "../content-headers"
import { ByteRange } from "../range"

const INLINE_IMAGE_MIMES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"])
// Players need the real type, and none of these run script; anything else is served as bytes.
const PLAYABLE_MIME = /^(video|audio)\/[a-z0-9][a-z0-9.+-]*$/
const CACHE_CONTROL = "private, max-age=31536000, immutable"

/**
 * `media.get` in the `server.experimental` group; serves only blobs a message or inbox item still references, or that
 * have not expired. The ETag is the quoted hash, which shipped iOS builds send back in `If-None-Match`.
 */
export const makeMediaGet = Effect.gen(function* () {
  const { db } = yield* Database.Service
  const store = yield* BlobStore.Service
  const fs = yield* FSUtil.Service
  return (hash: string, request: HttpServerRequest.HttpServerRequest) =>
    Effect.gen(function* () {
      const missing = new FileNotFoundError({
        path: `/api/experimental/media/${hash}`,
        message: `Media blob not found: ${hash}`,
      })
      const blob = yield* SessionBlob.stat(db, hash)
      if (!blob) return yield* missing
      // A file that is gone or truncated is logged by `open` and served as missing; its row stays.
      const file = blob.onDisk ? yield* store.open(hash, blob.bytes) : undefined
      if (blob.onDisk && file === undefined) return yield* missing
      const etag = `"${hash}"`
      const headers = {
        "cache-control": CACHE_CONTROL,
        etag,
        "accept-ranges": "bytes",
        "content-disposition": ContentHeaders.disposition(""),
        "content-security-policy": ContentHeaders.CONTENT_SECURITY_POLICY,
        "x-content-type-options": "nosniff",
      }
      if (matchesIfNoneMatch(request.headers["if-none-match"], etag))
        return HttpServerResponse.empty({ status: 304, headers })

      const range =
        request.method === "GET" && matchesIfRange(request.headers["if-range"], etag)
          ? ByteRange.parse(request.headers["range"], blob.bytes)
          : undefined
      if (range === "unsatisfiable")
        return HttpServerResponse.empty({
          status: 416,
          headers: { ...headers, "content-range": `bytes */${blob.bytes}` },
        })
      const offset = range?.start ?? 0
      const length = range === undefined ? blob.bytes : range.end - range.start + 1
      const options = {
        status: range === undefined ? 200 : 206,
        contentType: contentType(blob.mime),
        headers: {
          ...headers,
          ...(range === undefined ? {} : { "content-range": `bytes ${range.start}-${range.end}/${blob.bytes}` }),
        },
      }
      if (file !== undefined)
        return HttpServerResponse.stream(
          length === 0 ? Stream.empty : fs.stream(file, { offset, bytesToRead: length }),
          { ...options, contentLength: length },
        )
      const inline = yield* SessionBlob.read(db, hash)
      if (inline?.data === undefined) return yield* missing
      return HttpServerResponse.uint8Array(inline.data.subarray(offset, offset + length), options)
    })
})

function contentType(mime: string) {
  const lower = mime.toLowerCase()
  if (INLINE_IMAGE_MIMES.has(lower) || PLAYABLE_MIME.test(lower) || lower === "application/pdf") return lower
  return "application/octet-stream"
}

function matchesIfNoneMatch(ifNoneMatch: string | undefined, etag: string) {
  if (ifNoneMatch === undefined) return false
  return ifNoneMatch.split(",").some((tag) => {
    const trimmed = tag.trim()
    return trimmed === "*" || trimmed.replace(/^w\//i, "") === etag
  })
}

// If-Range only accepts a strong match (RFC 9110 13.1.5); a date or a weak tag serves the whole body.
const matchesIfRange = (ifRange: string | undefined, etag: string) => ifRange === undefined || ifRange.trim() === etag
