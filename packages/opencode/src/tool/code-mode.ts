import * as Tool from "./tool"
import type { Tool as AITool } from "ai"
import type { Tool as MCPToolDef } from "@modelcontextprotocol/sdk/types.js"
import { Cause, Effect, Schema } from "effect"
import {
  CodeMode,
  Tool as SandboxTool,
  toolError,
  type ExecuteResult,
  type JsonSchema,
  type ToolDefinition,
} from "@opencode-ai/codemode"
import { MCP } from "@/mcp"
import { McpCatalog } from "@/mcp/catalog"
import { McpInvoke } from "@/mcp/invoke"
import { Agent } from "@/agent/agent"
import { Session } from "@/session/session"
import { Permission } from "@/permission"
import { Plugin } from "@/plugin"

export const CODE_MODE_TOOL = "execute"

// OpenCode sets NO execution limits: no timeout, no tool-call cap, and no CodeMode output
// truncation. Cancelling the tool call aborts `ctx.abort`, which wins the race below and
// interrupts the execution fiber — structured concurrency takes the program and its
// in-flight child calls down with it; every child call is permission-gated anyway. Output
// bounding is OpenCode's native tool-output truncation (Tool.define's shared wrapper),
// which applies to `execute` like any other tool and dumps the full output to a file when
// it triggers.

// The static base description. The full usage guide and the grouped, permission-filtered
// tool catalog are appended per agent by the registry (`describeCodeMode`, the same
// composition point `describeTask` uses), so `plugin.trigger("tool.definition")` sees this
// base first, exactly like the task tool.
const DESCRIPTION = [
  "Execute a JavaScript/TypeScript program that orchestrates the connected MCP tools inside a confined runtime.",
  "The full usage guide and the catalog of available tools follow below.",
].join("\n")

export const Parameters = Schema.Struct({
  code: Schema.String.annotate({
    description: [
      "JavaScript source to execute.",
      "Inside CodeMode, `tools` contains only the MCP/CodeMode tools listed in this execute tool's description; top-level opencode tools like bash, read, or lsp are not available unless listed there.",
      "Call available tools using the exact signatures shown in this execute tool's description, compose the results, and `return` the final value.",
    ].join(" "),
  }),
})

/** One child tool call, surfaced live so the UI can render a per-call line that
 *  updates as the program runs. `tool` is the dotted path (e.g. `github.create_issue`). */
export type CallEntry = { tool: string; status: "running" | "completed" | "error"; input?: Record<string, unknown> }

type Metadata = {
  toolCalls: CallEntry[]
  error?: boolean
}

/**
 * A tool-result attachment: identical to a session `FilePart` (minus the ids) and
 * carrying the actual bytes (`url`, often a base64 `data:` URL), so it lowers 1:1 into
 * `Tool.ExecuteResult.attachments`. Attachments never enter the sandbox — media stripped
 * from child tool results is accumulated host-side and returned on the outer `execute`
 * result, where the existing attachment plumbing turns it into visible images/files.
 */
export type Attachment = NonNullable<Tool.ExecuteResult["attachments"]>[number]

/** One MCP tool in the grouped catalog: the flat `server_tool` key split into its
 *  namespace (`server`) and local name, with the raw JSON Schemas used for rendering. */
export type CatalogEntry = {
  path: string
  key: string
  server: string
  local: string
  description: string
  tool: AITool
  inputSchema: JsonSchema
  outputSchema?: JsonSchema
}

/** Render-only cast: MCP definitions carry JSON Schema documents already. */
const toJsonSchema = (schema: unknown): JsonSchema => schema as JsonSchema

/** The input schema for entries without a cached MCP definition, recovered from the
 *  ai-sdk tool when possible so signatures stay informative. */
function fallbackInputSchema(tool: AITool): JsonSchema {
  const schema = (tool.inputSchema as { jsonSchema?: unknown } | undefined)?.jsonSchema
  if (schema && typeof schema === "object") return toJsonSchema(schema)
  return { type: "object", properties: {} }
}

/**
 * Group the flat `server_tool` catalog into per-server namespaces. `servers` are
 * the sanitized MCP client names; the longest matching prefix wins so a server
 * named `a_b` beats `a` for the key `a_b_tool`. `mcpDefs` carries the raw MCP
 * definitions (keyed identically) so each entry retains its original
 * `inputSchema`/`outputSchema` for signature rendering.
 */
