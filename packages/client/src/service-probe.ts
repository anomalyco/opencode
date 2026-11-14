import { readFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"
import type { DiscoverOptions, Endpoint, Info } from "./service.js"
import { defaultEnsureTiming } from "./service-timing.js"
import { matchesVersion } from "./service-version.js"

// Shared by the Effect and Promise clients. Keep this module free of Effect so the
// Promise client never loads the Effect runtime.

export type LocalService = {
  readonly info: Info
  readonly endpoint: Endpoint
  readonly version?: string
  readonly state: "ready" | "waiting" | "failed"
  readonly compatible: boolean
}

/**
 * What `ensure()` does with a registered service that answered: return it, keep polling while
 * it starts, replace it because its version does not meet the requirement, or fail.
 */
export function decide(service: LocalService, options: DiscoverOptions) {
  if (!matchesVersion(service.version, options))
    return { _tag: "replace", pty: service.state === "ready" ? "handoff" : "clear" } as const
  if (!service.compatible)
    return fail(
      "Background service uses an incompatible health protocol. Update this client or explicitly restart the service.",
    )
  if (service.state === "ready") return { _tag: "reuse" } as const
  if (service.state === "failed") return fail("Background service failed to start")
  return { _tag: "wait" } as const
}

function fail(message: string) {
  return { _tag: "fail" as const, error: new Error(message) }
}

/** The default registration file. */
export function fallback() {
  return join(process.env["XDG_STATE_HOME"] ?? join(homedir(), ".local", "state"), "opencode", "service.json")
}

/** Whether two registrations describe the same service instance. */
export function same(left: Info, right: Info) {
  return left.id === right.id && left.version === right.version && left.url === right.url && left.pid === right.pid
}

/** Ask a registered owner for its health and classify the answer. */
export async function probeResult(info: Info, timeout = defaultEnsureTiming.requestTimeout) {
  const endpoint = {
    url: info.url,
    auth: info.password === undefined ? undefined : { type: "basic", username: "opencode", password: info.password },
  } satisfies Endpoint
  const signal = AbortSignal.timeout(timeout)
  const result = await fetch(new URL("/api/info", info.url), { headers: headers(endpoint), signal })
    .then(async (response) => ({
      response,
      body: response.status === 404 ? undefined : ((await response.json()) as unknown),
    }))
    .catch(() => undefined)
  if (result === undefined) return { service: undefined, timedOut: signal.aborted }
  const response = result.response
  // A missing health endpoint identifies protocol incompatibility, not an older
  // version. Only an unmet version requirement lets ensure replace this owner.
  if (response.status === 404)
    return {
      service: {
        info,
        endpoint,
        version: info.version,
        state: "ready",
        compatible: false,
      } satisfies LocalService,
      timedOut: false,
    }
  const serverInfo = decodeInfo(result.body)
  if (serverInfo === undefined) return { service: undefined, timedOut: false }
  if (serverInfo.pid !== info.pid) return { service: undefined, timedOut: false }
  if (info.version !== undefined && serverInfo.version !== info.version) return { service: undefined, timedOut: false }
  return {
    service: {
      info,
      endpoint,
      version: serverInfo.version,
      state: response.ok ? "ready" : response.status === 500 ? "failed" : "waiting",
      compatible: true,
    } satisfies LocalService,
    timedOut: false,
  }
}

/** Create HTTP authentication headers for a service endpoint. */
export function headers(endpoint: Endpoint) {
  if (endpoint.auth === undefined) return undefined
  return {
    authorization: "Basic " + Buffer.from(endpoint.auth.username + ":" + endpoint.auth.password).toString("base64"),
  }
}

function decodeInfo(input: unknown) {
  if (typeof input !== "object" || input === null) return
  if (!("version" in input) || typeof input.version !== "string") return
  if (!("pid" in input) || typeof input.pid !== "number" || !Number.isInteger(input.pid) || input.pid < 0) return
  return { version: input.version, pid: input.pid }
}

/**
 * Parse the single-character task state from Linux `/proc/<pid>/stat`.
 * `comm` is enclosed in parentheses and may itself contain spaces or `)`, so scan from the final `)`.
 */
export function parseLinuxProcStatState(stat: string) {
  const close = stat.lastIndexOf(")")
  if (close === -1) return undefined
  const state = stat[close + 2]
  return state && state !== " " ? state : undefined
}

/**
 * Tracks how long one registered owner has accepted connections without answering its health probe.
 * An owner that answers, or a different owner, starts the clock over. Time the owner spends in disk sleep
 * does not count: it is waiting for the disk, not hung, and a check only at the end of the budget would
 * evict it the moment the disk catches up.
 */
export function unresponsiveOwner(budget: number) {
  let current:
    | {
        readonly info: Info
        readonly since: number
        readonly last: number
        readonly counted: number
        readonly past: boolean
      }
    | undefined
  return {
    /**
     * Records a probe that began at `probedAt`, timed out for `info` (or answered, when `info` is undefined), and
     * whether the owner was then in disk sleep. Returns the owner once its counted time reaches the budget.
     */
    observe(info: Info | undefined, probedAt: number, now: number, diskSleep: boolean) {
      if (info === undefined) {
        current = undefined
        return undefined
      }
      const previous =
        current !== undefined && same(current.info, info)
          ? current
          : { info, since: probedAt, last: probedAt, counted: 0, past: false }
      const counted = previous.counted + (diskSleep ? 0 : now - previous.last)
      current = {
        info,
        since: previous.since,
        last: now,
        counted,
        past: counted >= budget || now - previous.since >= budget,
      }
      return counted >= budget ? info : undefined
    },
    /**
     * Whether no probe has yet seen the owner past its budget, so the startup deadline waits for the probe that may
     * evict it. Wall time also ends the wait, so an owner that stays in disk sleep cannot hold the deadline forever.
     */
    waiting() {
      return current !== undefined && !current.past
    },
    forget() {
      current = undefined
    },
  }
}

/**
 * Whether `pid` is currently in Linux uninterruptible disk sleep (`state D`). Always false elsewhere.
 * It is one sample per probe, so the time it excludes from an unresponsive budget is an estimate.
 */
export async function isUninterruptibleDiskSleep(pid: number) {
  if (process.platform !== "linux") return false
  const stat = await readFile(`/proc/${pid}/stat`, "utf8").catch(() => undefined)
  return stat !== undefined && parseLinuxProcStatState(stat) === "D"
}
