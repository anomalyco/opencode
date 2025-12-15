import { Log } from "@/util/log"
import type { ACPAgentDefinition, InstallCommand } from "./agents"

export type InstallRunOptions = {
  agent: ACPAgentDefinition
  installCommand: InstallCommand
  cwd?: string
  onOutput?: (chunk: string) => void
  signal?: AbortSignal
}

export type InstallRunResult = {
  code: number | null
  output: string
  detected: boolean
  error?: Error
}

/**
 * Run a single install command for an agent and stream output.
 */
export async function runAgentInstall(options: InstallRunOptions): Promise<InstallRunResult> {
  const log = Log.create({ service: "agent-install" })
  const { agent, installCommand, onOutput, cwd, signal } = options
  const output: string[] = []
  const append = (text: string) => {
    output.push(text)
    onOutput?.(text)
  }

  const isWindows = process.platform === "win32"
  const shell = isWindows
    ? ["powershell", "-NoLogo", "-NonInteractive", "-Command", installCommand.command]
    : ["bash", "-lc", installCommand.command]

  let code: number | null = null
  let error: Error | undefined
  let killed = false

  try {
    const proc = Bun.spawn(shell, {
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      env: process.env,
      cwd,
    })

    log.info("agent.install.start", {
      agent: agent.name,
      command: installCommand.command,
      method: installCommand.method,
      pid: proc.pid,
    })

    const decoder = new TextDecoder()

    const pump = async (stream: AsyncIterable<Uint8Array>) => {
      for await (const chunk of stream) {
        const text = decoder.decode(chunk)
        append(text)
      }
    }

    const pumpStdout = pump(proc.stdout as unknown as AsyncIterable<Uint8Array>)
    const pumpStderr = pump(proc.stderr as unknown as AsyncIterable<Uint8Array>)

    const abort = () => {
      try {
        killed = true
        proc.kill()
      } catch {
        // ignore kill errors
      }
    }

    if (signal) {
      if (signal.aborted) abort()
      else signal.addEventListener("abort", abort, { once: true })
    }

    code = await proc.exited
    // Ensure both streams finish (ignore errors while draining)
    await Promise.allSettled([pumpStdout, pumpStderr])

    if (signal) {
      signal.removeEventListener("abort", abort)
    }
  } catch (err) {
    error = err instanceof Error ? err : new Error(String(err))
    log.error("agent.install.failed", {
      agent: agent.name,
      command: installCommand.command,
      error: error.message,
    })
  }

  const detected = code === 0 ? Bun.which(agent.command) !== null : false

  return {
    code,
    output: output.join(""),
    detected: killed ? false : detected,
    error,
  }
}