export function groupByServer(
  mcpTools: Record<string, AITool>,
  servers: readonly string[],
  mcpDefs: Record<string, MCPToolDef> = {},
): Map<string, CatalogEntry[]> {
  const byLongest = [...servers].sort((a, b) => b.length - a.length)
  const groups = new Map<string, CatalogEntry[]>()
  for (const key of Object.keys(mcpTools).sort((a, b) => a.localeCompare(b))) {
    const server = byLongest.find((name) => key.startsWith(name + "_")) ?? (key.includes("_") ? key.slice(0, key.indexOf("_")) : key)
    const local = server && key.startsWith(server + "_") ? key.slice(server.length + 1) : key
    const def = mcpDefs[key]
    const entry: CatalogEntry = {
      path: `${server}.${local}`,
      key,
      server,
      local,
      description: mcpTools[key]!.description ?? def?.description ?? "",
      tool: mcpTools[key]!,
      inputSchema: def?.inputSchema ? toJsonSchema(def.inputSchema) : fallbackInputSchema(mcpTools[key]!),
      ...(def?.outputSchema ? { outputSchema: toJsonSchema(def.outputSchema) } : {}),
    }
    groups.set(server, [...(groups.get(server) ?? []), entry])
  }
  return groups
}

/** The executable catalog for a (already permission-filtered) MCP tool set: grouped
 *  entries, minus any without an ai-sdk execute function. */
export function buildCatalog(
  mcpTools: Record<string, AITool>,
  mcpDefs: Record<string, MCPToolDef>,
  servers: readonly string[],
): CatalogEntry[] {
  return [...groupByServer(mcpTools, servers, mcpDefs).values()].flat().filter((entry) => entry.tool.execute !== undefined)
}

/**
 * The model-facing usage guide plus grouped catalog for the given MCP tool set: the
 * CodeMode instructions for this tool tree (syntax guide + tool signatures, or the
 * namespace overview + search for large catalogs). Callers pass an already
 * permission-filtered tool set — hard-denied tools never enter the catalog. The preview
 * tree's runs are placeholders — rendering never invokes them.
 */
export function catalogInstructions(
  mcpTools: Record<string, AITool>,
  mcpDefs: Record<string, MCPToolDef>,
  servers: readonly string[],
): string {
  const catalog = buildCatalog(mcpTools, mcpDefs, servers)
  return CodeMode.make({
    tools: toolTree(catalog, () => () => Effect.fail(toolError("Tool preview is not executable."))),
  }).instructions()
}

function displayInput(input: unknown): Record<string, unknown> | undefined {
  if (input === null || input === undefined) return
  if (typeof input === "object" && !Array.isArray(input)) {
    const value = input as Record<string, unknown>
    if (Object.keys(value).length > 0) return value
    return
  }
  return { input }
}

