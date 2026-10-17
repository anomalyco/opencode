export * as Config from "./config"

import { Global } from "@opencode/util/global"
import { Flock } from "@opencode/util/flock"
import { Context, Effect, FileSystem, Layer, Option, Schema } from "effect"
import { produce, type Draft } from "immer"
import { applyEdits, modify, parse, type ParseError } from "jsonc-parser"
import path from "path"
import { ConfigMigration } from "./migrate"
import { Info, normalizeLegacyTabs, SchemaURL } from "./schema"

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
// Priority order: cli.jsonc wins when both exist. When neither exists, cli.json is created.
const filenames = ["cli.jsonc", "cli.json"] as const
const defaultFilename = "cli.json"

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const global = yield* Global.Service
    const content = process.env.OPENCODE_CLI_CONFIG_CONTENT
      ? Option.getOrUndefined(decode(parseRecord(process.env.OPENCODE_CLI_CONFIG_CONTENT)))
      : undefined

    // Resolve per operation so a cli.jsonc created while the process is running is picked up.
    const resolveFile = Effect.fnUntraced(function* () {
      const existing = yield* Effect.filter(
        filenames.map((name) => path.join(global.config, name)),
        (candidate) => fs.exists(candidate).pipe(Effect.orElseSucceed(() => false)),
      )
      return existing[0] ?? path.join(global.config, defaultFilename)
    })
    // Initial resolution for the TUI watcher directory; refreshed whenever get or update re-resolves.
    let file = yield* resolveFile()

    const readJson = Effect.fnUntraced(function* (target: string) {
      const text = yield* fs.readFileString(target).pipe(Effect.orElseSucceed(() => undefined))
      if (text === undefined) return undefined
      return parseRecord(text)
    })

    const write = Effect.fnUntraced(function* (target: string, text: string) {
      const temp = target + ".tmp"
      yield* fs.makeDirectory(path.dirname(target), { recursive: true })
      yield* fs.writeFileString(temp, text, { mode: 0o600 })
      yield* fs.rename(temp, target)
    })

    const migrate = (target: string) =>
      ConfigMigration.run({ file: target, config: global.config, state: global.state }).pipe(
        Effect.provideService(FileSystem.FileSystem, fs),
      )
    const withLock = <A, E, R>(target: string, effect: Effect.Effect<A, E, R>) =>
      Effect.scoped(
        Effect.uninterruptibleMask((restore) =>
          Effect.gen(function* () {
            const lock = yield* restore(
              Effect.promise((signal) => Flock.acquire(target, { dir: path.join(global.state, "locks"), signal })),
            )
            yield* Effect.addFinalizer(() => Effect.promise(() => lock.release()))
            return yield* restore(effect)
          }),
        ),
      )
    const load = Effect.fnUntraced(function* (target: string, migration?: Info) {
      return merge(migration ?? Option.getOrUndefined(decode(yield* readJson(target))), content)
    })

    const get = Effect.fn("cli.config.get")(() =>
      Effect.gen(function* () {
        const target = yield* resolveFile()
        file = target
        return yield* withLock(
          target,
          Effect.gen(function* () {
            const migration = yield* migrate(target).pipe(
              Effect.catchCause((cause) =>
                Effect.logWarning("failed to migrate cli config", { cause }).pipe(Effect.as(undefined)),
              ),
            )
            if (migration?.cause)
              yield* Effect.logWarning("failed to persist migrated cli config", { cause: migration.cause })
            return yield* load(target, migration?.info)
          }),
        )
      }),
    )

    const update = Effect.fn("cli.config.update")((update: (draft: Draft<Info>) => void) =>
      Effect.gen(function* () {
        const target = yield* resolveFile()
        file = target
        return yield* withLock(
          target,
          Effect.gen(function* () {
            const migration = yield* migrate(target)
            if (migration?.cause) return yield* Effect.failCause(migration.cause)
            const current = yield* load(target, migration?.info)
            const next = produce(current, update)
            const edits = changes(current, next)
            if (!edits.length) return current
            const text = yield* fs
              .readFileString(target)
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
            yield* write(target, updated.endsWith("\n") ? updated : updated + "\n")
            return merge(config, content)
          }),
        )
      }).pipe(Effect.mapError((cause) => new Error("Failed to update CLI config", { cause }))),
    )

    return Service.of({
      get path() {
        return file
      },
      get,
      update,
    })
  }),
)

type Edit = { readonly path: (string | number)[]; readonly value: any }

function merge(...values: readonly (Info | undefined)[]) {
  return Option.getOrElse(
    decode(
      values.reduce<Record<string, unknown>>(
        (result, value) => mergeRecords(result, normalizeLegacyTabs(value) ?? {}),
        {},
      ),
    ),
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
