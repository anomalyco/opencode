import { Global } from "@opencode-ai/core/global"
import { InstallationChannel, InstallationVersion } from "@opencode-ai/core/installation/version"
import { Service } from "@opencode-ai/client/effect"
import { Effect, FileSystem, Schema } from "effect"
import { randomBytes } from "crypto"
import path from "path"

// The CLI's service configuration file, plus the ServiceOptions binding that
// points the client package's service operations at this CLI: which
// registration file (by channel), which version, and how to spawn opencode.

export const Info = Schema.Struct({
  hostname: Schema.optional(Schema.String),
  port: Schema.optional(Schema.Int.check(Schema.isGreaterThanOrEqualTo(1), Schema.isLessThanOrEqualTo(65_535))),
  password: Schema.optional(Schema.String),
})
export type Info = typeof Info.Type

const keys = ["hostname", "port", "password"] as const
type Key = (typeof keys)[number]

const decodeInfo = Schema.decodeUnknownEffect(Schema.fromJsonString(Info))

function configKey(key: string): Key {
  if (keys.includes(key as Key)) return key as Key
  throw new Error(`Unknown service config key: ${key}`)
}

const env = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem
  const global = yield* Global.Service
  const filename = InstallationChannel === "local" ? "service-local.json" : "service.json"
  return {
    fs,
    file: path.join(global.state, filename),
    configFile: path.join(global.config, filename),
  }
})

export const options = Effect.fnUntraced(function* () {
  const { file } = yield* env
  const compiled = path.basename(process.execPath).replace(/\.exe$/, "") !== "bun"
  const entrypoint = compiled ? undefined : process.argv[1]
  if (!compiled && entrypoint === undefined) return yield* Effect.fail(new Error("Failed to resolve CLI entrypoint"))
  return {
    file,
    version: InstallationVersion,
    command: [process.execPath, ...(entrypoint ? [entrypoint] : []), "serve", "--service"],
  }
})

export const read = Effect.fn("cli.service-config.read")(function* () {
  const { fs, configFile } = yield* env
  return yield* fs.readFileString(configFile).pipe(
    Effect.flatMap(decodeInfo),
    Effect.catch(() => Effect.succeed({} as Info)),
  )
})

const write = Effect.fn("cli.service-config.write")(function* (value: Info) {
  const { fs, configFile } = yield* env
  const temp = configFile + ".tmp"
  yield* fs.makeDirectory(path.dirname(configFile), { recursive: true })
  yield* fs.writeFileString(temp, JSON.stringify(value, null, 2) + "\n", { mode: 0o600 })
  yield* fs.rename(temp, configFile)
})

export const password = Effect.fn("cli.service-config.password")(function* (value?: string) {
  const existing = yield* read()
  if (value === undefined && existing.password) return existing.password
  const next = value ?? randomBytes(32).toString("base64url")

  // Keep one private credential across server restarts so discovered clients
  // can reconnect without exposing a password flag or environment variable.
  yield* write({ ...existing, password: next })
  return next
})

export const get = Effect.fn("cli.service-config.get")(function* (key?: string) {
  if (key === undefined) {
    const { password: _password, ...safe } = yield* read()
    return JSON.stringify(safe, null, 2)
  }
  switch (configKey(key)) {
    case "hostname": {
      return (yield* read()).hostname ?? ""
    }
    case "port": {
      const port = (yield* read()).port
      return port === undefined ? "" : String(port)
    }
    case "password": {
      return yield* password()
    }
  }
})

export const set = Effect.fn("cli.service-config.set")(function* (key: string, value: string) {
  switch (configKey(key)) {
    case "hostname": {
      yield* Service.stop(yield* options())
      yield* write({ ...(yield* read()), hostname: value })
      return
    }
    case "port": {
      const port = Number(value)
      if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error("Port must be between 1 and 65535")
      yield* Service.stop(yield* options())
      yield* write({ ...(yield* read()), port })
      return
    }
    case "password": {
      yield* Service.stop(yield* options())
      yield* password(value)
      return
    }
  }
})

export const unset = Effect.fn("cli.service-config.unset")(function* (key: string) {
  switch (configKey(key)) {
    case "hostname": {
      yield* Service.stop(yield* options())
      const { hostname: _hostname, ...next } = yield* read()
      yield* write(next)
      return
    }
    case "port": {
      yield* Service.stop(yield* options())
      const { port: _port, ...next } = yield* read()
      yield* write(next)
      return
    }
    case "password": {
      yield* Service.stop(yield* options())
      const { password: _password, ...next } = yield* read()
      yield* write(next)
      return
    }
  }
})

export * as ServiceConfig from "./service-config"
