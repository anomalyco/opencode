import { Context, Effect, FileSystem, Layer, PlatformError } from "effect"
import * as path from "node:path"
import { cassetteSecretFindings, type SecretFinding } from "./redaction"
import type { Cassette } from "./schema"
import { cassettePath, DEFAULT_RECORDINGS_DIR, formatCassette, parseCassette } from "./storage"

export interface Entry {
  readonly name: string
  readonly path: string
}

export interface Interface {
  readonly path: (name: string) => string
  readonly read: (name: string) => Effect.Effect<Cassette, PlatformError.PlatformError>
  readonly write: (name: string, cassette: Cassette) => Effect.Effect<void, PlatformError.PlatformError>
  readonly exists: (name: string) => Effect.Effect<boolean>
  readonly list: () => Effect.Effect<ReadonlyArray<Entry>, PlatformError.PlatformError>
  readonly scan: (cassette: Cassette) => ReadonlyArray<SecretFinding>
}

export class Service extends Context.Service<Service, Interface>()("@opencode-ai/http-recorder/Cassette") {}

const walk = (
  fileSystem: FileSystem.FileSystem,
  directory: string,
): Effect.Effect<ReadonlyArray<string>, PlatformError.PlatformError> =>
  Effect.gen(function* () {
    const entries = yield* fileSystem.readDirectory(directory).pipe(Effect.catch(() => Effect.succeed([] as string[])))
    const nested = yield* Effect.forEach(entries, (entry) => {
      const full = path.join(directory, entry)
      return fileSystem.stat(full).pipe(
        Effect.flatMap((stat) => (stat.type === "Directory" ? walk(fileSystem, full) : Effect.succeed([full]))),
        Effect.catch(() => Effect.succeed([] as string[])),
      )
    })
    return nested.flat()
  })

export const layer = (options: { readonly directory?: string } = {}) =>
  Layer.effect(
    Service,
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem
      const directory = options.directory ?? DEFAULT_RECORDINGS_DIR

      const pathFor = (name: string) => cassettePath(name, directory)

      const read = Effect.fn("Cassette.read")(function* (name: string) {
        return parseCassette(yield* fileSystem.readFileString(pathFor(name)))
      })

      const write = Effect.fn("Cassette.write")(function* (name: string, cassette: Cassette) {
        yield* fileSystem.makeDirectory(path.dirname(pathFor(name)), { recursive: true })
        yield* fileSystem.writeFileString(pathFor(name), formatCassette(cassette))
      })

      const exists = Effect.fn("Cassette.exists")(function* (name: string) {
        return yield* fileSystem.access(pathFor(name)).pipe(
          Effect.as(true),
          Effect.catch(() => Effect.succeed(false)),
        )
      })

      const list = Effect.fn("Cassette.list")(function* () {
        return (yield* walk(fileSystem, directory))
          .filter((file) => file.endsWith(".json"))
          .map((file) => ({
            name: path.relative(directory, file).replace(/\.json$/, ""),
            path: file,
          }))
          .toSorted((a, b) => a.name.localeCompare(b.name))
      })

      return Service.of({ path: pathFor, read, write, exists, list, scan: cassetteSecretFindings })
    }),
  )

export const defaultLayer = layer()

export * as Cassette from "./cassette"
