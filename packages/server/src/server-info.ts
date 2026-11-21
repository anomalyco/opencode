import { Context, Effect, Layer } from "effect"
import { hostname, networkInterfaces } from "node:os"
import type { ServerOptions } from "./options"

export class Service extends Context.Service<
  Service,
  {
    readonly urls: () => ReadonlyArray<string>
    readonly app: NonNullable<ServerOptions["app"]>
    readonly paths: { readonly tmp: string }
  }
>()("@opencode/server/ServerInfo") {}

export function layer(urls: () => ReadonlyArray<string>, tmp: string, app: ServerOptions["app"] = {}) {
  return Layer.succeed(Service, Service.of({ urls, app, paths: { tmp } }))
}

export function connectionURLs(value: string, requestedHostname?: string) {
  const url = new URL(value)
  const hostname = requestedHostname ?? url.hostname
  const family = hostname === "0.0.0.0" ? "IPv4" : hostname === "::" || hostname === "[::]" ? "IPv6" : undefined
  if (family === undefined) return [value]

  const loopback = new URL(value)
  loopback.hostname = family === "IPv6" ? "[::1]" : "127.0.0.1"
  return [
    ...new Set([
      loopback.toString().replace(/\/$/, ""),
      ...Object.values(networkInterfaces())
        .flatMap((entries) => entries ?? [])
        .filter((entry) => !entry.internal && entry.family === family)
        .map((entry) => {
          const result = new URL(value)
          result.hostname = family === "IPv6" ? `[${entry.address}]` : entry.address
          return result.toString().replace(/\/$/, "")
        }),
    ]),
  ]
}

// The computer's human name: the macOS Computer Name ("Alex's MacBook Pro"), else the hostname without `.local`.
// Never fails; undefined when the runtime can't tell (e.g. workerd).
export const deviceName = Effect.gen(function* () {
  const name = (yield* computerName) || (yield* Effect.try(() => hostname().replace(/\.local$/, "")))
  return name.trim() || undefined
}).pipe(Effect.orElseSucceed(() => undefined))

const computerName = Effect.tryPromise(async () => {
  if (process.platform !== "darwin") return ""
  const { execFile } = await import("node:child_process")
  return new Promise<string>((resolve) =>
    execFile("scutil", ["--get", "ComputerName"], { timeout: 1000 }, (error, stdout) =>
      resolve(error ? "" : stdout.trim()),
    ),
  )
})

export * as ServerInfo from "./server-info"
