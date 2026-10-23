import { NodeStdio } from "@effect/platform-node"
import { Config, Context, Effect, Layer, Option, Predicate } from "effect"
import { McpProtocol, McpSchema, McpServer } from "effect/ai"
import fs from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import type { JsonObject } from "./protocol.ts"
import { getObject, getString, parseTargetSelection } from "./relay-helpers.ts"
import * as RelayClient from "./relay-client.ts"
import * as RelayLifecycle from "./relay-lifecycle.ts"
import type { TargetSelection } from "./relay-schema.ts"
import { opencodeBrowserVersion } from "./version.ts"

const packageRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
type CurrentSession = { id: string; established: boolean }

type ToolSpec = {
  readonly name: string
  readonly description: string
  readonly inputSchema: JsonObject
  readonly readOnly: boolean
  readonly destructive: boolean
  readonly idempotent: boolean
  readonly handle: (input: unknown) => Effect.Effect<unknown, Error>
}

type ExecuteArguments = {
  readonly code: string
  readonly session?: string | undefined
  readonly targetSelection?: TargetSelection
}

type AdoptArguments = {
  readonly session?: string | undefined
  readonly targetSelection?: TargetSelection
  readonly tabId?: number
}

const emptyInputSchema = objectSchema({})
const sessionSchemaProperty = {
  type: "string",
  description: "Optional session id. Defaults to this MCP server's current session.",
} as const
const sessionOnlyInputSchema = objectSchema({
  session: sessionSchemaProperty,
})

