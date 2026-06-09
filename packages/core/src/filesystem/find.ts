export * as FileSystemFind from "./find"

import path from "path"
import { pathToFileURL } from "url"
import { Context, Effect, Fiber, Layer, Schema, Scope } from "effect"
import { Fff } from "#fff"
import fuzzysort from "fuzzysort"
import { FileSystem } from "../filesystem"
import { FSUtil } from "../fs-util"
import { Location } from "../location"
import { Ripgrep } from "../ripgrep"
import { PositiveInt, RelativePath } from "../schema"

export class Input extends Schema.Class<Input>("FileSystem.FindInput")({
  query: Schema.String,
  type: Schema.Literals(["file", "directory"]).pipe(Schema.optional),
  limit: PositiveInt.pipe(Schema.optional),
}) {}

export interface Interface {
  readonly find: (input: Input) => Effect.Effect<FileSystem.Entry[]>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/FileSystem/Find") {}

export const ripgrepLayer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const location = yield* Location.Service
    const ripgrep = yield* Ripgrep.Service
    const scope = yield* Scope.Scope
    const state = {
      files: [] as string[],
      directories: [] as string[],
      scan: undefined as Fiber.Fiber<void, never> | undefined,
    }
    state.scan = yield* ripgrep.files({ cwd: location.directory, pattern: "*", limit: 100_000 }).pipe(
      Effect.tap((result) =>
        Effect.sync(() => {
          state.files = result.items.map((item) => item.replaceAll("\\", "/"))
          state.directories = Array.from(
            new Set(
              state.files.flatMap((file) => {
                const parts = file.split("/")
                return parts.slice(0, -1).map((_, index) => parts.slice(0, index + 1).join("/") + path.sep)
              }),
            ),
          )
        }),
      ),
      Effect.orDie,
      Effect.asVoid,
      Effect.forkIn(scope),
    )
    return Service.of({
      find: (input) =>
        Effect.gen(function* () {
          if (input.query) yield* Fiber.join(state.scan!)
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
              path: RelativePath.make(clean + (type === "directory" ? path.sep : "")),
              uri: pathToFileURL(absolute).href,
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
    const location = yield* Location.Service
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
    const scanned = yield* Effect.tryPromise({
      try: () => result.value.waitForScan(5_000),
      catch: (cause) => cause,
    }).pipe(Effect.orDie)
    if (!scanned.ok || !scanned.value) return yield* Effect.die(scanned.ok ? "fff scan timed out" : scanned.error)
    return Service.of({
      find: (input) =>
        Effect.sync(() => {
          const options = { pageIndex: 0, pageSize: input.limit ?? 50 }
          const items = (() => {
            if (input.type === "file") {
              const found = result.value.fileSearch(input.query.trim(), options)
              if (!found.ok) throw found.error
              return found.value.items.map((item) => ({ path: item.relativePath, type: "file" as const }))
            }
            if (input.type === "directory") {
              const found = result.value.directorySearch(input.query.trim(), options)
              if (!found.ok) throw found.error
              return found.value.items.map((item) => ({ path: item.relativePath, type: "directory" as const }))
            }
            const found = result.value.mixedSearch(input.query.trim(), options)
            if (!found.ok) throw found.error
            return found.value.items.map((item) => ({ path: item.item.relativePath, type: item.type }))
          })()
          return items.map((item) => {
            const relative = item.path.replaceAll("\\", "/").replace(/\/$/, "")
            const absolute = path.resolve(location.directory, relative)
            return new FileSystem.Entry({
              path: RelativePath.make(relative + (item.type === "directory" ? path.sep : "")),
              uri: pathToFileURL(absolute).href,
              type: item.type,
              mime: item.type === "directory" ? "application/x-directory" : FSUtil.mimeType(absolute),
            })
          })
        }),
    })
  }),
)

export const layer = Layer.unwrap(Effect.sync(() => (Fff.available() ? fffLayer : ripgrepLayer)))
