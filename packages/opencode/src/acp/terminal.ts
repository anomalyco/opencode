import type { AgentSideConnection, TerminalOutputResponse } from "@agentclientprotocol/sdk"

type TerminalConnection = Pick<AgentSideConnection, "createTerminal">
type TerminalHandle = Awaited<ReturnType<TerminalConnection["createTerminal"]>>

const startedError = "ACPTerminalStartedError"

class TerminalStartedError extends Error {
  readonly started = true
  readonly terminalId: string
  readonly original: unknown

  constructor(terminalId: string, original: unknown) {
    super(original instanceof Error ? original.message : String(original))
    this.name = startedError
    this.terminalId = terminalId
    this.original = original
  }
}

const sessionsBySessionID = new Map<string, Interface>()

export function commandStarted(error: unknown) {
  if (error instanceof TerminalStartedError) return true
  if (!error || typeof error !== "object") return false
  const info = error as Record<string, unknown>
  if (info.name === startedError || info.started === true) return true
  return commandStarted(info.cause)
}

export type RunInput = {
  sessionId: string
  command: string
  args?: string[]
  cwd: string
  env: NodeJS.ProcessEnv
  timeout: number
  outputByteLimit: number
  signal: AbortSignal
  onStart: (terminalId: string) => Promise<void>
}

export type RunOutput = {
  terminalId: string
  output: TerminalOutputResponse
  exitCode: number | null
  expired: boolean
  aborted: boolean
}

export interface Interface {
  readonly configure: (input: { enabled: boolean }) => void
  readonly register: (sessionId: string) => void
  readonly unregister: (sessionId: string) => void
  readonly available: (sessionId: string) => boolean
  readonly run: (input: RunInput) => Promise<RunOutput | undefined>
  readonly releaseFromMetadata: (metadata: unknown) => Promise<void>
}

export function make(input: { connection?: TerminalConnection }): Interface {
  const pendingRelease = new Map<string, TerminalHandle>()
  const ownedSessions = new Set<string>()
  let enabled = false

  const service: Interface = {
    configure(config) {
      enabled = config.enabled
      for (const sessionId of ownedSessions) {
        if (enabled && input.connection) sessionsBySessionID.set(sessionId, service)
        else if (sessionsBySessionID.get(sessionId) === service) sessionsBySessionID.delete(sessionId)
      }
    },
    register(sessionId) {
      ownedSessions.add(sessionId)
      if (enabled && input.connection) sessionsBySessionID.set(sessionId, service)
    },
    unregister(sessionId) {
      ownedSessions.delete(sessionId)
      if (sessionsBySessionID.get(sessionId) === service) sessionsBySessionID.delete(sessionId)
    },
    available(sessionId) {
      return enabled && input.connection !== undefined && sessionsBySessionID.get(sessionId) === service
    },
    run: (params) => runWithConnection(input.connection, pendingRelease, params, enabled),
    releaseFromMetadata: (metadata) => releaseFromMetadata(pendingRelease, metadata),
  }

  return service
}

export function available(sessionId: string) {
  return sessionsBySessionID.get(sessionId)?.available(sessionId) ?? false
}

export async function run(input: RunInput) {
  return await sessionsBySessionID.get(input.sessionId)?.run(input)
}

async function runWithConnection(
  connection: TerminalConnection | undefined,
  pendingRelease: Map<string, TerminalHandle>,
  input: RunInput,
  enabled: boolean,
) {
  if (!enabled || !connection) return

  const terminal = await connection.createTerminal({
    sessionId: input.sessionId,
    command: input.command,
    ...(input.args?.length ? { args: input.args } : {}),
    cwd: input.cwd,
    outputByteLimit: input.outputByteLimit,
    env: Object.entries(input.env)
      .filter((entry): entry is [string, string] => typeof entry[1] === "string")
      .map(([name, value]) => ({ name, value })),
  })

  let expired = false
  let aborted = false
  let timeout: ReturnType<typeof setTimeout> | undefined
  let abortHandler: (() => void) | undefined
  let release = true
  try {
    await input.onStart(terminal.id)
    const abort = new Promise<{ type: "abort" }>((resolve) => {
      if (input.signal.aborted) {
        resolve({ type: "abort" })
        return
      }
      abortHandler = () => resolve({ type: "abort" })
      input.signal.addEventListener("abort", abortHandler, { once: true })
    })
    const timer = new Promise<{ type: "timeout" }>((resolve) => {
      timeout = setTimeout(() => resolve({ type: "timeout" }), input.timeout)
    })
    const exit = await Promise.race([
      terminal.waitForExit().then((value) => ({ type: "exit" as const, value })),
      abort,
      timer,
    ])
    if (timeout) clearTimeout(timeout)
    if (abortHandler) input.signal.removeEventListener("abort", abortHandler)

    if (exit.type === "abort") {
      aborted = true
      await terminal.kill()
    }
    if (exit.type === "timeout") {
      expired = true
      await terminal.kill()
    }

    const output = await terminal.currentOutput()
    pendingRelease.set(terminal.id, terminal)
    release = false
    return {
      terminalId: terminal.id,
      output,
      exitCode: exit.type === "exit" ? (exit.value.exitCode ?? null) : null,
      expired,
      aborted,
    }
  } catch (error) {
    throw new TerminalStartedError(terminal.id, error)
  } finally {
    if (timeout) clearTimeout(timeout)
    if (abortHandler) input.signal.removeEventListener("abort", abortHandler)
    if (release) await terminal.release().catch(() => undefined)
  }
}

export function outputText(output: TerminalOutputResponse | undefined) {
  return output?.output ?? ""
}

async function releaseFromMetadata(pendingRelease: Map<string, TerminalHandle>, metadata: unknown) {
  if (!metadata || typeof metadata !== "object") return
  const terminalId = (metadata as Record<string, unknown>).terminalId
  if (typeof terminalId !== "string") return
  const terminal = pendingRelease.get(terminalId)
  if (!terminal) return
  pendingRelease.delete(terminalId)
  await terminal.release().catch(() => undefined)
}

export * as ACPTerminal from "./terminal"
