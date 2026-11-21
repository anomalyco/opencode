export * as AntigravityACP from "./acp.js"

import { ClientSideConnection, ndJsonStream } from "@agentclientprotocol/sdk"
import type {
  ContentBlock,
  InitializeResponse,
  ReadTextFileRequest,
  ReadTextFileResponse,
  RequestPermissionRequest,
  RequestPermissionResponse,
  SessionUpdate,
  WriteTextFileRequest,
  WriteTextFileResponse,
} from "@agentclientprotocol/sdk"
import { spawn } from "node:child_process"
import type { ChildProcess } from "node:child_process"
import { Readable, Writable } from "node:stream"
import { Schema } from "effect"

/** The CLI lists one entry per effort level, so the same model appears several times. */
export const Model = Schema.Struct({
  slug: Schema.String,
  name: Schema.String,
})
export type Model = typeof Model.Type

/** Updates carry only the fields that changed, so every field but the id may be missing. */
export interface ToolCall {
  readonly toolCallId: string
  readonly toolName?: string
  readonly args?: unknown
  /** Where the call stands: "pending", "in_progress", "completed" or "failed". */
  readonly status?: string
  readonly title?: string
}

export type Update =
  | { readonly kind: "message"; readonly text: string }
  | { readonly kind: "thought"; readonly text: string }
  | { readonly kind: "tool-call"; readonly call: ToolCall }
  | { readonly kind: "tool-call-update"; readonly call: ToolCall }

export interface Usage {
  readonly input: number
  readonly output: number
  readonly thought: number | undefined
  readonly cacheRead: number | undefined
  readonly cacheWrite: number | undefined
  readonly total: number
}

export interface Turn {
  /** Why the agent stopped: "end_turn", "max_tokens", "max_turn_requests", "refusal" or "cancelled". */
  readonly stopReason: string
  readonly usage: Usage | undefined
}

export interface AgentInfo {
  readonly name: string
  readonly version: string
}

export interface Session {
  readonly sessionId: string
  readonly models: readonly Model[]
  readonly currentModel: string | undefined
}

export interface Options {
  /** The Antigravity CLI to run. Defaults to "agy" on PATH. */
  readonly command?: string
  /** The arguments for the CLI. Defaults to ["acp"], the CLI's ACP server. */
  readonly args?: readonly string[]
  readonly cwd?: string
  readonly clientInfo?: { readonly name: string; readonly version: string }
  /**
   * Answers the agent's permission requests.
   *
   * Without one, every request is refused, so the agent never acts on the machine on its own.
   */
  readonly permission?: (
    request: RequestPermissionRequest,
  ) => RequestPermissionResponse | Promise<RequestPermissionResponse>
  /** Reads a file for the agent. The agent may only ask when this is set. */
  readonly readTextFile?: (request: ReadTextFileRequest) => ReadTextFileResponse | Promise<ReadTextFileResponse>
  /** Writes a file for the agent. The agent may only ask when this is set. */
  readonly writeTextFile?: (request: WriteTextFileRequest) => WriteTextFileResponse | Promise<WriteTextFileResponse>
}

export class Failed extends Schema.TaggedError<Failed>()("AntigravityACP.Failed", {
  message: Schema.String,
  cause: Schema.Defect(),
}) {}

// The CLI answers `session/new` and `session/resume` with the session and the models it may use.
const SessionPayload = Schema.Struct({
  sessionId: Schema.String,
  models: Schema.optional(
    Schema.Struct({
      availableModels: Schema.Array(Schema.Struct({ modelId: Schema.String, name: Schema.String })),
      currentModelId: Schema.optional(Schema.String),
    }),
  ),
})

/** Owns the `agy acp` child process, which speaks JSON-RPC over stdio, until it is closed. */
export class Client {
  private constructor(
    private readonly connection: ClientSideConnection,
    private readonly child: ChildProcess,
    private readonly listeners: Map<string, (update: Update) => void>,
    private readonly info: AgentInfo,
    readonly closed: Promise<void>,
  ) {}

  static async start(options: Options = {}): Promise<Client> {
    const child = await spawnCLI(options)
    const closed = new Promise<void>((resolve) => {
      if (child.exitCode !== null || child.signalCode !== null) return resolve()
      child.once("exit", () => resolve())
      child.once("error", () => resolve())
    })
    const listeners = new Map<string, (update: Update) => void>()
    const connection = new ClientSideConnection(
      () => ({
        sessionUpdate: (params) => {
          const listener = listeners.get(params.sessionId)
          const update = toUpdate(params.update)
          if (listener && update) listener(update)
        },
        requestPermission: (params) => answer(options, params),
        readTextFile: options.readTextFile ? (params) => options.readTextFile!(params) : undefined,
        writeTextFile: options.writeTextFile ? (params) => options.writeTextFile!(params) : undefined,
      }),
      ndJsonStream(
        Writable.toWeb(child.stdin!) as WritableStream<Uint8Array>,
        Readable.toWeb(child.stdout!) as ReadableStream<Uint8Array>,
      ),
    )
    let initialize: InitializeResponse
    try {
      initialize = await connection.initialize({
        protocolVersion: 1,
        clientCapabilities: {
          fs: {
            readTextFile: options.readTextFile !== undefined,
            writeTextFile: options.writeTextFile !== undefined,
          },
        },
        clientInfo: options.clientInfo ?? { name: "opencode", version: "0.0.0" },
      })
    } catch (cause) {
      child.kill("SIGTERM")
      throw new Failed({ message: message(cause), cause })
    }
    return new Client(
      connection,
      child,
      listeners,
      {
        name: initialize.agentInfo?.name ?? "Antigravity",
        version: initialize.agentInfo?.version ?? "unknown",
      },
      closed,
    )
  }

