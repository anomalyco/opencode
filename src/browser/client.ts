import { BrowserBinary } from "./binary"
import { BrowserDaemon, type BrowserDaemonOptions } from "./daemon"
import { PatchrightLauncher } from "./patchright"
import { Log } from "@/util/log"

const log = Log.create({ service: "browser.client" })

const DEFAULT_TIMEOUT = 30_000 // 30 seconds

export interface BrowserExecResult {
  output: string
  exitCode: number
  error?: string
}

/**
 * Programmatic wrapper around the agent-browser CLI.
 * Each method maps to an agent-browser subcommand.
 */
export namespace BrowserClient {
  /**
   * Execute an agent-browser command and return the result.
   */
  export async function exec(
    sessionId: string,
    command: string[],
    options?: { timeout?: number; abort?: AbortSignal },
  ): Promise<BrowserExecResult> {
    const binary = await BrowserBinary.resolve()
    const daemonInfo = BrowserDaemon.getInfo(sessionId)
    const globalArgs = BrowserDaemon.buildGlobalArgs(
      sessionId,
      daemonInfo?.options ?? { headed: true },
    )

    const cmdArgs =
      binary === "npx"
        ? ["npx", "agent-browser", ...globalArgs, ...command]
        : [binary, ...globalArgs, ...command]

    log.info("exec", { command: command.join(" "), sessionId })

    const timeout = options?.timeout ?? DEFAULT_TIMEOUT

    const proc = Bun.spawn(cmdArgs, {
      stdout: "pipe",
      stderr: "pipe",
      env: process.env as Record<string, string>,
    })

    // Handle timeout
    const timer = setTimeout(() => {
      proc.kill()
    }, timeout)

    // Handle abort signal
    if (options?.abort) {
      options.abort.addEventListener("abort", () => {
        proc.kill()
      })
    }

    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ])
    const exitCode = await proc.exited

    clearTimeout(timer)

    if (exitCode !== 0) {
      log.warn("command failed", { command: command.join(" "), exitCode, stderr: stderr.slice(0, 500) })
      return {
        output: stderr || stdout || `Command failed with exit code ${exitCode}`,
        exitCode,
        error: stderr || undefined,
      }
    }

    return { output: stdout, exitCode: 0 }
  }

  /**
   * Execute agent-browser command with automatic Patchright fallback.
   * If agent-browser fails and the command maps to a Patchright operation,
   * retry using Patchright's stealth API directly.
   */
  export async function execWithFallback(
    sessionId: string,
    command: string[],
    options?: { timeout?: number; abort?: AbortSignal },
  ): Promise<BrowserExecResult> {
    const result = await exec(sessionId, command, options)
    if (result.exitCode === 0) return result

    // Try Patchright fallback for common commands
    if (!PatchrightLauncher.isRunning()) return result

    const cmd = command[0]
    log.info("agent-browser failed, trying Patchright fallback", { cmd, error: result.error?.slice(0, 200) })

    try {
      switch (cmd) {
        case "open":
        case "goto":
        case "navigate":
          if (command[1]) {
            await PatchrightLauncher.goto(command[1])
            return { output: `Navigated to ${command[1]} (via Patchright fallback)`, exitCode: 0 }
          }
          break
        case "eval":
          if (command[1]) {
            const evalResult = await PatchrightLauncher.evaluate(command[1])
            return { output: JSON.stringify(evalResult), exitCode: 0 }
          }
          break
        case "get":
          if (command[1] === "title") {
            const title = await PatchrightLauncher.title()
            return { output: title, exitCode: 0 }
          }
          if (command[1] === "url") {
            const url = PatchrightLauncher.url()
            return { output: url, exitCode: 0 }
          }
          break
        case "screenshot":
          if (command[1]) {
            await PatchrightLauncher.screenshot(command[1])
            return { output: `Screenshot saved (via Patchright fallback)`, exitCode: 0 }
          }
          break
      }
    } catch (e) {
      log.warn("Patchright fallback also failed", { cmd, error: String(e) })
    }

    return result
  }

  // --- Navigation ---

  export async function open(
    sessionId: string,
    url: string,
    options?: { timeout?: number; abort?: AbortSignal },
  ): Promise<BrowserExecResult> {
    return exec(sessionId, ["open", url], options)
  }

  export async function navigate(
    sessionId: string,
    url: string,
    options?: { timeout?: number; abort?: AbortSignal },
  ): Promise<BrowserExecResult> {
    return exec(sessionId, ["open", url], options)
  }

  export async function back(
    sessionId: string,
    options?: { timeout?: number; abort?: AbortSignal },
  ): Promise<BrowserExecResult> {
    return exec(sessionId, ["back"], options)
  }

  export async function forward(
    sessionId: string,
    options?: { timeout?: number; abort?: AbortSignal },
  ): Promise<BrowserExecResult> {
    return exec(sessionId, ["forward"], options)
  }

  export async function reload(
    sessionId: string,
    options?: { timeout?: number; abort?: AbortSignal },
  ): Promise<BrowserExecResult> {
    return exec(sessionId, ["reload"], options)
  }

  // --- Snapshot & Analysis ---

  export async function snapshot(
    sessionId: string,
    options?: { interactive?: boolean; compact?: boolean; selector?: string; timeout?: number; abort?: AbortSignal },
  ): Promise<BrowserExecResult> {
    const args = ["snapshot"]
    if (options?.interactive) args.push("-i")
    if (options?.compact) args.push("-c")
    if (options?.selector) args.push("-s", options.selector)
    return exec(sessionId, args, options)
  }

  // --- Interaction ---

  export async function click(
    sessionId: string,
    ref: string,
    options?: { newTab?: boolean; timeout?: number; abort?: AbortSignal },
  ): Promise<BrowserExecResult> {
    const args = ["click", ref]
    if (options?.newTab) args.push("--new-tab")
    return exec(sessionId, args, options)
  }

  export async function type(
    sessionId: string,
    ref: string,
    text: string,
    options?: { timeout?: number; abort?: AbortSignal },
  ): Promise<BrowserExecResult> {
    return exec(sessionId, ["type", ref, text], options)
  }

  export async function fill(
    sessionId: string,
    ref: string,
    text: string,
    options?: { timeout?: number; abort?: AbortSignal },
  ): Promise<BrowserExecResult> {
    return exec(sessionId, ["fill", ref, text], options)
  }

  export async function select(
    sessionId: string,
    ref: string,
    value: string,
    options?: { timeout?: number; abort?: AbortSignal },
  ): Promise<BrowserExecResult> {
    return exec(sessionId, ["select", ref, value], options)
  }

  export async function press(
    sessionId: string,
    key: string,
    options?: { timeout?: number; abort?: AbortSignal },
  ): Promise<BrowserExecResult> {
    return exec(sessionId, ["press", key], options)
  }

  export async function hover(
    sessionId: string,
    ref: string,
    options?: { timeout?: number; abort?: AbortSignal },
  ): Promise<BrowserExecResult> {
    return exec(sessionId, ["hover", ref], options)
  }

  export async function scroll(
    sessionId: string,
    direction: "up" | "down" | "left" | "right",
    amount?: number,
    options?: { selector?: string; timeout?: number; abort?: AbortSignal },
  ): Promise<BrowserExecResult> {
    const args = ["scroll", direction]
    if (amount !== undefined) args.push(String(amount))
    if (options?.selector) args.push("--selector", options.selector)
    return exec(sessionId, args, options)
  }

  // --- Screenshots & Media ---

  export async function screenshot(
    sessionId: string,
    filepath?: string,
    options?: { fullPage?: boolean; timeout?: number; abort?: AbortSignal },
  ): Promise<BrowserExecResult> {
    const args = ["screenshot"]
    if (filepath) args.push(filepath)
    if (options?.fullPage) args.push("--full")
    return exec(sessionId, args, options)
  }

  // --- Information Retrieval ---

  export async function getText(
    sessionId: string,
    ref: string,
    options?: { timeout?: number; abort?: AbortSignal },
  ): Promise<BrowserExecResult> {
    return exec(sessionId, ["get", "text", ref], options)
  }

  export async function getHtml(
    sessionId: string,
    ref: string,
    options?: { timeout?: number; abort?: AbortSignal },
  ): Promise<BrowserExecResult> {
    return exec(sessionId, ["get", "html", ref], options)
  }

  export async function getTitle(
    sessionId: string,
    options?: { timeout?: number; abort?: AbortSignal },
  ): Promise<BrowserExecResult> {
    return exec(sessionId, ["get", "title"], options)
  }

  export async function getUrl(
    sessionId: string,
    options?: { timeout?: number; abort?: AbortSignal },
  ): Promise<BrowserExecResult> {
    return exec(sessionId, ["get", "url"], options)
  }

  // --- Code Execution ---

  export async function evaluate(
    sessionId: string,
    javascript: string,
    options?: { timeout?: number; abort?: AbortSignal },
  ): Promise<BrowserExecResult> {
    return exec(sessionId, ["eval", javascript], options)
  }

  // --- Tab Management ---

  export async function tabList(
    sessionId: string,
    options?: { timeout?: number; abort?: AbortSignal },
  ): Promise<BrowserExecResult> {
    return exec(sessionId, ["tab", "list"], options)
  }

  export async function tabNew(
    sessionId: string,
    url?: string,
    options?: { timeout?: number; abort?: AbortSignal },
  ): Promise<BrowserExecResult> {
    const args = ["tab", "new"]
    if (url) args.push(url)
    return exec(sessionId, args, options)
  }

  export async function tabSwitch(
    sessionId: string,
    index: number,
    options?: { timeout?: number; abort?: AbortSignal },
  ): Promise<BrowserExecResult> {
    return exec(sessionId, ["tab", String(index)], options)
  }

  export async function tabClose(
    sessionId: string,
    options?: { timeout?: number; abort?: AbortSignal },
  ): Promise<BrowserExecResult> {
    return exec(sessionId, ["tab", "close"], options)
  }

  // --- Waiting ---

  export async function wait(
    sessionId: string,
    target: string | number,
    options?: { text?: string; url?: string; timeout?: number; abort?: AbortSignal },
  ): Promise<BrowserExecResult> {
    const args = ["wait"]
    if (typeof target === "number") {
      args.push(String(target))
    } else if (options?.text) {
      args.push("--text", options.text)
    } else if (options?.url) {
      args.push("--url", options.url)
    } else {
      args.push(target)
    }
    return exec(sessionId, args, options)
  }

  // --- Close ---

  export async function close(
    sessionId: string,
    options?: { timeout?: number; abort?: AbortSignal },
  ): Promise<BrowserExecResult> {
    return exec(sessionId, ["close"], options)
  }
}
