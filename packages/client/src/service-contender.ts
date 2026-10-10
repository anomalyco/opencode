import { spawn, type ChildProcess } from "node:child_process"
import type { EnsureTiming } from "./service-timing.js"
import { PortConflictError } from "./service.js"

export type ServiceContender = {
  readonly child: ChildProcess
  readonly error: () => Error | undefined
  readonly closed: () => boolean
  readonly stderr: () => string
  readonly conflict: () => PortConflictError | undefined
  readonly release: () => void
}

const stderrLimit = 8 * 1024

export function spawnServiceContender(
  command: string,
  args: ReadonlyArray<string>,
  env?: Readonly<Record<string, string | undefined>>,
): ServiceContender {
  const child = spawn(command, args, {
    detached: true,
    windowsHide: true,
    // Startup facts have their own pipe: stderr prose must never be mistaken for a typed failure.
    stdio: ["ignore", "ignore", "pipe", "pipe"],
    env: { ...process.env, ...env, OPENCODE_SERVICE_STARTUP_PIPE: "1" },
  })
  let error: Error | undefined
  let closed = false
  let stderr = Buffer.alloc(0)
  let startup = Buffer.alloc(0)
  const pipe = child.stdio[3]
  const onStartup = (chunk: Buffer) => {
    startup = Buffer.concat([startup, chunk]).subarray(-stderrLimit)
  }
  pipe?.on("data", onStartup)
  if (pipe !== null && pipe !== undefined && "unref" in pipe && typeof pipe.unref === "function") pipe.unref()
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
    conflict: () => {
      // This is the sole decoding boundary for the private child-process startup pipe.
      try {
        const value: unknown = JSON.parse(startup.toString("utf8"))
        if (typeof value !== "object" || value === null) return
        if (!("type" in value) || value.type !== "port-conflict") return
        if (!("hostname" in value) || typeof value.hostname !== "string") return
        if (!("port" in value) || typeof value.port !== "number" || !Number.isInteger(value.port)) return
        if (value.port < 1 || value.port > 65535) return
        return new PortConflictError(value.hostname, value.port)
      } catch {
        return undefined
      }
    },
    release: () => {
      child.stderr?.off("data", onStderr)
      child.stderr?.resume()
      stderr = Buffer.alloc(0)
      pipe?.off("data", onStartup)
      pipe?.destroy()
      startup = Buffer.alloc(0)
    },
  }
}

/**
 * The startup attempts of one `ensure()` call. It keeps at most two attempts alive, remembers
 * the first startup failure, and backs off when attempts exit cleanly because another one won.
 */
export function contenderPool(timing: EnsureTiming) {
  const contenders = new Set<ServiceContender>()
  let failure: Error | undefined
  let spawnDelay = timing.spawnDelay
  let lastSpawn = 0
  return {
    /** The first startup failure seen since the last eviction. */
    failure: () => failure,
    /** A registered service answered, so the next attempt waits the base delay again. */
    serviceAnswered() {
      spawnDelay = timing.spawnDelay
    },
    /**
     * The owner `pid` was replaced. Drop its attempt and any finished ones, forget their
     * failure, and restart the spawn clock.
     */
    evict(pid: number) {
      for (const item of contenders) {
        if (item.child.pid === pid || contenderFinished(item)) {
          item.release()
          contenders.delete(item)
        }
      }
      failure = undefined
      lastSpawn = 0
    },
    /** Let the next attempt start without waiting a spawn delay. */
    recruitNow() {
      lastSpawn = Date.now() - spawnDelay
    },
    /** Collect finished attempts. Report the startup failure once no attempt is left alive. */
    reap() {
      const finished = [...contenders].filter(contenderFinished)
      failure ??= finished.map(contenderFailure).find((error) => error !== undefined)
      if (finished.some((item) => item.child.exitCode === 0))
        spawnDelay = Math.min(spawnDelay * 2, timing.maxSpawnDelay)
      finished.forEach((item) => contenders.delete(item))
      return contenders.size === 0 ? failure : undefined
    },
    /**
     * Whether to start another attempt now. A registration that has not answered yet gets one
     * spawn delay before an attempt competes with it.
     */
    shouldRecruit(registered: boolean) {
      if (lastSpawn === 0 && registered) lastSpawn = Date.now()
      // Keep one candidate plus one lock probe for pre-lock stalls. After a failure, let the
      // survivors finish without recruiting replacements that could hide the error indefinitely.
      return failure === undefined && contenders.size < 2 && Date.now() - lastSpawn >= spawnDelay
    },
    add(contender: ServiceContender) {
      contenders.add(contender)
      lastSpawn = Date.now()
    },
    releaseAll() {
      contenders.forEach((contender) => contender.release())
    },
  }
}

function contenderFailure(contender: ServiceContender) {
  const error = contender.error()
  if (error !== undefined) return error
  if (contender.child.exitCode !== null && contender.child.exitCode !== 0) {
    const failure = startupError(`Server process exited with code ${contender.child.exitCode}`, contender.stderr())
    const conflict = contender.conflict()
    if (!conflict) return failure

    conflict.cause = failure
    return conflict
  }
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
