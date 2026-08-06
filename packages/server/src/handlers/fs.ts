import { FileSystem } from "@opencode-ai/core/filesystem"
import { RelativePath } from "@opencode-ai/core/schema"
import { Effect, Stream } from "effect"
import { HttpServerResponse, Multipart } from "effect/unstable/http"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { InvalidRequestError } from "@opencode-ai/protocol/errors"
import { MaxUploadBytes, MaxUploadRequestBytes, UploadPathPattern } from "@opencode-ai/protocol/groups/fs"
import { Api } from "../api"
import { response } from "../location"

function invalidPath(path: string) {
  return new InvalidRequestError({ message: `Invalid file path: ${path}` })
}

export const FileSystemHandler = HttpApiBuilder.group(Api, "server.fs", (handlers) =>
  Effect.gen(function* () {
    return handlers
      .handleRaw("fs.read", (ctx) =>
        Effect.gen(function* () {
          const file = yield* (yield* FileSystem.Service).read({
            path: RelativePath.make(
              decodeURIComponent(new URL(ctx.request.url, "http://localhost").pathname.slice("/api/fs/read/".length)),
            ),
          })
          return HttpServerResponse.uint8Array(file.content, { contentType: file.mime })
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
      .handleRaw("fs.download", (ctx) =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.Service
          const path = decodeURIComponent(new URL(ctx.request.url, "http://localhost").pathname.slice("/api/fs/download/".length))
          const file = yield* fs.read({
            path: RelativePath.make(path),
          })
          const filename = path.split("/").pop() ?? "download"
          // ASCII fallback plus RFC 5987 UTF-8 filename so non-ASCII names are preserved.
          const ascii = filename.replace(/[^\x20-\x7E]/g, "_").replace(/"/g, "_")
          return HttpServerResponse.uint8Array(file.content, {
            contentType: file.mime,
            headers: {
              "content-disposition": `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
            },
          })
        }),
      )
      .handleRaw("fs.upload", (ctx) =>
        Effect.gen(function* () {
          if (!UploadPathPattern.test(ctx.query.path))
            return yield* Effect.fail(invalidPath(ctx.query.path))
          // Parse the multipart body as a stream with hard limits: at most one
          // part, and the file is rejected as soon as it exceeds the size limit
          // (no full-body buffering, so oversized uploads fail while streaming).
          const parts = Stream.provideContext(
            ctx.request.multipartStream,
            Multipart.limitsServices({
              maxParts: 1,
              maxFileSize: MaxUploadBytes,
              maxTotalSize: MaxUploadRequestBytes,
            }),
          )
          const fs = yield* FileSystem.Service
          // Consume the file part's content *inside* the fold: the multipart
          // parser can only emit the next part after the current part's content
          // has been drained, so deferring writeStream until after runFold would
          // deadlock on any file larger than the parser's initial buffer.
          //
          // The reducer short-circuits after the first file part. This is safe
          // only because `maxParts: 1` guarantees at most one part, so no other
          // part's content can be left undrained. If multi-file uploads are ever
          // supported, every file part's content must be consumed here instead.
          // Only remove the target when we actually streamed content to it: an
          // upload that fails before writing (e.g. a malformed body) must not
          // delete a pre-existing file with the same name. The core writeStream
          // already removes the partial file on write-time errors; this handles
          // rejections that surface after the content was streamed (e.g.
          // FileTooLarge), which would otherwise leave an orphaned file behind.
          let wrote = false
          const written = yield* Stream.runFoldEffect(
            () => false,
            (acc, part) => {
              if (acc) return Effect.succeed(true)
              if (Multipart.isFile(part) && part.key === "file") {
                wrote = true
                return fs.writeStream({ path: ctx.query.path, stream: part.content }).pipe(Effect.as(true))
              }
              return Effect.succeed(false)
            },
          )(parts).pipe(
            Effect.tapError(() => (wrote ? fs.remove({ path: ctx.query.path }).pipe(Effect.orDie) : Effect.void)),
            Effect.mapError((cause) => new InvalidRequestError({ message: `Invalid upload body: ${cause.message}` })),
          )
          if (!written) return yield* Effect.fail(new InvalidRequestError({ message: "Missing file part" }))
        }),
      )
      .handle("fs.delete", (ctx) =>
        Effect.gen(function* () {
          if (!UploadPathPattern.test(ctx.query.path))
            return yield* Effect.fail(invalidPath(ctx.query.path))
          const fs = yield* FileSystem.Service
          yield* fs.remove({ path: ctx.query.path })
        }),
      )
  }),
)
