import { readFileSync } from "node:fs"
import path from "node:path"
import { Server, WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/server"

export const TLS_FIXTURE_DIR = path.join(import.meta.dir, "tls")

// Long-lived self-signed certificates for 127.0.0.1 and localhost. The rotated pair presents a
// different certificate (and fingerprint) from the default pair on the same host and port.
export const CERT = readFileSync(path.join(TLS_FIXTURE_DIR, "localhost.crt"), "utf-8")
export const KEY = readFileSync(path.join(TLS_FIXTURE_DIR, "localhost.key"), "utf-8")
export const CERT_ROTATED = readFileSync(path.join(TLS_FIXTURE_DIR, "localhost2.crt"), "utf-8")
export const KEY_ROTATED = readFileSync(path.join(TLS_FIXTURE_DIR, "localhost2.key"), "utf-8")
// Appliance-style certificate: a CN and no subjectAltName. A hostname or IP name check fails
// against it, which is exactly why the fingerprint is the identity check when it is pinned.
export const CERT_APPLIANCE = readFileSync(path.join(TLS_FIXTURE_DIR, "appliance.crt"), "utf-8")
export const KEY_APPLIANCE = readFileSync(path.join(TLS_FIXTURE_DIR, "appliance.key"), "utf-8")

export function startTlsMcpServer(options: { cert?: string; key?: string; port?: number } = {}) {
  const cert = options.cert ?? CERT
  const key = options.key ?? KEY
  const protocol = new Server({ name: "tls-test", version: "1.0.0" }, { capabilities: { tools: {} } })
  protocol.setRequestHandler("tools/list", () =>
    Promise.resolve({ tools: [{ name: "echo", inputSchema: { type: "object", properties: {} } }] }),
  )
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: () => crypto.randomUUID() })
  return protocol.connect(transport).then(() => {
    const http = Bun.serve({
      port: options.port ?? 0,
      hostname: "127.0.0.1",
      tls: { cert, key },
      fetch: (request) => transport.handleRequest(request),
    })
    const port = http.port
    if (port === undefined) throw new Error("TLS server did not bind a port")
    return {
      url: `${http.url}/mcp`,
      port,
      close: async () => {
        await protocol.close().catch(() => {})
        http.stop(true)
      },
    }
  })
}
