import { FileSystem } from "@opencode-ai/core/filesystem"
import { RelativePath } from "@opencode-ai/core/schema"
import { Effect } from "effect"
import { HttpServerResponse } from "effect/unstable/http"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Api } from "../api"
import { response } from "../location"

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
          const safe = filename.replace(/[^\w.\-]/g, "_")
          return HttpServerResponse.uint8Array(file.content, {
            contentType: file.mime,
            headers: { "content-disposition": `attachment; filename="${safe}"` },
          })
        }),
      )
      .handle("fs.upload", (ctx) =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.Service
          const content = Buffer.from(ctx.payload.content, "base64")
          yield* fs.write({ path: ctx.query.path, content })
        }),
      )
      .handle("fs.delete", (ctx) =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.Service
          yield* fs.remove({ path: ctx.query.path })
        }),
      )
  }),
)
