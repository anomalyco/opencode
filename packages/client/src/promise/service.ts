import { readFile, rm } from "node:fs/promises"
import type { DiscoverOptions, Endpoint, Info, EnsureOptions, StopOptions } from "../service.js"
import { contenderPool, spawnServiceContender } from "../service-contender.js"
import { recoveryPolicy } from "../service-recovery.js"
import { defaultEnsureTiming, ensureTiming, type EnsureTiming } from "../service-timing.js"
import { matchesVersion } from "../service-version.js"
import { PtyHandoff } from "../pty-handoff.js"
import { alive, decide, fallback, headers, probeResult, same } from "../service-probe.js"

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
  const recovery = recoveryPolicy(timing)
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
      let waitingOnOwner = false
      if (registration.timedOut && registration.info !== undefined) {
        const owner = registration.info
        // A registered owner that still exists is busy, not gone: a long request can keep
        // /api/info unanswered well past the probe timeout, and on Windows SIGTERM ends the
        // process at once with no shutdown. Wait for it, and do not race it with new contenders.
        // Only a contender this call started, or a registration whose process is gone, yields.
        const ownerAlive = !pool.owns(owner.pid) && alive(owner.pid)
        if (
          ownerAlive &&
          !recovery.observe({
            now: performance.now(),
            info: owner,
            timedOut: registration.timedOut,
            stalled: registration.stalled,
            alive: ownerAlive,
          })
        ) {
          waitingOnOwner = true
          timeouts = undefined
        } else if (ownerAlive) {
          announce("missing")
          console.warn("Background service is unresponsive; replacing its registration")
          await abandon(owner, options)
          pool.evict(owner.pid)
          pool.recruitNow()
          recovery.replaced()
          timeouts = undefined
        } else {
          timeouts = {
            info: owner,
            count: timeouts !== undefined && same(timeouts.info, owner) ? timeouts.count + 1 : 1,
          }
          if (timeouts.count >= 3) {
            announce("missing")
            console.warn("Background service is unresponsive; recovery cannot preserve persistent terminals")
            await PtyHandoff.clear(options.file ?? fallback())
            await terminate(owner, options, timing)
            pool.evict(owner.pid)
            pool.recruitNow()
            timeouts = undefined
          }
        }
      } else {
        recovery.observe({
          now: performance.now(),
          info: registration.info,
          timedOut: registration.timedOut,
          stalled: registration.stalled,
          alive: false,
        })
        timeouts = undefined
      }

      if (registration.service !== undefined) {
        pool.serviceAnswered()
        const service = registration.service
        const decision = decide(service, options)
        if (decision._tag === "fail") throw decision.error
        if (decision._tag === "reuse") {
          await PtyHandoff.complete(options.file ?? fallback(), service.info)
          return service.endpoint
        }
        if (decision._tag === "replace") {
          announce("version-mismatch", service.version)
          if (service.state !== "ready")
            console.warn("Background service is not ready; replacement cannot preserve persistent terminals")
          await stop({ file: options.file, pty: decision.pty }).catch(() => undefined)
          pool.evict(service.info.pid)
        }
      } else if (!waitingOnOwner) {
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
  if (info === undefined) return { info: undefined, service: undefined, timedOut: false, stalled: false }
  return { info, ...(await probeResult(info, timeout)) }
}

async function abandon(info: Info, options: { readonly file?: string }) {
  const current = await read(options.file)
  if (current === undefined || !same(current, info)) return
  // A stale registration can name a PID that now belongs to an unrelated process. Removing the
  // registration lets a new service take over without risking a signal to that process.
  await PtyHandoff.clear(options.file ?? fallback())
  await rm(options.file ?? fallback(), { force: true })
}

function signal(pid: number, name: NodeJS.Signals) {
  try {
    process.kill(pid, name)
  } catch {}
}

function stopped(pid: number) {
  return !alive(pid)
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
  // Never signal a PID that no longer exists: it may already belong to an unrelated process.
  if (alive(info.pid)) {
    signal(info.pid, "SIGTERM")
    // The registration can disappear or change hands before this process exits. Only the PID we
    // signalled can tell us whether it has stopped, so escalate based on that process.
    if (!(await waitUntilStopped(info.pid, timing))) {
      signal(info.pid, "SIGKILL")
      if (!(await waitUntilStopped(info.pid, timing))) throw new Error(`Server process ${info.pid} is still running`)
    }
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
