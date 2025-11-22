import { spawn, type Subprocess } from "bun"
import { Log } from "@/util/log"
import { defer } from "@/util/defer"

const log = Log.create({ service: "acp-subprocess" })

const SIGKILL_TIMEOUT_MS = 200

export namespace ACPSubprocess {
  export type Options = {
    /**
     * Path to the claude-code-acp executable
     */
    command: string
    /**
     * Arguments to pass to the subprocess
     */
    args?: string[]
    /**
     * Environment variables to pass to the subprocess
     */
    env?: Record<string, string>
    /**
     * Callback for messages received from the subprocess
     */
    onMessage?: (message: unknown) => void
    /**
     * Callback for stderr output
     */
    onStderr?: (data: string) => void
    /**
     * Callback for subprocess exit
     */
    onExit?: (code: number | null, signal: string | null) => void
    /**
     * Callback for subprocess errors
     */
    onError?: (error: Error) => void
  }

  export interface Manager {
    /**
     * Send a message to the subprocess via stdin
     */
    send(message: unknown): Promise<void>
    /**
     * Kill the subprocess gracefully (SIGTERM then SIGKILL)
     */
    kill(): Promise<void>
    /**
     * Check if the subprocess is running
     */
    isRunning(): boolean
    /**
     * Get the process ID
     */
    get pid(): number | undefined
  }

  /**
   * Spawn a subprocess for claude-code-acp and manage its lifecycle
   */
  export async function spawn(options: Options): Promise<Manager> {
    const { command, args = [], env = {}, onMessage, onStderr, onExit, onError } = options

    log.info("spawning subprocess", { command, args })

    let proc: Subprocess<"pipe", "pipe", "pipe"> | undefined
    let exited = false
    let stdoutBuffer = ""

    try {
      proc = Bun.spawn([command, ...args], {
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
        env: {
          ...process.env,
          ...env,
        },
      })

      log.info("subprocess spawned", { pid: proc.pid })
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error))
      log.error("failed to spawn subprocess", { error: err.message })
      onError?.(err)
      throw err
    }

    // Process stdout for ndjson messages
    const processStdout = async () => {
      if (!proc) return

      try {
        for await (const chunk of proc.stdout as unknown as AsyncIterable<Uint8Array>) {
          const text = new TextDecoder().decode(chunk)
          stdoutBuffer += text

          // Process complete lines
          const lines = stdoutBuffer.split("\n")
          stdoutBuffer = lines.pop() || "" // Keep the incomplete line in the buffer

          for (const line of lines) {
            if (!line.trim()) continue

            try {
              const message = JSON.parse(line)
              log.debug("received message", { message })
              onMessage?.(message)
            } catch (parseError) {
              log.error("failed to parse message", {
                line,
                error: parseError instanceof Error ? parseError.message : String(parseError),
              })
            }
          }
        }
      } catch (error) {
        if (!exited) {
          const err = error instanceof Error ? error : new Error(String(error))
          log.error("stdout processing error", { error: err.message })
          onError?.(err)
        }
      }
    }

    // Process stderr
    const processStderr = async () => {
      if (!proc) return

      try {
        for await (const chunk of proc.stderr as unknown as AsyncIterable<Uint8Array>) {
          const text = new TextDecoder().decode(chunk)
          log.debug("stderr", { text })
          onStderr?.(text)
        }
      } catch (error) {
        if (!exited) {
          const err = error instanceof Error ? error : new Error(String(error))
          log.error("stderr processing error", { error: err.message })
        }
      }
    }

    // Handle process exit
    const handleExit = async () => {
      if (!proc) return

      try {
        const exitCode = await proc.exited
        exited = true
        log.info("subprocess exited", { exitCode, pid: proc.pid })
        onExit?.(exitCode, null)
      } catch (error) {
        exited = true
        const err = error instanceof Error ? error : new Error(String(error))
        log.error("subprocess error", { error: err.message })
        onError?.(err)
      }
    }

    // Start processing streams and exit handling
    void processStdout()
    void processStderr()
    void handleExit()

    const manager: Manager = {
      async send(message: unknown): Promise<void> {
        if (!proc || exited) {
          throw new Error("Subprocess is not running")
        }

        const json = JSON.stringify(message)
        log.debug("sending message", { message })

        try {
          proc.stdin!.write(json + "\n")
          await proc.stdin!.flush()
        } catch (error) {
          const err = error instanceof Error ? error : new Error(String(error))
          log.error("failed to send message", { error: err.message })
          throw err
        }
      },

      async kill(): Promise<void> {
        if (!proc || exited) {
          log.debug("subprocess already exited")
          return
        }

        const pid = proc.pid
        log.info("killing subprocess", { pid })

        try {
          // Try graceful shutdown first
          proc.kill("SIGTERM")
          await Bun.sleep(SIGKILL_TIMEOUT_MS)

          // Force kill if still running
          if (!exited) {
            log.warn("subprocess did not exit gracefully, sending SIGKILL", { pid })
            proc.kill("SIGKILL")
          }

          // Wait for exit
          await proc.exited.catch(() => {
            // Ignore errors during kill
          })
        } catch (error) {
          const err = error instanceof Error ? error : new Error(String(error))
          log.error("error killing subprocess", { error: err.message })
          throw err
        }
      },

      isRunning(): boolean {
        return !exited && proc !== undefined
      },

      get pid(): number | undefined {
        return proc?.pid
      },
    }

    return manager
  }

  /**
   * Create a disposable subprocess manager that automatically cleans up
   */
  export async function create(options: Options): Promise<Manager & AsyncDisposable> {
    const manager = await spawn(options)

    return {
      ...manager,
      async [Symbol.asyncDispose](): Promise<void> {
        await manager.kill()
      },
    }
  }
}