  get agent(): AgentInfo {
    return this.info
  }

  async newSession(cwd: string): Promise<Session> {
    const response = await this.connection.newSession({ cwd, mcpServers: [] })
    return toSession(response)
  }

  async resume(sessionId: string, cwd: string): Promise<Session> {
    const response = await this.connection.resumeSession({ sessionId, cwd })
    return toSession(response)
  }

  /** Takes the CLI's own model id, which includes the effort level, such as "gemini-3.8-flash-low". */
  async setModel(sessionId: string, modelId: string): Promise<void> {
    await this.connection.extMethod("session/set_model", { sessionId, modelId })
  }

  async closeSession(sessionId: string): Promise<void> {
    await this.connection.closeSession({ sessionId })
  }

  async prompt(
    sessionId: string,
    prompt: string,
    onUpdate: (update: Update) => void,
    signal?: AbortSignal,
  ): Promise<Turn> {
    this.listeners.set(sessionId, onUpdate)
    try {
      // The SDK's prompt takes no options, so a cancelled turn is cancelled the
      // way the protocol says: the client sends the cancel notification.
      const cancelled = signal
        ? new Promise<never>((_resolve, reject) => {
            const onAbort = () => {
              void this.connection.cancel({ sessionId }).catch(() => {})
              reject(new Failed({ message: "Antigravity: the turn was cancelled", cause: "aborted" }))
            }
            if (signal.aborted) onAbort()
            else signal.addEventListener("abort", onAbort, { once: true })
          })
        : undefined
      // A turn in flight when the CLI dies would otherwise never be answered.
      const died = this.closed.then((): never => {
        throw new Failed({ message: "Antigravity: the CLI exited during the turn", cause: "exited" })
      })
      const response = await Promise.race([
        this.connection.prompt({ sessionId, prompt: [{ type: "text", text: prompt }] }),
        died,
        ...(cancelled ? [cancelled] : []),
      ])
      return {
        stopReason: response.stopReason,
        usage: response.usage
          ? {
              input: response.usage.inputTokens,
              output: response.usage.outputTokens,
              thought: response.usage.thoughtTokens ?? undefined,
              cacheRead: response.usage.cachedReadTokens ?? undefined,
              cacheWrite: response.usage.cachedWriteTokens ?? undefined,
              total: response.usage.totalTokens,
            }
          : undefined,
      }
    } finally {
      this.listeners.delete(sessionId)
    }
  }

  async close(): Promise<void> {
    this.child.stdin?.end()
    this.child.kill("SIGTERM")
  }
}

function spawnCLI(options: Options): Promise<ChildProcess> {
  return new Promise<ChildProcess>((resolve, reject) => {
    const proc = spawn(options.command ?? "agy", options.args ?? ["acp"], {
      stdio: ["pipe", "pipe", "pipe"],
      ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    })
    let started = false
    proc.once("error", (cause) => {
      // The error also fires long after the CLI started, when it dies.
      if (started) return
      started = true
      reject(
        new Failed({
          message: `Could not start the Antigravity CLI: ${cause instanceof Error ? cause.message : String(cause)}`,
          cause,
        }),
      )
    })
    proc.once("spawn", () => {
      started = true
      resolve(proc)
    })
    // The CLI writes to its error stream, and a full pipe would stop it.
    proc.stderr?.resume()
  })
}

function answer(
  options: Options,
  params: RequestPermissionRequest,
): RequestPermissionResponse | Promise<RequestPermissionResponse> {
  if (options.permission) return options.permission(params)
  // Without a handler the agent may not act, so the request is refused rather than granted.
  const reject = params.options.find((option) => option.kind === "reject_once")
  return reject
    ? { outcome: { outcome: "selected", optionId: reject.optionId } }
    : { outcome: { outcome: "cancelled" } }
}

function toSession(payload: unknown): Session {
  const session = Schema.decodeUnknownSync(SessionPayload)(payload)
  return {
    sessionId: session.sessionId,
    models: (session.models?.availableModels ?? []).map((model) => ({ slug: model.modelId, name: model.name })),
    currentModel: session.models?.currentModelId,
  }
}

function toUpdate(update: SessionUpdate): Update | undefined {
  if (update.sessionUpdate === "agent_message_chunk") {
    const text = textOf(update.content)
    return text === undefined ? undefined : { kind: "message", text }
  }
  if (update.sessionUpdate === "agent_thought_chunk") {
    const text = textOf(update.content)
    return text === undefined ? undefined : { kind: "thought", text }
  }
  if (update.sessionUpdate === "tool_call") {
    return {
      kind: "tool-call",
      call: {
        toolCallId: update.toolCallId,
        toolName: update.name ?? update.title ?? "unknown",
        args: update.rawInput,
        status: update.status ?? "pending",
        title: update.title ?? undefined,
      },
    }
  }
  if (update.sessionUpdate === "tool_call_update") {
    // An update carries only what changed, so a missing field keeps the value the call already has.
    return {
      kind: "tool-call-update",
      call: {
        toolCallId: update.toolCallId,
        toolName: update.name ?? update.title ?? undefined,
        args: update.rawInput ?? undefined,
        status: update.status ?? undefined,
        title: update.title ?? undefined,
      },
    }
  }
  return undefined
}

function textOf(content: ContentBlock) {
  return content.type === "text" ? content.text : undefined
}

function message(cause: unknown) {
  return cause instanceof Error ? cause.message : String(cause)
}
