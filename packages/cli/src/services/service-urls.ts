import { Effect, Option } from "effect"

export function parseServerURL(value: string) {
  const url = new URL(value)
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash)
    throw new Error("Invalid server URL")
  return url.href.replace(/\/+$/, "")
}

export const serverURLs = Effect.fnUntraced(function* (
  client: { readonly server: { readonly info: () => Promise<{ readonly urls: ReadonlyArray<string> }> } },
  url: Option.Option<string>,
) {
  if (Option.isSome(url)) return [url.value]
  return (yield* Effect.tryPromise(() => client.server.info())).urls
})

export function isLoopback(hostname: string) {
  return (
    hostname === "localhost" || hostname.endsWith(".localhost") || hostname.startsWith("127.") || hostname === "[::1]"
  )
}
