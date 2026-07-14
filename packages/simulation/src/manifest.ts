import { homedir } from "node:os"
import { isAbsolute, join } from "node:path"
import { Config, Effect, FileSystem, Schema } from "effect"
import { PositiveInt } from "@opencode-ai/core/schema"

const InstanceName = Schema.String.check(
  Schema.makeFilter((value) =>
    /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(value) ? undefined : "a valid Drive instance name",
  ),
)

const Endpoint = Schema.String.check(
  Schema.makeFilter((value) => {
    if (!URL.canParse(value)) return "a loopback WebSocket endpoint with an explicit port"
    const endpoint = new URL(value)
    const port = Number(endpoint.port)
    return endpoint.protocol === "ws:" && endpoint.hostname === "127.0.0.1" && Number.isInteger(port) && port >= 1
      ? undefined
      : "a loopback WebSocket endpoint with an explicit port"
  }),
)

const AbsolutePath = Schema.String.check(
  Schema.makeFilter((value) => (isAbsolute(value) ? undefined : "an absolute path")),
)

export const Manifest = Schema.Struct({
  endpoints: Schema.Struct({
    ui: Endpoint,
    backend: Endpoint,
  }),
  viewport: Schema.optionalKey(
    Schema.Struct({
      cols: PositiveInt,
      rows: PositiveInt,
    }),
  ),
  recording: Schema.optionalKey(
    Schema.Struct({
      timeline: AbsolutePath,
    }),
  ),
})
export interface Manifest extends Schema.Schema.Type<typeof Manifest> {}

export class ResolveError extends Schema.TaggedErrorClass<ResolveError>()("DriveManifest.ResolveError", {
  reason: Schema.Literals(["config", "not-found", "read", "decode"]),
  path: Schema.optionalKey(Schema.String),
  message: Schema.String,
  cause: Schema.Defect(),
}) {}

export const defaults: Manifest = {
  endpoints: {
    ui: "ws://127.0.0.1:40900",
    backend: "ws://127.0.0.1:40950",
  },
}

const decode = Schema.decodeUnknownEffect(Schema.fromJsonString(Manifest))

const configError = (cause: unknown) =>
  new ResolveError({
    reason: "config",
    message: `Invalid Drive configuration: ${String(cause)}`,
    cause,
  })

export const resolve = Effect.fn("DriveManifest.resolve")(function* () {
  const name = yield* Config.schema(InstanceName, "OPENCODE_DRIVE").pipe(Effect.mapError(configError))
  if (name === "1") return defaults

  const state = yield* Config.string("XDG_STATE_HOME").pipe(
    Config.withDefault(join(homedir(), ".local", "state")),
    Effect.mapError(configError),
  )
  const directory = yield* Config.string("DRIVE_REGISTRY_DIR").pipe(
    Config.withDefault(join(state, "opencode-drive", "instances")),
    Effect.mapError(configError),
  )
  const file = join(directory, `${name}.json`)
  const fs = yield* FileSystem.FileSystem
  const contents = yield* fs.readFileString(file).pipe(
    Effect.mapError(
      (cause) =>
        new ResolveError({
          reason: cause.reason._tag === "NotFound" ? "not-found" : "read",
          path: file,
          message:
            cause.reason._tag === "NotFound"
              ? `Drive manifest not found: ${file}`
              : `Failed to read Drive manifest: ${file}: ${cause.message}`,
          cause,
        }),
    ),
  )
  return yield* decode(contents).pipe(
    Effect.mapError(
      (cause) =>
        new ResolveError({
          reason: "decode",
          path: file,
          message: `Invalid Drive manifest: ${file}: ${cause.message}`,
          cause,
        }),
    ),
  )
})

export * as DriveManifest from "./manifest"
