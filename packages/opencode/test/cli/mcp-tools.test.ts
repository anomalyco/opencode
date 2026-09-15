import { describe, expect } from "bun:test"
import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js"
import { CallToolRequestSchema, ListToolsRequestSchema, type Tool } from "@modelcontextprotocol/sdk/types.js"
import { Effect } from "effect"
import path from "node:path"
import { cliIt } from "../lib/cli-process"

const tools: Tool[] = [
  { name: "search_docs", description: "Search local docs", inputSchema: { type: "object" } },
  { name: "search.docs", description: "Search remote docs", inputSchema: { type: "object" } },
]

function serve(items: Tool[]) {
  return Effect.acquireRelease(
    Effect.promise(async () => {
      const requests: string[] = []
      const protocol = new Server({ name: "tools-test", version: "1.0.0" }, { capabilities: { tools: {} } })
      protocol.setRequestHandler(ListToolsRequestSchema, async (request) => {
        requests.push("tools/list")
        return request.params?.cursor
          ? { tools: items.slice(1) }
          : { tools: items.slice(0, 1), nextCursor: items.length > 1 ? "next" : undefined }
      })
      protocol.setRequestHandler(CallToolRequestSchema, async () => {
        requests.push("tools/call")
        return { content: [] }
      })
      const transport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: () => crypto.randomUUID(),
        enableJsonResponse: true,
      })
      await protocol.connect(transport)
      const http = Bun.serve({ port: 0, fetch: (request) => transport.handleRequest(request) })
      return {
        url: http.url.toString(),
        requests,
        close: async () => {
          await http.stop(true)
          await protocol.close()
        },
      }
    }),
    (server) => Effect.promise(server.close),
  )
}

