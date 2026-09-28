// Thin MCP client manager on @modelcontextprotocol/sdk (ADR MCP, ARCHITECTURE §12 Client). The SDK, opencode's
// catalog and the OAuth modules load on first use. Clients live for the layer's scope: the finalizer closes each one
// (stdio children get stdin EOF, then SIGTERM/SIGKILL from the SDK) and a process exit hook kills any leftover child.
import path from "path"
import { pathToFileURL } from "url"
import { Context, Deferred, Effect, Layer, Scope } from "effect"
import type { Client } from "@modelcontextprotocol/sdk/client/index.js"
import type { ConfigMCPV1 } from "@opencode-ai/core/v1/config/mcp"
import pkg from "../../package.json" with { type: "json" }
import { AppConfig, Mcp, McpError, type McpShape, type McpStatus } from "../contract"
import { redactText, registerSecret } from "../util/redact"
import { DEFAULT_TIMEOUT, type McpToolDef, promptParts, rank, resourceAttachment, toTool, wireName } from "./tools"

type Conn = { server: string; client: Client; defs: McpToolDef[]; instructions?: string; timeout: number; pid?: number }
type Entry = { status: McpStatus; conn?: Conn }
type OnStatus = (status: McpStatus) => Effect.Effect<void>
type Opened = { conn: Conn } | { status: "failed" | "needs_auth"; error: string }

const sdk = memo(async () => {
  const [client, stdio, http, sse, auth, types, catalog] = await Promise.all([
    import("@modelcontextprotocol/sdk/client/index.js"), import("@modelcontextprotocol/sdk/client/stdio.js"),
    import("@modelcontextprotocol/sdk/client/streamableHttp.js"), import("@modelcontextprotocol/sdk/client/sse.js"),
    import("@modelcontextprotocol/sdk/client/auth.js"), import("@modelcontextprotocol/sdk/types.js"), import("opencode/mcp/catalog"),
  ])
  return { client, stdio, http, sse, auth, types, catalog: catalog.McpCatalog }
})
type Sdk = Awaited<ReturnType<typeof sdk>>

