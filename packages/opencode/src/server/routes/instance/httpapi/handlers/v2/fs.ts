import { LocationFileSystem } from "@opencode-ai/core/location-filesystem"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../../api"

export const fileSystemHandlers = HttpApiBuilder.group(InstanceHttpApi, "v2.fs", (handlers) =>
  Effect.gen(function* () {
    return handlers
      .handle("read", (ctx) => LocationFileSystem.Service.use((fs) => fs.read(ctx.query)))
      .handle("list", (ctx) => LocationFileSystem.Service.use((fs) => fs.list(ctx.query)))
  }),
)
