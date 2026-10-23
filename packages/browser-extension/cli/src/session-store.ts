import { defaultPort } from "./relay-helpers.ts"
import { dataRoot } from "./paths.ts"
import { Context, Effect, FileSystem, Layer, Option, Path, Predicate, Schema } from "effect"
import os from "node:os"
import { endpointForPort, portConfig } from "./relay-client.ts"

/**
 * SessionStore persists the CLI's current OpenCode Browser session id, scoped
 * by relay endpoint so switching `OPENCODE_BROWSER_PORT` cannot silently reuse
 * a session id created against a different relay.
 *
 * File format (v2): `{ "endpoints": { "<endpoint>": { "id": "..." } } }`.
 * Legacy `{ "id": "..." }` files are read as belonging to the default
 * endpoint and migrated on the next write.
 */

export class SessionStoreError extends Schema.TaggedError<SessionStoreError>()(
  "SessionStore.SessionStoreError",
  {
    message: Schema.String,
    operation: Schema.String,
    cause: Schema.Defect(),
  },
) {}

const StoreFile = Schema.Struct({
  id: Schema.optionalKey(Schema.String),
  endpoints: Schema.optionalKey(Schema.Record(Schema.String, Schema.Struct({
    id: Schema.String,
  }))),
})

export interface Interface {
  readonly endpoint: string
  readonly filePath: string
  readonly read: Effect.Effect<string | undefined, SessionStoreError>
  readonly write: (id: string) => Effect.Effect<void, SessionStoreError>
  readonly clear: Effect.Effect<void, SessionStoreError>
}

export class Service extends Context.Service<Service, Interface>()("opencode-browser-cli/SessionStore") {}

const defaultFilePath = (): string => {
  return `${dataRoot()}/session.json`
}

export const make = Effect.fn("SessionStore.make")(function* (options?: {
  readonly filePath?: string
  readonly endpoint?: string
}) {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const filePath = options?.filePath ?? defaultFilePath()
  const port = yield* portConfig.pipe(
    Effect.mapError((cause) => new SessionStoreError({
      message: `Invalid OPENCODE_BROWSER_PORT configuration: ${cause.message}`,
      operation: "configure",
      cause,
    })),
  )
  const endpoint = options?.endpoint ?? endpointForPort(port)
  const defaultEndpoint = endpointForPort(defaultPort)

  const storeError = (operation: string) => (cause: unknown) =>
    new SessionStoreError({
      message: `Could not ${operation} the current session file at ${filePath}`,
      operation,
      cause,
    })

  const readStore: Effect.Effect<Schema.Schema.Type<typeof StoreFile>, SessionStoreError> = fs
    .readFileString(filePath)
    .pipe(
      Effect.map(Option.some),
      Effect.catchTag("PlatformError", (error) =>
        Predicate.isTagged(error.reason, "NotFound") ? Effect.succeed(Option.none<string>()) : Effect.fail(error)),
      Effect.mapError(storeError("read")),
      Effect.flatMap(Option.match({
        onNone: () => Effect.succeed({}),
        onSome: (text) => Effect.try({
          try: () => JSON.parse(text) as unknown,
          catch: (cause) => cause,
        }).pipe(
          Effect.flatMap(Schema.decodeUnknownEffect(StoreFile)),
          Effect.mapError(storeError("decode")),
        ),
      })),
    )

  const currentEntries = (store: Schema.Schema.Type<typeof StoreFile>): Record<string, { readonly id: string }> => {
    const entries = { ...(store.endpoints ?? {}) }
    // Migrate the legacy top-level id to the default endpoint.
    if (store.id && entries[defaultEndpoint] === undefined) {
      entries[defaultEndpoint] = { id: store.id }
    }
    return entries
  }

  const writeStore = (entries: Record<string, { readonly id: string }>) =>
    fs.makeDirectory(path.dirname(filePath), { recursive: true }).pipe(
      Effect.andThen(fs.writeFileString(filePath, `${JSON.stringify({ endpoints: entries }, null, 2)}\n`)),
      Effect.mapError(storeError("write")),
    )

  const read = readStore.pipe(
    Effect.map((store) => currentEntries(store)[endpoint]?.id),
  )

  const write = (id: string) =>
    readStore.pipe(
      Effect.flatMap((store) => {
        const entries = currentEntries(store)
        entries[endpoint] = { id }
        return writeStore(entries)
      }),
    )

  const clear = readStore.pipe(
    Effect.flatMap((store) => {
      const entries = currentEntries(store)
      delete entries[endpoint]
      return writeStore(entries)
    }),
  )

  return Service.of({ endpoint, filePath, read, write, clear })
})

export const layer: Layer.Layer<Service, SessionStoreError, FileSystem.FileSystem | Path.Path> = Layer.effect(Service, make())
