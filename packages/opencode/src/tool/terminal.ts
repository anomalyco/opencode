import z from "zod"
import stripAnsi from "strip-ansi"
import * as Tool from "./tool"
import DESCRIPTION from "./terminal.txt"
import { Instance } from "@/project/instance"
import { Log } from "@/util"
import { Shell } from "@/shell/shell"
import { Pty } from "@/pty"
import { PtyID } from "@/pty/schema"
import * as Truncate from "./truncate"
import { Plugin } from "@/plugin"
import { Effect, Deferred, Stream } from "effect"
import { Bus } from "@/bus"
import { InstanceState } from "@/effect"

export const log = Log.create({ service: "terminal-tool" })

// ---------------------------------------------------------------------------
// Sentinel for exit code detection
// ---------------------------------------------------------------------------

const SENTINEL_PREFIX = "__OPENCODE_EXIT_"
const MAX_SESSIONS = 20

// ---------------------------------------------------------------------------
// Session state for persistent PTY sessions
// ---------------------------------------------------------------------------

type SessionState = {
  ptyId: PtyID
  lastCursor: number
  description: string
  shell: string
  createdAt: number
  exitCode: number | null
  buffer: string
}

// ---------------------------------------------------------------------------
// Sentinel command helper (shell-aware)
// ---------------------------------------------------------------------------

/**
 * Returns the shell-appropriate sentinel command for exit code detection.
 * PowerShell uses $LASTEXITCODE (numeric), POSIX shells use $? (0/1).
 */
export function sentinelCommand(shellName: string): string {
  const isPowerShell = shellName.includes("powershell") || shellName.includes("pwsh")
  const exitVar = isPowerShell ? "$LASTEXITCODE" : "$?"
  return `echo "${SENTINEL_PREFIX}${exitVar}"`
}

// ---------------------------------------------------------------------------
// Parameters — discriminated union on "action"
// ---------------------------------------------------------------------------

const RunAction = z.object({
  action: z.literal("run"),
  command: z.string().describe("The command to execute in a TTY-aware terminal session"),
  timeout: z.number().describe("Optional timeout in milliseconds").optional(),
  workdir: z
    .string()
    .describe(
      `The working directory to run the command in. Defaults to the current directory. Use this instead of 'cd' commands.`,
    )
    .optional(),
  description: z.string().describe("Clear, concise description of what this command does in 5-10 words"),
})

const CreateAction = z.object({
  action: z.literal("create"),
  workdir: z.string().describe("Working directory for the session").optional(),
  description: z.string().describe("Description for the terminal session").optional(),
})

const SendAction = z.object({
  action: z.literal("send"),
  sessionId: PtyID.zod.describe("ID of the terminal session to send input to"),
  input: z
    .string()
    .describe("Text to send to the terminal. Use \\x03 for Ctrl+C, \\x04 for Ctrl+D. Commands are appended with \\n"),
  description: z.string().describe("Clear, concise description of what this input does in 5-10 words"),
})

const ReadAction = z.object({
  action: z.literal("read"),
  sessionId: PtyID.zod.describe("ID of the terminal session to read output from"),
  description: z.string().describe("Clear, concise description of what you are reading"),
})

const CloseAction = z.object({
  action: z.literal("close"),
  sessionId: PtyID.zod.describe("ID of the terminal session to close"),
})

export const Parameters = z.preprocess(
  (data: unknown) => {
    if (typeof data === "object" && data !== null && "command" in data && !("action" in data)) {
      return { ...data, action: "run" }
    }
    return data
  },
  z.discriminatedUnion("action", [RunAction, CreateAction, SendAction, ReadAction, CloseAction]),
)

// ---------------------------------------------------------------------------
// Pure helpers (unit-testable)
// ---------------------------------------------------------------------------

/**
 * Strips the echoed command from the beginning of PTY output.
 * PTYs always echo the typed command. After stripping ANSI, if the first line
 * matches the command (trimmed), we remove it.
 */
