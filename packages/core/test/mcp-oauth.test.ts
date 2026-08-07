import { createHash } from "node:crypto"
import { expect, test } from "bun:test"
import { Config } from "@opencode-ai/core/config"
import { ConfigMCP } from "@opencode-ai/core/config/mcp"
import { Credential } from "@opencode-ai/core/credential"
import { Bus } from "@opencode-ai/core/bus"
import { Event } from "@opencode-ai/schema/event"
import { Form } from "@opencode-ai/core/form"
import { Integration } from "@opencode-ai/core/integration"
import { Location } from "@opencode-ai/core/location"
import { MCP } from "@opencode-ai/core/mcp/index"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { Effect, Layer, Schema, Stream } from "effect"
import { location } from "./fixture/location"

const SERVER = "guarded"

/**
 * An auth-gated MCP endpoint plus the smallest OAuth metadata the SDK needs to attempt a refresh.
 * Every refresh is rejected, which is what a process sees once another one has rotated the shared
 * refresh token.
 */
function guardedServer(onRefresh: (refresh: string) => void) {
  return Effect.acquireRelease(
    Effect.sync(() => {
      const http = Bun.serve({
        port: 0,
        fetch: async (request) => {
          const { origin, pathname } = new URL(request.url)
          if (pathname.includes("oauth-protected-resource"))
            return Response.json({ resource: origin + "/", authorization_servers: [origin] })
          if (pathname.includes("oauth-authorization-server") || pathname.includes("openid-configuration"))
            return Response.json({
              issuer: origin,
              authorization_endpoint: origin + "/authorize",
              token_endpoint: origin + "/token",
              response_types_supported: ["code"],
              grant_types_supported: ["authorization_code", "refresh_token"],
              code_challenge_methods_supported: ["S256"],
            })
          if (pathname === "/token") {
            const refresh = (await request.formData()).get("refresh_token")
            onRefresh(typeof refresh === "string" ? refresh : "")
            return Response.json({ error: "invalid_grant" }, { status: 400 })
          }
          return new Response("Unauthorized", {
            status: 401,
            headers: {
              "WWW-Authenticate": `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource"`,
            },
          })
        },
      })
      return { url: http.url.toString(), close: () => http.stop(true) }
    }),
    (server) => Effect.promise(server.close),
  )
}

/** The identity MCP derives for a remote server, so the fixture credential lands on that integration. */
function integrationID(url: string) {
  const suffix =
    "mcp_" +
    createHash("sha1")
      .update(SERVER + "\u0000" + url)
      .digest("hex")
      .slice(0, 16)
  return Integration.ID.make(suffix)
}

function oauthCredential(url: string, tokens: { access: string; refresh: string }) {
  const id = integrationID(url)
  return new Credential.Info({
    id: Credential.ID.create(),
    integrationID: id,
    label: SERVER,
    value: Credential.OAuth.make({
      type: "oauth",
      methodID: Integration.MethodID.make(id),
      access: tokens.access,
      refresh: tokens.refresh,
      expires: 0,
      // A stored registration skips dynamic registration, so the SDK goes straight for the refresh.
      metadata: { serverUrl: url, client: { client_id: "test-client" } },
    }),
  })
}

function withValue(row: Credential.Info, value: Credential.Value) {
  return new Credential.Info({ id: row.id, integrationID: row.integrationID, label: row.label, value })
}

function rotated(row: Credential.Info, tokens: { access: string; refresh: string }) {
  return withValue(row, Schema.decodeUnknownSync(Credential.Value)({ ...row.value, ...tokens }))
}

/** MCP over a mutable in-memory credential store, standing in for the store shared between processes. */
function mcpLayer(url: string, rows: Credential.Info[]) {
  const directory = AbsolutePath.make(import.meta.dir)
  const unused = () => Effect.die("unused integration service")
  return MCP.layer().pipe(
    Layer.provideMerge(Form.layer),
    Layer.provide(
      Layer.mergeAll(
        Config.testLayer([
          new Config.Document({
            type: "document",
            info: new Config.Info({
              // Starts disabled so the test drives the connect attempt itself.
              mcp: new ConfigMCP.Info({
                servers: { [SERVER]: new ConfigMCP.Remote({ type: "remote", url, disabled: true }) },
              }),
            }),
          }),
        ]),
        Layer.succeed(Location.Service, Location.Service.of(location({ directory }))),
        Layer.mock(Bus.Service, {
          subscribe: () => Stream.never,
          publish: (definition, data) =>
            Effect.succeed({ id: Event.ID.create(), type: definition.type, data } as Event.Payload<typeof definition>),
        }),
        Layer.mock(Integration.Service, {
          transform: () => Effect.succeed({ dispose: Effect.void }),
          connection: {
            active: unused,
            resolve: unused,
            key: unused,
            update: unused,
            remove: unused,
          },
          oauth: { connect: unused, status: unused, complete: unused, cancel: unused },
          command: { connect: unused, status: unused, cancel: unused },
        }),
        Layer.mock(Credential.Service, {
          list: (id) => Effect.succeed(rows.filter((row) => row.integrationID === id)),
          update: (id, updates) =>
            Effect.sync(() => {
              const index = rows.findIndex((entry) => entry.id === id)
              const row = rows[index]
              if (row && updates.value) rows[index] = withValue(row, updates.value)
            }),
          remove: (id) =>
            Effect.sync(() => {
              const index = rows.findIndex((entry) => entry.id === id)
              if (index >= 0) rows.splice(index, 1)
            }),
        }),
      ),
    ),
  )
}

test("keeps a credential another process rotated while our own refresh was failing", async () => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const presented: string[] = []
        const rows: Credential.Info[] = []
        const server = yield* guardedServer((refresh) => {
          presented.push(refresh)
          // Only the first refresh races: another process rotates the shared token and saves it while
          // ours is still in flight, so its rejection must not take those fresh tokens down.
          if (presented.length === 1 && rows[0])
            rows[0] = rotated(rows[0], { access: "winner-access", refresh: "winner-refresh" })
        })
        rows.push(oauthCredential(server.url, { access: "stale-access", refresh: "stale-refresh" }))

        yield* Effect.gen(function* () {
          const service = yield* MCP.Service
          yield* service.connect(SERVER)
        }).pipe(Effect.provide(mcpLayer(server.url, rows)))

        // Removing the row on the rejected refresh would leave the retry with an empty store, so the
        // rotated token would never reach the server.
        expect(presented).toEqual(["stale-refresh", "winner-refresh"])
        expect(rows.length).toBe(1)
        expect(rows[0]?.value.type === "oauth" && rows[0].value.access).toBe("winner-access")
      }),
    ),
  )
})
