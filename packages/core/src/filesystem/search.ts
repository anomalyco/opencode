export * as FileSystemSearch from "./search"

import path from "path"
import { Context, Effect, Layer } from "effect"
import { Fff } from "#fff"
import fuzzysort from "fuzzysort"
import { FileSystem } from "../filesystem"
import { FSUtil } from "../fs-util"
import { Location } from "../location"
import { Ripgrep } from "../ripgrep"
import { RelativePath } from "../schema"
import { Flag } from "../flag/flag"

export interface Interface {
  readonly find: (input: FileSystem.FindInput) => Effect.Effect<FileSystem.Entry[]>
  readonly glob: (input: FileSystem.GlobInput) => Effect.Effect<readonly FileSystem.Entry[]>
  readonly grep: (input: FileSystem.GrepInput) => Effect.Effect<readonly FileSystem.Match[]>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/FileSystem/Search") {}

export const ripgrepLayer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    const location = yield* Location.Service
    const ripgrep = yield* Ripgrep.Service
    const root = yield* fs.realPath(location.directory).pipe(Effect.orDie)
    const resolve = Effect.fnUntraced(function* (input?: RelativePath) {
      const absolute = path.resolve(location.directory, input ?? ".")
      if (!FSUtil.contains(location.directory, absolute))
        return yield* Effect.die(new Error("Path escapes the location"))
      const real = yield* fs.realPath(absolute).pipe(Effect.orDie)
      if (!FSUtil.contains(root, real)) return yield* Effect.die(new Error("Path escapes the location"))
      return { absolute, info: yield* fs.stat(real).pipe(Effect.orDie) }
    })
    const state = {
      files: [] as string[],
      directories: [] as string[],
    }
    const directories = new Set<string>()
    yield* ripgrep
      .find({
        cwd: location.directory,
        pattern: "*",
        limit: location.vcs ? Number.MAX_SAFE_INTEGER : 100_000,
        onEntry: (entry) =>
          Effect.sync(() => {
            state.files.push(entry.path)
            const parts = entry.path.split("/")
            parts.slice(0, -1).forEach((_, index) => directories.add(parts.slice(0, index + 1).join("/") + path.sep))
            state.directories = Array.from(directories)
          }),
      })
      .pipe(Effect.orDie, Effect.asVoid)
    return Service.of({
      glob: (input) =>
        Effect.gen(function* () {
          const target = yield* resolve(input.path)
          const cwd = target.info.type === "File" ? path.dirname(target.absolute) : target.absolute
          return yield* ripgrep
            .glob({
              cwd,
              pattern: input.pattern,
              limit: input.limit ?? Number.MAX_SAFE_INTEGER,
            })
            .pipe(
              Effect.map((result) =>
                result.map(
                  (entry) =>
                    new FileSystem.Entry({
                      path: RelativePath.make(path.relative(location.directory, path.resolve(cwd, entry.path))),
                      type: entry.type,
                      mime: entry.mime,
                    }),
                ),
              ),
              Effect.orDie,
            )
        }),
      grep: (input) =>
        Effect.gen(function* () {
          const target = yield* resolve(input.path)
          const cwd = target.info.type === "File" ? path.dirname(target.absolute) : target.absolute
          return yield* ripgrep
            .grep({
              cwd,
              pattern: input.pattern,
              file: target.info.type === "File" ? path.basename(target.absolute) : undefined,
              include: input.include,
              limit: input.limit ?? Number.MAX_SAFE_INTEGER,
            })
            .pipe(
              Effect.map((result) =>
                result.map(
                  (match) =>
                    new FileSystem.Match({
                      entry: new FileSystem.Entry({
                        path: RelativePath.make(path.relative(location.directory, path.resolve(cwd, match.entry.path))),
                        type: match.entry.type,
                        mime: match.entry.mime,
                      }),
                      line: match.line,
                      offset: match.offset,
                      text: match.text,
                      submatches: match.submatches,
                    }),
                ),
              ),
              Effect.orDie,
            )
        }),
      find: (input) =>
        Effect.gen(function* () {
          const items =
            input.type === "file"
              ? state.files
              : input.type === "directory"
                ? state.directories
                : [...state.files, ...state.directories]
          return fuzzysort.go(input.query, items, { limit: input.limit ?? 50 }).map((item) => {
            const relative = item.target
            const type = relative.endsWith(path.sep) ? ("directory" as const) : ("file" as const)
            const clean = type === "directory" ? relative.slice(0, -path.sep.length) : relative
            const absolute = path.resolve(location.directory, clean)
            return new FileSystem.Entry({
              path: RelativePath.make(relative),
              type,
              mime: type === "directory" ? "application/x-directory" : FSUtil.mimeType(absolute),
            })
          })
        }),
    })
  }),
)

