// `oclite mcp serve` (ARCHITECTURE §12 Server, SPEC §5): the 7 agent-control tools, one prompt per primary agent,
// session resources, progress and notifications/message, and an Asker that elicits (or falls back to
// notifications + agent_permission_reply). stdio, or HTTP on Bun.serve with a bearer token per request.
import { createHash, timingSafeEqual } from "crypto"
import { existsSync, statSync } from "fs"
import path from "path"
import type { PermissionV1 } from "@opencode-ai/core/v1/permission"
import { Cause, Deferred, Effect, Layer, Option } from "effect"
import type { Server } from "@modelcontextprotocol/sdk/server/index.js"
import pkg from "../../package.json" with { type: "json" }
import {
  Asker, type AskReply, type AskRequest, ConfigError, Mcp, Permission, type PermissionMode, type RenderEvent,
  type ResolvedConfig, type RunState, Runtime, SessionStore, type SubagentInfo, type TokenUsage,
} from "../contract"
import { cleanEvent } from "../render/event"
import { validId } from "../session/store"
import { envelope } from "../subagent/manager"
import { id, isLoopback } from "../util/paths"
import { redact, redactText } from "../util/redact"

export interface ServeInput { transport: "stdio" | "http"; host: string; port: number; allowRemoteBypass: boolean }

type Result = { state: RunState; text?: string; error?: string }
interface Tracked {
  id: string; agent: string; mode: PermissionMode; conn: Conn; started_at: number
  /** The run's own depth and effective ruleset: what a parent_id child inherits. */
  depth: number; ruleset: PermissionV1.Ruleset
  status: Effect.Effect<{ state: RunState; step: number; tokens: TokenUsage }>; wait: (timeout_ms?: number) => Effect.Effect<Option.Option<Result>>
  send: (message: string) => Effect.Effect<boolean>; cancel: Effect.Effect<unknown>; progress?: (message: string) => void
}
type Conn = { server: Server }
type Args = Record<string, unknown>

const MODES = ["default", "acceptEdits", "plan", "bypassPermissions"]
/** A client's permission_mode may only tighten the serve-time mode (lead decision, Phase 6). */
const RANK: Record<string, number> = { plan: 0, default: 1, acceptEdits: 2, bypassPermissions: 3 }
const MAX_SESSIONS = Number(process.env.OCLITE_MCP_MAX_SESSIONS ?? 16)
const MAX_RUNS = Number(process.env.OCLITE_MCP_MAX_RUNS ?? 8)
const IDLE_MS = Number(process.env.OCLITE_MCP_IDLE_MS ?? 1_800_000)
const TERMINAL: readonly RunState[] = ["completed", "failed", "cancelled"]
const REPLY: Record<string, AskReply> = { allow: "once", deny: "reject", always: "always" }
const S = { type: "string" }
const STATE = { type: "string", enum: ["pending", "running", "completed", "failed", "cancelled"] }
const obj = (properties: Record<string, object>, required: string[] = []) => ({ type: "object" as const, properties, required })
const ID = obj({ id: S }, ["id"])
const tool = (name: string, description: string, inputSchema: ReturnType<typeof obj>, outputSchema: ReturnType<typeof obj>, readOnly = false) =>
  ({ name, description, inputSchema, outputSchema, annotations: { readOnlyHint: readOnly } })
