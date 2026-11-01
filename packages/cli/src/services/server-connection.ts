import { Service, type Endpoint, type EnsureOptions } from "@opencode/client/effect/service"
import { ClientError, isUnauthorizedError, OpenCode } from "@opencode/client/promise"
import { OPENCODE_VERSION } from "../version"
import { Effect, FileSystem, Option, Redacted } from "effect"
import { Server as ServerFlag, Standalone as StandaloneFlag } from "../commands/commands"
import { Env } from "../env"
import { ServiceConfig } from "./service-config"
import { Standalone } from "./standalone"
import { errorMessage } from "../util/error"

export type Args = {
  readonly server?: string
  readonly standalone?: boolean
  readonly mismatch?: "replace" | "ignore" | "error"
  readonly onStart?: EnsureOptions["onStart"]
}

export type Resolved = {
  readonly endpoint: Endpoint
  readonly service?: ReturnType<typeof managedService>
}

export const resolve = Effect.fn("cli.server-connection.resolve")(function* (args: Args = {}) {
  const serverFlag = yield* Effect.serviceOption(ServerFlag).pipe(Effect.map(Option.flatten))
  const standaloneFlag = yield* Effect.serviceOption(StandaloneFlag)
  const server = args.server ?? Option.getOrUndefined(serverFlag)
  const standalone = args.standalone ?? Option.getOrElse(standaloneFlag, () => false)
  if (server !== undefined && standalone)
    return yield* Effect.fail(new Error("--server and --standalone cannot be combined"))
  if (server !== undefined) {
    const password = yield* Env.password
    const endpoint = {
      url: server,
      auth: password ? { type: "basic" as const, username: "opencode", password: Redacted.value(password) } : undefined,
    } satisfies Endpoint
    const client = OpenCode.make({ baseUrl: endpoint.url, headers: Service.headers(endpoint) })
    const health = yield* Effect.tryPromise({
      try: () => client.server.info({ signal: AbortSignal.timeout(5_000) }),
      catch: (cause) => connectError(endpoint, cause),
    })
    if (health.version !== OPENCODE_VERSION) warnVersionMismatch(endpoint.url, health.version)
    return { endpoint } satisfies Resolved
  }
  if (standalone || (yield* ServiceConfig.read()).disabled === true) {
    return { endpoint: yield* Standalone.start() } satisfies Resolved
  }

  const mismatch = args.mismatch ?? "ignore"
  const options = yield* ServiceConfig.options({ checkVersion: mismatch !== "ignore" })
  return {
    endpoint: yield* resolveManaged({ ...options, onStart: args.onStart }, mismatch),
    service: managedService(options),
  } satisfies Resolved
})

function warnVersionMismatch(url: string, version: string) {
  process.stderr.write(
    `Warning: Server at ${url} has version ${version}; this client is ${OPENCODE_VERSION}. Continuing anyway.\n`,
  )
}

function managedService(options: EnsureOptions) {
  // Reconnects run under a live UI, so they find the server the same way as the first connection but stay quiet
  // about version mismatches.
  const reconnect = () => resolveManaged({ ...options, version: undefined }, "ignore", () => {})
  return {
    reconnect,
    restart: () =>
      Effect.gen(function* () {
        const unowned = yield* unownedServer(options)
        if (unowned !== undefined)
          return yield* Effect.fail(
            new Error(`The server at ${unowned.url} wasn't started by OpenCode, so it can't be restarted from here`),
          )
        yield* Service.stop({ file: options.file, pty: "handoff" })
        yield* reconnect()
      }),
  }
}

// A configured server with no registration was started outside OpenCode, so stopping it is not ours to do.
const unownedServer = Effect.fnUntraced(function* (options: EnsureOptions) {
  if (options.file === undefined) return undefined
  const fs = yield* FileSystem.FileSystem
  if (yield* fs.exists(options.file).pipe(Effect.orElseSucceed(() => false))) return undefined
  return (yield* ServiceConfig.discover(options.file))?.endpoint
})