function makeToolSpecs(relay: RelayClient.Interface, currentSession: CurrentSession): readonly ToolSpec[] {
  const resolveSessionId = (input: unknown, field = "session") => optionalStringField(input, field) ?? currentSession.id
  const establishCurrentSession = (id: string) => {
    currentSession.id = id
    currentSession.established = true
  }
  return [
    {
      name: "execute",
      description: "Execute trusted Playwright JavaScript against the OpenCode Browser session. The result includes console logs, warnings, a bounded execution-context diagnostic when relevant, and an aftermath summary (URL movement, navigations, error counts, handoffs).",
      inputSchema: objectSchema({
        code: { type: "string", description: "JavaScript code to execute. It receives browser, context, page, state, modules, fillInput, fillInputs, snapshot(options?) for compact semantic outlines, search, explicit diffs, or automatic deltas, persistent compatible ref(id) locators, webmcp (list/call), screenshot helpers, ariaSnapshot, ghostCursor, handoff, demonstrate, network capture, and pageConsole (start/stop capturing the page's own console messages and errors, off by default because pages can detect it)." },
        session: { type: "string", description: "Optional existing OpenCode Browser session id. Explicit ids must already exist; omit this field to use the MCP server's current session, which is created when needed." },
        targetUrl: { type: "string", description: "Optional URL substring selecting an existing attached page. This does not navigate or open a URL; use page.goto() for that." },
        targetIndex: { type: "integer", minimum: 0, description: "Optional zero-based attached page index selector." },
      }, ["code"]),
      readOnly: false,
      destructive: true,
      idempotent: false,
      handle: (input) => Effect.gen(function* () {
        const args = yield* Effect.try(() => parseExecuteArguments(input))
        yield* RelayLifecycle.ensureExtensionConnected({ relay, waitForReconnect: true })
        const sessionId = args.session ?? currentSession.id
        const result = yield* relay.execute({
          sessionId,
          code: args.code,
          createIfMissing: !args.session,
          ...(args.targetSelection ? { targetSelection: args.targetSelection } : {}),
        })
        const recreated = !args.session && currentSession.established && result.session.created === true
        establishCurrentSession(sessionId)
        return {
          ...result,
          ...(recreated ? { notice: `Recreated session '${sessionId}' — relay had no such session; page and state were reset.` } : {}),
        }
      }),
    },
    {
      name: "status",
      description: "Return relay, extension, target, and session status.",
      inputSchema: emptyInputSchema,
      readOnly: true,
      destructive: false,
      idempotent: false,
      handle: () => Effect.gen(function* () {
        const [version, status] = yield* Effect.all([relay.version, relay.extensionStatus])
        const buildProblem = RelayLifecycle.relayBuildProblem(version)
        return { endpoint: relay.endpoint, currentSession: currentSession.id, version, status, ...(buildProblem ? { buildProblem } : {}) }
      }),
    },
    {
      name: "session_new",
      description: "Create a OpenCode Browser session and make it current for this MCP server.",
      inputSchema: objectSchema({
        id: { type: "string", description: "Optional lowercase session id." },
        readOnly: { type: "boolean", description: "Create a read-only session: the relay rejects input-dispatching CDP so scripts can inspect but not click or type." },
      }),
      readOnly: false,
      destructive: false,
      idempotent: false,
      handle: (input) => Effect.gen(function* () {
        const requestedId = optionalStringField(input, "id")
        const readOnly = optionalBooleanField(input, "readOnly")
        const session = yield* relay.sessionNew(requestedId, readOnly ? { readOnly: true } : {})
        establishCurrentSession(session.id)
        return { session }
      }),
    },
    {
      name: "session_list",
      description: "List OpenCode Browser sessions.",
      inputSchema: emptyInputSchema,
      readOnly: true,
      destructive: false,
      idempotent: false,
      handle: () => relay.sessions.pipe(Effect.map((sessions) => ({ sessions }))),
    },
    {
      name: "session_current",
      description: "Return this MCP server's current OpenCode Browser session id.",
      inputSchema: emptyInputSchema,
      readOnly: true,
      destructive: false,
      idempotent: true,
      handle: () => Effect.succeed({ currentSession: currentSession.id }),
    },
    {
      name: "session_use",
      description: "Set this MCP server's current OpenCode Browser session id.",
      inputSchema: objectSchema({
        id: { type: "string", description: "Existing OpenCode Browser session id." },
      }, ["id"]),
      readOnly: false,
      destructive: false,
      idempotent: true,
      handle: (input) => Effect.gen(function* () {
        const id = yield* Effect.try(() => requiredStringField(input, "id"))
        yield* ensureSessionExists(relay, id)
        establishCurrentSession(id)
        return { currentSession: currentSession.id }
      }),
    },
    {
      name: "session_reset",
      description: "Reset a OpenCode Browser session's state and page.",
      inputSchema: objectSchema({
        id: sessionSchemaProperty,
      }),
      readOnly: false,
      destructive: true,
      idempotent: false,
      handle: (input) => Effect.gen(function* () {
        const id = resolveSessionId(input, "id")
        const session = yield* relay.sessionReset(id)
        establishCurrentSession(id)
        return { session }
      }),
    },
    {
      name: "session_delete",
      description: "Delete a OpenCode Browser session.",
      inputSchema: objectSchema({
        id: sessionSchemaProperty,
      }),
      readOnly: false,
      destructive: true,
      idempotent: true,
      handle: (input) => Effect.gen(function* () {
        const id = resolveSessionId(input, "id")
        const result = yield* relay.sessionDelete(id)
        if (currentSession.id === id) {
          currentSession.id = `mcp-${crypto.randomUUID().slice(0, 8)}`
          currentSession.established = false
        }
        return { ...result, currentSession: currentSession.id }
      }),
    },
    {
      name: "session_adopt",
      description: "Make an attached tab the OpenCode Browser session's default page for subsequent bare execute calls. Omit targetUrl and targetIndex when only one user-attached tab is available.",
      inputSchema: objectSchema({
        session: { type: "string", description: "Optional existing OpenCode Browser session id. Explicit ids must already exist; omit this field to use the MCP server's current session, which is created when needed." },
        targetUrl: { type: "string", description: "Adopt an existing attached page whose URL contains this text. Omit when only one user-attached tab is available. This does not navigate or open a URL." },
        targetIndex: { type: "integer", minimum: 0, description: "Adopt the attached page at this zero-based target index." },
        tabId: { type: "integer", description: "Adopt the user's tab with this Chrome tab id (the tab= value in status)." },
      }),
      readOnly: false,
      destructive: false,
      idempotent: false,
      handle: (input) => Effect.gen(function* () {
        const args = yield* Effect.try(() => parseAdoptArguments(input))
        const sessionId = args.session ?? currentSession.id
        const result = yield* relay.sessionAdopt({
          sessionId,
          createIfMissing: !args.session,
          ...(args.targetSelection ? { targetSelection: args.targetSelection } : {}),
          ...(args.tabId === undefined ? {} : { tabId: args.tabId }),
        })
        establishCurrentSession(sessionId)
        return { ...result, confirmation: `Adopted session '${result.session.id}' default page: ${result.adoptedUrl}` }
      }),
    },
    {
      name: "network_start",
      description: "Start session-scoped network capture. OpenCode Browser records normalized Playwright exchanges; HAR is only the optional export format. Bodies are embedded by default with per-body and total memory limits.",
      inputSchema: objectSchema({
        session: { type: "string", description: "Optional existing session id. Omit to use or create this MCP server's current session." },
        urlFilter: { type: "string", description: "Capture only request URLs containing this text." },
        resourceTypes: { type: "array", items: { type: "string" }, description: "Optional Playwright resource types such as fetch and xhr." },
        content: { type: "string", enum: ["embed", "omit"], description: "Request and response body mode. Defaults to embed." },
        maxBodyBytes: { type: "integer", minimum: 1, description: "Maximum bytes captured from each body. Defaults to 1000000." },
        maxTotalBodyBytes: { type: "integer", minimum: 1, description: "Maximum body bytes retained for the capture. Defaults to 25000000." },
        maxEntries: { type: "integer", minimum: 1, description: "Maximum captured requests. Defaults to 1000." },
      }),
      readOnly: false,
      destructive: false,
      idempotent: false,
      handle: (input) => Effect.gen(function* () {
        const object = requireObject(input)
        const explicitSession = optionalStringField(object, "session")
        const sessionId = explicitSession ?? currentSession.id
        if (explicitSession) {
          yield* ensureSessionExists(relay, sessionId)
        } else {
          yield* relay.sessionEnsure(sessionId)
          currentSession.established = true
        }
        yield* RelayLifecycle.ensureExtensionConnected({ relay, waitForReconnect: true })
        const content = optionalStringField(object, "content")
        if (content !== undefined && content !== "embed" && content !== "omit") {
          return yield* Effect.fail(new Error("content must be embed or omit"))
        }
        const urlFilter = optionalStringField(object, "urlFilter")
        const resourceTypes = optionalStringArrayField(object, "resourceTypes")
        const maxBodyBytes = optionalPositiveIntegerField(object, "maxBodyBytes")
        const maxTotalBodyBytes = optionalPositiveIntegerField(object, "maxTotalBodyBytes")
        const maxEntries = optionalPositiveIntegerField(object, "maxEntries")
        const result = yield* relay.networkStart({
          sessionId,
          ...(urlFilter ? { urlFilter } : {}),
          ...(resourceTypes && resourceTypes.length > 0 ? { resourceTypes } : {}),
          ...(content ? { content } : {}),
          ...(maxBodyBytes === undefined ? {} : { maxBodyBytes }),
          ...(maxTotalBodyBytes === undefined ? {} : { maxTotalBodyBytes }),
          ...(maxEntries === undefined ? {} : { maxEntries }),
        })
        return { session: sessionId, ...result }
      }),
    },
    {
      name: "network_status",
      description: "Return bounded metadata for a session's active network capture. Captured values are never included.",
      inputSchema: sessionOnlyInputSchema,
      readOnly: true,
      destructive: false,
      idempotent: true,
      handle: (input) => {
        const sessionId = resolveSessionId(input)
        return relay.networkStatus({ sessionId }).pipe(Effect.map((result) => ({ session: sessionId, ...result })))
      },
    },
    {
      name: "network_stop",
      description: "Stop network capture. Optionally write a credential-redacted HAR and store lossless credential values in a reusable secret profile. At least one of outputPath or secrets is required.",
      inputSchema: objectSchema({
        session: sessionSchemaProperty,
        outputPath: { type: "string", description: "Optional artifact path, resolved against the MCP process working directory. The HAR contains stable ${BC_SECRET_N} references, not captured values." },
        secrets: { type: "string", description: "Optional reusable profile name for captured credential values." },
      }),
      readOnly: false,
      destructive: false,
      idempotent: false,
      handle: (input) => Effect.gen(function* () {
        const sessionId = resolveSessionId(input)
        const outputPath = optionalStringField(input, "outputPath")
        const secrets = optionalStringField(input, "secrets")
        if (!outputPath && !secrets) {
          return yield* Effect.fail(new Error("network_stop requires outputPath, secrets, or both"))
        }
        return yield* relay.networkStop({
          sessionId,
          ...(outputPath ? { outputPath: path.resolve(outputPath) } : {}),
          ...(secrets ? { secrets } : {}),
        })
      }),
    },
    {
      name: "network_cancel",
      description: "Cancel a session's network capture and discard its in-memory exchanges.",
      inputSchema: sessionOnlyInputSchema,
      readOnly: false,
      destructive: true,
      idempotent: true,
      handle: (input) => relay.networkCancel({ sessionId: resolveSessionId(input) }),
    },
    {
      name: "recording_start",
      description: "Start recording the current session tab. CDP mode records video to WebM or MP4; tab-capture mode supports WebM and optional audio.",
      inputSchema: objectSchema({
        session: sessionSchemaProperty,
        outputPath: { type: "string", description: "Recording artifact path, resolved against the MCP process working directory." },
        mode: { type: "string", enum: ["auto", "tab-capture", "cdp"], description: "Recording backend. Defaults to auto." },
        audio: { type: "boolean", description: "Capture tab audio in tab-capture mode." },
        frameRate: { type: "integer", minimum: 1, maximum: 60, description: "Requested frame rate." },
        maxDurationMs: { type: "integer", minimum: 1, description: "Maximum recording duration in milliseconds." },
      }, ["outputPath"]),
      readOnly: false,
      destructive: false,
      idempotent: false,
      handle: (input) => {
        const object = requireObject(input)
        const mode = optionalStringField(object, "mode")
        if (mode !== undefined && mode !== "auto" && mode !== "tab-capture" && mode !== "cdp") {
          return Effect.fail(new Error("mode must be auto, tab-capture, or cdp"))
        }
        const frameRate = optionalPositiveIntegerField(object, "frameRate")
        if (frameRate !== undefined && frameRate > 60) return Effect.fail(new Error("frameRate must be at most 60"))
        const maxDurationMs = optionalPositiveIntegerField(object, "maxDurationMs")
        const audio = optionalBooleanField(object, "audio")
        return relay.recordingStart({
          sessionId: resolveSessionId(object),
          outputPath: path.resolve(requiredStringField(object, "outputPath")),
          ...(mode ? { mode } : {}),
          ...(audio === undefined ? {} : { audio }),
          ...(frameRate === undefined ? {} : { frameRate }),
          ...(maxDurationMs === undefined ? {} : { maxDurationMs }),
        })
      },
    },
    {
      name: "recording_stop",
      description: "Stop the active recording for a session and finalize its artifact.",
      inputSchema: sessionOnlyInputSchema,
      readOnly: false,
      destructive: false,
      idempotent: false,
      handle: (input) => relay.recordingStop({ sessionId: resolveSessionId(input) }),
    },
    {
      name: "tabs_cleanup",
      description: "Close tabs agents opened that nobody has used for a while (no agent command and not visited by the user). Tabs the user shared or pinned, the active tab, tabs playing audio, recording, or waiting for a handoff stay open. Call it when you finish a task to leave the user's browser tidy; OpenCode Browser also does this automatically after 10 idle minutes.",
      inputSchema: objectSchema({
        idleMinutes: { type: "integer", minimum: 0, description: "Close tabs idle at least this long. 0 closes every eligible agent tab. Defaults to the user's setting (10)." },
      }),
      readOnly: false,
      destructive: true,
      idempotent: true,
      handle: (input) => {
        const value = typeof input === "object" && input !== null && "idleMinutes" in input ? input.idleMinutes : undefined
        return relay.tabsCleanup(typeof value === "number" && value >= 0 ? value : undefined)
      },
    },
    {
      name: "recording_status",
      description: "Return bounded status and quality counters for a session recording.",
      inputSchema: sessionOnlyInputSchema,
      readOnly: true,
      destructive: false,
      idempotent: true,
      handle: (input) => relay.recordingStatus({ sessionId: resolveSessionId(input) }),
    },
    {
      name: "recording_cancel",
      description: "Cancel a session recording and discard its unfinished artifact.",
      inputSchema: sessionOnlyInputSchema,
      readOnly: false,
      destructive: true,
      idempotent: true,
      handle: (input) => relay.recordingCancel({ sessionId: resolveSessionId(input) }),
    },
    {
      name: "flight_recorder_start",
      description: "Start a rolling in-memory video buffer for the current session tab. Saving a clip does not stop buffering.",
      inputSchema: objectSchema({
        session: sessionSchemaProperty,
        retentionMs: { type: "integer", minimum: 1000, maximum: 120000, description: "Rolling retention window. Defaults to 60000." },
        frameRate: { type: "integer", minimum: 1, maximum: 60, description: "Saved clip frame rate. Defaults to 60." },
      }),
      readOnly: false,
      destructive: false,
      idempotent: false,
      handle: (input) => {
        const object = requireObject(input)
        const retentionMs = optionalPositiveIntegerField(object, "retentionMs")
        const frameRate = optionalPositiveIntegerField(object, "frameRate")
        return relay.flightRecorderStart({
          sessionId: resolveSessionId(object),
          ...(retentionMs === undefined ? {} : { retentionMs }),
          ...(frameRate === undefined ? {} : { frameRate }),
        })
      },
    },
    {
      name: "flight_recorder_status",
      description: "Return bounded rolling-buffer duration, frame, byte, and drop counters.",
      inputSchema: sessionOnlyInputSchema,
      readOnly: true,
      destructive: false,
      idempotent: true,
      handle: (input) => relay.flightRecorderStatus({ sessionId: resolveSessionId(input) }),
    },
    {
      name: "flight_recorder_save_last",
      description: "Encode and save the most recent buffered browser video without stopping the flight recorder.",
      inputSchema: objectSchema({
        session: sessionSchemaProperty,
        outputPath: { type: "string", description: "Fresh .webm or .mp4 path, resolved against the MCP process working directory." },
        durationMs: { type: "integer", minimum: 1, description: "Recent duration to save. Defaults to 30000 and cannot exceed retention." },
      }, ["outputPath"]),
      readOnly: false,
      destructive: false,
      idempotent: false,
      handle: (input) => {
        const object = requireObject(input)
        const durationMs = optionalPositiveIntegerField(object, "durationMs")
        return relay.flightRecorderSaveLast({
          sessionId: resolveSessionId(object),
          outputPath: path.resolve(requiredStringField(object, "outputPath")),
          ...(durationMs === undefined ? {} : { durationMs }),
        })
      },
    },
    {
      name: "flight_recorder_cancel",
      description: "Stop and discard a session's rolling video buffer.",
      inputSchema: sessionOnlyInputSchema,
      readOnly: false,
      destructive: true,
      idempotent: true,
      handle: (input) => relay.flightRecorderCancel({ sessionId: resolveSessionId(input) }),
    },
    {
      name: "secrets_status",
      description: "Return secret profile references, sources, and expiration metadata without revealing credential values.",
      inputSchema: objectSchema({ name: { type: "string", description: "Secret profile name." } }, ["name"]),
      readOnly: true,
      destructive: false,
      idempotent: true,
      handle: (input) => relay.authStatus({ name: requiredStringField(input, "name") }),
    },
    {
      name: "secrets_refresh",
      description: "Reload a session page, observe fresh credentials, and update a secret profile while preserving stable BC_SECRET_N references.",
      inputSchema: objectSchema({
        name: { type: "string", description: "Existing secret profile name." },
        session: sessionSchemaProperty,
        urlFilter: { type: "string", description: "Observe credentials only on matching request URLs." },
        timeoutMs: { type: "integer", minimum: 1, description: "Reload timeout. Defaults to 30000." },
      }, ["name"]),
      readOnly: false,
      destructive: true,
      idempotent: false,
      handle: (input) => {
        const object = requireObject(input)
        const timeoutMs = optionalPositiveIntegerField(object, "timeoutMs")
        const urlFilter = optionalStringField(object, "urlFilter")
        return relay.authRefresh({
          sessionId: resolveSessionId(object),
          name: requiredStringField(object, "name"),
          ...(urlFilter ? { urlFilter } : {}),
          ...(timeoutMs === undefined ? {} : { timeoutMs }),
        })
      },
    },
    {
      name: "secrets_run",
      description: "Run a local command with a captured profile injected as BC_SECRET_N environment variables. Known values are replaced with their references in stdout and stderr.",
      inputSchema: objectSchema({
        name: { type: "string", description: "Secret profile name." },
        command: { type: "string", description: "Executable path or command name." },
        args: { type: "array", items: { type: "string" }, description: "Command arguments." },
        cwd: { type: "string", description: "Optional child working directory." },
        timeoutMs: { type: "integer", minimum: 1, description: "Child timeout. Defaults to 120000." },
      }, ["name", "command"]),
      readOnly: false,
      destructive: true,
      idempotent: false,
      handle: (input) => {
        const object = requireObject(input)
        const args = optionalStringArrayField(object, "args")
        const cwd = optionalStringField(object, "cwd")
        const timeoutMs = optionalPositiveIntegerField(object, "timeoutMs")
        return relay.authRun({
          name: requiredStringField(object, "name"),
          command: requiredStringField(object, "command"),
          ...(args ? { args } : {}),
          cwd: path.resolve(cwd ?? process.cwd()),
          ...(timeoutMs === undefined ? {} : { timeoutMs }),
        })
      },
    },
    {
      name: "skill",
      description: "Return the OpenCode Browser agent skill instructions.",
      inputSchema: emptyInputSchema,
      readOnly: true,
      destructive: false,
      idempotent: true,
      handle: () => Effect.tryPromise({
        try: () => fs.readFile(path.join(packageRoot, "skills", "browse", "SKILL.md"), "utf8"),
        catch: (cause) => new Error("read opencode-browser skill", { cause }),
      }),
    },
  ]
}