const TOOLS = [
  tool("agent_list", "List the oclite agents agent_spawn can start.", obj({}),
    obj({ agents: { type: "array", items: obj({ name: S, description: S, mode: S }, ["name", "mode"]) } }, ["agents"]), true),
  tool("agent_spawn", "Start an oclite agent on a prompt. Foreground (default) waits and returns the <task> envelope; background returns the id at once.",
    obj({ agent: S, prompt: S, background: { type: "boolean", default: false }, parent_id: S, model: S, cwd: S, permission_mode: { type: "string", enum: MODES } }, ["agent", "prompt"]),
    obj({ id: S, state: STATE, envelope: S }, ["id", "state"])),
  tool("agent_send", "Send a message to a running agent; it is read at the next turn boundary.", obj({ id: S, message: S }, ["id", "message"]),
    obj({ ok: { type: "boolean" }, delivery: { type: "string", enum: ["steer", "not_running"] } }, ["ok", "delivery"])),
  tool("agent_status", "State, step, tokens and any pending permission request of an agent.", ID,
    obj({ id: S, agent: S, state: STATE, step: { type: "number" }, started_at: S,
      tokens: obj({ input: { type: "number" }, output: { type: "number" }, estimated: { type: "boolean" } }, ["input", "output", "estimated"]),
      pending_permission: obj({ request_id: S, tool: S, patterns: { type: "array", items: S }, summary: S }, ["request_id", "tool", "patterns", "summary"]) },
    ["id", "agent", "state", "step", "started_at", "tokens"]), true),
  tool("agent_result", "Wait for an agent's result (wait=false returns at once). state stays running on timeout.",
    obj({ id: S, wait: { type: "boolean", default: true }, timeout_ms: { type: "number", default: 300000 } }, ["id"]), obj({ id: S, state: STATE, envelope: S }, ["id", "state"]), true),
  tool("agent_cancel", "Cancel an agent.", ID, obj({ status: { type: "string", enum: ["cancelled", "already_finished", "not_found"] } }, ["status"])),
  tool("agent_permission_reply", "Answer a permission_request notification.",
    obj({ id: S, request_id: S, action: { type: "string", enum: ["allow", "deny", "always"] } }, ["id", "request_id", "action"]),
    obj({ ok: { type: "boolean" }, error: { type: "string", enum: ["unknown_request", "expired"] } }, ["ok"])),
]

