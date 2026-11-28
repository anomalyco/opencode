import { BlobStore } from "@opencode/core/blob-store"
import { Flag } from "@opencode/core/flag"
import { Location } from "@opencode/core/location"
import { LocationServiceMap } from "@opencode/core/location-services"
import { AbsolutePath } from "@opencode/core/schema"
import {
  BlobNotFoundError,
  ForbiddenError,
  InvalidRequestError,
  ServiceUnavailableError,
} from "@opencode/protocol/errors"
import type { CreateQuery, ListQuery, UpdatePayload } from "@opencode/protocol/groups/blob"
import { Global } from "@opencode/util/global"
import { Effect } from "effect"
import { type HttpServerRequest, HttpServerResponse } from "effect/http"
import { ContentHeaders } from "../content-headers"
import { ByteRange } from "../range"

/** `blob.*` in the `server.experimental` group. Reading a blob is open; the rest needs `experimental.blob_catalog`. */
export const makeBlob = Effect.gen(function* () {
  const blobs = yield* BlobStore.Service
  const global = yield* Global.Service
  const locations = yield* LocationServiceMap.Service
  // Blobs aren't in a Location, so the flag is read from the server's base config, as the video routes read theirs.
  const catalog = Flag.enabled("blob_catalog").pipe(
    Effect.provide(locations.get(Location.Ref.make({ directory: AbsolutePath.make(global.config) }))),
    Effect.orElseSucceed(() => false),
    Effect.flatMap((enabled) =>
      enabled
        ? Effect.void
        : Effect.fail(new ForbiddenError({ message: "The blob API is disabled; set experimental.blob_catalog in config" })),
    ),
  )
  const missing = (error: BlobStore.NotFoundError) =>
    new BlobNotFoundError({ blobID: error.id, message: error.message })

  return {
    list: Effect.fn("BlobHandler.list")(function* (query: ListQuery) {
      yield* catalog
      return { data: yield* blobs.list(query) }
    }),
    create: Effect.fn("BlobHandler.create")(function* (query: CreateQuery, request: HttpServerRequest.HttpServerRequest) {
      yield* catalog
      const info = yield* blobs
        .write(request.stream, { ...query, mime: request.headers["content-type"] })
        .pipe(
          // A body that breaks off mid-upload is the client's doing; there's no blob and nothing to answer.
          Effect.catch((error) =>
            error instanceof BlobStore.UnavailableError
              ? Effect.fail(new ServiceUnavailableError({ message: error.message, service: "blob" }))
              : Effect.die(error),
          ),
        )
      return HttpServerResponse.jsonUnsafe({ data: info })
    }),
    get: Effect.fn("BlobHandler.get")(function* (id: BlobStore.ID) {
      return { data: yield* blobs.get(id).pipe(Effect.mapError(missing)) }
    }),
    content: Effect.fn("BlobHandler.content")(function* (id: BlobStore.ID, request: HttpServerRequest.HttpServerRequest) {
      const blob = yield* blobs.get(id).pipe(Effect.mapError(missing))
      // The ID names one immutable sequence of bytes.
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
      return HttpServerResponse.stream(yield* blobs.content(id, { offset, length }).pipe(Effect.mapError(missing)), {
        status: range === undefined ? 200 : 206,
        contentType: headers["content-type"],
        contentLength: length,
        headers:
          range === undefined
            ? headers
            : { ...headers, "content-range": `bytes ${range.start}-${range.end}/${blob.bytes}` },
      })
    }),
    update: Effect.fn("BlobHandler.update")(function* (id: BlobStore.ID, payload: UpdatePayload) {
      yield* catalog
      if (
        payload.metadata !== undefined &&
        new TextEncoder().encode(JSON.stringify(payload.metadata)).length > BlobStore.METADATA_LIMIT
      )
        return yield* new InvalidRequestError({
          message: `metadata must be at most ${BlobStore.METADATA_LIMIT} bytes as JSON`,
          field: "metadata",
        })
      return { data: yield* blobs.update(id, payload).pipe(Effect.mapError(missing)) }
    }),
    remove: Effect.fn("BlobHandler.remove")(function* (id: BlobStore.ID) {
      yield* catalog
      yield* blobs.remove(id).pipe(Effect.mapError(missing))
    }),
  }
})