const registerTools = Effect.gen(function* () {
  const server = yield* McpServer.McpServer
  const relay = yield* RelayClient.Service
  const configuredSession = Option.getOrUndefined(yield* Config.option(Config.String("OPENCODE_BROWSER_SESSION")))
  const currentSession: CurrentSession = {
    id: configuredSession || `mcp-${crypto.randomUUID().slice(0, 8)}`,
    established: Boolean(configuredSession),
  }
  yield* Effect.forEach(makeToolSpecs(relay, currentSession), (spec) => {
    return server.addTool({
      tool: new McpSchema.Tool({
        name: spec.name,
        description: spec.description,
        inputSchema: spec.inputSchema,
        annotations: {
          readOnlyHint: spec.readOnly,
          destructiveHint: spec.destructive,
          idempotentHint: spec.idempotent,
          openWorldHint: true,
        },
      }),
      annotations: Context.empty(),
      handle: (payload: unknown) => {
        const operation = mcpToolRequiresRelayCompatibility(spec.name)
          ? RelayLifecycle.ensureRelay({ relay }).pipe(
            Effect.flatMap((readiness) => readiness.buildProblem
              ? Effect.fail(new Error(readiness.buildProblem))
              : spec.handle(payload)),
          )
          : spec.handle(payload)
        return operation.pipe(
          Effect.match({
            onFailure: (error) => toolResult({ text: mcpErrorMessage(spec.name, error.message), isError: true }),
            onSuccess: (value) => toolResultForValue(value),
          }),
        )
      },
    })
  }, { discard: true })
})

