// The recording proxy: forwards a client's HTTP requests to the simulated server, streams the responses (the event
// stream included), and logs every request for P-REQ.
import { Option, Schema } from "effect"

export type Logged = { method: string; path: string; query: Record<string, string[]>; body?: unknown; status?: number }

export function startProxy(upstream: string) {
  const log: Logged[] = []
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    idleTimeout: 0,
    async fetch(request) {
      const url = new URL(request.url)
      const text = request.method === "GET" || request.method === "HEAD" ? "" : await request.text()
      const entry: Logged = { method: request.method, path: url.pathname, query: query(url), body: parse(text) }
      log.push(entry)
      if (request.headers.get("upgrade")) {
        entry.status = 501
        return new Response("the parity proxy does not forward WebSockets", { status: 501 })
      }
      const headers = new Headers(request.headers)
      headers.delete("host")
      const response = await fetch(upstream + url.pathname + url.search, {
        method: request.method,
        headers,
        body: text === "" ? undefined : text,
        redirect: "manual",
        decompress: true,
      })
      entry.status = response.status
      const out = new Headers(response.headers)
      out.delete("content-encoding")
      out.delete("content-length")
      return new Response(response.body, { status: response.status, headers: out })
    },
  })
  return { url: `http://127.0.0.1:${server.port}`, log, stop: () => server.stop(true) }
}

function query(url: URL) {
  return [...url.searchParams.keys()]
    .toSorted()
    .reduce<Record<string, string[]>>((all, key) => ({ ...all, [key]: url.searchParams.getAll(key) }), {})
}

function parse(text: string): unknown {
  if (text === "") return undefined
  return Option.getOrElse(Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown))(text), () => text)
}
