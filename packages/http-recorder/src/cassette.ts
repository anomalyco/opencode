import { Context, Effect, FileSystem, Layer, PlatformError } from "effect"
import * as path from "node:path"
import { cassetteSecretFindings, secretFindings, type SecretFinding } from "./redaction"
import type { Cassette, CassetteMetadata, Interaction } from "./schema"
import { cassetteFor, cassettePath, DEFAULT_RECORDINGS_DIR, formatCassette, parseCassette } from "./storage"

export interface Entry {
  readonly name: string
  readonly path: string
}

export interface Interface {
  readonly path: (name: string) => string
  readonly read: (name: string) => Effect.Effect<Cassette, PlatformError.PlatformError>
  readonly write: (name: string, cassette: Cassette) => Effect.Effect<void, PlatformError.PlatformError>
  readonly append: (
    name: string,
    interaction: Interaction,
    metadata: CassetteMetadata | undefined,
  ) => Effect.Effect<
    {
      readonly cassette: Cassette
      readonly findings: ReadonlyArray<SecretFinding>
    },
    PlatformError.PlatformError
  >
  readonly exists: (name: string) => Effect.Effect<boolean>
  readonly list: () => Effect.Effect<ReadonlyArray<Entry>, PlatformError.PlatformError>
  readonly scan: (cassette: Cassette) => ReadonlyArray<SecretFinding>
}

export class Service extends Context.Service<Service, Interface>()("@opencode-ai/http-recorder/Cassette") {}

export const layer = (options: { readonly directory?: string } = {}) =>
  Layer.effect(
    Service,
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem
      const directory = options.directory ?? DEFAULT_RECORDINGS_DIR
      const recorded = new Map<string, { interactions: Interaction[]; findings: SecretFinding[] }>()
      const directoriesEnsured = new Set<string>()

      const pathFor = (name: string) => cassettePath(name, directory)

      const ensureDirectory = Effect.fn("Cassette.ensureDirectory")(function* (name: string) {
        const dir = path.dirname(pathFor(name))
        if (directoriesEnsured.has(dir)) return
        yield* fileSystem.makeDirectory(dir, { recursive: true })
        directoriesEnsured.add(dir)
      })

      const walk = (directory: string): Effect.Effect<ReadonlyArray<string>, PlatformError.PlatformError> =>
        Effect.gen(function* () {
          const entries = yield* fileSystem
            .readDirectory(directory)
            .pipe(Effect.catch(() => Effect.succeed([] as string[])))
          const nested = yield* Effect.forEach(entries, (entry) => {
            const full = path.join(directory, entry)
            return fileSystem.stat(full).pipe(
              Effect.flatMap((stat) => (stat.type === "Directory" ? walk(full) : Effect.succeed([full]))),
              Effect.catch(() => Effect.succeed([] as string[])),
            )
          })
          return nested.flat()
        })

      const read = Effect.fn("Cassette.read")(function* (name: string) {
        return parseCassette(yield* fileSystem.readFileString(pathFor(name)))
      })

      const write = Effect.fn("Cassette.write")(function* (name: string, cassette: Cassette) {
        yield* ensureDirectory(name)
        yield* fileSystem.writeFileString(pathFor(name), formatCassette(cassette))
      })

      const append = Effect.fn("Cassette.append")(function* (
        name: string,
        interaction: Interaction,
        metadata: CassetteMetadata | undefined,
      ) {
        const entry = recorded.get(name) ?? { interactions: [], findings: [] }
        entry.interactions.push(interaction)
        entry.findings.push(...secretFindings(interaction))
        recorded.set(name, entry)
        const cassette = cassetteFor(name, entry.interactions, metadata)
        const findings = [...entry.findings, ...secretFindings(cassette.metadata ?? {})]
        if (findings.length === 0) yield* write(name, cassette)
        return { cassette, findings }
      })

      const exists = Effect.fn("Cassette.exists")(function* (name: string) {
        return yield* fileSystem.access(pathFor(name)).pipe(
          Effect.as(true),
          Effect.catch(() => Effect.succeed(false)),
        )
      })

      const list = Effect.fn("Cassette.list")(function* () {
        return (yield* walk(directory))
          .filter((file) => file.endsWith(".json"))
          .map((file) => ({
            name: path
              .relative(directory, file)
              .replace(/\\/g, "/")
              .replace(/\.json$/, ""),
            path: file,
          }))
          .toSorted((a, b) => a.name.localeCompare(b.name))
      })

      return Service.of({ path: pathFor, read, write, append, exists, list, scan: cassetteSecretFindings })
    }),
  )