export function mcpToolRequiresRelayCompatibility(name: string): boolean {
  return !["status", "session_list", "session_current", "network_status", "recording_status", "flight_recorder_status", "secrets_status", "skill"].includes(name)
}

export const mcpServerLayer = McpServer.layerStdio({
  name: "browse",
  version: opencodeBrowserVersion,
  protocols: [McpProtocol.v2025_06_18, McpProtocol.v2025_11_25, McpProtocol.v2025_03_26, McpProtocol.v2024_11_05],
})

export const mcpToolsLayer = Layer.effectDiscard(registerTools)

export const runMcpServer: Effect.Effect<never, Error> = Layer.launch(
  mcpToolsLayer.pipe(
    Layer.provide(mcpServerLayer),
    Layer.provide(NodeStdio.layer),
    Layer.provide(RelayClient.layerFetch),
  ),
)

const ensureSessionExists = Effect.fnUntraced(function* (relay: RelayClient.Interface, id: string) {
  const sessions = yield* relay.sessions
  const exists = sessions.some((session) => {
    return session.id === id
  })
  if (!exists) {
    return yield* Effect.fail(new Error(`Session not found: ${id}`))
  }
})

function parseExecuteArguments(input: unknown): ExecuteArguments {
  const object = requireObject(input)
  const code = requiredStringField(object, "code")
  const session = optionalStringField(object, "session")
  const targetSelection = parseMcpTargetSelection(object)
  return {
    code,
    ...(session ? { session } : {}),
    ...(targetSelection ? { targetSelection } : {}),
  }
}