export const fffLayer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    const location = yield* Location.Service
    const root = yield* fs.realPath(location.directory).pipe(Effect.orDie)
    const resolve = Effect.fnUntraced(function* (input?: RelativePath) {
      const absolute = path.resolve(location.directory, input ?? ".")
      if (!FSUtil.contains(location.directory, absolute))
        return yield* Effect.die(new Error("Path escapes the location"))
      const real = yield* fs.realPath(absolute).pipe(Effect.orDie)
      if (!FSUtil.contains(root, real)) return yield* Effect.die(new Error("Path escapes the location"))
      return real
    })
    const result = yield* Effect.try({
      try: () =>
        Fff.create({
          basePath: location.directory,
          aiMode: true,
          enableFsRootScanning: true,
          enableHomeDirScanning: true,
        }),
      catch: (cause) => cause,
    }).pipe(Effect.orDie)
    if (!result.ok) return yield* Effect.die(result.error)
    yield* Effect.addFinalizer(() => Effect.sync(() => result.value.destroy()).pipe(Effect.ignore))
    return Service.of({
      glob: (input) =>
        Effect.gen(function* () {
          yield* resolve(input.path)
          const prefix = input.path?.replaceAll("\\", "/").replace(/\/$/, "")
          return yield* Effect.sync(() => {
            const found = result.value.glob(prefix ? `${prefix}/${input.pattern}` : input.pattern, {
              pageIndex: 0,
              pageSize: input.limit,
            })
            if (!found.ok) throw found.error
            return found.value.items.map((item) => {
              const absolute = path.resolve(location.directory, item.relativePath)
              return new FileSystem.Entry({
                path: RelativePath.make(item.relativePath.replaceAll("\\", "/")),
                type: "file",
                mime: FSUtil.mimeType(absolute),
              })
            })
          })
        }),
      grep: (input) =>
        Effect.gen(function* () {
          yield* resolve(input.path)
          const prefix = input.path?.replaceAll("\\", "/").replace(/\/$/, "")
          return yield* Effect.sync(() => {
            const found = result.value.grep(
              [prefix ? `${prefix}/**` : undefined, input.include, input.pattern]
                .filter((value) => value !== undefined)
                .join(" "),
              { mode: "regex", pageSize: input.limit, timeBudgetMs: 1_500 },
            )
            if (!found.ok) throw found.error
            return found.value.items.map((match) => {
              const bytes = Buffer.from(match.lineContent)
              return new FileSystem.Match({
                entry: new FileSystem.Entry({
                  path: RelativePath.make(match.relativePath.replaceAll("\\", "/")),
                  type: "file",
                  mime: FSUtil.mimeType(match.relativePath),
                }),
                line: match.lineNumber,
                offset: match.byteOffset,
                text: match.lineContent.length > 2_000 ? match.lineContent.slice(0, 2_000) + "..." : match.lineContent,
                submatches: match.matchRanges.map(([start, end]) => ({
                  text: bytes.subarray(start, end).toString("utf8"),
                  start,
                  end,
                })),
              })
            })
          })
        }),
      find: (input) =>
        Effect.sync(() => {
          const options = { pageIndex: 0, pageSize: input.limit ?? 50 }
          const items = (() => {
            if (input.type === "file") {
              const found = result.value.fileSearch(input.query.trim(), options)
              if (!found.ok) throw found.error
              return found.value.items.map((item, index) => ({
                path: item.relativePath,
                type: "file" as const,
                score: found.value.scores[index]?.total ?? 0,
              }))
            }
            if (input.type === "directory") {
              const found = result.value.directorySearch(input.query.trim(), options)
              if (!found.ok) throw found.error
              return found.value.items.map((item, index) => ({
                path: item.relativePath,
                type: "directory" as const,
                score: found.value.scores[index]?.total ?? 0,
              }))
            }
            const found = result.value.mixedSearch(input.query.trim(), options)
            if (!found.ok) throw found.error
            return found.value.items.map((item, index) => ({
              path: item.item.relativePath,
              type: item.type,
              score: found.value.scores[index]?.total ?? 0,
            }))
          })()
          return items
            .sort((a, b) => b.score - a.score || a.path.length - b.path.length)
            .map((item) => {
              const relative = item.path.replaceAll("\\", "/").replace(/\/$/, "")
              const absolute = path.resolve(location.directory, relative)
              return new FileSystem.Entry({
                path: RelativePath.make(relative + (item.type === "directory" ? path.sep : "")),
                type: item.type,
                mime: item.type === "directory" ? "application/x-directory" : FSUtil.mimeType(absolute),
              })
            })
        }),
    })
  }),
)

export const defaultLayer = Layer.unwrap(
  Effect.sync(() => (Flag.OPENCODE_DISABLE_FFF || !Fff.available() ? ripgrepLayer : fffLayer)),
)
