import { spawn, type ChildProcess } from "child_process"

// In-memory registry of background processes launched by the process_* tools.
// Output is buffered as a bounded ring of lines so process_logs can read recent
// output without blocking on a long-running process (dev servers, watchers).

export type ProcStatus = "running" | "exited" | "error"

export interface Proc {
  id: string
  command: string
  cwd: string
  status: ProcStatus
  exitCode: number | null
  startedAt: number
  output: string[]
  child: ChildProcess
}

const MAX_LINES = 2000
const procs = new Map<string, Proc>()
let counter = 0

export function start(command: string, cwd: string): Proc {
  counter += 1
  const id = `proc_${Date.now().toString(36)}_${counter}`
  const child = spawn(command, {
    cwd,
    shell: true,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  })

  const proc: Proc = {
    id,
    command,
    cwd,
    status: "running",
    exitCode: null,
    startedAt: Date.now(),
    output: [],
    child,
  }

  const push = (chunk: Buffer | string) => {
    const text = typeof chunk === "string" ? chunk : chunk.toString("utf8")
    for (const line of text.split("\n")) proc.output.push(line)
    while (proc.output.length > MAX_LINES) proc.output.shift()
  }

  child.stdout?.on("data", push)
  child.stderr?.on("data", push)
  child.on("exit", (code) => {
    proc.status = "exited"
    proc.exitCode = code ?? null
  })
  child.on("error", (err) => {
    proc.status = "error"
    push(`[process error] ${err instanceof Error ? err.message : String(err)}`)
  })

  procs.set(id, proc)
  return proc
}

export function get(id: string): Proc | undefined {
  return procs.get(id)
}

export function list(): Proc[] {
  return [...procs.values()]
}

export function stop(id: string): boolean {
  const proc = procs.get(id)
  if (!proc) return false
  try {
    proc.child.kill("SIGTERM")
  } catch {
    // ignore
  }
  return true
}

export function recent(proc: Proc, lines: number): string {
  const slice = proc.output.slice(Math.max(0, proc.output.length - lines))
  return slice.join("\n")
}