function parseAdoptArguments(input: unknown): AdoptArguments {
  const object = requireObject(input)
  const session = optionalStringField(object, "session")
  const targetSelection = parseMcpTargetSelection(object)
  const tabId = typeof object.tabId === "number" && Number.isInteger(object.tabId) ? object.tabId : undefined
  if (tabId !== undefined && targetSelection) throw new Error("Use only one of tabId, targetUrl, or targetIndex")
  return {
    ...(session ? { session } : {}),
    ...(targetSelection ? { targetSelection } : {}),
    ...(tabId === undefined ? {} : { tabId }),
  }
}

function parseMcpTargetSelection(input: JsonObject): TargetSelection | undefined {
  const urlIncludes = optionalStringField(input, "targetUrl")
  const selection = parseTargetSelection({
    ...(urlIncludes ? { urlIncludes } : {}),
    ...(input.targetIndex === undefined ? {} : { index: input.targetIndex }),
  })
  return selection?.urlIncludes || selection?.index !== undefined ? selection : undefined
}

function requiredStringField(input: unknown, field: string): string {
  const value = optionalStringField(input, field)
  if (!value) {
    throw new Error(`${field} is required`)
  }
  return value
}

function optionalStringField(input: unknown, field: string): string | undefined {
  const value = getString(requireObject(input), field)
  return value ? value : undefined
}

