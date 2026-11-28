import { createHash } from "node:crypto"
import { Buffer } from "node:buffer"
import { createServer } from "node:http"
import { expect } from "bun:test"
import { NodeHttpServer } from "@effect/platform-node"
import { Context, Effect, Layer } from "effect"
import { HttpRouter, HttpServer } from "effect/http"
import { tmpdirScoped } from "../../core/test/fixture/tmpdir"
import { it } from "../../core/test/lib/effect"
import { CERT, startTlsMcpServer } from "../../core/test/fixture/tls-server"
import { createRoutes } from "../src/routes"

const authorization = `Basic ${btoa("opencode:secret")}`

const FINGERPRINT = createHash("sha256")
  .update(Buffer.from(CERT.split("\n").slice(1, -1).join(""), "base64"))
  .digest("hex")

const serve = Effect.fnUntraced(function* () {
  const directory = (yield* tmpdirScoped("opencode-mcp-trust-")).path
  const context = yield* Layer.build(
    createRoutes({
      password: "secret",
      app: { version: "test-version" },
      database: { path: ":memory:" },
      models: { fetch: false },
      config: { directory, project: false, content: "{}" },
      fs: { filewatcher: false },
    }).pipe(Layer.provideMerge(NodeHttpServer.layerHttpServices)),
  )
  const server = createServer()
  const http = yield* NodeHttpServer.make(() => server, { port: 0, host: "127.0.0.1" })
  yield* Effect.addFinalizer(() => Effect.sync(() => server.closeAllConnections()))
  yield* http
    .serve(Context.get(context, HttpRouter.HttpRouter).asHttpEffect())
    .pipe(Effect.provide(NodeHttpServer.layerHttpServices))
  return { base: HttpServer.formatAddress(http.address), directory }
})

const post = (base: string, path: string, directory: string, body: Record<string, unknown>) =>
  Effect.promise(async () => {
    const url = new URL(path, base)
    url.searchParams.set("location[directory]", directory)
    const response = await fetch(url, {
      method: "POST",
      headers: { authorization, "content-type": "application/json" },
      body: JSON.stringify(body),
    })
    const text = await response.text()
    return { status: response.status, text, json: () => JSON.parse(text) }
  })

type TrustCert = { host: string; port: number; fingerprint: string; subject: string; validTo: number }

it.live(
  "inspects and pins a private-network MCP server certificate through the API",
  () =>
    Effect.gen(function* () {
      const server = yield* serve()
      const tls = yield* Effect.acquireRelease(Effect.promise(() => startTlsMcpServer()), (item) =>
        Effect.promise(() => item.close()),
      )
      const url = `https://127.0.0.1:${tls.port}/mcp`

      const inspect = post(server.base, "/api/experimental/mcp/trust/inspect", server.directory, { url })
      const before = yield* inspect
      expect(before.status).toBe(200)
      const inspected = before.json() as { data: { cert: TrustCert; stored?: TrustCert } }
      expect(inspected.data.cert.fingerprint).toBe(FINGERPRINT)
      expect(inspected.data.cert.subject).toContain("CN=localhost")
      expect(inspected.data.stored).toBeUndefined()

      const pin = post(server.base, "/api/experimental/mcp/trust", server.directory, { url })
      const pinned = yield* pin
      expect(pinned.status).toBe(200)
      const result = pinned.json() as { data: TrustCert & { replaced: boolean } }
      expect(result.data.fingerprint).toBe(FINGERPRINT)
      expect(result.data.replaced).toBeFalse()

      const after = yield* inspect
      const stored = (after.json() as { data: { stored?: TrustCert } }).data.stored
      expect(stored?.fingerprint).toBe(FINGERPRINT)

      const stale = yield* post(server.base, "/api/experimental/mcp/trust", server.directory, {
        url,
        expectFingerprint: "f".repeat(64),
      })
      expect(stale.status).toBe(400)
      expect(stale.text).toContain("certificate changed between the check and the confirmation")
    }),
  30_000,
)

it.live(
  "rejects trust for non-private hosts with a 400",
  () =>
    Effect.gen(function* () {
      const server = yield* serve()
      const denied = yield* post(
        server.base,
        "/api/experimental/mcp/trust/inspect",
        server.directory,
        { url: "https://8.8.8.8/mcp" },
      )
      expect(denied.status).toBe(400)
      expect(denied.text).toContain("not a private IP address")
      const plain = yield* post(server.base, "/api/experimental/mcp/trust", server.directory, {
        url: "http://192.168.1.1/mcp",
      })
      expect(plain.status).toBe(400)
      expect(plain.text).toContain("requires an https URL")
    }),
  30_000,
)
