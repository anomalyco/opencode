import { Context, Effect, FileSystem, Layer, Schema, Semaphore } from "effect"
import { existsSync, rmSync } from "node:fs"
import path from "node:path"
import { secretFindings, SecretFindingSchema, type SecretFinding } from "../redaction/secrets.js"
import { CassetteSchema, encodeCassette, type Cassette, type CassetteMetadata, type Interaction } from "./model.js"

const DEFAULT_RECORDINGS_DIR = path.resolve(process.cwd(), "test", "fixtures", "recordings")

export class CassetteNotFoundError extends Schema.TaggedErrorClass<CassetteNotFoundError>()("CassetteNotFoundError", {
  cassetteName: Schema.String,
}) {
  override get message() {
    return `Cassette "${this.cassetteName}" not found`
  }
}

export class InvalidCassetteError extends Schema.TaggedErrorClass<InvalidCassetteError>()("InvalidCassetteError", {
  cassetteName: Schema.String,
  description: Schema.String,
}) {
  override get message() {
    return `Cassette "${this.cassetteName}" is invalid: ${this.description}`
  }
}

export class UnsafeCassetteError extends Schema.TaggedErrorClass<UnsafeCassetteError>()("UnsafeCassetteError", {
  cassetteName: Schema.String,
  findings: Schema.Array(SecretFindingSchema),
}) {
  override get message() {
    return `Refusing to write cassette "${this.cassetteName}" because it contains possible secrets: ${this.findings
      .map((finding) => `${finding.path} (${finding.reason})`)
      .join(", ")}`
  }
}

export interface Interface {
  readonly read: (
    name: string,
  ) => Effect.Effect<ReadonlyArray<Interaction>, CassetteNotFoundError | InvalidCassetteError>
  readonly append: (
    name: string,
    interaction: Interaction,
    metadata?: CassetteMetadata,
  ) => Effect.Effect<void, UnsafeCassetteError>
  readonly exists: (name: string) => Effect.Effect<boolean>
  readonly list: () => Effect.Effect<ReadonlyArray<string>>
}

export class Service extends Context.Service<Service, Interface>()("@opencode-ai/http-recorder/Cassette") {}

const cassettePath = (directory: string, name: string) => {
  if (!name || path.isAbsolute(name) || path.win32.isAbsolute(name) || name.split(/[\\/]/).includes(".."))
    throw new Error(`Invalid cassette name "${name}"`)
  const root = path.resolve(directory)
  const target = path.resolve(root, `${name}.json`)
  const relative = path.relative(root, target)
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative))
    throw new Error(`Invalid cassette name "${name}"`)
  return target
}

export const hasCassetteSync = (name: string, options: { readonly directory?: string } = {}) =>
  existsSync(cassettePath(options.directory ?? DEFAULT_RECORDINGS_DIR, name))

export const removeCassetteSync = (name: string, options: { readonly directory?: string } = {}) =>
  rmSync(cassettePath(options.directory ?? DEFAULT_RECORDINGS_DIR, name), { force: true })

const buildCassette = (
  name: string,
  interactions: ReadonlyArray<Interaction>,
  metadata: CassetteMetadata | undefined,
): Cassette => ({
  version: 1,
  metadata: { ...metadata, name, recordedAt: new Date().toISOString() },
  interactions,
})
const formatCassette = (cassette: Cassette) => `${JSON.stringify(encodeCassette(cassette), null, 2)}\n`
const parseCassette = Schema.decodeUnknownSync(Schema.fromJsonString(CassetteSchema))
const invalidCassette = (name: string, error: unknown) =>
  new InvalidCassetteError({
    cassetteName: name,
    description: error instanceof Error ? error.message : String(error),
  })
const failIfUnsafe = (name: string, findings: ReadonlyArray<SecretFinding>) =>
  findings.length === 0 ? Effect.void : Effect.fail(new UnsafeCassetteError({ cassetteName: name, findings }))

export const fileSystem = (
  options: { readonly directory?: string } = {},
): Layer.Layer<Service, never, FileSystem.FileSystem> =>
  Layer.effect(
    Service,
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const directory = options.directory ?? DEFAULT_RECORDINGS_DIR
      const recorded = new Map<string, { interactions: Interaction[]; findings: SecretFinding[] }>()
      const appendLock = yield* Semaphore.make(1)
      const pathFor = (name: string) => cassettePath(directory, name)
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
          fs.readFileString(pathFor(name)).pipe(
            Effect.mapError((error) =>
              error.reason._tag === "NotFound"
                ? new CassetteNotFoundError({ cassetteName: name })
                : invalidCassette(name, error),
            ),
            Effect.flatMap((raw) =>
              Effect.try({
                try: () => parseCassette(raw).interactions,
                catch: (error) => invalidCassette(name, error),
              }),
            ),
          ),
        append: (name, interaction, metadata) =>
          appendLock.withPermit(
            Effect.gen(function* () {
              const entry = recorded.get(name) ?? { interactions: [], findings: [] }
              const interactions = [...entry.interactions, interaction]
              const interactionFindings = [...entry.findings, ...secretFindings(interaction)]
              const cassette = buildCassette(name, interactions, metadata)
              const findings = [...interactionFindings, ...secretFindings(cassette.metadata ?? {})]
              yield* failIfUnsafe(name, findings)
              const target = pathFor(name)
              yield* fs.makeDirectory(path.dirname(target), { recursive: true }).pipe(Effect.orDie)
              const temporary = `${target}.${crypto.randomUUID()}.tmp`
              yield* fs.writeFileString(temporary, formatCassette(cassette)).pipe(
                Effect.flatMap(() => fs.rename(temporary, target)),
                Effect.ensuring(fs.remove(temporary, { force: true }).pipe(Effect.catch(() => Effect.void))),
                Effect.orDie,
              )
              recorded.set(name, { interactions, findings: interactionFindings })
            }),
          ),
        exists: (name) =>
          fs.access(pathFor(name)).pipe(
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
    const appendLock = Semaphore.makeUnsafe(1)
    return Service.of({
      read: (name) =>
        stored.has(name)
          ? Effect.succeed(stored.get(name) ?? [])
          : Effect.fail(new CassetteNotFoundError({ cassetteName: name })),
      append: (name, interaction, metadata) =>
        appendLock.withPermit(
          Effect.suspend(() => {
            const interactions = [...(stored.get(name) ?? []), interaction]
            const findings = [...(accumulatedFindings.get(name) ?? []), ...secretFindings(interaction)]
            const allFindings = metadata ? [...findings, ...secretFindings({ ...metadata, name })] : findings
            return failIfUnsafe(name, allFindings).pipe(
              Effect.tap(() =>
                Effect.sync(() => {
                  stored.set(name, interactions)
                  accumulatedFindings.set(name, findings)
                }),
              ),
            )
          }),
        ),
      exists: (name) => Effect.sync(() => stored.has(name)),
      list: () => Effect.sync(() => Array.from(stored.keys()).toSorted()),
    })
  })