export function filterEcho(text: string, command: string): string {
  const lines = text.split("\n")
  if (lines.length === 0) return text
  const firstLine = lines[0].replace(/\r$/, "").trim()
  if (firstLine === command.trim()) {
    return lines.slice(1).join("\n")
  }
  return text
}

/**
 * Extracts the exit code from the sentinel line and removes that line.
 * The sentinel is: __OPENCODE_EXIT_<code>
 */
export function extractExit(text: string): { exit: number | null; cleaned: string } {
  const regex = new RegExp(`^${SENTINEL_PREFIX}(\\d+)$`, "m")
  const match = regex.exec(text)
  if (!match) return { exit: null, cleaned: text }
  const exitCode = parseInt(match[1], 10)
  const cleaned = text
    .replace(match[0], "")
    .replace(/\n{2,}/, "\n")
    .replace(/^\n/, "")
    .replace(/\n$/, "")
  return { exit: exitCode, cleaned }
}

/**
 * Chains stripAnsi → filterEcho → extractExit → trim
 */
export function cleanOutput(raw: string, command: string): { output: string; exit: number | null } {
  const stripped = stripAnsi(raw)
  const filtered = filterEcho(stripped, command)
  const { exit, cleaned } = extractExit(filtered)
  return { output: cleaned.trim(), exit }
}

// ---------------------------------------------------------------------------
// Mock WebSocket for capturing PTY output via Pty.connect()
// ---------------------------------------------------------------------------

type MockSocket = {
  readyState: number
  data: unknown
  send: (data: string | Uint8Array | ArrayBuffer) => void
  close: (code?: number, reason?: string) => void
}

