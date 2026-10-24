import { Global } from "@opencode/util/global"
import { OPENCODE_CHANNEL, OPENCODE_VERSION } from "../version"
import { Hash } from "@opencode/util/hash"
import { Service, type Endpoint, type Info as RegistrationInfo } from "@opencode/client/effect/service"
import { Effect, FileSystem, Option, Schema } from "effect"
import { randomBytes } from "crypto"
import path from "path"
import { selfCommand } from "../util/process"
import { RemoteTunnel } from "./remote-tunnel"

// The CLI's service configuration file, plus the Service.EnsureOptions binding that
// points the client package's service operations at this CLI: which
// registration file (by channel), which version, and how to spawn opencode.

export const Info = Schema.Struct({
  disabled: Schema.optional(Schema.Boolean),
  // Present when remote access is on. The route is generated, never user-set: the secret subdomain the service is
  // served on.
  remote: Schema.optional(Schema.Struct({ route: Schema.String })),
  // Set once the user has accepted exposing the service to the internet, or had remote access on before, so turning
  // remote access off and on again does not ask a second time.
  remoteAccepted: Schema.optional(Schema.Literal(true)),
  hostname: Schema.optional(Schema.String),
  port: Schema.optional(Schema.Int.check(Schema.isGreaterThanOrEqualTo(1), Schema.isLessThanOrEqualTo(65_535))),
  password: Schema.optional(Schema.String),
  cors: Schema.optional(Schema.Array(Schema.String)),
  env: Schema.optional(Schema.Record(Schema.String, Schema.String)),
})
export type Info = typeof Info.Type

const keys = ["disabled", "remote", "hostname", "port", "password", "cors", "env"] as const
type Key = (typeof keys)[number]

const decodeInfo = Schema.decodeUnknownEffect(Schema.fromJsonString(Info))
// Earlier builds stored remote access as a boolean.
const decodeLegacy = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Struct({ ...Info.fields, remote: Schema.Boolean })),
)
const decodeRegistration = Schema.decodeUnknownEffect(Schema.fromJsonString(Service.Info))

export function filename(channel = OPENCODE_CHANNEL) {
  if (channel === "latest" || channel === "dev" || channel === "beta" || channel === "next") return "service.json"
  return `service-${channel.replace(/[^a-zA-Z0-9._-]/g, "-")}.json`
}

export function defaultPort(channel = OPENCODE_CHANNEL, platform = process.platform) {
  const port = channelPort(channel)
  // Windows hands out 0xC000-0xFFFF for outgoing connections, Hyper-V and WinNAT reserve blocks of that range at boot,
  // and WSL mirrored networking reserves a 4096-port block that usually covers 44620-48715. A reserved port fails as in
  // use while nothing listens on it. Moving into the 0x7000 block, below 32768, avoids all of them and keeps the low
  // 12 bits: 0xC0DE becomes 0x70DE.
  if (platform === "win32" && port >= 0x8000) return 0x7000 | (port & 0xfff)
  return port
}

function channelPort(channel: string) {
  if (channel === "latest" || channel === "dev" || channel === "beta" || channel === "next") return 0xc0de
  if (channel === "local") return 0xc0df
  return 10_000 + (Number.parseInt(Hash.fast(channel).slice(0, 8), 16) % 50_000)
}

export function legacyFilename(channel = OPENCODE_CHANNEL) {
  if (channel === "latest" || channel === "local") return
  return `service-${Hash.fast(channel)}.json`
}

export function versionBelongsToChannel(
  version: string | undefined,
  channel = OPENCODE_CHANNEL,
  installedVersion = OPENCODE_VERSION,
) {
  if (version === undefined) return false
  if (version === installedVersion) return true
  const prefix = `0.0.0-${channel}-`
  if (!version.startsWith(prefix)) return false
  return /^\d+(?:\.\d+)?$/.test(version.slice(prefix.length))
}

export const migrateRegistration = Effect.fnUntraced(function* (
  legacy: string,
  file: string,
  channel = OPENCODE_CHANNEL,
  installedVersion = OPENCODE_VERSION,
) {
  const fs = yield* FileSystem.FileSystem
  const text = yield* fs.readFileString(legacy).pipe(Effect.option)
  if (Option.isNone(text)) return
  const registration = yield* decodeRegistration(text.value).pipe(Effect.option)
  if (Option.isNone(registration)) return
  if (!versionBelongsToChannel(registration.value.version, channel, installedVersion)) return
  yield* fs.writeFileString(file, text.value, { flag: "wx", mode: 0o600 }).pipe(Effect.ignore)
})

