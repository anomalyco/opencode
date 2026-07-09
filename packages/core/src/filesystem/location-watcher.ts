export * as LocationWatcher from "./location-watcher"

import { makeLocationNode } from "../effect/app-node"
import { Context, Effect, Layer, Stream } from "effect"
import { FileSystem } from "@opencode-ai/schema/filesystem"
import os from "os"
import path from "path"
import { Config } from "../config"
import { EventV2 } from "../event"
import { FSUtil } from "../fs-util"
import { Git } from "../git"
import { Location } from "../location"
import { Watcher } from "./watcher"
import { Ignore } from "./ignore"
import { Protected } from "./protected"

function protecteds(dir: string) {
  return Protected.paths().filter((item) => {
    const relative = path.relative(dir, item)
    return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative)
  })
}

export interface Interface {}

export class Service extends Context.Service<Service, Interface>()("@opencode/LocationWatcher") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const location = yield* Location.Service
    const watcher = yield* Watcher.Service
    const events = yield* EventV2.Service
    const fs = yield* FSUtil.Service
    const git = yield* Git.Service
    const configService = yield* Config.Service
    const publish = (update: { type: "create" | "update" | "delete"; path: string }) =>
      events.publish(FileSystem.Event.Changed, {
        file: update.path,
        event: update.type === "create" ? "add" : update.type === "update" ? "change" : "unlink",
      })

    yield* Effect.gen(function* () {
      const config = (yield* configService.entries())
        .filter((entry): entry is Config.Document => entry.type === "document")
        .flatMap((item) => item.info.watcher?.ignore ?? [])
      const home = path.resolve(location.directory) === path.resolve(os.homedir())

      if (!home && location.vcs) {
        yield* watcher
          .subscribe({
            path: location.directory,
            type: "directory",
            ignore: [...Ignore.PATTERNS, ...config, ...protecteds(location.directory)],
          })
          .pipe(Stream.runForEach(publish), Effect.forkScoped)
      }
      if (home) {
        yield* Effect.logInfo("location watcher skipped home directory", { directory: location.directory })
      }

      if (location.vcs?.type === "git") {
        const resolved = (yield* git.repo.discover(location.directory))?.gitDirectory
        const vcs = resolved
          ? yield* fs.realPath(resolved).pipe(Effect.catch(() => Effect.succeed(resolved)))
          : undefined
        if (vcs && !config.includes(".git") && !config.includes(vcs) && (!resolved || !config.includes(resolved))) {
          const ignore = (yield* fs.readDirectoryEntries(vcs).pipe(Effect.catch(() => Effect.succeed([])))).flatMap(
            (entry) => (entry.name === "HEAD" ? [] : [entry.name]),
          )
          yield* watcher
            .subscribe({ path: vcs, type: "directory", ignore })
            .pipe(Stream.runForEach(publish), Effect.forkScoped)
        }
      }
    }).pipe(
      Effect.withSpan("LocationWatcher.start", { attributes: { directory: location.directory } }),
      Effect.catchCause((cause) => Effect.logError("failed to init location watcher service", { cause })),
      Effect.forkScoped,
    )

    return Service.of({})
  }),
)

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [Watcher.node, FSUtil.node, Location.node, Config.node, Git.node, EventV2.node],
})
