import { BrowseError } from "@opencode-ai/protocol/groups/browse"
import { FileSystem } from "@opencode-ai/schema/filesystem"
import { RelativePath } from "@opencode-ai/schema/schema"
import { FSUtil } from "@opencode-ai/util/fs-util"
import path from "path"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Api } from "../api"

function failure(message: string) {
  return new BrowseError({ name: "BrowseError", data: { message } })
}

function describe(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  return message.split("\n")[0] ?? message
}

export const BrowseHandler = HttpApiBuilder.group(Api, "server.browse", (handlers) =>
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    return handlers.handle("browse.list", (ctx) =>
      Effect.gen(function* () {
        const directory = ctx.query.directory
        const info = yield* fs.stat(directory).pipe(
          Effect.mapError((error) => failure(`Cannot access ${directory}: ${describe(error)}`)),
        )
        if (info.type !== "Directory") return yield* Effect.fail(failure(`Not a directory: ${directory}`))
        const items = yield* fs.readDirectoryEntries(directory).pipe(
          Effect.mapError((error) => failure(`Cannot list ${directory}: ${describe(error)}`)),
        )
        return {
          directory,
          entries: items
            .flatMap((item) =>
              item.type === "file" || item.type === "directory"
                ? [
                    FileSystem.Entry.make({
                      path: RelativePath.make(item.name + (item.type === "directory" ? path.sep : "")),
                      type: item.type,
                    }),
                  ]
                : [],
            )
            .sort((a, b) => (a.type === b.type ? a.path.localeCompare(b.path) : a.type === "directory" ? -1 : 1)),
        }
      }),
    )
  }),
)