export const migrateConfig = Effect.fnUntraced(function* (legacy: string, file: string) {
  const fs = yield* FileSystem.FileSystem
  const text = yield* fs.readFileString(legacy).pipe(Effect.option)
  if (Option.isNone(text)) return
  if (Option.isNone(yield* decodeInfo(text.value).pipe(Effect.option))) return
  yield* fs.writeFileString(file, text.value, { flag: "wx", mode: 0o600 }).pipe(Effect.ignore)
})

function configKey(key: string): Key {
  if (
    key === "disabled" ||
    key === "remote" ||
    key === "hostname" ||
    key === "port" ||
    key === "password" ||
    key === "cors" ||
    key === "env"
  )
    return key
  throw new Error(`Unknown service config key: ${key}`)
}

const paths = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem
  const global = yield* Global.Service
  const name = filename()
  const legacy = legacyFilename()
  const file = path.join(global.state, name)
  return {
    fs,
    file,
    name,
    home: global.home,
    legacyConfigFile: legacy ? path.join(global.config, legacy) : undefined,
    legacyRegistrationFiles: [
      ...(legacy ? [path.join(global.state, legacy)] : []),
      ...(name !== "service.json" && OPENCODE_CHANNEL !== "local" ? [path.join(global.state, "service.json")] : []),
    ],
    configFile: path.join(global.config, name),
  }
})

export const options = Effect.fnUntraced(function* (input: { readonly checkVersion?: boolean } = {}) {
  const { fs, file: primaryFile, home, legacyRegistrationFiles, name } = yield* paths
  yield* Effect.forEach(legacyRegistrationFiles, (legacy) => migrateRegistration(legacy, primaryFile))
  const config = yield* read()
  const configuredState = config.env?.XDG_STATE_HOME ? path.join(config.env.XDG_STATE_HOME, "opencode") : undefined
  const homeState =
    config.env?.XDG_STATE_HOME !== undefined && config.password !== undefined
      ? path.join(home, ".local", "state", "opencode")
      : undefined
  const homeStateFiles = new Set(homeState ? [path.join(homeState, name)] : [])
  const candidates = [
    ...new Set([primaryFile, ...(configuredState ? [path.join(configuredState, name)] : []), ...homeStateFiles]),
  ]
  const file = yield* findActiveRegistrationFile(fs, candidates, primaryFile, homeStateFiles, config.password)
  return {
    file,
    version: input.checkVersion && file === primaryFile ? OPENCODE_VERSION : undefined,
    env: config.env,
    command: [...selfCommand(), "serve", "--service"],
  }
})

const findActiveRegistrationFile = Effect.fnUntraced(function* (
  fs: FileSystem.FileSystem,
  candidates: ReadonlyArray<string>,
  primaryFile: string,
  homeStateFiles: ReadonlySet<string>,
  configuredPassword: string | undefined,
) {
  if (candidates.length <= 1) return primaryFile
  const secondary: string[] = []
  for (const candidate of candidates.slice(1)) {
    const text = yield* fs.readFileString(candidate).pipe(Effect.option)
    if (Option.isNone(text)) continue
    const info = yield* decodeRegistration(text.value).pipe(Effect.option)
    if (Option.isNone(info)) continue
    if (homeStateFiles.has(candidate) && info.value.password !== configuredPassword) continue
    secondary.push(candidate)
  }
  if (secondary.length === 0) return primaryFile
  const primaryText = yield* fs.readFileString(primaryFile).pipe(Effect.option)
  if (Option.isSome(primaryText)) {
    const primaryInfo = yield* decodeRegistration(primaryText.value).pipe(Effect.option)
    // Preserve damaged registrations so the running owner can notice and self-evict.
    if (Option.isNone(primaryInfo)) return primaryFile
    if ((yield* Service.discover({ file: primaryFile, version: undefined })) !== undefined) return primaryFile
  }
  for (const candidate of secondary) {
    if ((yield* Service.discover({ file: candidate, version: undefined })) !== undefined) return candidate
  }
  return primaryFile
})

export const registeredVersion = Effect.fnUntraced(function* (file?: string) {
  const { fs, file: defaultFile } = yield* paths
  const text = yield* fs.readFileString(file ?? defaultFile).pipe(Effect.option)
  if (Option.isNone(text)) return undefined
  const info = yield* decodeRegistration(text.value).pipe(Effect.option)
  return Option.isSome(info) ? info.value.version : undefined
})

export type ConfiguredProbe =
  | {
      readonly state: "ready" | "waiting" | "failed"
      readonly endpoint: Endpoint
      readonly version: string
      readonly pid: number
    }
  | {
      readonly state: "unauthorized" | "incompatible"
      readonly endpoint: Endpoint
    }

