import { spawn, type ChildProcess } from "node:child_process"
import { getDeterministicPath } from "./deterministic-env.js"

export type ServiceContender = {
  readonly child: ChildProcess
  readonly error: () => Error | undefined
  readonly closed: () => boolean
  readonly stderr: () => string
  readonly release: () => void
}

const stderrLimit = 8 * 1024

export function spawnServiceContender(
  command: string,
  args: ReadonlyArray<string>,
  env?: Readonly<Record<string, string | undefined>>,
): ServiceContender {
  // Make PATH deterministic across reconnect election: whichever client wins
  // should not determine the service's global PATH. Use the login shell's
  // PATH (cached, bounded) and only fall back to the client's PATH.
  // Explicit env.PATH from the caller (e.g., tests) is still respected.
  const deterministicPath = getDeterministicPath()
  const baseEnv: Record<string, string | undefined> = { ...process.env, ...env }
  const hasExplicitPath = env !== undefined && ("PATH" in env || "Path" in (env as Record<string, unknown>))
  if (deterministicPath !== undefined && !hasExplicitPath) {
    baseEnv.PATH = deterministicPath
    if (process.platform === "win32") (baseEnv as Record<string, string | undefined>).Path = deterministicPath
  }
  const child = spawn(command, args, {
    detached: true,
    stdio: ["ignore", "ignore", "pipe"],
    env: baseEnv,
  })
  let error: Error | undefined
  let closed = false
  let stderr = Buffer.alloc(0)
  const onStderr = (chunk: Buffer) => {
    const tail = chunk.subarray(-stderrLimit)
    stderr =
      tail.length === stderrLimit
        ? Buffer.from(tail)
        : Buffer.concat([stderr.subarray(-(stderrLimit - tail.length)), tail])
  }
  child.stderr?.on("data", onStderr)
  if (child.stderr !== null && "unref" in child.stderr && typeof child.stderr.unref === "function") child.stderr.unref()
  child.once("error", (cause) => {
    error = new Error("Failed to start server", { cause })
  })
  child.once("close", () => {
    closed = true
  })
  child.unref()
  return {
    child,
    error: () => error,
    closed: () => closed,
    stderr: () => stderr.toString("utf8").trim(),
    release: () => {
      child.stderr?.off("data", onStderr)
      child.stderr?.resume()
      stderr = Buffer.alloc(0)
    },
  }
}

export function contenderFailure(contender: ServiceContender) {
  const error = contender.error()
  if (error !== undefined) return error
  if (contender.child.exitCode !== null && contender.child.exitCode !== 0)
    return startupError(`Server process exited with code ${contender.child.exitCode}`, contender.stderr())
  if (contender.child.signalCode !== null)
    return startupError(`Server process terminated by ${contender.child.signalCode}`, contender.stderr())
  return undefined
}

export function contenderFinished(contender: ServiceContender) {
  return contender.error() !== undefined || contender.closed()
}

function startupError(message: string, stderr: string) {
  return new Error(stderr ? `${message}\n${stderr}` : message)
}
