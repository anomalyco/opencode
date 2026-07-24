/**
 * Conformance client driver.
 *
 * Spawned by `@modelcontextprotocol/conformance` once per scenario:
 *
 *   MCP_CONFORMANCE_SCENARIO=<scenario> bun test/mcp/conformance-driver.ts <server-url>
 *
 * Exercises opencode's MCP client stack (shared CLIENT_OPTIONS, streamable-http
 * → SSE fallback, OAuth provider) against the referee server. For OAuth
 * scenarios it plays the user's browser: it follows the authorization URL and
 * completes the code exchange on the same transport that captured the
 * `WWW-Authenticate` challenge.
 */
import {
  Client,
  SSEClientTransport,
  StreamableHTTPClientTransport,
  UnauthorizedError,
  type ClientOptions,
  type Tool,
} from "@modelcontextprotocol/client"
import { Effect } from "effect"
import { CLIENT_OPTIONS } from "../../src/mcp/index"
import { McpOAuthPendingProvider } from "../../src/mcp/oauth-provider"
import type { McpAuth } from "../../src/mcp/auth"

// Transport errors surface both from the awaited connect and asynchronously
// via onerror; keep the async copy from killing the driver mid-retry.
process.on("unhandledRejection", (error) => console.error("unhandled rejection:", error))
process.on("uncaughtException", (error) => console.error("uncaught exception:", error))

const scenario = process.env["MCP_CONFORMANCE_SCENARIO"]
const protocolVersion = process.env["MCP_CONFORMANCE_PROTOCOL_VERSION"] ?? "2025-11-25"
const context = JSON.parse(process.env["MCP_CONFORMANCE_CONTEXT"] ?? "{}") as {
  client_id?: string
  client_secret?: string
  toolCalls?: Array<{ name: string; arguments: Record<string, unknown> }>
}
const serverUrl = process.argv.at(-1)
if (!scenario || !serverUrl || !URL.canParse(serverUrl)) {
  console.error("Usage: MCP_CONFORMANCE_SCENARIO=<scenario> bun conformance-driver.ts <server-url>")
  process.exit(1)
}

// The referee announces the lifecycle via the protocol version: dated 2025
// revisions use the stateful initialize handshake without probing; for the
// 2026 draft, `auto` probes and conservatively falls back to `initialize`
// (the alpha.9 referee predates the final `server/discover` wire).
let versionNegotiation: ClientOptions["versionNegotiation"] =
  protocolVersion >= "2026-07-28" ? { mode: "auto" } : { mode: "legacy" }

// In-memory McpAuth store; the driver process lives for exactly one scenario.
const entries = new Map<string, McpAuth.Entry>()
const auth: McpAuth.Interface = {
  all: () => Effect.sync(() => Object.fromEntries(entries)),
  get: (name) => Effect.sync(() => entries.get(name)),
  getForUrl: (name, url) =>
    Effect.sync(() => {
      const entry = entries.get(name)
      return entry?.serverUrl === url ? entry : undefined
    }),
  set: (name, entry, url) => Effect.sync(() => void entries.set(name, url ? { ...entry, serverUrl: url } : entry)),
  remove: (name) => Effect.sync(() => void entries.delete(name)),
  updateTokens: (name, tokens, url) => update(name, (entry) => ({ ...entry, tokens }), url),
  updateClientInfo: (name, clientInfo, url) => update(name, (entry) => ({ ...entry, clientInfo }), url),
  updateCodeVerifier: (name, codeVerifier) => update(name, (entry) => ({ ...entry, codeVerifier })),
  clearCodeVerifier: (name) => update(name, ({ codeVerifier, ...entry }) => entry),
  updateOAuthState: (name, oauthState) => update(name, (entry) => ({ ...entry, oauthState })),
  getOAuthState: (name) => Effect.sync(() => entries.get(name)?.oauthState),
  clearOAuthState: (name) => update(name, ({ oauthState, ...entry }) => entry),
}
function update(name: string, fn: (entry: McpAuth.Entry) => McpAuth.Entry, url?: string) {
  return Effect.sync(() => {
    const next = fn(entries.get(name) ?? {})
    entries.set(name, url ? { ...next, serverUrl: url } : next)
  })
}