export const probeConfigured = Effect.fnUntraced(function* (options: { readonly file?: string } = {}) {
  const { fs } = yield* paths
  let registeredInfo: RegistrationInfo | undefined
  if (options.file !== undefined) {
    const text = yield* fs.readFileString(options.file).pipe(Effect.option)
    if (Option.isSome(text)) {
      const decoded = yield* decodeRegistration(text.value).pipe(Effect.option)
      if (Option.isNone(decoded)) return undefined
      registeredInfo = decoded.value
    }
  }
  const config = yield* read()
  const rawHost = config.hostname ?? "127.0.0.1"
  const connectHost = rawHost === "0.0.0.0" ? "127.0.0.1" : rawHost === "::" ? "::1" : rawHost
  const configuredURL =
    config.port !== undefined || config.password !== undefined || config.hostname !== undefined
      ? `http://${connectHost.includes(":") ? `[${connectHost}]` : connectHost}:${config.port ?? defaultPort()}`
      : undefined
  // Each password is only ever sent to the URL it belongs to.
  const targets = [
    ...(configuredURL === undefined ? [] : [{ url: configuredURL, password: config.password || undefined }]),
    ...(registeredInfo === undefined
      ? []
      : [{ url: registeredInfo.url, password: registeredInfo.password || undefined }]),
  ].filter(
    (target, index, all) =>
      all.findIndex((other) => other.url === target.url && other.password === target.password) === index,
  )
  let unauthorized: Endpoint | undefined
  let incompatible: Endpoint | undefined
  for (const target of targets) {
    const endpoint = {
      url: target.url,
      auth:
        target.password === undefined
          ? undefined
          : { type: "basic" as const, username: "opencode", password: target.password },
    } satisfies Endpoint
    const result = yield* Effect.promise(() =>
      fetch(new URL("/api/info", target.url), {
        headers: Service.headers(endpoint),
        signal: AbortSignal.timeout(1_500),
      })
        .then(async (response) => ({
          status: response.status,
          ok: response.ok,
          body: (await response.json().catch(() => undefined)) as unknown,
        }))
        .catch(() => undefined),
    )
    if (result === undefined) continue
    if (result.status === 401 && isUnauthorizedBody(result.body)) {
      unauthorized = endpoint
      continue
    }
    const serverInfo = decodeServerInfo(result.body)
    if (serverInfo === undefined) {
      if (target.url === configuredURL) incompatible = { url: target.url }
      continue
    }
    return {
      state: result.ok ? ("ready" as const) : result.status === 500 ? ("failed" as const) : ("waiting" as const),
      endpoint,
      version: serverInfo.version,
      pid: serverInfo.pid,
    } satisfies ConfiguredProbe
  }
  if (unauthorized !== undefined)
    return { state: "unauthorized" as const, endpoint: unauthorized } satisfies ConfiguredProbe
  if (incompatible !== undefined)
    return { state: "incompatible" as const, endpoint: incompatible } satisfies ConfiguredProbe
  return undefined
})

export const discover = Effect.fnUntraced(function* (file?: string) {
  const found = yield* probeConfigured({ file })
  return found?.state === "ready" ? found : undefined
})

function isUnauthorizedBody(input: unknown) {
  return typeof input === "object" && input !== null && "_tag" in input && input._tag === "UnauthorizedError"
}

function decodeServerInfo(input: unknown) {
  if (typeof input !== "object" || input === null) return
  if (!("version" in input) || typeof input.version !== "string") return
  if (!("pid" in input) || typeof input.pid !== "number" || !Number.isInteger(input.pid) || input.pid < 0) return
  return { version: input.version, pid: input.pid }
}

export const read = Effect.fn("cli.service-config.read")(function* () {
  const { fs, configFile, legacyConfigFile } = yield* paths
  if (legacyConfigFile) yield* migrateConfig(legacyConfigFile, configFile)
  const text = yield* fs.readFileString(configFile).pipe(Effect.option)
  if (Option.isNone(text)) return {} as Info
  const info = yield* decodeInfo(text.value).pipe(Effect.option)
  if (Option.isSome(info)) return info.value
  const legacy = decodeLegacy(text.value)
  if (Option.isNone(legacy)) return {} as Info
  // Repair the file in place so every reader sees the same route.
  const { remote: enabled, ...rest } = legacy.value
  const repaired: Info = enabled ? { ...rest, remote: { route: route() } } : rest
  yield* write(repaired)
  return repaired
})

// 64 random bits as 16 hex characters, a valid DNS label.
function route() {
  return randomBytes(8).toString("hex")
}

