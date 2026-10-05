import { readFile, rm } from "node:fs/promises"
import type { DiscoverOptions, Endpoint, Info, EnsureOptions, StopOptions } from "../service.js"
import { contenderPool, spawnServiceContender } from "../service-contender.js"
import { defaultEnsureTiming, ensureTiming, type EnsureTiming } from "../service-timing.js"
import { matchesVersion } from "../service-version.js"
import { PtyHandoff } from "../pty-handoff.js"
import { fallback, headers, probeResult, same } from "../service-probe.js"

export * from "../service.js"
export { headers }

// Find, start, and stop the local opencode background service.
//
// The registration file is the complete discovery contract. This module is
// intentionally implemented with Node APIs so Promise clients do not need
// Effect or @effect/platform-node at runtime.

/** Discover a healthy, compatible local service without starting one. */
export async function discover(options: DiscoverOptions = {}) {
  const found = (await registered(options.file)).service
  if (found?.state !== "ready") return undefined
  if (!found.compatible) return undefined
  if (!matchesVersion(found.version, options)) return undefined
  return found.endpoint
}

/** Ensure a healthy, compatible local service is running. */
export async function ensure(options: EnsureOptions = {}): Promise<Endpoint> {
  const timing = ensureTiming(options)
  const deadline = Date.now() + timing.promiseTimeout
  const pool = contenderPool(timing)
  let timeouts: { readonly info: Info; readonly count: number } | undefined
  let announced = false

  const announce = (reason: "missing" | "version-mismatch", previousVersion?: string) => {
    if (announced) return
    announced = true
    options.onStart?.(reason, previousVersion)
  }
  const spawnContender = async () => {
    const [command, ...args] = options.command ?? ["opencode", "serve", "--service"]
    if (command === undefined) throw new Error("Missing service command")
    try {
      return spawnServiceContender(command, args, await PtyHandoff.environment(options.file ?? fallback(), options.env))
    } catch (cause) {
      throw new Error("Failed to start server", { cause })
    }
  }

  try {
    while (true) {
      if (Date.now() >= deadline)
        throw pool.failure() ?? new Error("Timed out waiting for the background service to start")
      const registration = await registered(options.file, timing.requestTimeout)
      if (registration.timedOut && registration.info !== undefined) {
        timeouts = {
          info: registration.info,
          count: timeouts !== undefined && same(timeouts.info, registration.info) ? timeouts.count + 1 : 1,
        }
        if (timeouts.count >= 3) {
          announce("missing")
          console.warn("Background service is unresponsive; recovery cannot preserve persistent terminals")
          await PtyHandoff.clear(options.file ?? fallback())
          await terminate(registration.info, options, timing)
          pool.evict(registration.info.pid)
          pool.recruitNow()
          timeouts = undefined
        }
      } else timeouts = undefined

      if (registration.service !== undefined) {
        pool.serviceAnswered()
        const service = registration.service
        const versionMatches = matchesVersion(service.version, options)
        const compatible = service.compatible && versionMatches
        if (!service.compatible && versionMatches)
          throw new Error(
            "Background service uses an incompatible health protocol. Update this client or explicitly restart the service.",
          )
        if (compatible && service.state === "ready") {
          await PtyHandoff.complete(options.file ?? fallback(), service.info)
          return service.endpoint
        }
        if (compatible && service.state === "failed") throw new Error("Background service failed to start")
        if (!compatible) {
          announce("version-mismatch", service.version)
          if (service.state !== "ready")
            console.warn("Background service is not ready; replacement cannot preserve persistent terminals")
          await stop({
            file: options.file,
            pty: service.state === "ready" ? "handoff" : "clear",
          }).catch(() => undefined)
          pool.evict(service.info.pid)
        }
      } else {
        const failed = pool.reap()
        if (failed !== undefined) throw failed
        if (pool.shouldRecruit(registration.info !== undefined)) {
          announce("missing")
          pool.add(await spawnContender())
        }
      }
      await delay(timing.pollInterval)
    }
  } finally {
    pool.releaseAll()
  }
}

/** Stop the registered local service. */
export async function stop(options: StopOptions = {}) {
  const info = await read(options.file)
  // Terminal handoff is best-effort; it must never keep the old service running.
  await (
    options.pty === "handoff" && info !== undefined
      ? PtyHandoff.prepare(options.file ?? fallback(), info, defaultEnsureTiming.requestTimeout)
      : PtyHandoff.clear(options.file ?? fallback())
  ).catch((cause: unknown) => console.warn("Failed to prepare persistent terminals for replacement", cause))
  if (info !== undefined) await terminate(info, options, ensureTiming(options))
}

async function read(file?: string) {
  const text = await readFile(file ?? fallback(), "utf8").catch(() => undefined)
  if (text === undefined) return undefined
  try {
    return JSON.parse(text) as Info
  } catch {
    return undefined
  }
}

async function registered(file?: string, timeout?: number) {
  const info = await read(file)
  if (info === undefined) return { info: undefined, service: undefined, timedOut: false }
  return { info, ...(await probeResult(info, timeout)) }
}

function signal(pid: number, name: NodeJS.Signals) {
  try {
    process.kill(pid, name)
  } catch {}
}

function stopped(pid: number) {
  try {
    process.kill(pid, 0)
    return false
  } catch {
    return true
  }
}

async function waitUntilStopped(pid: number, timing: EnsureTiming) {
  for (let attempt = 0; attempt <= timing.stopPollAttempts; attempt++) {
    if (stopped(pid)) return true
    if (attempt < timing.stopPollAttempts) await delay(timing.stopPollInterval)
  }
  return false
}

async function terminate(info: Info, options: { readonly file?: string }, timing: EnsureTiming) {
  const current = await read(options.file)
  if (current === undefined || !same(current, info)) return
  signal(info.pid, "SIGTERM")
  // The registration can disappear or change hands before this process exits. Only the PID we
  // signalled can tell us whether it has stopped, so escalate based on that process.
  if (!(await waitUntilStopped(info.pid, timing))) {
    signal(info.pid, "SIGKILL")
    if (!(await waitUntilStopped(info.pid, timing))) throw new Error(`Server process ${info.pid} is still running`)
  }
  const latest = await read(options.file)
  if (latest === undefined || !same(latest, info)) return
  await rm(options.file ?? fallback(), { force: true })
}

function delay(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds))
}

/** Promise-based local service lifecycle operations. */
export const Service = { discover, ensure, stop, headers }