function optionalBooleanField(input: unknown, field: string): boolean | undefined {
  const value = requireObject(input)[field]
  return Predicate.isBoolean(value) ? value : undefined
}

function optionalPositiveIntegerField(input: unknown, field: string): number | undefined {
  const value = requireObject(input)[field]
  if (value === undefined) return undefined
  if (!Predicate.isNumber(value) || !Number.isInteger(value) || value <= 0) {
    throw new Error(`${field} must be a positive integer`)
  }
  return value
}

function optionalStringArrayField(input: unknown, field: string): readonly string[] | undefined {
  const value = requireObject(input)[field]
  if (value === undefined) return undefined
  if (!Array.isArray(value) || !value.every((item): item is string => Predicate.isString(item) && item.length > 0)) {
    throw new Error(`${field} must be an array of non-empty strings`)
  }
  return value
}

function requireObject(input: unknown): JsonObject {
  const object = getObject(input)
  if (!object) {
    throw new Error("Expected arguments object")
  }
  return object
}

function stringifyResult(value: unknown): string {
  if (Predicate.isString(value)) {
    return value
  }
  return JSON.stringify(value, null, 2)
}

export function toolResultForValue(value: unknown): McpSchema.CallToolResult {
  const object = getObject(value)
  const isError = object?.isError === true
  const media = Array.isArray(object?.media)
    ? object.media.flatMap((item) => {
      const image = getObject(item)
      const mimeType = getString(image, "mimeType")
      const data = getString(image, "data")
      return image?.type === "image" && mimeType !== undefined && data !== undefined
        ? [{ data, mimeType }]
        : []
    })
    : []
  const errorText = isError ? getString(object, "text") : undefined
  if (media.length > 0) {
    const { media: _media, ...structuredContent } = object ?? {}
    const text = errorText ?? stringifyResult(structuredContent)
    return new McpSchema.CallToolResult({
      content: [
        McpSchema.TextContent.make({ text }),
        ...media.map((image) => McpSchema.ImageContent.make({
          data: new Uint8Array(Buffer.from(image.data, "base64")),
          mimeType: image.mimeType,
        })),
      ],
      structuredContent,
      isError,
    })
  }
  const text = errorText ?? stringifyResult(value)
  return toolResult({ text, ...(object ? { structuredContent: object } : {}), isError })
}

export function mcpErrorMessage(tool: string, message: string): string {
  if (!message.startsWith("Session not found:")) {
    return message
  }
  return tool === "execute" || tool === "session_adopt"
    ? `${message} Create it with session_new first, or omit the explicit session id to use the MCP current session.`
    : `${message} Create it with session_new first.`
}

function toolResult(options: { readonly text: string; readonly structuredContent?: unknown; readonly isError: boolean }): McpSchema.CallToolResult {
  return new McpSchema.CallToolResult({
    content: [McpSchema.TextContent.make({ text: options.text })],
    structuredContent: options.structuredContent,
    isError: options.isError,
  })
}

function objectSchema(properties: JsonObject, required: readonly string[] = []): JsonObject {
  return {
    type: "object",
    properties,
    required: [...required],
    additionalProperties: false,
  }
}
