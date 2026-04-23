import { spawn, type ChildProcess } from "child_process"
import { ulid } from "ulid"
import { Effect, Layer, Context, Schema } from "effect"
import { InstanceState } from "@/effect"
import { Log } from "@/util"
import { killTree } from "./shell"

const log = Log.create({ service: "shell.background" })

const MAX_BUFFER_BYTES = 1_000_000 // 1 MB rolling window per shell

type Status = "running" | "exited" | "killed" | "errored"

type Handle = {
  id: string
  command: string
  description?: string
  startedAt: number
  proc: ChildProcess
  buffer: string[]
  bufferBytes: number
  status: Status
  exitCode: number | null
  error?: string
  exited: boolean
}

export type StartInput = {
  shell: string
  shellName: string
  command: string
  cwd: string
  env: NodeJS.ProcessEnv
  description?: string
}

export type OutputResult = {
  shellID: string
  command: string
  description?: string
  status: Status
  exitCode: number | null
  error?: string
  startedAt: number
  output: string
  truncated: boolean
}

const PS_NAMES = new Set(["powershell", "pwsh"])

function buildSpawn(input: StartInput): ChildProcess {
  if (process.platform === "win32" && PS_NAMES.has(input.shellName)) {
    return spawn(
      input.shell,
      ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", input.command],
      {
        cwd: input.cwd,
        env: input.env,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      },
    )
  }
  return spawn(input.command, [], {
    shell: input.shell,
    cwd: input.cwd,
    env: input.env,
    stdio: ["ignore", "pipe", "pipe"],
    detached: process.platform !== "win32",
  })
}

function appendBuffer(handle: Handle, chunk: string) {
  if (!chunk) return
  const bytes = Buffer.byteLength(chunk, "utf-8")
  handle.buffer.push(chunk)
  handle.bufferBytes += bytes
  while (handle.bufferBytes > MAX_BUFFER_BYTES && handle.buffer.length > 1) {
    const removed = handle.buffer.shift()
    if (!removed) break
    handle.bufferBytes -= Buffer.byteLength(removed, "utf-8")
  }
}

function drainBuffer(handle: Handle): { text: string; truncated: boolean } {
  const text = handle.buffer.join("")
  const truncated = handle.bufferBytes >= MAX_BUFFER_BYTES
  handle.buffer = []
  handle.bufferBytes = 0
  return { text, truncated }
}

function startHandle(input: StartInput): Handle {
  const id = ulid().toLowerCase()
  const proc = buildSpawn(input)
  const handle: Handle = {
    id,
    command: input.command,
    description: input.description,
    startedAt: Date.now(),
    proc,
    buffer: [],
    bufferBytes: 0,
    status: "running",
    exitCode: null,
    exited: false,
  }
  proc.stdout?.on("data", (chunk: Buffer | string) => {
    appendBuffer(handle, typeof chunk === "string" ? chunk : chunk.toString("utf-8"))
  })
  proc.stderr?.on("data", (chunk: Buffer | string) => {
    appendBuffer(handle, typeof chunk === "string" ? chunk : chunk.toString("utf-8"))
  })
  proc.on("error", (err) => {
    handle.status = "errored"
    handle.error = String(err?.message ?? err)
    handle.exited = true
    log.error("background shell errored", { id, error: handle.error })
  })
  proc.on("exit", (code) => {
    handle.exited = true
    if (handle.status === "running") {
      handle.status = code === 0 ? "exited" : code === null ? "killed" : "exited"
    }
    handle.exitCode = code
    log.info("background shell exited", { id, code, status: handle.status })
  })
  log.info("background shell started", { id, command: input.command })
  return handle
}

function snapshot(handle: Handle): OutputResult {
  const drained = drainBuffer(handle)
  return {
    shellID: handle.id,
    command: handle.command,
    description: handle.description,
    status: handle.status,
    exitCode: handle.exitCode,
    error: handle.error,
    startedAt: handle.startedAt,
    output: drained.text,
    truncated: drained.truncated,
  }
}

async function killAll(shells: Map<string, Handle>) {
  for (const handle of shells.values()) {
    if (handle.exited) continue
    try {
      await killTree(handle.proc, { exited: () => handle.exited })
    } catch (err) {
      log.error("kill on shutdown failed", { id: handle.id, error: String(err) })
    }
  }
  shells.clear()
}

type State = {
  shells: Map<string, Handle>
}

export class ShellNotFound extends Schema.TaggedErrorClass<ShellNotFound>()("ShellNotFound", {
  shellID: Schema.String,
}) {}

export interface Interface {
  readonly start: (input: StartInput) => Effect.Effect<{ shellID: string }>
  readonly output: (input: { shellID: string }) => Effect.Effect<OutputResult, ShellNotFound>
  readonly kill: (input: { shellID: string }) => Effect.Effect<OutputResult, ShellNotFound>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/BackgroundShell") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const state = yield* InstanceState.make<State>(
      Effect.fn("BackgroundShell.state")(function* (_ctx) {
        const shells = new Map<string, Handle>()
        yield* Effect.addFinalizer(() => Effect.promise(() => killAll(shells)))
        return { shells }
      }),
    )

    return Service.of({
      start: Effect.fn("BackgroundShell.start")(function* (input: StartInput) {
        return yield* InstanceState.useEffect(state, (s) =>
          Effect.sync(() => {
            const handle = startHandle(input)
            s.shells.set(handle.id, handle)
            return { shellID: handle.id }
          }),
        )
      }),
      output: Effect.fn("BackgroundShell.output")(function* (input: { shellID: string }) {
        return yield* InstanceState.useEffect(state, (s) =>
          Effect.gen(function* () {
            const handle = s.shells.get(input.shellID)
            if (!handle) return yield* Effect.fail(new ShellNotFound({ shellID: input.shellID }))
            return snapshot(handle)
          }),
        )
      }),
      kill: Effect.fn("BackgroundShell.kill")(function* (input: { shellID: string }) {
        return yield* InstanceState.useEffect(state, (s) =>
          Effect.gen(function* () {
            const handle = s.shells.get(input.shellID)
            if (!handle) return yield* Effect.fail(new ShellNotFound({ shellID: input.shellID }))
            if (!handle.exited) {
              yield* Effect.promise(() => killTree(handle.proc, { exited: () => handle.exited }))
              if (handle.status === "running") handle.status = "killed"
            }
            const result = snapshot(handle)
            s.shells.delete(input.shellID)
            return result
          }),
        )
      }),
    })
  }),
)

export const defaultLayer = layer

export * as BackgroundShell from "./background"
