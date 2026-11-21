export * as AntigravityACPClient from "./acp-client.js"

import { ClientSideConnection, ndJsonStream } from "@agentclientprotocol/sdk"
import type {
  ContentBlock,
  InitializeResponse,
  RequestPermissionRequest,
  RequestPermissionResponse,
  SessionUpdate,
} from "@agentclientprotocol/sdk"
import { spawn } from "node:child_process"
import type { ChildProcess } from "node:child_process"
import { Readable, Writable } from "node:stream"
import { Schema } from "effect"
import { Failed, type AgentInfo, type Options, type Session, type Turn, type Update } from "./acp.js"

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
