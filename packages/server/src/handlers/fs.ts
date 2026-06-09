import { FileSystem } from "@opencode-ai/core/filesystem"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Api } from "../api"
import { response } from "../groups/location"

export const FileSystemHandler = HttpApiBuilder.group(Api, "server.fs", (handlers) =>
  Effect.succeed(
    handlers
      .handle("fs.read", (ctx) => response(FileSystem.Service.use((fs) => fs.read(ctx.query))))
      .handle("fs.list", (ctx) => response(FileSystem.Service.use((fs) => fs.list(ctx.query))))
      .handle("fs.find", (ctx) => response(FileSystem.Service.use((fs) => fs.find(ctx.query)))),
  ),
)
