export * as Download from "./download"

import path from "node:path"
import { createHash } from "node:crypto"
import { open } from "node:fs/promises"
import { Effect, Stream } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http"
import { FSUtil } from "./fs-util"

export type Phase = "starting" | "downloading" | "verifying" | "completed"

export interface Progress {
  readonly phase: Phase
  readonly url: string
  readonly filePath: string
  readonly receivedBytes: number
  readonly totalBytes?: number
  readonly percent?: number
  readonly bytesPerSecond: number
  readonly elapsedMs: number
}

export interface Result extends Progress {
  readonly phase: "completed"
  readonly sha256: string
}

export interface Input {
  readonly http: HttpClient.HttpClient
  readonly fs: FSUtil.Interface
  readonly url: string
  readonly filePath: string
  readonly temporaryID: string
  readonly expectedSha256?: string
  readonly overwrite?: boolean
  readonly onProgress: (progress: Progress) => Effect.Effect<void, unknown>
}

const INTERVAL_MS = 250

const declaredLength = (response: HttpClientResponse.HttpClientResponse): number | undefined => {
  const raw = response.headers["content-length"]
  if (!raw) return
  const size = Number.parseInt(raw, 10)
  if (!Number.isSafeInteger(size) || size < 0) return
  return size
}

const writeAll = (handle: Awaited<ReturnType<typeof open>>, chunk: Uint8Array) =>
  Effect.tryPromise({
    try: async () => {
      let offset = 0
      while (offset < chunk.byteLength) {
        const result = await handle.write(chunk, offset, chunk.byteLength - offset)
        if (result.bytesWritten === 0) throw new Error("Download file stopped accepting data")
        offset += result.bytesWritten
      }
    },
    catch: (cause) => new Error("Unable to write downloaded data", { cause }),
  })

/**
 * Streams one HTTP(S) response to an adjacent temporary file, then renames it
 * into place only after the body and optional checksum have completed.
 */
export const file = Effect.fn("Download.file")(function* (input: Input) {
  const started = Date.now()
  const hash = createHash("sha256")
  const suffix = input.temporaryID.replaceAll(/[^A-Za-z0-9_-]/g, "_") || "download"
  const temporary = `${input.filePath}.opencode-part-${suffix}`
  let receivedBytes = 0
  let totalBytes: number | undefined
  let lastReportedAt = 0

  const progress = (phase: Phase, force = false) => {
    const now = Date.now()
    if (!force && now - lastReportedAt < INTERVAL_MS) return Effect.void
    lastReportedAt = now
    const elapsedMs = Math.max(now - started, 1)
    return input.onProgress({
      phase,
      url: input.url,
      filePath: input.filePath,
      receivedBytes,
      ...(totalBytes === undefined ? {} : { totalBytes }),
      ...(totalBytes && totalBytes > 0
        ? { percent: Math.min(100, Math.max(0, (receivedBytes / totalBytes) * 100)) }
        : {}),
      bytesPerSecond: Math.round((receivedBytes * 1000) / elapsedMs),
      elapsedMs,
    })
  }

  return yield* Effect.gen(function* () {
    yield* input.fs.ensureDir(path.dirname(input.filePath))
    if (!input.overwrite && (yield* input.fs.existsSafe(input.filePath)))
      return yield* Effect.fail(new Error(`Destination already exists: ${input.filePath}`))
    yield* input.fs.remove(temporary, { force: true }).pipe(Effect.ignore)
    yield* progress("starting", true)

    const request = HttpClientRequest.get(input.url).pipe(
      HttpClientRequest.setHeaders({
        "User-Agent": "opencode",
        Accept: "*/*",
        "Accept-Encoding": "identity",
      }),
    )
    const response = yield* input.http.execute(request).pipe(Effect.flatMap(HttpClientResponse.filterStatusOk))
    totalBytes = declaredLength(response)
    yield* progress("downloading", true)

    yield* Effect.scoped(
      Effect.acquireRelease(
        Effect.tryPromise({
          try: () => open(temporary, "wx"),
          catch: (cause) => new Error(`Unable to create temporary download file: ${temporary}`, { cause }),
        }),
        (handle) => Effect.promise(() => handle.close()).pipe(Effect.ignore),
      ).pipe(
        Effect.flatMap((handle) =>
          Stream.runForEach(response.stream, (chunk) =>
            writeAll(handle, chunk).pipe(
              Effect.tap(() =>
                Effect.sync(() => {
                  hash.update(chunk)
                  receivedBytes += chunk.byteLength
                }),
              ),
              Effect.andThen(progress("downloading")),
            ),
          ),
        ),
      ),
    )

    yield* progress("verifying", true)
    const sha256 = hash.digest("hex")
    if (input.expectedSha256 && sha256 !== input.expectedSha256.toLowerCase())
      return yield* Effect.fail(
        new Error(`SHA-256 mismatch: expected ${input.expectedSha256.toLowerCase()}, received ${sha256}`),
      )
    yield* input.fs.rename(temporary, input.filePath)
    yield* progress("completed", true)

    const elapsedMs = Math.max(Date.now() - started, 1)
    return {
      phase: "completed" as const,
      url: input.url,
      filePath: input.filePath,
      receivedBytes,
      ...(totalBytes === undefined ? {} : { totalBytes }),
      ...(totalBytes && totalBytes > 0
        ? { percent: Math.min(100, Math.max(0, (receivedBytes / totalBytes) * 100)) }
        : {}),
      bytesPerSecond: Math.round((receivedBytes * 1000) / elapsedMs),
      elapsedMs,
      sha256,
    } satisfies Result
  }).pipe(Effect.ensuring(input.fs.remove(temporary, { force: true }).pipe(Effect.ignore)))
})
