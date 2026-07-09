import { NodeFileSystem } from "@effect/platform-node"
import { Service } from "@opencode-ai/client/effect"
import { ClientError, isUnauthorizedError, OpenCode } from "@opencode-ai/client/promise"
import { InstallationVersion } from "@opencode-ai/core/installation/version"
import { Effect, Redacted } from "effect"
import { Env } from "../env"
import { ServiceConfig } from "./service-config"
import { Standalone } from "./standalone"

export type Args = {
  readonly server?: string
  readonly standalone?: boolean
}

export type Resolved = {
  readonly endpoint: Service.Endpoint
  readonly discover?: () => Promise<Service.Endpoint>
  readonly reload?: () => Promise<void>
}

export const resolve = Effect.fn("cli.server.resolve")(function* (args: Args) {
  if (args.server !== undefined && args.standalone)
    return yield* Effect.fail(new Error("--server and --standalone cannot be combined"))
  if (args.server !== undefined) {
    const password = yield* Env.password
    const endpoint = {
      url: args.server,
      auth: password
        ? { type: "basic" as const, username: "opencode", password: Redacted.value(password) }
        : undefined,
    } satisfies Service.Endpoint
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
  const endpoint = yield* Service.start(options)
  const reconnectOptions = { ...options, version: undefined }
  return {
    endpoint,
    discover: () => Effect.runPromise(Service.start(reconnectOptions).pipe(Effect.provide(NodeFileSystem.layer))),
    reload: () =>
      Effect.runPromise(
        Effect.gen(function* () {
          yield* Service.stop(options)
          yield* Service.start(options)
        }).pipe(Effect.provide(NodeFileSystem.layer)),
      ),
  } satisfies Resolved
})

function connectError(endpoint: Service.Endpoint, cause: unknown) {
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

export * as Server from "./server"