export const layer = Layer.effect(
  Mcp,
  Effect.gen(function* () {
    const cfg = yield* AppConfig
    const scope = yield* Scope.Scope
    const entries = new Map<string, Entry>(
      Object.keys(cfg.mcp).map((name) => [name, { status: { name, status: cfg.mcp[name]!.enabled === false ? "disabled" : "connecting", tools: 0 } }]))
    const ready = yield* Deferred.make<void>()
    const started = { value: false }
    const pids = new Set<number>()
    // Last resort for exits that skip finalizers (a second Ctrl-C calls process.exit).
    const onExit = () => pids.forEach(kill)
    process.on("exit", onExit)
    yield* Effect.addFinalizer(() =>
      Effect.promise(() => Promise.all([...entries.values()].map((entry) => close(entry)))).pipe(Effect.andThen(Effect.sync(() => process.off("exit", onExit)))),
    )

    // Shared with opencode (~/.local/share/opencode/mcp-auth.json, PROGRESS decision 2); loaded only for OAuth.
    const oauth = memo(async () => {
      const [auth, nodes, provider, callback] = await Promise.all([
        import("opencode/mcp/auth"), import("@opencode-ai/core/effect/layer-node"), import("opencode/mcp/oauth-provider"), import("opencode/mcp/oauth-callback"),
      ])
      const context = await Effect.runPromise(Layer.buildWithScope(nodes.LayerNode.compile(auth.McpAuth.node), scope))
      return { auth: Context.get(context, auth.McpAuth.Service), provider, callback: callback.McpOAuthCallback }
    })

    const set = (name: string, entry: Entry, onStatus: OnStatus) => Effect.suspend(() => onStatus(entries.set(name, entry).get(name)!.status))
    const connect = (name: string, onStatus: OnStatus) =>
      Effect.gen(function* () {
        const server = cfg.mcp[name]!
        const status = (value: McpStatus["status"], extra: Partial<McpStatus> = {}): McpStatus => ({ name, status: value, tools: 0, ...extra })
        if (server.enabled === false) return yield* set(name, { status: status("disabled") }, onStatus)
        yield* set(name, { status: status("connecting") }, onStatus)
        const opened = yield* Effect.promise(() => open(name, server).catch((error): Opened => ({ status: "failed", error: message(error) })))
        if (!("conn" in opened)) return yield* set(name, { status: status(opened.status, { error: redactText(opened.error) }) }, onStatus)
        if (opened.conn.pid) pids.add(opened.conn.pid)
        yield* set(name, { conn: opened.conn, status: status("connected", { tools: opened.conn.defs.length }) }, onStatus)
      })

    async function open(name: string, server: ConfigMCPV1.Info): Promise<Opened> {
      const lib = await sdk()
      const timeout = server.timeout ?? DEFAULT_TIMEOUT
      const log = { tail: "" }
      const transports = server.type === "local" ? [stdio(lib, server, log, cfg.cwd)] : await remote(lib, name, server)
      const errors: string[] = []
      for (const transport of transports) {
        const client = makeClient(lib, cfg.cwd)
        const error = await within(client.connect(transport, { timeout }), timeout).then(() => undefined, (error: unknown) => error)
        if (error === undefined) return { conn: await watch(lib, name, client, timeout, log) }
        await transport.close().catch(() => undefined)
        const text = `${message(error)}${log.tail ? ` (${lastLine(log.tail)})` : ""}`
        // Stop at the first auth error instead of trying SSE (opencode's order).
        if (error instanceof lib.auth.UnauthorizedError || /\b401\b|unauthorized|oauth/i.test(text))
          return { status: "needs_auth", error: `${text}; run: oclite mcp auth ${name}` }
        errors.push(text)
      }
      return { status: "failed", error: errors.join("; ") || "no transport" }
    }

    async function remote(lib: Sdk, name: string, server: ConfigMCPV1.Remote) {
      if (!URL.canParse(server.url)) throw new Error(`invalid MCP URL for "${name}"`)
      const config = typeof server.oauth === "object" ? server.oauth : {}
      const api = server.oauth === false ? undefined : await oauth()
      const authProvider = api && new api.provider.McpOAuthProvider(name, server.url, config, { onRedirect: () => undefined }, api.auth)
      const tokens = await authProvider?.tokens()
      if (tokens) [tokens.access_token, tokens.refresh_token ?? ""].forEach(registerSecret)
      const options = { authProvider, requestInit: server.headers ? { headers: server.headers } : undefined }
      return [new lib.http.StreamableHTTPClientTransport(new URL(server.url), options), new lib.sse.SSEClientTransport(new URL(server.url), options)]
    }

    async function watch(lib: Sdk, name: string, client: Client, timeout: number, log: { tail: string }): Promise<Conn> {
      const listed = client.getServerCapabilities()?.tools ? await Effect.runPromise(lib.catalog.defs(client, timeout)) : []
      if (!listed) {
        await client.close().catch(() => undefined)
        throw new Error("failed to list tools")
      }
      const pid = client.transport instanceof lib.stdio.StdioClientTransport ? (client.transport.pid ?? undefined) : undefined
      const conn: Conn = { server: name, client, defs: listed, instructions: client.getInstructions()?.trim() || undefined, timeout, pid }
      client.onclose = () => {
        if (pid) pids.delete(pid)
        if (entries.get(name)?.conn !== conn) return
        entries.set(name, { status: { name, status: "failed", error: redactText(`connection closed${log.tail ? `: ${lastLine(log.tail)}` : ""}`), tools: 0 } })
      }
      // New tools apply from the next run: a run's tool list is fixed when it starts (prefix cache).
      if (client.getServerCapabilities()?.tools?.listChanged)
        client.setNotificationHandler(lib.types.ToolListChangedNotificationSchema, async () => {
          const next = await Effect.runPromise(lib.catalog.defs(client, timeout))
          const entry = entries.get(name)
          if (!next || entry?.conn !== conn) return
          conn.defs = next
          entry.status = { ...entry.status, tools: next.length }
        })
      return conn
    }

    const connectAll: McpShape["connectAll"] = (onStatus) =>
      Effect.suspend(() => {
        if (started.value) return Deferred.await(ready)
        started.value = true
        return Effect.forEach([...entries.keys()], (name) => connect(name, onStatus), { concurrency: "unbounded", discard: true }).pipe(
          Effect.andThen(Effect.suspend(() => Effect.forEach(warnings(), (item) => set(item.name, item.entry, onStatus), { discard: true }))),
          Effect.ensuring(Deferred.succeed(ready, undefined)),
        )
      })
    const ensure = connectAll(() => Effect.void)
    // Names that collide after sanitizing (`a` + `b__c` vs `a__b` + `c`): the first server in config order keeps the
    // name (tools() skips the rest). Shown on the server's connected status line.
    const warnings = () => {
      const owners = new Map<string, string>()
      return connected().flatMap((conn) => {
        const notes = [
          ...(conn.server.length > 40 ? [`server name over 40 chars: hashed tool names may not match mcp__${conn.server}__* globs`] : []),
          ...conn.defs.flatMap((def) => {
            const wire = wireName(conn.server, def.name)
            const owner = owners.get(wire)
            if (owner !== undefined) return [`skipped ${conn.server}/${def.name}: ${wire} is already ${owner}`]
            owners.set(wire, `${conn.server}/${def.name}`)
            return []
          }),
        ]
        const entry = entries.get(conn.server)!
        return notes.length ? [{ name: conn.server, entry: { ...entry, status: { ...entry.status, error: notes.join("; ") } } }] : []
      })
    }
    const connected = () => [...entries.values()].flatMap((entry) => (entry.conn && entry.status.status === "connected" ? [entry.conn] : []))
    const tools = () =>
      ensure.pipe(
        Effect.map(() => {
          const all = connected().flatMap((conn) =>
            conn.defs.map((def) =>
              toTool({ server: conn.server, def, timeoutMs: conn.timeout, call: (args, signal) =>
                // onprogress makes the SDK send a progress token, which is what lets progress reset the timeout.
                conn.client.callTool({ name: def.name, arguments: args }, undefined, {
                  timeout: conn.timeout, resetTimeoutOnProgress: true, maxTotalTimeout: conn.timeout * 10, onprogress: () => undefined, signal,
                }) }),
            ),
          )
          return all.filter((tool, index) => all.findIndex((other) => other.name === tool.name) === index)
        }),
      )
    const use = <A>(server: string, run: (conn: Conn) => Promise<A>) =>
      ensure.pipe(
        Effect.flatMap(() => {
          const conn = entries.get(server)?.conn
          if (!conn) return Effect.fail(new McpError({ server, message: `MCP server "${server}" is not connected` }))
          return Effect.tryPromise({ try: () => run(conn), catch: (error) => new McpError({ server, message: redactText(message(error)) }) })
        }),
      )
    const list = <A>(read: (conn: Conn, lib: Sdk) => Promise<A[]>) =>
      ensure.pipe(Effect.andThen(Effect.promise(async () => (await Promise.all(connected().map(async (conn) => read(conn, await sdk()).catch((): A[] => [])))).flat())))
    const reconnect = (name?: string) =>
      ensure.pipe(
        Effect.andThen(
          Effect.forEach([...entries.keys()].filter((key) => name === undefined || key === name), (key) =>
            Effect.gen(function* () {
              const previous = entries.get(key)!
              entries.set(key, { status: { name: key, status: "connecting", tools: 0 } })
              yield* Effect.promise(() => close(previous))
              yield* connect(key, () => Effect.void)
            }), { concurrency: "unbounded", discard: true }),
        ),
      )

    return Mcp.of({
      connectAll,
      status: () => Effect.sync(() => [...entries.values()].map((entry) => entry.status)),
      tools,
      search: (query, limit) =>
        tools().pipe(Effect.map((all) => rank(query, all.map((tool) => ({ name: tool.name, description: tool.tool.description })), limit))),
      instructions: (names) =>
        ensure.pipe(Effect.map(() => connected().flatMap((conn) =>
          conn.instructions && conn.defs.some((def) => names.includes(wireName(conn.server, def.name))) ? [`Instructions from MCP server ${conn.server}:\n${conn.instructions}`] : []))),
      prompts: () =>
        list(async (conn, lib) => (await lib.catalog.prompts(conn.client, conn.timeout)).map((prompt) =>
          ({ server: conn.server, name: prompt.name, description: prompt.description, arguments: (prompt.arguments ?? []).map((arg) => arg.name) }))),
      getPrompt: (server, name, args) =>
        use(server, async (conn) => promptParts((await conn.client.getPrompt({ name, arguments: args }, { timeout: conn.timeout })).messages)),
      resources: () =>
        list(async (conn, lib) => (await lib.catalog.resources(conn.client, conn.timeout)).map((item) => ({ server: conn.server, uri: item.uri, name: item.name, mimeType: item.mimeType }))),
      readResource: (server, uri) =>
        use(server, async (conn) => resourceAttachment(server, uri, (await conn.client.readResource({ uri }, { timeout: conn.timeout })).contents)),
      reconnect,
      authenticate: (name) =>
        Effect.gen(function* () {
          const server = cfg.mcp[name]
          if (server?.type !== "remote") return yield* new McpError({ server: name, message: `"${name}" is not a configured remote MCP server` })
          if (server.oauth === false) return yield* new McpError({ server: name, message: `OAuth is disabled for "${name}" (oauth: false)` })
          yield* Effect.tryPromise({ try: () => browserFlow(name, server).finally(() => oauth().then((api) => api.callback.stop())), catch: (error) => new McpError({ server: name, message: redactText(message(error)) }) })
          yield* reconnect(name)
          return entries.get(name)!.status
        }),
    })

    /** opencode's startAuth → authenticate → finishAuth, condensed: tokens land in the shared mcp-auth.json. */
    async function browserFlow(name: string, server: ConfigMCPV1.Remote) {
      const lib = await sdk()
      const api = await oauth()
      const config = typeof server.oauth === "object" ? server.oauth : {}
      const redirectUri = config.redirectUri ?? (config.callbackPort ? `http://127.0.0.1:${config.callbackPort}${api.provider.OAUTH_CALLBACK_PATH}` : undefined)
      await api.callback.ensureRunning(redirectUri)
      const state = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("hex")
      await Effect.runPromise(api.auth.updateOAuthState(name, state))
      const captured: { url?: URL } = {}
      const provider = new api.provider.McpOAuthPendingProvider(name, server.url, { ...config, redirectUri }, { onRedirect: (url) => void (captured.url = url) }, api.auth)
      const transport = new lib.http.StreamableHTTPClientTransport(new URL(server.url), { authProvider: provider, requestInit: server.headers ? { headers: server.headers } : undefined })
      const client = makeClient(lib, cfg.cwd)
      const error = await client.connect(transport).then(() => undefined, (error: unknown) => error)
      const finish = () => provider.commit().then(() => client.close().catch(() => undefined))
      if (error === undefined) return finish()
      if (!(error instanceof lib.auth.UnauthorizedError) || !captured.url) throw error
      const code = api.callback.waitForCallback(state, name)
      process.stderr.write(`Open this URL to authorize ${name}:\n${captured.url}\n`)
      const { openUrl } = await import("@opencode-ai/core/open")
      await openUrl(captured.url.toString()).catch(() => undefined)
      const received = await code
      if ((await Effect.runPromise(api.auth.getOAuthState(name))) !== state) throw new Error("OAuth state mismatch")
      await Effect.runPromise(api.auth.clearOAuthState(name))
      await transport.finishAuth(received)
      await Effect.runPromise(api.auth.clearCodeVerifier(name))
      return finish()
    }
  }),
)

