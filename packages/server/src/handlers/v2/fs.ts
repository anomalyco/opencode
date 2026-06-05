import { FileSystem } from "@opencode-ai/core/filesystem"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { V2Api } from "../../api"
import { response } from "../../groups/v2/location"

export const fileSystemHandlers = HttpApiBuilder.group(V2Api, "v2.fs", (handlers) =>
  Effect.gen(function* () {
    return handlers
      .handle("read", (ctx) => response(FileSystem.Service.use((fs) => fs.read(ctx.query))))
      .handle("list", (ctx) => response(FileSystem.Service.use((fs) => fs.list(ctx.query))))
  }),
)