const lastSegment = (uri: string) => {
  const trimmed = uri.split(/[?#]/, 1)[0]!.replace(/\/+$/, "")
  const segment = trimmed.slice(trimmed.lastIndexOf("/") + 1)
  return segment.length > 0 ? segment : undefined
}

const dataUrl = (mime: string, base64: string) => `data:${mime};base64,${base64}`

/** The stand-in payload for a media-only tool result, so the program knows the call
 *  succeeded even though the media itself never enters the sandbox. */
const mediaMarker = (files: number, images: number) => {
  const noun = files === images ? "image" : "file"
  return `[${files} ${noun}${files === 1 ? "" : "s"} attached to the result]`
}

/**
 * Reduce a raw MCP tool result to the value the sandbox sees. Structured content is
 * preferred; otherwise text blocks are joined. Media blocks (image/audio/resource
 * blob/resource_link) NEVER enter the sandbox: they are stripped into `collect`, the
 * per-execution attachment accumulator, and a tool that returned ONLY media yields a
 * small text marker instead. Lenient — never throws on unexpected shapes.
 */
export function toSandboxResult(raw: unknown, collect: (attachment: Attachment) => void): unknown {
  if (raw === null || typeof raw !== "object") return raw
  const record = raw as { structuredContent?: unknown; content?: unknown }
  const content = Array.isArray(record.content) ? record.content : []
  const text: string[] = []
  let files = 0
  let images = 0
  const push = (attachment: Attachment) => {
    files += 1
    if (attachment.mime.startsWith("image/")) images += 1
    collect(attachment)
  }
  for (const item of content) {
    if (!item || typeof item !== "object") continue
    const block = item as Record<string, unknown>
    switch (block.type) {
      case "text":
        if (typeof block.text === "string") text.push(block.text)
        break
      case "image":
      case "audio":
        if (typeof block.data === "string" && typeof block.mimeType === "string") {
          push({ type: "file", mime: block.mimeType, url: dataUrl(block.mimeType, block.data) })
        }
        break
      case "resource": {
        const res = block.resource as Record<string, unknown> | undefined
        if (res && typeof res === "object") {
          const mime = typeof res.mimeType === "string" ? res.mimeType : "application/octet-stream"
          const uri = typeof res.uri === "string" ? res.uri : undefined
          if (typeof res.blob === "string") {
            push({ type: "file", mime, url: dataUrl(mime, res.blob), filename: uri ? lastSegment(uri) : undefined })
          } else if (typeof res.text === "string") {
            text.push(res.text)
          }
        }
        break
      }
      case "resource_link":
        if (typeof block.uri === "string") {
          push({
            type: "file",
            mime: typeof block.mimeType === "string" ? block.mimeType : "application/octet-stream",
            url: block.uri,
            filename: typeof block.name === "string" ? block.name : lastSegment(block.uri),
          })
        }
        break
    }
  }

  if (record.structuredContent !== undefined && record.structuredContent !== null) return record.structuredContent
  if (text.length > 0) return text.join("\n")
  if (files > 0) return mediaMarker(files, images)
  if (Array.isArray(record.content)) return null // MCP-shaped result with nothing extractable
  return raw
}

/**
 * Append captured `console.*` output to the model-facing text as a trailing `Logs:` section,
 * so a program's diagnostics ride back alongside its result — on success AND on error.
 * Returns the text unchanged when nothing was logged. This is the sandbox's only
 * stdout-like channel — it goes to the model, not the user.
 */
export function withLogs(output: string, logs: ReadonlyArray<string> = []): string {
  if (logs.length === 0) return output
  const section = "Logs:\n" + logs.join("\n")
  return output.length > 0 ? `${output}\n\n${section}` : section
}

/** Coerce the program's return value to model-facing text without ever failing on shape. */
export function formatValue(value: unknown): string {
  if (typeof value === "string") return value
  if (value === undefined) return "undefined"
  try {
    return JSON.stringify(value, null, 2) ?? String(value)
  } catch {
    return String(value)
  }
}

type Run = (input: unknown) => Effect.Effect<unknown, unknown>

/** Build the `tools.<server>.<tool>` tree CodeMode executes against, one
 *  `Tool.make` definition per MCP tool with its render-only JSON Schemas. */
function toolTree(catalog: readonly CatalogEntry[], run: (entry: CatalogEntry) => Run) {
  const tree: Record<string, Record<string, ToolDefinition>> = {}
  for (const entry of catalog) {
    const namespace = (tree[entry.server] ??= {})
    namespace[entry.local] = SandboxTool.make({
      description: entry.description,
      input: entry.inputSchema,
      output: entry.outputSchema,
      run: run(entry),
    })
  }
  return tree
}

/** Failures inside a child call — plugin hook failures, permission denials, and tool
 *  failures alike — become safe, catchable in-program errors via toolError, so a
 *  program can try/catch one call without the whole execution dying. Interruption
 *  (user cancel) keeps propagating as interruption. */
const toCatchable = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(
    Effect.catchCause((cause) => {
      if (Cause.hasInterruptsOnly(cause)) return Effect.interrupt
      const error = Cause.squash(cause)
      return Effect.fail(toolError(error instanceof Error ? error.message : String(error), error))
    }),
  )

export const CodeModeTool = Tool.define(
  CODE_MODE_TOOL,
  Effect.gen(function* () {
    const mcp = yield* MCP.Service
    const agents = yield* Agent.Service
    const sessions = yield* Session.Service
    const plugin = yield* Plugin.Service

    const init: Tool.DefWithoutID<typeof Parameters, Metadata> = {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: Effect.fn("CodeMode.execute")(function* (params, ctx) {
        // Already cancelled: don't start the program at all. (The mid-flight case is the
        // race below; racing alone would still let the program run its first steps.)
        if (ctx.abort.aborted) {
          return {
            title: CODE_MODE_TOOL,
            metadata: { toolCalls: [], error: true },
            output: "Execution cancelled.",
          } satisfies Tool.ExecuteResult<Metadata>
        }
        // A fresh MCP snapshot per execution, so the runtime tracks live tool-list
        // changes, filtered with the same merged agent+session ruleset that gates
        // `ctx.ask` (see SessionTools.context). A hard-denied tool never enters the
        // tree, so it is not dispatchable even if the model guesses its name — the
        // program gets the normal unknown-tool diagnostic, not a permission error.
        const agent = yield* agents.get(ctx.agent)
        const session = yield* sessions.get(ctx.sessionID).pipe(Effect.orDie)
        const ruleset = Permission.merge(agent.permission, session.permission ?? [])
        const mcpTools = Permission.visibleTools(yield* mcp.tools(), ruleset)
        const servers = Object.keys(yield* mcp.clients()).map(McpCatalog.sanitize)
        const catalog = buildCatalog(mcpTools, yield* mcp.defs(), servers)

        const calls: CallEntry[] = []
        // Media stripped from child tool results accumulates here for the life of the
        // call; the bytes never enter the sandbox (see toSandboxResult).
        const attachments: Attachment[] = []
        const collect = (attachment: Attachment) => void attachments.push(attachment)
        // Stream the current call list to the UI. Sent on every status change so the
        // tool part shows each child call appearing and resolving while the program runs.
        const publish = () => ctx.metadata({ title: CODE_MODE_TOOL, metadata: { toolCalls: calls.map((c) => ({ ...c })) } })

        // One CodeMode tool per MCP tool, running the same shared middle as legacy
        // per-tool registration (McpInvoke.invoke: plugin before hook → permission
        // ask → Tool.execute span → dispatch through the ai-sdk wrapper, which owns
        // callTool timeouts/progress and turns an MCP isError into a thrown Error →
        // plugin after hook), so plugins observe child calls too. Each child gets a
        // synthetic hook/span callID `${parentCallID}/${n}` (per-execution counter,
        // opaque — nothing parses it); the ai-sdk toolCallId is unchanged. Failures —
        // hook, denial, or tool — fail only that child call as a safe, catchable
        // in-program error (toCatchable); the raw result is then shaped for the sandbox.
        let childCalls = 0
        const callTool = (entry: CatalogEntry) => (input: unknown) =>
          toCatchable(
            Effect.gen(function* () {
              childCalls += 1
              const raw = yield* McpInvoke.invoke({
                plugin,
                key: entry.key,
                execute: entry.tool.execute!,
                args: input ?? {},
                callID: `${ctx.callID ?? entry.key}/${childCalls}`,
                options: { toolCallId: ctx.callID ?? entry.key, abortSignal: ctx.abort, messages: [] },
                sessionID: ctx.sessionID,
                messageID: ctx.messageID,
                ask: ctx.ask,
              })
              return toSandboxResult(raw, collect)
            }),
          )

        const runtime = CodeMode.make({
          tools: toolTree(catalog, callTool),
          onToolCallStart: ({ index, name, input }) =>
            Effect.suspend(() => {
              const shown = displayInput(input)
              calls[index] = { tool: name, status: "running", ...(shown ? { input: shown } : {}) }
              return publish()
            }),
          onToolCallEnd: ({ index, outcome }) =>
            Effect.suspend(() => {
              const current = calls[index]
              if (current) calls[index] = { ...current, status: outcome === "success" ? "completed" : "error" }
              return publish()
            }),
        })

        // The shared tool runner does not wire ctx.abort to fiber interruption (it runs
        // tools via Effect.runPromise with no abort handling), so without this race the
        // program would keep running after the user cancels. The abort signal winning the
        // race interrupts the execution fiber; the cancelled result keeps the runner's
        // post-abort bookkeeping (completeToolCall) on its normal path.
        const cancelled = Effect.callback<ExecuteResult>((resume) => {
          const onAbort = () =>
            resume(
              Effect.succeed<ExecuteResult>({
                ok: false,
                error: { kind: "ExecutionFailure", message: "Execution cancelled." },
                toolCalls: calls.map((call) => ({ name: call.tool })),
              }),
            )
          if (ctx.abort.aborted) return onAbort()
          ctx.abort.addEventListener("abort", onAbort, { once: true })
          return Effect.sync(() => ctx.abort.removeEventListener("abort", onAbort))
        })

        const result = yield* Effect.raceFirst(runtime.execute(params.code), cancelled)
        const logs = result.logs ?? []
        const attached = attachments.length > 0 ? { attachments } : {}

        if (result.ok) {
          return {
            title: CODE_MODE_TOOL,
            metadata: { toolCalls: calls },
            output: withLogs(formatValue(result.value), logs),
            ...attached,
          } satisfies Tool.ExecuteResult<Metadata>
        }
        // Diagnostics may carry suggestions (e.g. pointing an unknown tool at
        // discovery); append the ones the message doesn't already contain.
        const hints = (result.error.suggestions ?? []).filter((hint) => !result.error.message.includes(hint))
        return {
          title: CODE_MODE_TOOL,
          metadata: { toolCalls: calls, error: true },
          output: withLogs([result.error.message, ...hints].join("\n"), logs),
          ...attached,
        } satisfies Tool.ExecuteResult<Metadata>
      }),
    }
    return init
  }),
)
