import { spawn, type ChildProcess } from "node:child_process"
import { randomUUID } from "node:crypto"
import { createServer } from "node:net"
import type { Context } from "../sdk/main"
import { type WslCommandLine, type WslRuntime, shellEscape, wslArgs } from "./runtime"

export type WslSidecar = {
  stop: () => Promise<void>
  onExit: (cb: (code: number | null, signal: NodeJS.Signals | null) => void) => void
  url: string
  password: string
}

export async function spawnWslSidecar(
  distro: string,
  opts: {
    runtime: WslRuntime
    t: Context["t"]
    packaged: boolean
    /** Aborts the start: CLI discovery, health polling, and the server process, which has exited when this rejects. */
    signal: AbortSignal
    onLine?: (line: WslCommandLine) => void
    healthTimeoutMs?: number
  },
): Promise<WslSidecar> {
  const t = opts.t
  const opencode = await opts.runtime.resolveCli(distro, { signal: opts.signal })
  if (!opencode) throw new Error(t("error.opencodeNotInstalled", { distro }))

  const port = await allocatePort(t)
  opts.signal.throwIfAborted()
  const password = randomUUID()
  const script = [
    "set -euo pipefail",
    'cd "$HOME" || cd /',
    'PATH=$(awk -v RS=: -v ORS=: \'$0 !~ /^\\/mnt\\//\' <<<"$PATH" | sed "s/:$//")',
    "export PATH",
    "export WSLENV=",
    "export OPENCODE_EXPERIMENTAL_DISABLE_FILEWATCHER=true",
    "export OPENCODE_CLIENT=desktop",
    `export OPENCODE_SERVER_PASSWORD=${shellEscape(password)}`,
    'export XDG_STATE_HOME="$HOME/.local/state"',
    `exec ${shellEscape(opencode)} --log-level ${opts.packaged ? "warn" : "info"} serve --hostname 0.0.0.0 --port ${port}`,
  ].join("\n")
  const child = spawn("wsl", wslArgs(["bash", "-se"], distro), {
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  })
  child.stdin.end(script)

  const recentOutput: string[] = []
  const emit = (line: WslCommandLine) => {
    if (!line.text.trim()) return
    recentOutput.push(`[${line.stream}] ${line.text}`)
    if (recentOutput.length > 12) recentOutput.shift()
    opts.onLine?.(line)
  }
  forwardLines(child.stdout, "stdout", emit)
  forwardLines(child.stderr, "stderr", emit)

  const exit = new Promise<never>((_, reject) => {
    child.once("error", reject)
    child.once("exit", (code, signal) =>
      reject(
        new Error(
          t("error.serverExitedBeforeHealthy", {
            code: code ?? "null",
            signal: signal ?? "null",
            output: recentOutput.length ? `\n${recentOutput.join("\n")}` : "",
          }),
        ),
      ),
    )
  })
  const aborted = Promise.withResolvers<never>()
  const abort = () => aborted.reject(opts.signal.reason)
  opts.signal.addEventListener("abort", abort, { once: true })
  const url = `http://127.0.0.1:${port}`
  const startup = new AbortController()
  const health = pollWslHealth(() => checkHealth(url, password), startup.signal)
  const timeoutMs = opts.healthTimeoutMs ?? 30_000
  let timeout: ReturnType<typeof setTimeout>
  const timedOut = new Promise<never>(
    (_, reject) =>
      (timeout = setTimeout(
        () => reject(new Error(t("error.healthTimeout", { distro, timeout: timeoutMs }))),
        timeoutMs,
      )),
  )

  await Promise.race([health, exit, timedOut, aborted.promise])
    .catch(async (error) => {
      await stop(child)
      throw error
    })
    .finally(() => {
      clearTimeout(timeout)
      startup.abort()
      opts.signal.removeEventListener("abort", abort)
    })
  return {
    stop: () => stop(child),
    onExit: (cb) => child.once("exit", cb),
    url,
    password,
  }
}

function stop(child: ChildProcess) {
  // A process that never started or already exited has nothing to wait for.
  if (child.pid === undefined || child.exitCode !== null || child.signalCode !== null) return Promise.resolve()
  return new Promise<void>((resolve) => {
    child.once("exit", () => resolve())
    child.kill()
  })
}

async function checkHealth(url: string, password: string) {
  const auth = Buffer.from(`opencode:${password}`).toString("base64")
  return fetch(new URL("/api/info", url), {
    method: "GET",
    headers: { authorization: `Basic ${auth}` },
    signal: AbortSignal.timeout(3000),
  }).then(
    (res) => res.ok,
    () => false,
  )
}

async function pollWslHealth(check: () => Promise<boolean>, signal: AbortSignal) {
  while (!signal.aborted) {
    if (await check()) return
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
}

function allocatePort(t: Context["t"]) {
  return new Promise<number>((resolve, reject) => {
    const server = createServer()
    server.on("error", reject)
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      if (typeof address !== "object" || !address) {
        server.close()
        reject(new Error(t("error.failedPort")))
        return
      }
      server.close(() => resolve(address.port))
    })
  })
}

function forwardLines(
  stream: NodeJS.ReadableStream,
  source: WslCommandLine["stream"],
  onLine: (line: WslCommandLine) => void,
) {
  let pending = ""
  stream.setEncoding("utf8")
  stream.on("data", (chunk: string) => {
    pending += chunk
    const lines = pending.split(/\r?\n/g)
    pending = lines.pop() ?? ""
    lines.forEach((text) => onLine({ stream: source, text }))
  })
  stream.on("end", () => {
    if (pending) onLine({ stream: source, text: pending })
  })
}