describe("opencode mcp tools", () => {
  cliIt.live("groups local and remote tools, preserving native names and pagination", ({ opencode }) =>
    Effect.gen(function* () {
      const server = yield* serve(tools)
      const result = yield* opencode.spawn(["mcp", "tools"], {
        env: {
          OPENCODE_CONFIG_CONTENT: JSON.stringify({
            mcp: {
              remote: { type: "remote", url: server.url, oauth: false },
              local: {
                type: "local",
                command: [process.execPath, path.join(import.meta.dir, "../fixture/mcp-lifecycle-stdio.ts")],
              },
              disabled: { type: "local", command: ["missing-mcp-server"], enabled: false },
            },
          }),
        },
      })
      opencode.expectExit(result, 0)
      expect(result.stdout).toContain("remote · 2 tool(s)")
      expect(result.stdout).toContain("search.docs")
      expect(result.stdout).toContain("search_docs")
      expect(result.stdout).not.toContain("Search local docs")
      expect(result.stdout).toContain("local · 1 tool(s)")
      expect(result.stdout).toContain("current_directory")
      expect(result.stdout).toContain("disabled · disabled")
      expect(server.requests).toEqual(["tools/list", "tools/list"])
    }),
  )

  cliIt.live("shows only the requested server even when another server fails", ({ opencode }) =>
    Effect.gen(function* () {
      const server = yield* serve([
        tools[0],
        { ...tools[1], description: "  Search\n\nremote\tdocs  " },
        { name: "no_description", inputSchema: { type: "object" } },
      ])
      const result = yield* opencode.spawn(["mcp", "tools", "docs"], {
        env: {
          OPENCODE_CONFIG_CONTENT: JSON.stringify({
            mcp: {
              docs: { type: "remote", url: server.url, oauth: false },
              ignored: { type: "local", command: ["missing-mcp-server"] },
            },
          }),
        },
      })
      opencode.expectExit(result, 0)
      expect(result.stdout).toContain("docs · 3 tool(s)")
      expect(result.stdout).toContain("Search local docs")
      expect(result.stdout).toContain("Search remote docs")
      expect(result.stdout).toContain("no_description")
      expect(result.stdout).not.toContain("undefined")
      expect(result.stdout).not.toContain("ignored")
      expect(server.requests).toEqual(["tools/list", "tools/list"])
    }),
  )

  cliIt.live("distinguishes an empty configuration from an unknown server", ({ opencode }) =>
    Effect.gen(function* () {
      const empty = yield* opencode.spawn(["mcp", "tools"])
      opencode.expectExit(empty, 0)
      expect(empty.stdout).toContain("No MCP servers configured")

      const missing = yield* opencode.spawn(["mcp", "tools", "missing"])
      opencode.expectExit(missing, 1)
      expect(missing.stderr).toContain('MCP server "missing" not found')
      expect(missing.stderr).toContain("opencode mcp list")
    }),
  )

  cliIt.live("reports a connected server with no tools", ({ opencode }) =>
    Effect.gen(function* () {
      const server = yield* serve([])
      const result = yield* opencode.spawn(["mcp", "tools", "empty"], {
        env: {
          OPENCODE_CONFIG_CONTENT: JSON.stringify({ mcp: { empty: { type: "remote", url: server.url } } }),
        },
      })
      opencode.expectExit(result, 0)
      expect(result.stdout).toContain("empty · 0 tool(s)")
      expect(result.stdout).toContain("No tools exposed")
      expect(server.requests).toEqual(["tools/list"])
    }),
  )

  cliIt.live("fails when the requested server is disabled", ({ opencode }) =>
    Effect.gen(function* () {
      const result = yield* opencode.spawn(["mcp", "tools", "disabled"], {
        env: {
          OPENCODE_CONFIG_CONTENT: JSON.stringify({
            mcp: { disabled: { type: "local", command: ["missing-mcp-server"], enabled: false } },
          }),
        },
      })
      opencode.expectExit(result, 1)
      expect(result.stdout).toContain("disabled · disabled")
      expect(result.stdout).not.toContain("0 tool(s)")
    }),
  )

  cliIt.live("keeps successful results while reporting a failed connection", ({ opencode }) =>
    Effect.gen(function* () {
      const server = yield* serve(tools)
      const result = yield* opencode.spawn(["mcp", "tools"], {
        env: {
          OPENCODE_CONFIG_CONTENT: JSON.stringify({
            mcp: {
              docs: { type: "remote", url: server.url, oauth: false },
              broken: { type: "local", command: ["missing-mcp-server"] },
            },
          }),
        },
      })
      opencode.expectExit(result, 1)
      expect(result.stdout).toContain("docs · 2 tool(s)")
      expect(result.stdout).toContain("broken · failed")
      expect(result.stdout).not.toContain("0 tool(s)")
    }),
  )

  cliIt.live("reports authentication requirements instead of an empty tool list", ({ opencode }) =>
    Effect.gen(function* () {
      const server = yield* Effect.acquireRelease(
        Effect.sync(() =>
          Bun.serve({
            port: 0,
            fetch(request) {
              const url = new URL(request.url)
              if (url.pathname === "/.well-known/oauth-protected-resource")
                return Response.json({ resource: `${url.origin}/mcp`, authorization_servers: [url.origin] })
              if (url.pathname === "/.well-known/oauth-authorization-server")
                return Response.json({
                  issuer: url.origin,
                  authorization_endpoint: `${url.origin}/authorize`,
                  token_endpoint: `${url.origin}/token`,
                  response_types_supported: ["code"],
                  code_challenge_methods_supported: ["S256"],
                })
              if (url.pathname !== "/mcp") return new Response("Not found", { status: 404 })
              return new Response("Unauthorized", {
                status: 401,
                headers: {
                  "WWW-Authenticate": `Bearer resource_metadata="${url.origin}/.well-known/oauth-protected-resource"`,
                },
              })
            },
          }),
        ),
        (server) => Effect.promise(async () => server.stop(true)),
      )
      const result = yield* opencode.spawn(["mcp", "tools", "private"], {
        env: {
          OPENCODE_CONFIG_CONTENT: JSON.stringify({
            mcp: {
              private: {
                type: "remote",
                url: new URL("/mcp", server.url).toString(),
                oauth: { clientId: "test-client" },
              },
            },
          }),
        },
      })
      opencode.expectExit(result, 1)
      expect(result.stdout).toContain("private · needs authentication")
      expect(result.stdout).toContain("opencode mcp auth private")
      expect(result.stdout).not.toContain("0 tool(s)")
    }),
  )
})
