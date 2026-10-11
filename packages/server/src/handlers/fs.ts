import { FileSystem } from "@opencode/core/filesystem"
import { RelativePath } from "@opencode/core/schema"
import { FileNotFoundError } from "@opencode/protocol/errors"
import { Effect, Option, Stream } from "effect"
import { type HttpServerRequest, HttpServerResponse } from "effect/http"
import { HttpApiBuilder } from "effect/http-api"
import { Api } from "../api"
import { response } from "../location"

export const FileSystemHandler = HttpApiBuilder.group(Api, "server.fs", (handlers) =>
  Effect.gen(function* () {
    return handlers
      .handleRaw("fs.read", (ctx) =>
        Effect.gen(function* () {
          const path = yield* decodeRequestPath(ctx.request.url)
          const fs = yield* FileSystem.Service
          const file = yield* fs
            .read({ path })
            .pipe(
              Effect.mapError(
                (error) => new FileNotFoundError({ path: error.path, message: `File not found: ${error.path}` }),
              ),
            )
          return serveFile(ctx.request, file)
        }),
      )
      .handle("fs.list", (ctx) =>
        response(
          Effect.gen(function* () {
            const fs = yield* FileSystem.Service
            return yield* fs
              .list(ctx.query)
              .pipe(
                Effect.mapError(
                  (error) => new FileNotFoundError({ path: error.path, message: `Directory not found: ${error.path}` }),
                ),
              )
          }),
        ),
      )
      .handle("fs.find", (ctx) =>
        response(
          Effect.gen(function* () {
            const fs = yield* FileSystem.Service
            return yield* fs.find(ctx.query)
          }),
        ),
      )
      .handle("fs.write", (ctx) =>
        response(
          Effect.gen(function* () {
            const fs = yield* FileSystem.Service
            return yield* fs.write({ path: ctx.query.path, data: ctx.payload })
          }),
        ),
      )
  }),
)

function decodeRequestPath(url: string) {
  const raw = new URL(url, "http://localhost").pathname.slice("/api/fs/read/".length)
  return Effect.try({
    try: () => RelativePath.make(decodeURIComponent(raw)),
    catch: () => new FileNotFoundError({ path: raw, message: `File not found: ${raw}` }),
  })
}

function serveFile(request: HttpServerRequest.HttpServerRequest, file: FileSystem.File) {
  const etag = `W/"${file.size.toString(16)}-${Option.match(file.mtime, {
    onNone: () => "0",
    onSome: (mtime) => mtime.getTime().toString(16),
  })}"`
  const lastModified = Option.getOrUndefined(Option.map(file.mtime, (mtime) => mtime.toUTCString()))
  // Clients must revalidate after agent edits; no-transform keeps compression from changing Content-Length.
  const validators = {
    "cache-control": "no-cache, no-transform",
    etag,
    ...(lastModified === undefined ? {} : { "last-modified": lastModified }),
  }
  if (isNotModified(request, etag, lastModified)) return HttpServerResponse.empty({ status: 304, headers: validators })

  const rangeHeader = request.method === "GET" ? request.headers["range"] : undefined
  const range =
    rangeHeader !== undefined && matchesIfRange(request.headers["if-range"], etag, lastModified)
      ? parseRange(rangeHeader, file.size)
      : undefined
  if (range === "unsatisfiable")
    return HttpServerResponse.empty({
      status: 416,
      headers: { "accept-ranges": "bytes", "content-range": `bytes */${file.size}` },
    })

  const offset = range?.start ?? 0
  const length = range === undefined ? file.size : range.end - range.start + 1
  return HttpServerResponse.stream(length === 0 ? Stream.empty : file.stream({ offset, bytesToRead: length }), {
    status: range === undefined ? 200 : 206,
    contentLength: length,
    headers: {
      ...validators,
      "accept-ranges": "bytes",
      "content-type": file.mime,
      ...(range === undefined ? {} : { "content-range": `bytes ${range.start}-${range.end}/${file.size}` }),
    },
  })
}

function isNotModified(request: HttpServerRequest.HttpServerRequest, etag: string, lastModified: string | undefined) {
  const ifNoneMatch = request.headers["if-none-match"]
  if (ifNoneMatch !== undefined)
    return ifNoneMatch.split(",").some((tag) => tag.trim() === "*" || stripWeak(tag) === stripWeak(etag))
  const ifModifiedSince = request.headers["if-modified-since"]
  return (
    ifModifiedSince !== undefined &&
    lastModified !== undefined &&
    Date.parse(lastModified) <= Date.parse(ifModifiedSince)
  )
}

function matchesIfRange(ifRange: string | undefined, etag: string, lastModified: string | undefined) {
  if (ifRange === undefined) return true
  if (/^\s*(w\/)?"/i.test(ifRange)) return stripWeak(ifRange) === stripWeak(etag)
  return lastModified !== undefined && Date.parse(ifRange) === Date.parse(lastModified)
}

function stripWeak(etag: string) {
  return etag.trim().replace(/^w\//i, "")
}

function parseRange(header: string, size: number) {
  const match = /^bytes=\s*(\d*)\s*-\s*(\d*)\s*$/i.exec(header.trim())
  if (match === null || (match[1] === "" && match[2] === "")) return undefined
  if (match[1] === "") {
    const suffix = Number(match[2])
    if (suffix === 0 || size === 0) return "unsatisfiable"
    return { start: Math.max(size - suffix, 0), end: size - 1 }
  }
  const start = Number(match[1])
  const end = match[2] === "" ? size - 1 : Number(match[2])
  if (start > end || start >= size) return "unsatisfiable"
  return { start, end: Math.min(end, size - 1) }
}
