import { Effect, FileSystem, Layer } from "effect"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Glob } from "@opencode-ai/core/util/glob"
import { makeGlobalNode } from "@opencode-ai/core/effect/app-node"
import { filesystem } from "@opencode-ai/core/effect/app-node-platform"
import path from "path"

/**
 * Simulation replacement for `FSUtil`.
 *
 * This implementation is intentionally self-contained and only uses the
 * injected simulated `FileSystem.FileSystem`. The default FSUtil layer has a
 * few helpers that reach host-node APIs directly; depending on it here makes it
 * easy for mutation paths to escape or miss the in-memory project tree.
 */

const layer = Layer.effect(
  FSUtil.Service,
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem

    const existsSafe = Effect.fn("SimulationFSUtil.existsSafe")(function* (file: string) {
      return yield* fs.exists(file).pipe(Effect.orElseSucceed(() => false))
    })

    const isDir = Effect.fn("SimulationFSUtil.isDir")(function* (file: string) {
      const info = yield* fs.stat(file).pipe(Effect.catch(() => Effect.succeed(undefined)))
      return info?.type === "Directory"
    })

    const isFile = Effect.fn("SimulationFSUtil.isFile")(function* (file: string) {
      const info = yield* fs.stat(file).pipe(Effect.catch(() => Effect.succeed(undefined)))
      return info?.type === "File"
    })

    const realPath = Effect.fn("SimulationFSUtil.realPath")(function* (file: string) {
      return yield* fs.realPath(file)
    })

    const stat = Effect.fn("SimulationFSUtil.stat")(function* (file: string) {
      return yield* fs.stat(file)
    })

    const readFile = Effect.fn("SimulationFSUtil.readFile")(function* (file: string) {
      return yield* fs.readFile(file)
    })

    const readFileString = Effect.fn("SimulationFSUtil.readFileString")(function* (file: string) {
      return yield* fs.readFileString(file)
    })

    const readFileStringSafe = Effect.fn("SimulationFSUtil.readFileStringSafe")(function* (file: string) {
      return yield* fs
        .readFileString(file)
        .pipe(Effect.catchReason("PlatformError", "NotFound", () => Effect.succeed(undefined)))
    })

    const readJson = Effect.fn("SimulationFSUtil.readJson")(function* (file: string) {
      const text = yield* readFileString(file)
      return JSON.parse(text) as unknown
    })

    const writeFile = Effect.fn("SimulationFSUtil.writeFile")(function* (
      file: string,
      data: Uint8Array,
      options?: Parameters<typeof fs.writeFile>[2],
    ) {
      return yield* fs.writeFile(file, data, options)
    })

    const writeFileString = Effect.fn("SimulationFSUtil.writeFileString")(function* (
      file: string,
      data: string,
      options?: Parameters<typeof fs.writeFileString>[2],
    ) {
      return yield* fs.writeFileString(file, data, options)
    })

    const makeDirectory: FileSystem.FileSystem["makeDirectory"] = (file, options) => fs.makeDirectory(file, options)

    const ensureDir = Effect.fn("SimulationFSUtil.ensureDir")(function* (file: string) {
      yield* fs.makeDirectory(file, { recursive: true })
    })

    const writeWithDirs = Effect.fn("SimulationFSUtil.writeWithDirs")(function* (
      file: string,
      content: string | Uint8Array,
      mode?: number,
    ) {
      const write =
        typeof content === "string"
          ? fs.writeFileString(file, content)
          : fs.writeFile(file, content)
      yield* write.pipe(
        Effect.catchReason("PlatformError", "NotFound", () =>
          fs.makeDirectory(path.dirname(file), { recursive: true }).pipe(Effect.andThen(write)),
        ),
      )
      if (mode !== undefined) yield* fs.chmod(file, mode)
    })

    const writeJson = Effect.fn("SimulationFSUtil.writeJson")(function* (file: string, data: unknown, mode?: number) {
      yield* writeFileString(file, JSON.stringify(data, null, 2))
      if (mode !== undefined) yield* fs.chmod(file, mode)
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

    const resolve = Effect.fn("SimulationFSUtil.resolve")(function* (input: string) {
      return path.resolve(input)
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

    const up = Effect.fn("SimulationFSUtil.up")(function* (options: { targets: string[]; start: string; stop?: string }) {
      const result: string[] = []
      let current = path.resolve(options.start)
      while (true) {
        for (const target of options.targets) {
          const search = path.join(current, target)
          if (yield* fs.exists(search)) result.push(search)
        }
        if (options.stop === current) break
        const parent = path.dirname(current)
        if (parent === current) break
        current = parent
      }
      return result
    })

    const findUp = Effect.fn("SimulationFSUtil.findUp")(function* (target: string, start: string, stop?: string) {
      return yield* up({ targets: [target], start, stop })
    })

    return FSUtil.Service.of({
      ...fs,
      realPath,
      stat,
      readFile,
      readFileString,
      writeFile,
      writeFileString,
      makeDirectory,
      isDir,
      isFile,
      existsSafe,
      readFileStringSafe,
      readJson,
      writeJson,
      ensureDir,
      writeWithDirs,
      readDirectoryEntries,
      resolve,
      findUp,
      up,
      globUp,
      glob,
      globMatch: Glob.match,
    })
  }),
)

export const node = makeGlobalNode({ service: FSUtil.Service, layer, deps: [filesystem] })

export * as SimulationFSUtil from "./fs-util"
