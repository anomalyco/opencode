import { BlobStore } from "@opencode/core/blob-store"
import { Database } from "@opencode/core/database/database"
import { SessionBlob } from "@opencode/core/session/blob"
import { FileNotFoundError } from "@opencode/protocol/errors"
import { FSUtil } from "@opencode/util/fs-util"
import { Effect, Stream } from "effect"
import { type HttpServerRequest, HttpServerResponse } from "effect/http"
import { ContentHeaders } from "../content-headers"
import { ByteRange } from "../range"

// Types `<img>`, players and PDF viewers need, none of which run script; anything else is served as bytes.
const SERVED_MIME = /^(image\/(png|jpeg|gif|webp)|(video|audio)\/[a-z0-9][a-z0-9.+-]*|application\/pdf)$/

/** `media.get` in the `server.experimental` group; serves only blobs still referenced or not yet expired. */
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
      const file = blob.onDisk ? yield* store.open(hash, blob.bytes) : undefined
      if (blob.onDisk && file === undefined) return yield* missing
      // Stays the quoted hash: shipped iOS builds probe with `If-None-Match: "<hash>"`.
      const etag = `"${hash}"`
      const headers = {
        "cache-control": "private, max-age=31536000, immutable",
        etag,
        "accept-ranges": "bytes",
        "content-disposition": ContentHeaders.disposition(""),
        "content-security-policy": ContentHeaders.CONTENT_SECURITY_POLICY,
        "x-content-type-options": "nosniff",
      }
      if (
        request.headers["if-none-match"]
          ?.split(",")
          .some((tag) => tag.trim() === "*" || tag.trim().replace(/^w\//i, "") === etag)
      )
        return HttpServerResponse.empty({ status: 304, headers })

      // If-Range takes only a strong match (RFC 9110 13.1.5); anything else serves the whole body.
      const ifRange = request.headers["if-range"]
      const range =
        request.method === "GET" && (ifRange === undefined || ifRange.trim() === etag)
          ? ByteRange.parse(request.headers["range"], blob.bytes)
          : undefined
      if (range === "unsatisfiable")
        return HttpServerResponse.empty({
          status: 416,
          headers: { ...headers, "content-range": `bytes */${blob.bytes}` },
        })
      const offset = range?.start ?? 0
      const length = range === undefined ? blob.bytes : range.end - range.start + 1
      const mime = blob.mime.toLowerCase()
      const options = {
        status: range === undefined ? 200 : 206,
        contentType: SERVED_MIME.test(mime) ? mime : "application/octet-stream",
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
