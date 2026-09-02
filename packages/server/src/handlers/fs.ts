import { FileSystem } from "@opencode-ai/core/filesystem"
import { RelativePath } from "@opencode-ai/core/schema"
import { InvalidRequestError } from "@opencode-ai/protocol/errors"
import { Effect, Schema } from "effect"
import { HttpServerResponse } from "effect/unstable/http"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Api } from "../api"
import { response } from "../location"

export const FileSystemHandler = HttpApiBuilder.group(Api, "server.fs", (handlers) =>
  Effect.gen(function* () {
    return handlers
      .handleRaw("fs.read", (ctx) =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.Service
          const file = yield* fs.read({
            path: RelativePath.make(
              decodeURIComponent(new URL(ctx.request.url, "http://localhost").pathname.slice(13)),
            ),
          })
          return HttpServerResponse.uint8Array(file.content, { contentType: file.mime })
        }),
      )
      .handle("fs.write", (ctx) =>
        response(
          Effect.gen(function* () {
            const fs = yield* FileSystem.Service
            const input = yield* Schema.decodeEffect(FileSystem.WriteInput)(ctx.payload).pipe(
              Effect.mapError(() => new InvalidRequestError({ message: "Content and expected must be valid base64" })),
            )
            return yield* fs.write(input)
          }),
        ),
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
  }),
)
