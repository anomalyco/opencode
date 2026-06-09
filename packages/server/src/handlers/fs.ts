import { FileSystem } from "@opencode-ai/core/filesystem"
import { Search } from "@opencode-ai/core/filesystem/search"
import { Location } from "@opencode-ai/core/location"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Api } from "../api"
import { response } from "../groups/location"

export const FileSystemHandler = HttpApiBuilder.group(Api, "server.fs", (handlers) =>
  Effect.gen(function* () {
    return handlers
      .handle("fs.read", (ctx) =>
        response(
          Effect.gen(function* () {
            const fs = yield* FileSystem.Service
            return yield* fs.read(ctx.query)
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
            const location = yield* Location.Service
            const search = yield* Search.Service
            return yield* search
              .find({
                cwd: AbsolutePath.make(location.directory),
                query: ctx.query.query,
                type: ctx.query.type,
                limit: ctx.query.limit,
              })
              .pipe(Effect.orDie)
          }),
        ),
      )
  }),
)
