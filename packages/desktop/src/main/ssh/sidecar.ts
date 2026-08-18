import { spawn } from "node:child_process"
import { randomInt, randomUUID } from "node:crypto"
import { createServer } from "node:net"
import { app } from "electron"
import { checkHealth } from "../server"
import { nativeT } from "../native-translations"
import type { SshCommandLine } from "./runtime"
import { resolveSshCommand, requireSshDestination } from "./runtime"
import {
  buildSshServerScript,
  sshOutputIndicatesOpencodeMissing,
  sshOutputIndicatesPortConflict,
  sshTunnelArgs,
} from "./policy"
import { pollSshHealth } from "./startup"

export type SshSidecar = {
  listener: { stop: () => void; onExit: (cb: (code: number | null, signal: NodeJS.Signals | null) => void) => void }
  url: string
  username: string | null
  password: string
}

export class SshSidecarError extends Error {
  constructor(
    message: string,
    readonly reason?: "opencode-missing",
  ) {
    super(message)
    this.name = "SshSidecarError"
  }
}

export type SpawnSshSidecarOptions = {
  onLine?: (line: SshCommandLine) => void
  healthTimeoutMs?: number
}

const REMOTE_PORT_MIN = 20000
const REMOTE_PORT_MAX = 64000
const REMOTE_PORT_ATTEMPTS = 3

/**
 * Starts an opencode server on the remote host over a single ssh connection:
 * `ssh -L <local>:127.0.0.1:<remote> <host> sh -se` with the server script on
 * stdin. The remote port is picked at random; on the rare bind conflict the
 * whole connection is retried with a fresh port.
 */
export async function spawnSshSidecar(host: string, opts: SpawnSshSidecarOptions = {}): Promise<SshSidecar> {
  let lastError: Error | undefined
  for (let attempt = 0; attempt < REMOTE_PORT_ATTEMPTS; attempt++) {
    try {
      return await spawnSshSidecarOnce(host, opts)
    } catch (error) {
      if (error instanceof SshRemotePortConflictError) {
        lastError = error
        continue
      }
      throw error
    }
  }
  throw lastError ?? new Error(nativeT("desktop.ssh.error.connectFailed", { host }))
}

class SshRemotePortConflictError extends Error {}

async function spawnSshSidecarOnce(host: string, opts: SpawnSshSidecarOptions): Promise<SshSidecar> {
  const dest = requireSshDestination(host)
  const localPort = await allocatePort()
  const remotePort = randomInt(REMOTE_PORT_MIN, REMOTE_PORT_MAX)
  const password = randomUUID()
  const username = "opencode"
  const script = buildSshServerScript({
    password,
    remotePort,
    logLevel: app.isPackaged ? "WARN" : "INFO",
  })

  const child = spawn(resolveSshCommand(), sshTunnelArgs(dest, localPort, remotePort), {
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  })
  // Stdin stays open: the remote script's watchdog shuts the server down when
  // the connection (and with it stdin) goes away.
  child.stdin.on("error", () => {})
  child.stdin.write(script)

  const recentOutput: string[] = []
  const emit = (line: SshCommandLine) => {
    if (!line.text.trim()) return
    recentOutput.push(`[${line.stream}] ${line.text}`)
    if (recentOutput.length > 12) recentOutput.shift()
    opts.onLine?.(line)
  }
  forwardLines(child.stdout, "stdout", emit)
  forwardLines(child.stderr, "stderr", emit)

  const exit = new Promise<never>((_, reject) => {
    child.once("error", reject)
    child.once("exit", (code, signal) => reject(startupFailure(host, code, signal, recentOutput)))
  })
  const url = `http://127.0.0.1:${localPort}`
  const startup = new AbortController()
  const health = pollSshHealth(() => checkHealth(url, password), startup.signal)
  const timeoutMs = opts.healthTimeoutMs ?? 45_000
  let timeout: ReturnType<typeof setTimeout>
  const timedOut = new Promise<never>(
    (_, reject) =>
      (timeout = setTimeout(
        () => reject(new Error(nativeT("desktop.ssh.error.healthTimeout", { host, timeout: timeoutMs }))),
        timeoutMs,
      )),
  )

  await Promise.race([health, exit, timedOut])
    .catch((error) => {
      child.kill()
      throw error
    })
    .finally(() => {
      clearTimeout(timeout)
      startup.abort()
    })
  return {
    listener: {
      stop: () => child.kill(),
      onExit: (cb) => child.once("exit", cb),
    },
    url,
    username,
    password,
  }
}

function allocatePort() {
  return new Promise<number>((resolve, reject) => {
    const server = createServer()
    server.on("error", reject)
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      if (typeof address !== "object" || !address) {
        server.close()
        reject(new Error(nativeT("desktop.ssh.error.failedPort")))
        return
      }
      server.close(() => resolve(address.port))
    })
  })
}

function forwardLines(
  stream: NodeJS.ReadableStream,
  source: SshCommandLine["stream"],
  onLine: (line: SshCommandLine) => void,
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

function startupFailure(host: string, code: number | null, signal: NodeJS.Signals | null, recentOutput: string[]) {
  if (sshOutputIndicatesOpencodeMissing(recentOutput, code)) {
    return new SshSidecarError(nativeT("desktop.ssh.error.opencodeNotInstalled", { host }), "opencode-missing")
  }
  if (sshOutputIndicatesPortConflict(recentOutput)) {
    return new SshRemotePortConflictError()
  }
  const suffix = recentOutput.length ? `\n${recentOutput.join("\n")}` : ""
  return new SshSidecarError(
    nativeT("desktop.ssh.error.serverExitedBeforeHealthy", {
      host,
      code: code ?? "null",
      signal: signal ?? "null",
      output: suffix,
    }),
  )
}
