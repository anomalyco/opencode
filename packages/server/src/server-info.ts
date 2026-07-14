import { Context, Layer } from "effect"
import { networkInterfaces } from "node:os"

export class Service extends Context.Service<Service, { readonly urls: () => ReadonlyArray<string> }>()(
  "@opencode-ai/server/ServerInfo",
) {}

export function layer(urls: () => ReadonlyArray<string>) {
  return Layer.succeed(Service, Service.of({ urls }))
}

export function connectionURLs(value: string, requestedHostname?: string) {
  const url = new URL(value)
  const hostname = requestedHostname ?? url.hostname
  const family = hostname === "0.0.0.0" ? "IPv4" : hostname === "::" || hostname === "[::]" ? "IPv6" : undefined
  if (family === undefined) return [value]

  return [
    ...new Set(
      Object.values(networkInterfaces())
        .flatMap((entries) => entries ?? [])
        .filter((entry) => !entry.internal && entry.family === family)
        .map((entry) => {
          const result = new URL(value)
          result.hostname = family === "IPv6" ? `[${entry.address}]` : entry.address
          return result.toString().replace(/\/$/, "")
        }),
    ),
  ]
}

export * as ServerInfo from "./server-info"