function makeClient(lib: Sdk, cwd: string) {
  const client = new lib.client.Client({ name: "oclite", version: pkg.version }, { capabilities: { roots: {} } })
  client.setRequestHandler(lib.types.ListRootsRequestSchema, async () => ({ roots: [{ uri: pathToFileURL(cwd).href }] }))
  return client
}

/** stderr goes to a small tail (for failure messages) and, with OCLITE_DEBUG=1, to our stderr; never to stdout. */
function stdio(lib: Sdk, server: ConfigMCPV1.Local, log: { tail: string }, cwd: string) {
  const [command = "", ...args] = server.command
  const transport = new lib.stdio.StdioClientTransport({
    command, args, stderr: "pipe", cwd: path.resolve(cwd, server.cwd ?? "."),
    env: { ...(process.env as Record<string, string>), ...server.environment },
  })
  transport.stderr?.on("data", (chunk: Buffer) => {
    log.tail = (log.tail + chunk.toString()).slice(-2000)
    if (process.env.OCLITE_DEBUG) process.stderr.write(redactText(`[mcp ${command}] ${chunk}`))
  })
  return transport
}

const close = async (entry: Entry) => void (await entry.conn?.client.close().catch(() => undefined))

function within<A>(promise: Promise<A>, ms: number) {
  return Promise.race([promise, new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`timed out after ${ms / 1000} s`)), ms).unref())])
}

function kill(pid: number) {
  // process.kill throws ESRCH when the child is already gone (the normal case), and kill(pid, 0) throws the same way.
  try {
    process.kill(pid, "SIGKILL")
  } catch {}
}

function lastLine(text: string) {
  return text.trim().split("\n").at(-1)!.slice(0, 200)
}

function message(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function memo<A>(load: () => Promise<A>) {
  const cache: { value?: Promise<A> } = {}
  return () => (cache.value ??= load())
}
