export * as Config from "./config"

import { Global } from "@opencode/util/global"
import { Flock } from "@opencode/util/flock"
import { Context, Effect, FileSystem, Layer, Option, Schema } from "effect"
import { produce, type Draft } from "immer"
import { applyEdits, modify, parse, type ParseError } from "jsonc-parser"
import path from "path"
import { ConfigMigration } from "./migrate"
import { ConfigPersistence } from "./persist"
import { Info, SchemaURL } from "./schema"

export * from "./schema"

export interface Interface {
  readonly path: string
  readonly get: () => Effect.Effect<Info>
  readonly update: (update: (draft: Draft<Info>) => void) => Effect.Effect<Info, Error>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/cli/config/Config") {}

const decode = Schema.decodeUnknownOption(Info)
const decodeRecord = Schema.decodeUnknownOption(Schema.Record(Schema.String, Schema.Unknown))
const empty: Info = {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const global = yield* Global.Service
    const file = path.join(global.config, "cli.json")
    const content = process.env.OPENCODE_CLI_CONFIG_CONTENT
      ? Option.getOrUndefined(decode(parseRecord(process.env.OPENCODE_CLI_CONFIG_CONTENT)))
      : undefined

    const readJson = Effect.fnUntraced(function* () {
      const text = yield* fs.readFileString(file).pipe(Effect.orElseSucceed(() => undefined))
      if (text === undefined) return undefined
      return parseRecord(text)
    })

    const migrate = ConfigMigration.run({ file, config: global.config, state: global.state }).pipe(
      Effect.provideService(FileSystem.FileSystem, fs),
    )
    const withLock = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
      Effect.scoped(
        Effect.uninterruptibleMask((restore) =>
          Effect.gen(function* () {
            const lock = yield* restore(
              Effect.promise((signal) => Flock.acquire(file, { dir: path.join(global.state, "locks"), signal })),
            )
            yield* Effect.addFinalizer(() => Effect.promise(() => lock.release()))
            return yield* restore(effect)
          }),
        ),
      )
    const load = Effect.fnUntraced(function* (migration?: Info) {
      return merge(migration ?? Option.getOrUndefined(decode(yield* readJson())), content)
    })

    const get = Effect.fn("cli.config.get")(() =>
      withLock(
        Effect.gen(function* () {
          const migration = yield* migrate.pipe(
            Effect.catchCause((cause) =>
              Effect.logWarning("failed to migrate cli config", { cause }).pipe(Effect.as(undefined)),
            ),
          )
          if (migration?.cause)
            yield* Effect.logWarning("failed to persist migrated cli config", { cause: migration.cause })
          return yield* load(migration?.info)
        }),
      ),
    )

    const update = Effect.fn("cli.config.update")((update: (draft: Draft<Info>) => void) =>
      withLock(
        Effect.gen(function* () {
          const migration = yield* migrate
          if (migration?.cause) return yield* Effect.failCause(migration.cause)
          const current = yield* load(migration?.info)
          const next = produce(current, update)
          const edits = changes(current, next)
          if (!edits.length) return current
          const text = yield* fs
            .readFileString(file)
            .pipe(Effect.orElseSucceed(() => JSON.stringify({ $schema: SchemaURL }, null, 2)))
          const updated = edits.reduce(
            (text, edit) =>
              applyEdits(
                text,
                modify(text, edit.path, edit.value, { formattingOptions: { tabSize: 2, insertSpaces: true } }),
              ),
            text,
          )
          const errors: ParseError[] = []
          const config = Option.getOrUndefined(decode(parse(updated, errors, { allowTrailingComma: true })))
          if (errors.length || config === undefined) return yield* Effect.fail(new Error("Invalid CLI config update"))
          yield* ConfigPersistence.write(file, updated.endsWith("\n") ? updated : updated + "\n").pipe(
            Effect.provideService(FileSystem.FileSystem, fs),
          )
          return merge(config, content)
        }),
      ).pipe(Effect.mapError((cause) => new Error("Failed to update CLI config", { cause }))),
    )

    return Service.of({ path: file, get, update })
  }),
)

type Edit = { readonly path: (string | number)[]; readonly value: any }

function merge(...values: readonly (Info | undefined)[]) {
  return Option.getOrElse(
    decode(values.reduce<Record<string, unknown>>((result, value) => mergeRecords(result, value ?? {}), {})),
    () => empty,
  )
}

function mergeRecords(base: object, overlay: object) {
  return Object.entries(overlay).reduce<Record<string, unknown>>(
    (result, [key, value]) => {
      result[key] = isRecord(result[key]) && isRecord(value) ? mergeRecords(result[key], value) : value
      return result
    },
    { ...base },
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function parseRecord(text: string) {
  const errors: ParseError[] = []
  const value: unknown = parse(text, errors, { allowTrailingComma: true })
  if (errors.length) return undefined
  return Option.getOrUndefined(decodeRecord(value))
}

function changes(before: any, after: any, path: (string | number)[] = []): Edit[] {
  if (Object.is(before, after)) return []
  if (
    before !== null &&
    after !== null &&
    typeof before === "object" &&
    typeof after === "object" &&
    !Array.isArray(before) &&
    !Array.isArray(after)
  ) {
    return [...new Set([...Object.keys(before), ...Object.keys(after)])].flatMap((key) => {
      if (!(key in after)) return [{ path: [...path, key], value: undefined }]
      if (!(key in before)) return [{ path: [...path, key], value: after[key] }]
      return changes(before[key], after[key], [...path, key])
    })
  }
  return [{ path, value: after }]
}
