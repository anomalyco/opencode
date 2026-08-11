export * as ConfigInstructionPlugin from "./instruction"

import { define } from "@opencode-ai/plugin/effect/plugin"
import { FSUtil } from "@opencode-ai/util/fs-util"
import { Global } from "@opencode-ai/util/global"
import { isAbsolute, join, relative, sep } from "path"
import { Effect, PubSub, Semaphore, Stream } from "effect"
import { Watcher } from "../../filesystem/watcher"
import { InstructionDiscovery } from "../../instruction-discovery"
import { Instructions } from "../../instructions/index"
import { Location } from "../../location"
import { AbsolutePath } from "../../schema"

export const Plugin = define({
  id: "opencode.config.instruction",
  effect: Effect.fn(function* () {
    const discovery = yield* InstructionDiscovery.Service
    yield* Effect.gen(function* () {
      const fs = yield* FSUtil.Service
      const global = yield* Global.Service
      const location = yield* Location.Service
      const watcher = yield* Watcher.Service
      const changes = yield* PubSub.sliding<string>(1)
      const lock = Semaphore.makeUnsafe(1)
      const start = yield* fs.resolve(location.directory)
      const stop = yield* fs.resolve(location.project.directory)
      const fromProject = relative(stop, start)
      const insideProject =
        fromProject === "" || (fromProject !== ".." && !fromProject.startsWith(`..${sep}`) && !isAbsolute(fromProject))
      const project = discovery.project && insideProject
      const globalFile = yield* fs.resolve(join(global.config, "AGENTS.md"))
      const loaded: { files: InstructionDiscovery.File[] | Instructions.Unavailable } = { files: [] }

      const publish = (update: Watcher.Update) => PubSub.publish(changes, update.path).pipe(Effect.asVoid)
      const globalUpdates = yield* watcher.subscribe({ path: globalFile, type: "file" })
      yield* globalUpdates.pipe(Stream.runForEach(publish), Effect.forkScoped({ startImmediately: true }))
      if (project) {
        const projectUpdates = yield* watcher.subscribe({ path: stop, type: "directory" })
        yield* projectUpdates.pipe(
          Stream.filter((update) => FSUtil.contains(stop, update.path) && update.path.endsWith(`${sep}AGENTS.md`)),
          Stream.runForEach(publish),
          Effect.forkScoped({ startImmediately: true }),
        )
      }

      const read = Effect.fn("ConfigInstructionPlugin.read")(function* (path: string, required: boolean) {
        const content = yield* fs.readFileStringSafe(path)
        if (content !== undefined) return new InstructionDiscovery.File({ path: AbsolutePath.make(path), content })
        yield* Effect.logDebug("instruction file skipped", { path, reason: "missing" })
        if (required) return Instructions.unavailable
      })

      const globalSource = Effect.fn("ConfigInstructionPlugin.globalSource")(function* () {
        const file = yield* read(globalFile, false)
        return file instanceof InstructionDiscovery.File ? [file] : []
      })

      const projectSource = Effect.fn("ConfigInstructionPlugin.projectSource")(function* () {
        if (!project) return []
        const discovered = new Set(
          yield* Effect.forEach(yield* fs.up({ targets: ["AGENTS.md"], start, stop }), fs.resolve),
        )
        const files = yield* Effect.forEach(discovered, (path) => read(path, true), { concurrency: "unbounded" })
        if (files.some((file) => file === Instructions.unavailable)) return Instructions.unavailable
        return files.filter((file): file is InstructionDiscovery.File => file !== undefined)
      })

      const isolate = <A, E, R>(source: string, effect: Effect.Effect<A, E, R>) =>
        effect.pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning("failed to load instruction source", { source, cause }).pipe(
              Effect.as(Instructions.unavailable),
            ),
          ),
        )

      const refresh = Effect.fn("ConfigInstructionPlugin.refresh")(function* (file?: string) {
        yield* lock.withPermit(
          Effect.gen(function* () {
            const sources = yield* Effect.all({
              global: isolate("global", globalSource()),
              project: isolate("project", projectSource()),
            })
            loaded.files =
              Array.isArray(sources.global) && Array.isArray(sources.project)
                ? [...sources.global, ...sources.project]
                : Instructions.unavailable
            if (!file) return
            yield* Effect.logInfo("instructions rescanned", {
              file,
              instructions: Array.isArray(loaded.files) ? loaded.files.map((item) => item.path) : "unavailable",
            })
          }),
        )
      })

      yield* Stream.fromPubSub(changes).pipe(
        Stream.runForEach((file) => refresh(file).pipe(Effect.andThen(discovery.reload()))),
        Effect.forkScoped({ startImmediately: true }),
      )
      yield* refresh()
      yield* discovery.transform((draft) => {
        if (!Array.isArray(loaded.files)) {
          draft.unavailable()
          return
        }
        for (const file of loaded.files) draft.add(file)
      })
    }).pipe(
      Effect.catchCause((cause) =>
        Effect.logWarning("failed to activate instruction source", { cause }).pipe(
          Effect.andThen(discovery.transform((draft) => draft.unavailable())),
          Effect.asVoid,
        ),
      ),
    )
  }),
})