export function serve(cfg: ResolvedConfig, input: ServeInput) {
  return Effect.gen(function* () {
    const http = input.transport === "http"
    const token = process.env.OCLITE_MCP_TOKEN
    if (http && !token) return yield* new ConfigError({ message: "mcp serve --transport http: set OCLITE_MCP_TOKEN (clients send it as a Bearer token)" })
    if (http && cfg.permissionMode === "bypassPermissions" && !input.allowRemoteBypass)
      return yield* new ConfigError({ message: "bypassPermissions over HTTP needs --i-understand-remote-bypass" })
    if (http && !isLoopback(`http://${input.host.includes(":") ? `[${input.host}]` : input.host}`))
      process.stderr.write(`oclite: warning: serving on ${input.host}, reachable beyond this machine (token required)\n`)
    const root = Number(process.env.OCLITE_DEPTH ?? 0)
    const runs = new Map<string, Tracked>()
    const pending = new Map<string, { req: AskRequest; run: string; answer: Deferred.Deferred<AskReply> }>()
    const expired = new Set<string>()
    const bound: { rootOf?: (session: string) => Effect.Effect<string> } = {}
    const notify = (conn: Conn, level: "info" | "warning", run: string, data: unknown) =>
      Effect.promise(() => conn.server.notification({ method: "notifications/message", params: { level, logger: `oclite/${run}`, data: redact(data) } }).catch(() => undefined))

    // Elicitation when the client declares it, else a permission_request notification answered by agent_permission_reply.
    // Permission.check bounds both by permission_timeout_ms (reject, via "timeout"); interruption lands in `ensuring`.
    const ask = (req: AskRequest) =>
      Effect.gen(function* () {
        const run = yield* bound.rootOf!(req.session_id)
        // No run of ours owns this session: nobody to ask, so reject.
        const conn = runs.get(run)?.conn
        if (!conn) return "reject" as AskReply
        const answer = yield* Deferred.make<AskReply>()
        pending.set(req.request_id, { req, run, answer })
        const replied = Deferred.await(answer)
        if (!conn.server.getClientCapabilities()?.elicitation) {
          yield* notify(conn, "warning", run, { type: "permission_request", id: run, request_id: req.request_id, tool: req.tool,
            patterns: req.patterns, summary: req.summary, reply_with: "agent_permission_reply" })
          return yield* replied
        }
        const elicited = Effect.tryPromise((signal) =>
          conn.server.elicitInput({
            message: redactText(req.summary),
            requestedSchema: { type: "object", properties: { action: { type: "string", enum: ["allow", "deny", "always"] } }, required: ["action"] },
            _meta: { "oclite/ask": { request_id: req.request_id, session_id: req.session_id, agent: req.agent, tool: req.tool, patterns: req.patterns, always: req.always } },
          }, { signal, timeout: cfg.permission_timeout_ms }),
        ).pipe(Effect.map((result) => (result.action === "accept" ? (REPLY[String(result.content?.action)] ?? "reject") : "reject")), Effect.orElseSucceed((): AskReply => "reject"))
        return yield* Effect.raceFirst(elicited, replied)
      }).pipe(Effect.ensuring(Effect.sync(() => pending.delete(req.request_id) && expired.add(req.request_id))))

    const { appLayer } = yield* Effect.promise(() => import("../runtime/runtime"))
    const lib = yield* Effect.promise(() => sdk())
    yield* Effect.gen(function* () {
      const runtime = yield* Runtime
      const store = yield* SessionStore
      const permission = yield* Permission
      const mcp = yield* Mcp
      bound.rootOf = (session) =>
        runs.has(session) ? Effect.succeed(session) : store.read(session).pipe(Effect.flatMap((records) => {
          const parent = records.find((record) => record.type === "session")?.parent_id
          return parent ? bound.rootOf!(parent) : Effect.succeed(session)
        }))

      // Events → notifications/message and, for a waiting foreground call, progress. Text and reasoning deltas are
      // batched per 50 ms and redacted after joining, so a secret split across deltas is still caught.
      const sinkFor = (conn: Conn, ref: { id?: string; run?: Tracked }) => {
        const batch = { text: "", last: undefined as RenderEvent | undefined }
        const flush = () => {
          if (batch.last) void Effect.runPromise(notify(conn, "info", ref.id ?? batch.last.session_id, cleanEvent({ ...batch.last, text: batch.text } as RenderEvent)))
          batch.text = ""
          batch.last = undefined
        }
        return (event: RenderEvent) =>
          Effect.suspend(() => {
            if (event.type === "reasoning_delta" || event.type === "text_delta") {
              if (batch.last && (batch.last.type !== event.type || batch.last.session_id !== event.session_id)) flush()
              if (!batch.last) setTimeout(flush, 50)
              batch.text += event.text
              batch.last = event
              return Effect.void
            }
            flush()
            const line = progressLine(event)
            if (line) ref.run?.progress?.(line)
            return notify(conn, "info", ref.id ?? event.session_id, cleanEvent(event))
          })
      }

      const spawn = (args: Args, conn: Conn) =>
        Effect.gen(function* () {
          const agent = cfg.agents[str(args, "agent")]
          if (!agent) return yield* fail(`unknown agent "${args.agent}" (available: ${Object.keys(cfg.agents).sort().join(", ")})`)
          const mode = (MODES.includes(String(args.permission_mode)) ? args.permission_mode : cfg.permissionMode) as PermissionMode
          if (RANK[mode]! > RANK[cfg.permissionMode]!)
            return yield* fail(`permission_mode ${mode} is looser than this server's ${cfg.permissionMode}; a client may only tighten it (plan < default < acceptEdits < bypassPermissions)`)
          const prompt = str(args, "prompt")
          const model = typeof args.model === "string" ? args.model : undefined
          const cwd = typeof args.cwd === "string" ? path.resolve(cfg.cwd, args.cwd) : cfg.cwd
          if (![cfg.projectRoot, cfg.cwd].some((dir) => inside(dir, cwd)) || !existsSync(cwd) || !statSync(cwd).isDirectory())
            return yield* fail(`cwd must be an existing directory inside ${cfg.projectRoot}`)
          if ((yield* Effect.forEach([...runs.values()], (run) => run.status)).filter((item) => !TERMINAL.includes(item.state)).length >= MAX_RUNS) return yield* fail(`too many live runs (${MAX_RUNS}); wait for one to finish or cancel it`)
          const mcpReadOnly = (yield* mcp.tools()).filter((item) => item.readOnly).map((item) => item.name)
          const ref: { id?: string; run?: Tracked } = {}
          const base = { agent: agent.name, mode, conn, started_at: Date.now() }
          if (typeof args.parent_id === "string") {
            // The parent's own depth and full effective ruleset, so a parent_id chain can't reset either.
            const parent = runs.get(args.parent_id)
            if (!parent || parent.conn !== conn) return yield* fail(`unknown parent_id "${args.parent_id}"`)
            const subagents = runtime.subagents
            const info = yield* subagents.spawn({ parent: { session_id: parent.id, depth: parent.depth, ruleset: parent.ruleset, call_id: id("call"), cwd }, agent: agent.name, prompt,
              description: prompt.slice(0, 60), background: true, model, permissionMode: mode, sink: sinkFor(conn, ref) })
            const result = (item: SubagentInfo | undefined) => (item && TERMINAL.includes(item.state) ? Option.some<Result>({ state: item.state, text: item.result, error: item.error }) : Option.none())
            ref.run = { ...base, id: info.id, depth: parent.depth + 1, ruleset: permission.ruleset({ agent, mode, parent: parent.ruleset, mcpReadOnly }), cancel: subagents.cancel(info.id), send: (message) => subagents.send(info.id, message),
              status: subagents.get(info.id).pipe(Effect.map((item) => ({ state: item?.state ?? "failed", step: item?.step ?? 0, tokens: item?.tokens ?? info.tokens }))),
              wait: (ms) => (ms === 0 ? subagents.get(info.id) : subagents.wait(info.id, ms)).pipe(Effect.map(result)) }
          } else {
            // Depth applies on every path: a child `oclite mcp serve` starts at OCLITE_DEPTH.
            if (root > cfg.subagent.max_depth) return yield* fail(`Subagent depth limit reached (${cfg.subagent.max_depth})`)
            // A `transport: mcp` parent sends its ruleset. Over MCP only deny and ask rules are taken, whatever the key (an
            // external_directory allow would switch off outside-cwd asks), so a client can restrict a run, never grant.
            const inherited = Array.isArray(args.parent_rules)
              ? (args.parent_rules as PermissionV1.Rule[]).filter((rule) => isRule(rule) && (rule.action === "deny" || rule.action === "ask"))
              : undefined
            const parent = inherited && { session_id: validId(String(args.parent_session_id)) ? String(args.parent_session_id) : id("ses"), depth: root - 1, ruleset: inherited, call_id: id("call") }
            const handle = yield* runtime.start({ agent: agent.name, prompt, model, cwd, permissionMode: mode, parent }, sinkFor(conn, ref))
            const done = (result: { state: RunState; text: string; error?: string }): Result => ({ state: result.state, text: result.text, error: result.error })
            ref.run = { ...base, id: handle.session_id, depth: root, ruleset: permission.ruleset({ agent, mode, parent: inherited, mcpReadOnly }), cancel: handle.cancel, send: (message) => handle.send(message).pipe(Effect.as(true)),
              status: handle.status, wait: (ms) => (ms === undefined ? handle.await.pipe(Effect.map((item) => Option.some(done(item)))) : handle.await.pipe(Effect.timeoutOption(ms), Effect.map(Option.map(done)))) }
          }
          const run = ref.run
          ref.id = run.id
          runs.set(run.id, run)
          return run
        })

      const call = (name: string, args: Args, conn: Conn, progress?: (message: string) => void) =>
        Effect.gen(function* () {
          if (name === "agent_list")
            return { agents: Object.values(cfg.agents).sort((a, b) => a.name.localeCompare(b.name)).map((agent) => ({ name: agent.name, description: agent.description ?? "", mode: agent.mode })) }
          if (name === "agent_spawn") {
            const run = yield* spawn(args, conn)
            if (args.background === true) return { id: run.id, state: (yield* run.status).state }
            run.progress = progress
            const result = yield* run.wait().pipe(Effect.ensuring(Effect.sync(() => void (run.progress = undefined))))
            return { id: run.id, ...view(run.id, result) }
          }
          if (name === "agent_permission_reply") {
            const entry = pending.get(str(args, "request_id"))
            // Only the connection that started the run may answer for it.
            if (!entry || entry.run !== args.id || runs.get(entry.run)?.conn !== conn) return { ok: false, error: expired.has(String(args.request_id)) ? "expired" : "unknown_request" }
            yield* Deferred.succeed(entry.answer, REPLY[String(args.action)] ?? "reject")
            return { ok: true }
          }
          const run = runs.get(str(args, "id"))
          if (name === "agent_cancel") {
            if (!run || TERMINAL.includes((yield* run.status).state)) return { status: run ? "already_finished" : "not_found" }
            return yield* run.cancel.pipe(Effect.as({ status: "cancelled" }))
          }
          if (!run) return yield* fail(`unknown agent id "${args.id}"`)
          if (name === "agent_send") {
            const running = (yield* run.status).state === "running" && (yield* run.send(str(args, "message")))
            return { ok: running, delivery: running ? "steer" : "not_running" }
          }
          if (name === "agent_status") {
            const status = yield* run.status
            const ask = [...pending.values()].find((entry) => entry.run === run.id || entry.req.session_id === run.id)?.req
            return { id: run.id, agent: run.agent, state: status.state, step: status.step, started_at: new Date(run.started_at).toISOString(),
              tokens: { input: status.tokens.input, output: status.tokens.output, estimated: status.tokens.estimated },
              ...(ask ? { pending_permission: { request_id: ask.request_id, tool: ask.tool, patterns: ask.patterns, summary: ask.summary } } : {}) }
          }
          if (name === "agent_result") {
            const result = yield* run.wait(args.wait === false ? 0 : typeof args.timeout_ms === "number" ? args.timeout_ms : 300_000)
            return { id: run.id, ...view(run.id, result) }
          }
          return yield* fail(`unknown tool "${name}"`)
        })

      const connect = () => {
        const server = new lib.server.Server({ name: "oclite", version: pkg.version }, { capabilities: { tools: {}, prompts: {}, resources: {}, logging: {} },
          instructions: "oclite coding agents. agent_spawn starts one; background runs report through agent_status/agent_result." })
        const conn: Conn = { server }
        const types = lib.types
        server.setRequestHandler(types.ListToolsRequestSchema, async () => ({ tools: TOOLS }))
        server.setRequestHandler(types.CallToolRequestSchema, (request, extra) => {
          const token = request.params._meta?.progressToken
          const count = { value: 0 }
          const progress = token === undefined ? undefined : (message: string) =>
            void extra.sendNotification({ method: "notifications/progress", params: { progressToken: token, progress: ++count.value, message } }).catch(() => undefined)
          return Effect.runPromise(call(request.params.name, request.params.arguments ?? {}, conn, progress).pipe(
            Effect.map((raw) => redact(raw) as Args),
            Effect.map((out) => ({ content: [{ type: "text" as const, text: JSON.stringify(out) }], structuredContent: out })),
            // Bad arguments (str throws) and failures alike become isError results.
            Effect.catchCause((cause) => Effect.succeed({ content: [{ type: "text" as const, text: JSON.stringify({ error: (Cause.squash(cause) as { message?: string }).message ?? "failed" }) }], isError: true })),
          ))
        })
        const primary = () => Object.values(cfg.agents).filter((agent) => agent.mode !== "subagent").sort((a, b) => a.name.localeCompare(b.name))
        server.setRequestHandler(types.ListPromptsRequestSchema, async () =>
          ({ prompts: primary().map((agent) => ({ name: agent.name, description: agent.description, arguments: [{ name: "task", description: "What the agent should do", required: true }] })) }))
        server.setRequestHandler(types.GetPromptRequestSchema, async (request) => {
          const agent = primary().find((item) => item.name === request.params.name)
          if (!agent) throw new Error(`unknown prompt "${request.params.name}"`)
          const text = `Call the oclite agent_spawn tool with ${JSON.stringify({ agent: agent.name, prompt: request.params.arguments?.task ?? "" })} and report its result.`
          return { description: agent.description, messages: [{ role: "user" as const, content: { type: "text" as const, text } }] }
        })
        // Only this server's runs and sessions under its cwd, never every session on the machine.
        const mine = (header: { id: string; cwd: string } | undefined) => !!header && (runs.has(header.id) || inside(cfg.cwd, header.cwd))
        server.setRequestHandler(types.ListResourcesRequestSchema, () => Effect.runPromise(store.list({ limit: 500 }).pipe(Effect.map((items) => ({
          resources: items.filter(mine).slice(0, 50).map((item) => ({ uri: `oclite://sessions/${item.id}`, name: `${item.id} (${item.agent})`, mimeType: "application/x-ndjson" })),
        })))))
        server.setRequestHandler(types.ReadResourceRequestSchema, (request) => {
          const session = request.params.uri.match(/^oclite:\/\/sessions\/(.+)$/)?.[1] ?? ""
          if (!validId(session)) throw new Error(`unknown resource ${request.params.uri}`)
          // JSONL is redacted on write; redact again for secrets registered in this process.
          return Effect.runPromise(store.read(session).pipe(Effect.map((records) => {
            const header = records.find((record) => record.type === "session")
            if (!mine(header?.type === "session" ? header : undefined)) throw new Error(`unknown resource ${request.params.uri}`)
            return { contents: [{ uri: request.params.uri, mimeType: "application/x-ndjson", text: records.map((record) => JSON.stringify(redact(record))).join("\n") }] }
          })))
        })
        return conn
      }

      const cancelAll = Effect.suspend(() => Effect.forEach([...runs.values()], (run) => run.cancel.pipe(Effect.ignore), { concurrency: "unbounded", discard: true }))
      if (!http) {
        yield* Effect.promise(() => connect().server.connect(new lib.stdio.StdioServerTransport()))
        // stdin EOF: the client is gone, so every run is cancelled and the process exits 0.
        yield* Effect.callback<void>((resume) => void process.stdin.once("end", () => resume(Effect.void)).once("close", () => resume(Effect.void)))
        yield* cancelAll
        return
      }
      const sessions = new Map<string, InstanceType<typeof lib.http.WebStandardStreamableHTTPServerTransport>>()
      const seen = new Map<string, number>()
      // Idle sessions expire; their runs keep going and stay reachable from a new session by id.
      setInterval(() => seen.forEach((at, session) => {
        if (Date.now() - at >= IDLE_MS) void (sessions.get(session)?.close(), sessions.delete(session), seen.delete(session))
      }), Math.min(IDLE_MS, 60_000)).unref()
      const listener = Bun.serve({
        hostname: input.host, port: input.port, idleTimeout: 0, maxRequestBodySize: 4 * 1024 * 1024,
        // One shared token = one principal: agent_send/status/cancel/result aren't bound to the connection that started
        // a run (agent_permission_reply and parent_id are).
        fetch: async (request, bun) => {
          if (!trusted(request, input.host, bun.port ?? input.port)) return new Response("forbidden", { status: 403 })
          if (new URL(request.url).pathname !== "/mcp") return new Response("not found", { status: 404 })
          if (!authorized(request.headers.get("authorization"), token!)) return new Response("unauthorized", { status: 401, headers: { "WWW-Authenticate": "Bearer" } })
          const sid = request.headers.get("mcp-session-id")
          const existing = sid ? sessions.get(sid) : undefined
          if (existing) return (seen.set(sid!, Date.now()), existing.handleRequest(request))
          if (sid) return new Response("unknown session", { status: 404 })
          if (sessions.size >= MAX_SESSIONS) return new Response(`too many MCP sessions (${MAX_SESSIONS})`, { status: 503 })
          const transport: InstanceType<typeof lib.http.WebStandardStreamableHTTPServerTransport> = new lib.http.WebStandardStreamableHTTPServerTransport({
            sessionIdGenerator: () => crypto.randomUUID(),
            onsessioninitialized: (session) => void (sessions.set(session, transport), seen.set(session, Date.now())),
            onsessionclosed: (session) => void (sessions.delete(session), seen.delete(session)),
          })
          await connect().server.connect(transport)
          return transport.handleRequest(request)
        },
      })
      process.stderr.write(`oclite mcp serve: http://${listener.hostname}:${listener.port}/mcp\n`)
      yield* Effect.never.pipe(Effect.ensuring(Effect.sync(() => void listener.stop(true))), Effect.ensuring(cancelAll))
    }).pipe(Effect.provide(appLayer(cfg, Layer.succeed(Asker, { ask }))))
  })
}

