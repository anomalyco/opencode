import { spawn as launch, type ChildProcess } from "child_process"

export namespace Process {
  export type Stdio = "inherit" | "pipe" | "ignore"

  export interface Options {
    cwd?: string
    env?: NodeJS.ProcessEnv | null
    stdin?: Stdio
    stdout?: Stdio
    stderr?: Stdio
    abort?: AbortSignal
    kill?: NodeJS.Signals | number
    timeout?: number
  }

  export type Child = ChildProcess & { exited: Promise<number> }

  export function spawn(cmd: string[], options: Options = {}): Child {
    if (cmd.length === 0) throw new Error("Command is required")
    options.abort?.throwIfAborted()

    const proc = launch(cmd[0], cmd.slice(1), {
      cwd: options.cwd,
      env: options.env === null ? {} : options.env ? { ...process.env, ...options.env } : undefined,
      stdio: [options.stdin ?? "ignore", options.stdout ?? "ignore", options.stderr ?? "ignore"],
    })

    let aborted = false
    let timer: ReturnType<typeof setTimeout> | undefined

    const abort = () => {
      if (aborted) return
      if (proc.exitCode !== null || proc.signalCode !== null) return
      aborted = true

      proc.kill(options.kill ?? "SIGTERM")

      const timeout = options.timeout ?? 5_000
      if (timeout <= 0) return

      timer = setTimeout(() => {
        proc.kill("SIGKILL")
      }, timeout)
    }

    const exited = new Promise<number>((resolve, reject) => {
      const done = () => {
        options.abort?.removeEventListener("abort", abort)
        if (timer) clearTimeout(timer)
      }
      proc.once("exit", (exitCode, signal) => {
        done()
        resolve(exitCode ?? (signal ? 1 : 0))
      })
      proc.once("error", (error) => {
        done()
        reject(error)
      })
    })

    if (options.abort) {
      options.abort.addEventListener("abort", abort, { once: true })
      if (options.abort.aborted) abort()
    }

    const child = proc as Child
    child.exited = exited
    return child
  }
}
