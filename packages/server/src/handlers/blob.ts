import { BlobStore } from "@opencode/core/blob-store"
import { BlobNotFoundError } from "@opencode/protocol/errors"
import { FSUtil } from "@opencode/util/fs-util"
import { Effect } from "effect"
import { type HttpServerRequest, HttpServerResponse } from "effect/http"
import { ContentHeaders } from "../content-headers"
import { ByteRange } from "../range"

/** `blob.get` in the `server.experimental` group. Raw, so it can stream the file and answer Range and 304 itself. */
export const makeBlobGet = Effect.gen(function* () {
  const blobs = yield* BlobStore.Service
  const fs = yield* FSUtil.Service
  return (id: BlobStore.ID, request: HttpServerRequest.HttpServerRequest) =>
    Effect.gen(function* () {
      const blob = yield* blobs
        .read(id)
        .pipe(Effect.mapError((error) => new BlobNotFoundError({ blobID: error.id, message: error.message })))
      // The ID names one immutable blob.
      const etag = `"${id}"`
      const headers = {
        ...ContentHeaders.download({ mime: blob.mime }),
        "cache-control": "private, max-age=31536000, immutable",
        etag,
        "accept-ranges": "bytes",
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
        ifRange === undefined || ifRange.trim() === etag
          ? ByteRange.parse(request.headers["range"], blob.bytes)
          : undefined
      if (range === "unsatisfiable")
        return HttpServerResponse.empty({
          status: 416,
          headers: { ...headers, "content-range": `bytes */${blob.bytes}` },
        })
      const offset = range?.start ?? 0
      const length = range === undefined ? blob.bytes : range.end - range.start + 1
      return HttpServerResponse.stream(fs.stream(blob.path, { offset, bytesToRead: length }), {
        status: range === undefined ? 200 : 206,
        contentType: headers["content-type"],
        contentLength: length,
        headers:
          range === undefined
            ? headers
            : { ...headers, "content-range": `bytes ${range.start}-${range.end}/${blob.bytes}` },
      })
    })
})