const write = Effect.fn("cli.service-config.write")(function* (value: Info) {
  const { fs, configFile } = yield* paths
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

export const acceptRemote = Effect.fn("cli.service-config.accept-remote")(function* () {
  yield* write({ ...(yield* read()), remoteAccepted: true })
})

// Disabling forgets the address, so enabling again issues a new unguessable one. Having had it on counts as
// accepting remote access.
const disableRemote = Effect.fnUntraced(function* () {
  const { remote, ...next } = yield* read()
  yield* write(remote === undefined ? next : { ...next, remoteAccepted: true })
})

// Turns remote access on and returns its route, created once and kept so the remote URL survives restarts.
export const remote = Effect.fn("cli.service-config.remote")(function* () {
  const existing = yield* read()
  if (existing.remote) return existing.remote.route
  const next = route()
  yield* write({ ...existing, remote: { route: next } })
  return next
})

export const get = Effect.fn("cli.service-config.get")(function* (key?: string, name?: string) {
  if (key === undefined) {
    const { password: _password, ...safe } = yield* read()
    // The route is as sensitive as the password: it is the unguessable half of the remote address.
    return JSON.stringify(safe.remote === undefined ? safe : { ...safe, remote: {} }, null, 2)
  }
  const selected = configKey(key)
  if (selected !== "env" && name !== undefined) throw new Error(`Usage: opencode service get ${selected}`)
  switch (selected) {
    case "disabled": {
      return String((yield* read()).disabled ?? false)
    }
    case "remote": {
      return String((yield* read()).remote !== undefined)
    }
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
    case "cors": {
      return JSON.stringify((yield* read()).cors ?? [], null, 2)
    }
    case "env": {
      const env = (yield* read()).env ?? {}
      return name === undefined ? JSON.stringify(env, null, 2) : (env[name] ?? "")
    }
  }
  throw new Error(`Unknown service config key: ${key}`)
})

export const set = Effect.fn("cli.service-config.set")(function* (key: string, value: string, nestedValue?: string) {
  const selected = configKey(key)
  if (selected !== "env" && nestedValue !== undefined)
    throw new Error(`Usage: opencode service set ${selected} <value>`)
  switch (selected) {
    case "disabled": {
      if (value !== "true" && value !== "false") throw new Error("Disabled must be true or false")
      if (value === "true") yield* Service.stop(yield* options())
      yield* write({ ...(yield* read()), disabled: value === "true" })
      return
    }
    case "remote": {
      if (value !== "true" && value !== "false") throw new Error("Remote must be true or false")
      // A tunnel that cannot be created leaves remote access off instead of a service that keeps retrying.
      if (value === "true") yield* RemoteTunnel.ensure()
      yield* Service.stop(yield* options())
      if (value === "true") {
        yield* remote()
        return
      }
      yield* disableRemote()
      return
    }
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
    case "env": {
      if (nestedValue === undefined) throw new Error("Usage: opencode service set env <key> <value>")
      yield* Service.stop(yield* options())
      const existing = yield* read()
      yield* write({ ...existing, env: { ...existing.env, [value]: nestedValue } })
      return
    }
    case "cors": {
      const cors = value.split(",").map((origin) => origin.trim())
      if (
        cors.some((origin) => {
          const url = URL.parse(origin)
          return !url || (url.protocol !== "http:" && url.protocol !== "https:") || url.origin !== origin
        })
      )
        throw new Error("CORS must be a comma-separated list of HTTP(S) origins without paths or trailing slashes")
      yield* Service.stop(yield* options())
      yield* write({ ...(yield* read()), cors })
      return
    }
  }
})

export const unset = Effect.fn("cli.service-config.unset")(function* (key: string, name?: string) {
  const selected = configKey(key)
  if (selected !== "env" && name !== undefined) throw new Error(`Usage: opencode service unset ${selected}`)
  switch (selected) {
    case "disabled": {
      const { disabled: _disabled, ...next } = yield* read()
      yield* write(next)
      return
    }
    case "remote": {
      yield* Service.stop(yield* options())
      yield* disableRemote()
      return
    }
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
    case "env": {
      if (name === undefined) throw new Error("Usage: opencode service unset env <key>")
      yield* Service.stop(yield* options())
      const existing = yield* read()
      const { [name]: _removed, ...env } = existing.env ?? {}
      const { env: _existingEnv, ...rest } = existing
      yield* write(Object.keys(env).length === 0 ? rest : { ...rest, env })
      return
    }
    case "cors": {
      yield* Service.stop(yield* options())
      const { cors: _cors, ...next } = yield* read()
      yield* write(next)
      return
    }
  }
})

export * as ServiceConfig from "./service-config"
