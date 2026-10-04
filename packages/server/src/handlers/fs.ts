import { FileSystem } from "@opencode/core/filesystem"
import { RelativePath } from "@opencode/core/schema"
import { FileNotFoundError } from "@opencode/protocol/errors"
import { Effect } from "effect"
import { HttpEffect, HttpPlatform, type HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Api } from "../api"
import { response } from "../location"

export const FileSystemHandler = HttpApiBuilder.group(Api, "server.fs", (handlers) =>
  Effect.gen(function* () {
    const platform = yield* HttpPlatform.HttpPlatform
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
          return yield* serveFile(ctx.request, path, file).pipe(
            Effect.provideService(HttpPlatform.HttpPlatform, platform),
          )
        }),
      )
      .handle("fs.list", (ctx) =>
        response(
          Effect.gen(function* () {
            const fs = yield* FileSystem.Service
            return yield* fs.list(ctx.query)
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
  const raw = new URL(url, "http://localhost").pathname.slice(13)
  return Effect.try({
    try: () => RelativePath.make(decodeURIComponent(raw)),
    catch: () => new FileNotFoundError({ path: raw, message: `File not found: ${raw}` }),
  })
}

const serveFile = Effect.fnUntraced(function* (
  request: HttpServerRequest.HttpServerRequest,
  path: RelativePath,
  file: FileSystem.File,
) {
  yield* HttpEffect.appendPreResponseHandler((_request, res) =>
    Effect.succeed(HttpServerResponse.removeHeader(res, "content-encoding")),
  )
  const fileResponse = (options?: Parameters<typeof HttpServerResponse.file>[1]) =>
    HttpServerResponse.file(file.path, {
      ...options,
      headers: {
        "content-type": file.mime,
        "accept-ranges": "bytes",
        "content-encoding": "identity",
        ...options?.headers,
      },
    }).pipe(
      Effect.catchReason(
        "PlatformError",
        "NotFound",
        () => Effect.fail(new FileNotFoundError({ path, message: `File not found: ${path}` })),
        (_, error) => Effect.die(error),
      ),
    )

  const rangeHeader = request.method === "GET" ? request.headers["range"] : undefined
  const ifRange = request.headers["if-range"]
  const shouldEvaluateConditionals =
    request.headers["if-none-match"] !== undefined || request.headers["if-modified-since"] !== undefined

  const fullResponse =
    shouldEvaluateConditionals || (rangeHeader !== undefined && ifRange !== undefined) || rangeHeader === undefined
      ? yield* fileResponse()
      : undefined

  if (shouldEvaluateConditionals && fullResponse !== undefined) {
    const conditional = evaluateConditionalRequest(request, fullResponse)
    if (conditional !== undefined) return conditional
  }

  if (rangeHeader === undefined) {
    return fullResponse ?? (yield* fileResponse())
  }

  if (ifRange !== undefined && fullResponse !== undefined && !matchesIfRange(ifRange, fullResponse)) {
    return fullResponse
  }

  const parsedRange = parseRange(rangeHeader, file.size)
  if (parsedRange === undefined) {
    return fullResponse ?? (yield* fileResponse())
  }

  if (parsedRange === "unsatisfiable") {
    return HttpServerResponse.empty({
      status: 416,
      headers: {
        "accept-ranges": "bytes",
        "content-range": `bytes */${file.size}`,
      },
    })
  }

  return yield* fileResponse({
    status: 206,
    offset: parsedRange.start,
    bytesToRead: parsedRange.end - parsedRange.start + 1,
    headers: {
      "content-range": `bytes ${parsedRange.start}-${parsedRange.end}/${file.size}`,
    },
  })
})

function parseInteger(value: string) {
  if (!/^\d+$/.test(value)) return undefined
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? parsed : undefined
}

function parseRange(
  header: string,
  fileSize: number,
): { readonly start: number; readonly end: number } | "unsatisfiable" | undefined {
  const value = header.trim()
  if (!value.toLowerCase().startsWith("bytes=")) return undefined
  const rangeValue = value.slice(6).trim()
  if (rangeValue.length === 0 || rangeValue.includes(",")) return undefined
  const separatorIndex = rangeValue.indexOf("-")
  if (separatorIndex === -1) return undefined
  const startPart = rangeValue.slice(0, separatorIndex).trim()
  const endPart = rangeValue.slice(separatorIndex + 1).trim()
  if (startPart === "" && endPart === "") return undefined
  if (startPart === "") {
    const suffixLength = parseInteger(endPart)
    if (suffixLength === undefined) return undefined
    if (suffixLength === 0 || fileSize === 0) return "unsatisfiable"
    return {
      start: Math.max(fileSize - suffixLength, 0),
      end: fileSize - 1,
    }
  }
  const start = parseInteger(startPart)
  if (start === undefined) return undefined
  if (endPart === "") {
    if (start >= fileSize) return "unsatisfiable"
    return {
      start,
      end: fileSize - 1,
    }
  }
  const end = parseInteger(endPart)
  if (end === undefined) return undefined
  if (start > end || start >= fileSize) return "unsatisfiable"
  return {
    start,
    end: Math.min(end, fileSize - 1),
  }
}

function stripWeakEtagPrefix(value: string) {
  const trimmed = value.trim()
  return /^w\//i.test(trimmed) ? trimmed.slice(2) : trimmed
}

function matchesIfNoneMatch(ifNoneMatch: string, etag: string | undefined) {
  const normalizedEtag = etag === undefined ? undefined : stripWeakEtagPrefix(etag)
  return ifNoneMatch.split(",").some((candidate) => {
    const value = candidate.trim()
    if (value === "") return false
    if (value === "*") return true
    return normalizedEtag !== undefined && stripWeakEtagPrefix(value) === normalizedEtag
  })
}

function isNotModifiedSince(ifModifiedSince: string, lastModified: string | undefined) {
  if (lastModified === undefined) return false
  const ifModifiedSinceMs = Date.parse(ifModifiedSince)
  if (Number.isNaN(ifModifiedSinceMs)) return false
  const lastModifiedMs = Date.parse(lastModified)
  if (Number.isNaN(lastModifiedMs)) return false
  return lastModifiedMs <= ifModifiedSinceMs
}

function matchesIfRange(ifRange: string, response: HttpServerResponse.HttpServerResponse) {
  const value = ifRange.trim()
  if (value === "") return false
  if (value.startsWith('"') || /^w\/"/i.test(value)) {
    const etag = response.headers["etag"]
    if (etag === undefined || !value.endsWith('"')) return false
    return stripWeakEtagPrefix(value) === stripWeakEtagPrefix(etag)
  }
  const lastModified = response.headers["last-modified"]
  if (lastModified === undefined) return false
  const ifRangeMs = Date.parse(value)
  if (Number.isNaN(ifRangeMs)) return false
  const lastModifiedMs = Date.parse(lastModified)
  if (Number.isNaN(lastModifiedMs)) return false
  return lastModifiedMs === ifRangeMs
}

function notModifiedResponse(response: HttpServerResponse.HttpServerResponse) {
  return HttpServerResponse.empty({
    status: 304,
    headers: {
      ...(response.headers["etag"] !== undefined ? { etag: response.headers["etag"] } : {}),
      ...(response.headers["cache-control"] !== undefined ? { "cache-control": response.headers["cache-control"] } : {}),
      ...(response.headers["last-modified"] !== undefined ? { "last-modified": response.headers["last-modified"] } : {}),
    },
  })
}

function evaluateConditionalRequest(
  request: HttpServerRequest.HttpServerRequest,
  response: HttpServerResponse.HttpServerResponse,
) {
  const ifNoneMatch = request.headers["if-none-match"]
  if (ifNoneMatch !== undefined) {
    return matchesIfNoneMatch(ifNoneMatch, response.headers["etag"]) ? notModifiedResponse(response) : undefined
  }
  const ifModifiedSince = request.headers["if-modified-since"]
  if (ifModifiedSince !== undefined && isNotModifiedSince(ifModifiedSince, response.headers["last-modified"])) {
    return notModifiedResponse(response)
  }
  return undefined
}
