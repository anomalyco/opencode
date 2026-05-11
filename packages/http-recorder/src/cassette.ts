import { Context, Effect, FileSystem, Layer, Schema } from "effect"
import * as fs from "node:fs"
import * as path from "node:path"
import { secretFindings, type SecretFinding } from "./redaction"
import { decodeCassette, encodeCassette, type Cassette, type CassetteMetadata, type Interaction } from "./schema"

const DEFAULT_RECORDINGS_DIR = path.resolve(process.cwd(), "test", "fixtures", "recordings")

export class CassetteNotFoundError extends Schema.TaggedErrorClass<CassetteNotFoundError>()("CassetteNotFoundError", {
  cassetteName: Schema.String,
}) {
  override get message() {
    return `Cassette "${this.cassetteName}" not found`
  }
}

export interface AppendResult {
  readonly findings: ReadonlyArray<SecretFinding>
}

export interface Interface {
  readonly read: (name: string) => Effect.Effect<ReadonlyArray<Interaction>, CassetteNotFoundError>
  readonly append: (name: string, interaction: Interaction, metadata?: CassetteMetadata) => Effect.Effect<AppendResult>
  readonly exists: (name: string) => Effect.Effect<boolean>
  readonly list: () => Effect.Effect<ReadonlyArray<string>>
}

export class Service extends Context.Service<Service, Interface>()("@opencode-ai/http-recorder/Cassette") {}

export const hasCassetteSync = (name: string, options: { readonly directory?: string } = {}) =>
  fs.existsSync(path.join(options.directory ?? DEFAULT_RECORDINGS_DIR, `${name}.json`))

const buildCassette = (
  name: string,
  interactions: ReadonlyArray<Interaction>,
  metadata: CassetteMetadata | undefined,
): Cassette => ({
  version: 1,
  metadata: { name, recordedAt: new Date().toISOString(), ...(metadata ?? {}) },
  interactions,
})

const formatCassette = (cassette: Cassette) => `${JSON.stringify(encodeCassette(cassette), null, 2)}\n`

const parseCassette = (raw: string) => decodeCassette(JSON.parse(raw))

export const fileSystem = (
  options: { readonly directory?: string } = {},
): Layer.Layer<Service, never, FileSystem.FileSystem> =>
  Layer.effect(
    Service,
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const directory = options.directory ?? DEFAULT_RECORDINGS_DIR
      const recorded = new Map<string, { interactions: Interaction[]; findings: SecretFinding[] }>()
      const directoriesEnsured = new Set<string>()

      const cassettePath = (name: string) => path.join(directory, `${name}.json`)

      const ensureDirectory = (name: string) =>
        Effect.gen(function* () {
          const dir = path.dirname(cassettePath(name))
          if (directoriesEnsured.has(dir)) return
          yield* fs.makeDirectory(dir, { recursive: true }).pipe(Effect.orDie)
          directoriesEnsured.add(dir)
        })

      const walk = (current: string): Effect.Effect<ReadonlyArray<string>> =>
        Effect.gen(function* () {
          const entries = yield* fs.readDirectory(current).pipe(Effect.catch(() => Effect.succeed([] as string[])))
          const nested = yield* Effect.forEach(entries, (entry) => {
            const full = path.join(current, entry)
            return fs.stat(full).pipe(
              Effect.flatMap((stat) => (stat.type === "Directory" ? walk(full) : Effect.succeed([full]))),
              Effect.catch(() => Effect.succeed([] as string[])),
            )
          })
          return nested.flat()
        })

      return Service.of({
        read: (name) =>
          fs.readFileString(cassettePath(name)).pipe(
            Effect.map((raw) => parseCassette(raw).interactions),
            Effect.catch(() => Effect.fail(new CassetteNotFoundError({ cassetteName: name }))),
          ),
        append: (name, interaction, metadata) =>
          Effect.gen(function* () {
            const entry = recorded.get(name) ?? { interactions: [], findings: [] }
            if (!recorded.has(name)) recorded.set(name, entry)
            entry.interactions.push(interaction)
            entry.findings.push(...secretFindings(interaction))
            const cassette = buildCassette(name, entry.interactions, metadata)
            const findings = [...entry.findings, ...secretFindings(cassette.metadata ?? {})]
            if (findings.length === 0) {
              yield* ensureDirectory(name)
              yield* fs.writeFileString(cassettePath(name), formatCassette(cassette)).pipe(Effect.orDie)
            }
            return { findings }
          }),
        exists: (name) =>
          fs.access(cassettePath(name)).pipe(
            Effect.as(true),
            Effect.catch(() => Effect.succeed(false)),
          ),
        list: () =>
          walk(directory).pipe(
            Effect.map((files) =>
              files
                .filter((file) => file.endsWith(".json"))
                .map((file) =>
                  path
                    .relative(directory, file)
                    .replace(/\\/g, "/")
                    .replace(/\.json$/, ""),
                )
                .toSorted((a, b) => a.localeCompare(b)),
            ),
          ),
      })
    }),
  )

export const memory = (initial: Record<string, ReadonlyArray<Interaction>> = {}): Layer.Layer<Service> =>
  Layer.sync(Service, () => {
    const stored = new Map<string, Interaction[]>(
      Object.entries(initial).map(([name, interactions]) => [name, [...interactions]]),
    )
    const accumulatedFindings = new Map<string, SecretFinding[]>()

    return Service.of({
      read: (name) =>
        stored.has(name)
          ? Effect.succeed(stored.get(name) ?? [])
          : Effect.fail(new CassetteNotFoundError({ cassetteName: name })),
      append: (name, interaction, metadata) =>
        Effect.sync(() => {
          const existing = stored.get(name)
          if (existing) existing.push(interaction)
          else stored.set(name, [interaction])
          const findings = accumulatedFindings.get(name)
          if (findings) findings.push(...secretFindings(interaction))
          else accumulatedFindings.set(name, [...secretFindings(interaction)])
          if (metadata) accumulatedFindings.get(name)!.push(...secretFindings({ name, ...metadata }))
          return { findings: accumulatedFindings.get(name) ?? [] }
        }),
      exists: (name) => Effect.sync(() => stored.has(name)),
      list: () => Effect.sync(() => Array.from(stored.keys()).toSorted()),
    })
  })