async function sdk() {
  const [server, stdio, http, types] = await Promise.all([
    import("@modelcontextprotocol/sdk/server/index.js"), import("@modelcontextprotocol/sdk/server/stdio.js"),
    import("@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js"), import("@modelcontextprotocol/sdk/types.js"),
  ])
  return { server, stdio, http, types }
}

/** Digests have one length, so the comparison is constant-time and never leaks the token's length. */
function authorized(header: string | null, token: string) {
  const digest = (value: string) => createHash("sha256").update(value).digest()
  return header?.startsWith("Bearer ") === true && timingSafeEqual(digest(header.slice(7)), digest(token))
}

/** DNS-rebinding defence in depth: a present Origin must be loopback, and Host must name the bound host:port. */
function trusted(request: Request, host: string, port: number) {
  const origin = request.headers.get("origin")
  if (origin && !isLoopback(origin)) return false
  const loopback = isLoopback(`http://${host.includes(":") ? `[${host}]` : host}`)
  const names = loopback ? ["localhost", "127.0.0.1", "[::1]", host] : [host.includes(":") ? `[${host}]` : host]
  return names.map((name) => `${name}:${port}`).includes(request.headers.get("host") ?? "")
}

function view(run: string, result: Option.Option<Result>) {
  if (Option.isNone(result)) return { state: "running" as RunState }
  const info = { id: run, state: result.value.state, result: result.value.text, error: result.value.error } as SubagentInfo
  return { state: result.value.state, envelope: envelope(info) }
}

function progressLine(event: RenderEvent) {
  if (event.type === "tool_start" || event.type === "tool_end") return `${event.type === "tool_start" ? "⚙" : "✓"} ${event.summary}`
  if (event.type === "step_finish") return `step ${event.step}`
  if (event.type === "status") return event.message
  return undefined
}

function inside(root: string, target: string) {
  const relative = path.relative(root, target)
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))
}

function isRule(value: unknown): value is PermissionV1.Rule {
  const rule = value as PermissionV1.Rule
  return typeof rule === "object" && rule !== null && typeof rule.permission === "string" && typeof rule.pattern === "string" && ["allow", "deny", "ask"].includes(rule.action)
}

function str(args: Args, key: string) {
  if (typeof args[key] !== "string") throw new Error(`${key} must be a string`)
  return args[key] as string
}

function fail(message: string) {
  return Effect.fail(new ConfigError({ message }))
}
