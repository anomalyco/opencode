// `transport: mcp` sub-agents (ARCHITECTURE §12): an MCP client to a child `oclite mcp serve` over stdio (or a url plus
// token). The child elicits its asks, which go to the parent's Asker; its notifications/message events become parent
// events. The scope finalizer cancels live runs, then closes (stdin EOF → SIGTERM → SIGKILL after 2 s).
import path from "path"
import { Effect } from "effect"
import pkg from "../../package.json" with { type: "json" }
import { type AskReply, type AskRequest, type ChildClient, type ChildSpec, McpError, type RenderEvent, type RunState } from "../contract"
import type { PermissionV1 } from "@opencode-ai/core/v1/permission"
import { redactText } from "../util/redact"

const ENTRY = path.resolve(import.meta.dir, "../index.ts")
const ACTION: Record<AskReply, string> = { once: "allow", always: "always", reject: "deny" }
/** agent_result waits at most this long per call; longer waits repeat it. */
const SLICE_MS = 300_000

export const connectChild = (spec: ChildSpec) =>
  Effect.gen(function* () {
    const lib = yield* Effect.promise(() => sdk())
    const client = new lib.client.Client({ name: "oclite-parent", version: pkg.version }, { capabilities: { elicitation: {} } })
    client.setRequestHandler(lib.types.ElicitRequestSchema, async (request) => {
      const meta = (request.params._meta?.["oclite/ask"] ?? {}) as Partial<AskRequest>
      const ask: AskRequest = { request_id: meta.request_id ?? "", session_id: meta.session_id ?? "", agent: meta.agent ?? "", tool: meta.tool ?? "",
        patterns: meta.patterns ?? [], always: meta.always ?? [], summary: request.params.message, metadata: {} }
      const reply = await Effect.runPromise(spec.onAsk(ask))
      return { action: "accept" as const, content: { action: ACTION[reply] } }
    })
    client.setNotificationHandler(lib.types.LoggingMessageNotificationSchema, (notification) => {
      const data = notification.params.data
      if (isEvent(data)) void Effect.runPromise(spec.onEvent(data))
    })
    const command = spec.command ?? ["oclite", "mcp", "serve"]
    // A leading "oclite" means this very CLI, so tests and unlinked checkouts need no PATH install.
    const argv = command[0] === "oclite" ? [process.execPath, ENTRY, ...command.slice(1)] : command
    const log = { tail: "" }
    const transport = spec.url
      ? new lib.http.StreamableHTTPClientTransport(new URL(spec.url), { requestInit: spec.token ? { headers: { Authorization: `Bearer ${spec.token}` } } : undefined })
      : new lib.stdio.StdioClientTransport({ command: argv[0]!, args: argv.slice(1), cwd: spec.cwd, stderr: "pipe",
          // A stdio child serves over stdio, so it never needs the HTTP serve token.
          env: Object.fromEntries(Object.entries(spec.env).filter((entry) => entry[0] !== "OCLITE_MCP_TOKEN")) })
    if (transport instanceof lib.stdio.StdioClientTransport)
      transport.stderr?.on("data", (chunk: Buffer) => void (log.tail = (log.tail + chunk.toString()).slice(-2000)))
    const failure = (error: unknown) =>
      new McpError({ server: spec.url ?? argv.join(" "), message: redactText(`${error instanceof Error ? error.message : String(error)}${log.tail ? ` (${log.tail.trim().split("\n").at(-1)})` : ""}`) })
    const live = new Set<string>()
    const pid = { value: undefined as number | undefined }
    // Last resort for exits that skip finalizers.
    const onExit = () => pid.value && kill(pid.value)
    yield* Effect.acquireRelease(
      Effect.tryPromise({ try: () => client.connect(transport, { timeout: 30_000 }), catch: failure }).pipe(
        Effect.tap(() => Effect.sync(() => {
          pid.value = transport instanceof lib.stdio.StdioClientTransport ? (transport.pid ?? undefined) : undefined
          process.on("exit", onExit)
        })),
      ),
      () => Effect.promise(async () => {
        await Promise.all([...live].map((id) => call("agent_cancel", { id }, 5_000).catch(() => undefined)))
        await client.close().catch(() => undefined)
        process.off("exit", onExit)
      }),
    )

    async function call(name: string, args: Record<string, unknown>, timeout = 60_000) {
      const result = await client.callTool({ name, arguments: args }, undefined, { timeout })
      const out = (result.structuredContent ?? {}) as Record<string, unknown>
      if (result.isError) throw new Error(result.content.map((part) => (part.type === "text" ? part.text : "")).join("") || `${name} failed`)
      return out
    }
    const run = <A>(body: () => Promise<A>) => Effect.tryPromise({ try: body, catch: failure })

    const result = (id: string, timeout_ms: number): Effect.Effect<{ state: RunState; text: string }, McpError> =>
      run(() => call("agent_result", { id, wait: true, timeout_ms: Math.min(timeout_ms, SLICE_MS) }, Math.min(timeout_ms, SLICE_MS) + 30_000)).pipe(
        Effect.flatMap((out) => {
          const state = out.state as RunState
          if ((state === "running" || state === "pending") && timeout_ms > SLICE_MS) return result(id, timeout_ms - SLICE_MS)
          if (state !== "running" && state !== "pending") live.delete(id)
          return Effect.succeed({ state, text: unwrap(String(out.envelope ?? "")) })
        }),
      )

    return {
      // Wider than ChildClient's input: the parent's ruleset and session id travel too (manager.ts `remote`).
      spawn: (input: Parameters<ChildClient["spawn"]>[0] & { parent_rules?: PermissionV1.Ruleset; parent_session_id?: string }) =>
        run(() => call("agent_spawn", { ...input })).pipe(Effect.map((out) => {
          live.add(String(out.id))
          return String(out.id)
        })),
      result,
      send: (id, message) => run(() => call("agent_send", { id, message })).pipe(Effect.asVoid),
      cancel: (id) => run(() => call("agent_cancel", { id })).pipe(Effect.ignore),
    } satisfies ChildClient
  })

/** The child's `<task>` envelope → its inner text; the parent's manager wraps it again with its own id. */
function unwrap(envelope: string) {
  return envelope.match(/<task_(?:result|error)>\n([\s\S]*)\n<\/task_(?:result|error)>\n<\/task>$/)?.[1] ?? envelope
}

function isEvent(data: unknown): data is RenderEvent {
  return typeof data === "object" && data !== null && "session_id" in data && "agent_path" in data && Array.isArray(data.agent_path)
}

async function sdk() {
  const [client, stdio, http, types] = await Promise.all([
    import("@modelcontextprotocol/sdk/client/index.js"), import("@modelcontextprotocol/sdk/client/stdio.js"),
    import("@modelcontextprotocol/sdk/client/streamableHttp.js"), import("@modelcontextprotocol/sdk/types.js"),
  ])
  return { client, stdio, http, types }
}

function kill(pid: number) {
  // process.kill throws ESRCH when the child is already gone (the normal case), and kill(pid, 0) throws the same way.
  try {
    process.kill(pid, "SIGKILL")
  } catch {}
}
