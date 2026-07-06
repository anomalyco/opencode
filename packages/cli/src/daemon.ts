import { Service } from "@opencode-ai/client/effect"
import { ClientError, isUnauthorizedError, OpenCode } from "@opencode-ai/client/promise"
import { InstallationVersion } from "@opencode-ai/core/installation/version"
import { ServerAuth } from "@opencode-ai/server/auth"
import { Effect } from "effect"
import { ServiceConfig } from "./services/service-config"

export type SharedOptions = {
  readonly mode: "shared"
  readonly command?: ReadonlyArray<string>
}
export type AttachOptions = {
  readonly mode: "attach"
  readonly url: string
  readonly username?: string
  readonly password?: string
}
export type Options = SharedOptions | AttachOptions

const attach = Effect.fn("cli.daemon.attach")(function* (options: AttachOptions) {
  const transport = {
    url: options.url,
    headers:
      options.password === undefined
        ? undefined
        : ServerAuth.headers({ password: options.password, username: options.username }),
  } satisfies Service.Transport
  const client = OpenCode.make({ baseUrl: transport.url, headers: transport.headers })
  const health = yield* Effect.tryPromise({
    try: () => client.health.get({ signal: AbortSignal.timeout(5_000) }),
    catch: (cause) => attachError(options, cause),
  })
  if (health.version !== InstallationVersion)
    process.stderr.write(
      `Warning: Server at ${options.url} has version ${health.version}; this client is ${InstallationVersion}. Continuing anyway.\n`,
    )
  return transport
})

const shared = Effect.fn("cli.daemon.shared")(function* (options: SharedOptions) {
  const config = yield* ServiceConfig.options()
  const service = options.command === undefined ? config : { ...config, command: options.command }
  const found = yield* Service.discover(service)
  if (found) return found
  return yield* Service.start(service)
})

export function transport(options: AttachOptions): ReturnType<typeof attach>
export function transport(options: SharedOptions): ReturnType<typeof shared>
export function transport(options: Options): ReturnType<typeof attach> | ReturnType<typeof shared>
export function transport(options: Options) {
  if (options.mode === "attach") return attach(options)
  return shared(options)
}

function attachError(options: AttachOptions, cause: unknown) {
  if (isUnauthorizedError(cause)) {
    return new Error(
      options.password === undefined
        ? `Server at ${options.url} requires authentication; provide a password`
        : `Server at ${options.url} rejected the supplied credentials`,
      { cause },
    )
  }
  if (cause instanceof ClientError && cause.reason === "Transport")
    return new Error(`Could not reach server at ${options.url}`, { cause })
  return new Error(`Server at ${options.url} did not provide a compatible V2 health response`, { cause })
}

export * as Daemon from "./daemon"
