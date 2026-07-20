import { Service, type Endpoint, type EnsureOptions } from "@opencode-ai/client/effect/service"
import { ClientError, isUnauthorizedError, OpenCode } from "@opencode-ai/client/promise"
import { InstallationVersion } from "@opencode-ai/core/installation/version"
import { Effect, Redacted } from "effect"
import { Env } from "../env"
import { ServiceConfig } from "./service-config"
import { Standalone } from "./standalone"

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

export const resolve = Effect.fn("cli.server-connection.resolve")(function* (args: Args) {
  if (args.server !== undefined && args.standalone)
    return yield* Effect.fail(new Error("--server and --standalone cannot be combined"))
  if (args.server !== undefined) {
    const password = yield* Env.password
    const endpoint = {
      url: args.server,
      auth: password ? { type: "basic" as const, username: "opencode", password: Redacted.value(password) } : undefined,
    } satisfies Endpoint
    const client = OpenCode.make({ baseUrl: endpoint.url, headers: Service.headers(endpoint) })
    const health = yield* Effect.tryPromise({
      try: () => client.health.get({ signal: AbortSignal.timeout(5_000) }),
      catch: (cause) => connectError(endpoint, cause),
    })
    if (health.version !== InstallationVersion)
      process.stderr.write(
        `Warning: Server at ${endpoint.url} has version ${health.version}; this client is ${InstallationVersion}. Continuing anyway.\n`,
      )
    return { endpoint } satisfies Resolved
  }
  if (args.standalone) {
    return { endpoint: yield* Standalone.start() } satisfies Resolved
  }

  const options = yield* ServiceConfig.options()
  return {
    endpoint: yield* resolveManaged({ ...options, onStart: args.onStart }, args.mismatch ?? "replace"),
    service: managedService(options),
  } satisfies Resolved
})

function managedService(options: EnsureOptions) {
  const reconnectOptions = { ...options, version: undefined }
  return {
    reconnect: () => Service.ensure(reconnectOptions),
    restart: () =>
      Effect.gen(function* () {
        yield* Service.stop(options)
        yield* Service.ensure(reconnectOptions)
      }),
  }
}

const resolveManaged = Effect.fnUntraced(function* (
  options: EnsureOptions,
  mismatch: NonNullable<Args["mismatch"]>,
) {
  if (mismatch === "replace") return yield* Service.ensure(options)
  if (mismatch === "ignore") return yield* Service.ensure({ ...options, version: undefined })

  const compatible = yield* Service.discover(options)
  if (compatible !== undefined) return compatible
  const existing = yield* Service.discover({ ...options, version: undefined })
  if (existing !== undefined)
    return yield* Effect.fail(new Error("Background server version does not match this client"))
  return yield* Service.ensure(options)
})

function connectError(endpoint: Endpoint, cause: unknown) {
  if (isUnauthorizedError(cause)) {
    return new Error(
      endpoint.auth === undefined
        ? `Server at ${endpoint.url} requires a password; set OPENCODE_PASSWORD`
        : `Server at ${endpoint.url} rejected the password`,
      { cause },
    )
  }
  if (cause instanceof ClientError && cause.reason === "Transport")
    return new Error(`Could not reach server at ${endpoint.url}`, { cause })
  return new Error(`Server at ${endpoint.url} did not provide a compatible V2 health response`, { cause })
}

export * as ServerConnection from "./server-connection"