export const shutdownPersistentPty = Effect.fn("cli.server-connection.shutdown-persistent-pty")(function* (
  options: EnsureOptions,
) {
  const endpoint =
    (yield* Service.discover({ ...options, version: undefined })) ??
    (yield* ServiceConfig.discover(options.file))?.endpoint
  if (!endpoint) return
  const client = OpenCode.make({ baseUrl: endpoint.url, headers: Service.headers(endpoint) })
  yield* Effect.tryPromise(() => client.experimental.persistentPty.shutdown())
})

const resolveManaged = Effect.fnUntraced(function* (
  options: EnsureOptions,
  mismatch: NonNullable<Args["mismatch"]>,
  warn: (url: string, version: string) => void = warnVersionMismatch,
) {
  if (mismatch === "ignore") {
    const registered = yield* Service.reuse({ ...options, version: undefined })
    if (registered !== undefined) {
      const version = yield* ServiceConfig.registeredVersion(options.file)
      if (version !== undefined && version !== OPENCODE_VERSION) warn(registered.url, version)
      return registered
    }
    const configured = yield* ServiceConfig.probeConfigured({ file: options.file })
    if (configured?.state === "ready") {
      if (configured.version !== OPENCODE_VERSION) warn(configured.endpoint.url, configured.version)
      return configured.endpoint
    }
    if (configured?.state === "unauthorized") return yield* Effect.fail(unauthorizedError(configured.endpoint))
    if (configured?.state === "incompatible")
      return yield* Effect.fail(
        new Error(`Server at ${configured.endpoint.url} did not provide a compatible V2 health response`),
      )
    return yield* Service.ensure({ ...options, version: undefined })
  }

  const compatible = yield* Service.reuse(options)
  if (compatible !== undefined) {
    if (options.version === undefined) {
      const version = yield* ServiceConfig.registeredVersion(options.file)
      if (version !== undefined && version !== OPENCODE_VERSION) warn(compatible.url, version)
    }
    return compatible
  }
  const existing = yield* Service.discover({ ...options, version: undefined })
  if (existing !== undefined) {
    if (mismatch === "error")
      return yield* Effect.fail(new Error("Background server version does not match this client"))
    return yield* Service.ensure(options)
  }

  const configured = yield* ServiceConfig.probeConfigured({ file: options.file })
  if (configured?.state === "ready") {
    if (mismatch === "error" && configured.version !== OPENCODE_VERSION)
      return yield* Effect.fail(new Error("Background server version does not match this client"))
    if (configured.version !== OPENCODE_VERSION) warn(configured.endpoint.url, configured.version)
    return configured.endpoint
  }
  if (configured?.state === "unauthorized") return yield* Effect.fail(unauthorizedError(configured.endpoint))
  if (configured?.state === "incompatible")
    return yield* Effect.fail(
      new Error(`Server at ${configured.endpoint.url} did not provide a compatible V2 health response`),
    )
  return yield* Service.ensure(options)
})

function unauthorizedError(endpoint: Endpoint, cause?: unknown) {
  return new Error(
    endpoint.auth === undefined
      ? `Server at ${endpoint.url} requires a password; set OPENCODE_PASSWORD`
      : `Server at ${endpoint.url} rejected the password`,
    cause === undefined ? undefined : { cause },
  )
}

function connectError(endpoint: Endpoint, cause: unknown) {
  if (isUnauthorizedError(cause)) return unauthorizedError(endpoint, cause)
  if (cause instanceof ClientError && cause.reason === "Transport")
    return new Error(`Could not reach server at ${endpoint.url}: ${errorMessage(cause.cause ?? cause)}`, { cause })
  return new Error(
    `Server at ${endpoint.url} did not provide a compatible V2 health response: ${errorMessage(cause)}`,
    { cause },
  )
}

export * as ServerConnection from "./server-connection"
