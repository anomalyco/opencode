import { Effect, FileSystem, Layer } from "effect"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Glob } from "@opencode-ai/core/util/glob"
import { makeGlobalNode } from "@opencode-ai/core/effect/app-node"
import { filesystem } from "@opencode-ai/core/effect/app-node-platform"
import path from "path"

/**
 * Simulation replacement for `FSUtil`.
 *
 * The real `FSUtil` layer builds most helpers on the injected
 * `FileSystem.FileSystem`, but `readDirectoryEntries`, `glob`, and `globUp`
 * reach for node `fs/promises` and the `glob` package directly, and `resolve`
 * canonicalizes through the host filesystem. This wraps the real layer and
 * reroutes those through the injected `FileSystem`/lexical path resolution so
 * every read observes the in-memory tree.
 */

const layer = Layer.effect(
  FSUtil.Service,
  Effect.gen(function* () {
    const base = yield* FSUtil.Service
    const fs = yield* FileSystem.FileSystem

    const resolve = Effect.fn("SimulationFSUtil.resolve")(function* (input: string) {
      return input
    })

    const readDirectoryEntries = Effect.fn("SimulationFSUtil.readDirectoryEntries")(function* (dirPath: string) {
      const names = yield* fs.readDirectory(dirPath)
      return yield* Effect.forEach(names, (name) =>
        fs.stat(path.join(dirPath, name)).pipe(
          Effect.map(
            (info): FSUtil.DirEntry => ({
              name,
              type:
                info.type === "Directory"
                  ? "directory"
                  : info.type === "File"
                    ? "file"
                    : info.type === "SymbolicLink"
                      ? "symlink"
                      : "other",
            }),
          ),
          Effect.orElseSucceed((): FSUtil.DirEntry => ({ name, type: "other" })),
        ),
      )
    })

    const glob = Effect.fn("SimulationFSUtil.glob")(function* (pattern: string, options?: Glob.Options) {
      const cwd = path.resolve(options?.cwd ?? process.cwd())
      const entries = yield* fs
        .readDirectory(cwd, { recursive: true })
        .pipe(Effect.orElseSucceed(() => [] as string[]))
      const matches = yield* Effect.forEach(entries, (entry) =>
        fs.stat(path.join(cwd, entry)).pipe(
          Effect.map((info) => ({ entry, type: info.type })),
          Effect.orElseSucceed(() => undefined),
        ),
      )
      return matches
        .filter((item) => item !== undefined)
        .filter((item) => options?.include === "all" || item.type === "File")
        .filter((item) => Glob.match(pattern, item.entry))
        .map((item) => (options?.absolute ? path.join(cwd, item.entry) : item.entry))
        .sort((a, b) => a.localeCompare(b))
    })

    const globUp = Effect.fn("SimulationFSUtil.globUp")(function* (pattern: string, start: string, stop?: string) {
      const result: string[] = []
      let current = path.resolve(start)
      while (true) {
        result.push(...(yield* glob(pattern, { cwd: current, absolute: true, include: "file", dot: true })))
        if (stop === current) break
        const parent = path.dirname(current)
        if (parent === current) break
        current = parent
      }
      return result
    })

    return FSUtil.Service.of({ ...base, readDirectoryEntries, resolve, glob, globUp })
  }),
).pipe(Layer.provide(FSUtil.layer))

export const node = makeGlobalNode({ service: FSUtil.Service, layer, deps: [filesystem] })

export * as SimulationFSUtil from "./fs-util"