let authorizationUrl: URL | undefined
let currentTransport: StreamableHTTPClientTransport | SSEClientTransport | undefined
let established = false
const provider = new McpOAuthPendingProvider(
  "conformance",
  serverUrl,
  { clientId: context.client_id, clientSecret: context.client_secret },
  {
    onRedirect: async (url) => {
      authorizationUrl = url
      // Mid-session step-up (insufficient_scope): complete the new grant
      // inline so the SDK can retry the request with the escalated token.
      if (established && currentTransport) await followAuthorization(url, currentTransport)
    },
  },
  auth,
)

function createClient() {
  return new Client({ name: "opencode", version: "conformance" }, { ...CLIENT_OPTIONS, versionNegotiation })
}

/** Plays the user's browser: follows the authorization URL to the code redirect. */
async function followAuthorization(url: URL, transport: StreamableHTTPClientTransport | SSEClientTransport) {
  const response = await fetch(url, { redirect: "manual" })
  const location = response.headers.get("location")
  if (!location) throw new Error(`authorization endpoint did not redirect (status ${response.status})`)
  const params = new URL(location, url).searchParams
  await transport.finishAuth(params)
  await provider.commit()
}

async function authorize(transport: StreamableHTTPClientTransport | SSEClientTransport) {
  if (!authorizationUrl) throw new Error("server rejected with 401 but no authorization URL was captured")
  await followAuthorization(authorizationUrl, transport)
}

async function connect() {
  const makeTransports = () => [
    new StreamableHTTPClientTransport(new URL(serverUrl!), { authProvider: provider }),
    new SSEClientTransport(new URL(serverUrl!), { authProvider: provider }),
  ]
  let lastError: unknown
  for (let transport of makeTransports()) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const client = createClient()
      currentTransport = transport
      try {
        await client.connect(transport)
        established = true
        return client
      } catch (error) {
        await client.close().catch(() => {})
        if (error instanceof UnauthorizedError && attempt === 0) {
          await authorize(transport)
          // Re-run the connect with the granted tokens on a fresh transport.
          transport = new StreamableHTTPClientTransport(new URL(serverUrl!), { authProvider: provider })
          continue
        }
        lastError = error
        break
      }
    }
  }
  throw lastError ?? new Error("failed to connect")
}

function syntheticArguments(tool: Tool): Record<string, unknown> {
  const args: Record<string, unknown> = {}
  const properties = (tool.inputSchema.properties ?? {}) as Record<string, { type?: string }>
  for (const name of tool.inputSchema.required ?? []) {
    const type = properties[name]?.type
    if (type === "number" || type === "integer") args[name] = 1
    else if (type === "boolean") args[name] = true
    else args[name] = "conformance"
  }
  return args
}

async function run() {
  established = false
  const client = await connect()
  try {
    const { tools } = await client.listTools()
    const calls =
      context.toolCalls ??
      tools.map((tool) => ({
        name: tool.name,
        arguments: tool.name === "add_numbers" ? { a: 3, b: 4 } : syntheticArguments(tool),
      }))
    for (const call of calls) {
      await client
        .callTool({ name: call.name, arguments: call.arguments })
        .catch((error) => {
          // A scope step-up completed by onRedirect still surfaces as
          // UnauthorizedError; retry once with the escalated token.
          if (error instanceof UnauthorizedError) return client.callTool({ name: call.name, arguments: call.arguments })
          throw error
        })
        .catch((error) => console.error(`tools/call ${call.name} failed:`, error))
    }
  } finally {
    await client.close().catch(() => {})
  }
}

try {
  await run()
} catch (error) {
  // Some referees answer `server/discover` yet reject the modern wire on the
  // next request; redo the whole session on the legacy handshake.
  if (
    versionNegotiation.mode !== "legacy" &&
    error instanceof Error &&
    error.message.includes("Unsupported protocol version")
  ) {
    versionNegotiation = { mode: "legacy" }
    await run()
  } else {
    throw error
  }
}