function createMockSocket(
  onData: (chunk: string) => void,
  onMeta?: (cursor: number) => void,
): MockSocket {
  return {
    readyState: 1, // OPEN
    data: {},
    send(data: string | Uint8Array | ArrayBuffer) {
      if (typeof data === "string") {
        onData(data)
      } else {
        const buf = data instanceof Uint8Array ? data : new Uint8Array(data)
        if (buf.length > 0 && buf[0] === 0x00) {
          // Meta frame: 0x00 + JSON
          const json = new TextDecoder().decode(buf.slice(1))
          try {
            const meta = JSON.parse(json)
            onMeta?.(meta.cursor)
          } catch (e) {
            // Invalid meta - ignore
          }
        } else {
          onData(new TextDecoder().decode(buf))
        }
      }
    },
    close() {
      this.readyState = 3 // CLOSED
    },
  }
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_TIMEOUT = 2 * 60 * 1000
const MAX_METADATA_LENGTH = 30_000

function preview(text: string): string {
  if (text.length <= MAX_METADATA_LENGTH) return text
  return "...\n\n" + text.slice(-MAX_METADATA_LENGTH)
}

// ---------------------------------------------------------------------------
// Tool definition
// ---------------------------------------------------------------------------

export const TerminalTool = Tool.define(
  "terminal",
  Effect.gen(function* () {
    const pty = yield* Pty.Service
    const trunc = yield* Truncate.Service
    const plugin = yield* Plugin.Service
    const bus = yield* Bus.Service

    const shell = Shell.name(Shell.acceptable())
    log.info("terminal tool using shell", { shell })

    // --- InstanceState for persistent sessions ---
    const sessionState = yield* InstanceState.make<Map<string, SessionState>>(
      (_ctx) =>
        Effect.gen(function* () {
          const sessions = new Map<string, SessionState>()
          yield* Effect.addFinalizer(() =>
            Effect.gen(function* () {
              for (const [id] of sessions) {
                yield* pty.remove(id as PtyID).pipe(Effect.orDie)
              }
              sessions.clear()
            }),
          )
          return sessions
        }),
    )

    const description = DESCRIPTION.replaceAll("${directory}", Instance.directory)
      .replaceAll("${shell}", shell)
      .replaceAll("${os}", process.platform)
      .replaceAll("${maxLines}", String(Truncate.MAX_LINES))
      .replaceAll("${maxBytes}", String(Truncate.MAX_BYTES))

    return {
      description,
      parameters: Parameters,
      execute: (params: z.infer<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          // --- action: "run" (default, backward-compatible) ---
          if (params.action === "run" || params.action === undefined) {
            return yield* Effect.scoped(Effect.gen(function* () {
              const cwd = params.workdir ?? Instance.directory
              if (params.timeout !== undefined && params.timeout < 0) {
                throw new Error(`Invalid timeout value: ${params.timeout}. Timeout must be a positive number.`)
              }
              const timeout = params.timeout ?? DEFAULT_TIMEOUT

              yield* ctx.ask({
                permission: "terminal",
                patterns: [params.command],
                always: [],
                metadata: {},
              })

              const extra = yield* plugin.trigger(
                "shell.env",
                { cwd, sessionID: ctx.sessionID, callID: ctx.callID },
                { env: {} },
              )
              const env = {
                ...process.env,
                ...extra.env,
                TERM: "xterm-256color",
                OPENCODE_TERMINAL: "1",
              } as Record<string, string>

              if (process.platform === "win32") {
                env.LC_ALL = "C.UTF-8"
                env.LC_CTYPE = "C.UTF-8"
                env.LANG = "C.UTF-8"
              }

              const info = yield* pty.create({
                command: Shell.preferred(),
                cwd,
                title: `Agent: ${params.description.slice(0, 30)}`,
                env,
                source: "agent",
              })

              yield* Effect.addFinalizer(() => pty.remove(info.id).pipe(Effect.orDie))

              yield* ctx.metadata({
                metadata: {
                  output: "",
                  description: params.description,
                },
              })

              let buffer = ""

              const mockWs = createMockSocket((chunk) => {
                buffer += chunk
                Effect.runFork(
                  ctx.metadata({
                    metadata: {
                      output: preview(buffer),
                      description: params.description,
                    },
                  }),
                )
              })

              const conn = yield* pty.connect(info.id, mockWs)
              if (!conn) {
                return {
                  title: params.description,
                  metadata: {
                    output: "(failed to connect to PTY session)",
                    exit: null,
                    pty: true as const,
                    description: params.description,
                    truncated: false,
                  },
                  output: "(failed to connect to PTY session)",
                }
              }

              const sentinel = sentinelCommand(shell)
              conn.onMessage(params.command + "\n")
              conn.onMessage(sentinel + "\n")

              const exitDeferred = yield* Deferred.make<
                { kind: "exit"; code: number } | { kind: "timeout" } | { kind: "abort" }
              >()

              yield* Effect.forkScoped(
                bus.subscribe(Pty.Event.Exited).pipe(
                  Stream.filter((evt) => evt.properties.id === info.id),
                  Stream.runForEach((evt) =>
                    Effect.sync(() =>
                      Deferred.succeed(exitDeferred, { kind: "exit" as const, code: evt.properties.exitCode }),
                    ),
                  ),
                ),
              )

              yield* Effect.forkScoped(
                Effect.callback<void>((resume) => {
                  if (ctx.abort.aborted) {
                    resume(Effect.void)
                    return Effect.sync(() => {})
                  }
                  const handler = () => resume(Effect.void)
                  ctx.abort.addEventListener("abort", handler, { once: true })
                  return Effect.sync(() => ctx.abort.removeEventListener("abort", handler))
                }).pipe(
                  Effect.andThen(() => Deferred.succeed(exitDeferred, { kind: "abort" as const })),
                ),
              )

              yield* Effect.forkScoped(
                Effect.sleep(`${timeout + 100} millis`).pipe(
                  Effect.andThen(() => Deferred.succeed(exitDeferred, { kind: "timeout" as const })),
                ),
              )

              const result = yield* Deferred.await(exitDeferred)

              conn.onClose()

              const { output, exit } = cleanOutput(buffer, params.command)
              const exitCode = result.kind === "exit" ? result.code : null

              const meta: string[] = []
              if (result.kind === "timeout") {
                meta.push(
                  `terminal tool terminated command after exceeding timeout ${timeout} ms. If this command is expected to take longer and is not waiting for interactive input, retry with a larger timeout value in milliseconds.`,
                )
              }
              if (result.kind === "abort") {
                meta.push("User aborted the command")
              }

              const truncated = yield* trunc.output(output)

              let finalOutput = truncated.content
              if (!finalOutput) finalOutput = "(no output)"
              if (truncated.truncated && truncated.outputPath) {
                finalOutput = `...output truncated...\n\nFull output saved to: ${truncated.outputPath}\n\n` + finalOutput
              }
              if (meta.length > 0) {
                finalOutput += "\n\n<terminal_metadata>\n" + meta.join("\n") + "\n</terminal_metadata>"
              }

              return {
                title: params.description,
                metadata: {
                  output: preview(finalOutput),
                  exit: exitCode,
                  pty: true as const,
                  description: params.description,
                  truncated: truncated.truncated,
                  ...(truncated.truncated && truncated.outputPath ? { outputPath: truncated.outputPath } : {}),
                },
                output: finalOutput,
              }
            }))
          }

          // --- action: "create" (persistent PTY session) ---
          if (params.action === "create") {
            const cwd = params.workdir ?? Instance.directory
            const desc = params.description ?? "Terminal session"

            yield* ctx.ask({
              permission: "terminal",
              patterns: [desc],
              always: [],
              metadata: {},
            })

            const extra = yield* plugin.trigger(
              "shell.env",
              { cwd, sessionID: ctx.sessionID, callID: ctx.callID },
              { env: {} },
            )
            const env = {
              ...process.env,
              ...extra.env,
              TERM: "xterm-256color",
              OPENCODE_TERMINAL: "1",
            } as Record<string, string>

            if (process.platform === "win32") {
              env.LC_ALL = "C.UTF-8"
              env.LC_CTYPE = "C.UTF-8"
              env.LANG = "C.UTF-8"
            }

            const sessions = yield* InstanceState.get(sessionState)

            // FIFO eviction: if at max, remove oldest
            if (sessions.size >= MAX_SESSIONS) {
              const oldest = sessions.keys().next().value
              if (oldest) {
                const oldSession = sessions.get(oldest)!
                sessions.delete(oldest)
                yield* pty.remove(oldSession.ptyId).pipe(Effect.orDie)
              }
            }

            const info = yield* pty.create({
              command: Shell.preferred(),
              cwd,
              title: desc.slice(0, 30),
              env,
              source: "agent",
            })

            sessions.set(info.id, {
              ptyId: info.id,
              lastCursor: 0,
              description: desc,
              shell,
              createdAt: Date.now(),
              exitCode: null,
              buffer: "",
            })

            // Subscribe to PTY exit event to capture the exit code
            Effect.runFork(
              bus.subscribe(Pty.Event.Exited).pipe(
                Stream.filter((evt) => evt.properties.id === info.id),
                Stream.take(1),
                Stream.runForEach((evt) =>
                  Effect.sync(() => {
                    const s = sessions.get(info.id)
                    if (s) s.exitCode = evt.properties.exitCode
                  }),
                ),
              ),
            )

            // Subscribe to output for streaming metadata
            let buffer = ""
            const mockWs = createMockSocket((chunk) => {
              buffer += chunk
              Effect.runFork(
                ctx.metadata({
                  metadata: {
                    output: preview(buffer),
                    description: desc,
                    pty: true as const,
                  },
                }),
              )
            })

            // Connect the mock websocket to stream output metadata to the agent
            // Connection stays alive for the session's lifetime; cleaned up on PTY exit or close
            yield* pty.connect(info.id, mockWs, 0)

            return {
              title: desc,
              metadata: {
                output: "(session created)",
                exit: null,
                pty: true as const,
                description: desc,
                truncated: false,
                sessionId: info.id,
              },
              output: `Session created: ${info.id}\nShell: ${shell}\nWorkdir: ${cwd}`,
            }
          }

          // --- action: "send" (write to PTY stdin) ---
          if (params.action === "send") {
            const sessions = yield* InstanceState.get(sessionState)
            const session = sessions.get(params.sessionId)
            if (!session) {
              return {
                title: params.description ?? "Send input",
                metadata: {
                  output: `(session ${params.sessionId} not found)`,
                  exit: null,
                  pty: true as const,
                  description: params.description ?? "Send input",
                  truncated: false,
                },
                output: `Error: Session ${params.sessionId} not found. Use action="create" to start a new session.`,
              }
            }

            yield* ctx.ask({
              permission: "terminal",
              patterns: [params.input],
              always: [],
              metadata: {},
            })

            // Send input to PTY — append \n for commands (unless it's a control sequence)
            const data = /^\x03|\x04|\x1a|\x1c$/.test(params.input) ? params.input : params.input + "\n"
            yield* pty.write(session.ptyId, data)

            return {
              title: params.description ?? "Send input",
              metadata: {
                output: "(input sent)",
                exit: null,
                pty: true as const,
                description: params.description ?? "Send input",
                truncated: false,
              },
              output: `(input sent to session ${params.sessionId})`,
            }
          }

          // --- action: "read" (cursor-based incremental output) ---
          if (params.action === "read") {
            const sessions = yield* InstanceState.get(sessionState)
            const session = sessions.get(params.sessionId)
            if (!session) {
              return {
                title: params.description ?? "Read output",
                metadata: {
                  output: `(session ${params.sessionId} not found)`,
                  exit: null,
                  pty: true as const,
                  description: params.description ?? "Read output",
                  truncated: false,
                  sessionId: params.sessionId,
                },
                output: `Error: Session ${params.sessionId} not found. Use action="create" to start a new session.`,
              }
            }

            // Use a temporary mock socket to capture output from lastCursor
            let newOutput = ""
            let currentCursor = session.lastCursor

            const readWs = createMockSocket(
              (chunk) => {
                newOutput += chunk
              },
              (cursor) => {
                currentCursor = cursor
              },
            )

            const conn = yield* pty.connect(session.ptyId, readWs, session.lastCursor)

            if (conn) {
              conn.onClose()
            }

            const stripped = stripAnsi(newOutput)
            const cleaned = stripped.trim()

            session.lastCursor = currentCursor
            session.buffer += newOutput

            const exitCode = session.exitCode !== null ? session.exitCode : null

            let finalOutput = cleaned
            if (!finalOutput) finalOutput = "(no new output)"

            const truncated = yield* trunc.output(finalOutput)

            return {
              title: params.description ?? "Read output",
              metadata: {
                output: preview(truncated.content),
                exit: exitCode,
                pty: true as const,
                description: params.description ?? "Read output",
                truncated: truncated.truncated,
                ...(truncated.truncated && truncated.outputPath ? { outputPath: truncated.outputPath } : {}),
                sessionId: params.sessionId,
              },
              output: truncated.content || "(no new output)",
            }
          }

          // --- action: "close" (terminate session + cleanup) ---
          if (params.action === "close") {
            const sessions = yield* InstanceState.get(sessionState)
            const session = sessions.get(params.sessionId)
            if (!session) {
              return {
                title: "Close session",
                metadata: {
                  output: `(session ${params.sessionId} not found)`,
                  exit: null,
                  pty: true as const,
                  description: "Close session",
                  truncated: false,
                },
                output: `Error: Session ${params.sessionId} not found.`,
              }
            }

            yield* pty.remove(session.ptyId).pipe(Effect.orDie)
            sessions.delete(params.sessionId)

            return {
              title: "Close session",
              metadata: {
                output: "(session closed)",
                exit: null,
                pty: true as const,
                description: `Closed session ${params.sessionId}`,
                truncated: false,
              },
              output: `(session ${params.sessionId} closed)`,
            }
          }

          // Should never reach here — Zod validates action
          throw new Error(`Unknown action: ${(params as any).action}`)
          }),
    } satisfies Tool.DefWithoutID<typeof Parameters>
  }),
)