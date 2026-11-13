import { readFile, rm, writeFile } from "node:fs/promises"
import type { Info } from "./service.js"
import type { EnsureTiming } from "./service-timing.js"
import { probeHealth, same, type Health } from "./service-probe.js"

// Shared by the Effect and Promise clients. Keep this module free of Effect so the
// Promise client never loads the Effect runtime.

/**
 * Decides when a registered owner whose `/api/info` probes time out is hung, rather than busy. Silence alone cannot
 * tell them apart: the main thread that serves `/api/info` also runs SQLite synchronously, so a slow disk silences a
 * healthy service. The owner's health thread answers regardless and reports how long its main thread has been blocked
 * and whether it is waiting on disk. Only an owner without that report (an older service, or a process frozen whole)
 * is judged by how long it has been silent.
 */
export function hangDetector(timing: EnsureTiming) {
  let silent: { readonly info: Info; readonly since: number } | undefined
  let health: Health | undefined
  return {
    /** The owner answered, or no owner is registered. */
    answered() {
      silent = undefined
      health = undefined
    },
    /** Whether `info`, whose latest `/api/info` probe timed out, is hung. */
    async hung(info: Info) {
      if (silent === undefined || !same(silent.info, info)) silent = { info, since: Date.now() }
      health = await probeHealth(info, timing.requestTimeout)
      // No signal lands on a thread waiting on disk, and a replacement would wait on the same disk.
      if (health !== undefined) return !health.disk && health.blocked >= timing.hangTimeout
      if (await blockedOnDisk(info.pid)) silent = { info, since: Date.now() }
      return Date.now() - silent.since >= timing.unresponsiveTimeout
    },
    /** Why `ensure()` gave up while the owner it left running did not answer, if it did. */
    stuck() {
      if (silent === undefined) return undefined
      const pid = silent.info.pid
      if (health?.disk)
        return new Error(
          `Background service ${pid} is running, but has been waiting on disk for ${seconds(health.blocked)}s. It was left running: it cannot stop before the disk responds.`,
        )
      if (health !== undefined)
        return new Error(`Background service ${pid} is running, but has been busy for ${seconds(health.blocked)}s.`)
      return new Error(
        `Background service ${pid} is running, but has not answered for ${seconds(Date.now() - silent.since)}s.`,
      )
    },
  }
}

/**
 * The right to replace a hung owner, held by one client at a time through `<registration>.recovery`. Every connected
 * client probes the same owner; without it each one kills the owner and starts its own contenders, which race for the
 * service slot on a machine that is likely already overloaded.
 */
export function recoveryLock(registration: string) {
  const file = registration + ".recovery"
  let held = false
  return {
    /** Takes the lock unless another live client holds it. */
    async acquire() {
      if (held) return true
      held = await create()
      if (held || (await holderAlive())) return held
      await rm(file, { force: true })
      held = await create()
      return held
    },
    /** Whether another live client is replacing the owner now, so this one should wait for its result. */
    async busy() {
      return !held && (await holderAlive())
    },
    async release() {
      if (!held) return
      held = false
      await rm(file, { force: true })
    },
  }

  // A lock the filesystem refuses for any other reason than an existing holder must not block recovery.
  function create() {
    return writeFile(file, String(process.pid), { flag: "wx", mode: 0o600 }).then(
      () => true,
      (error: NodeJS.ErrnoException) => error.code !== "EEXIST",
    )
  }

  // A client that dies while recovering leaves its lock behind.
  async function holderAlive() {
    const pid = Number(await readFile(file, "utf8").catch(() => ""))
    return Number.isInteger(pid) && pid > 0 && alive(pid)
  }
}

/**
 * Whether `pid` is blocked in uninterruptible IO (Linux state `D`). Such a process is busy, not hung: no
 * signal, not even SIGKILL, lands before its IO returns. Always false where `/proc` is missing.
 */
async function blockedOnDisk(pid: number) {
  const stat = await readFile(`/proc/${pid}/stat`, "utf8").catch(() => undefined)
  // The state follows the command name, which is in parentheses and may contain ") " itself.
  return stat?.split(") ").at(-1)?.startsWith("D") === true
}

function alive(pid: number) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    // The process exists but belongs to someone else.
    return error instanceof Error && "code" in error && error.code === "EPERM"
  }
}

function seconds(milliseconds: number) {
  return Math.round(milliseconds / 1_000)
}
