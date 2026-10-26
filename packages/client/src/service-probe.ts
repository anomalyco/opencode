import { homedir } from "node:os"
import { execFile } from "node:child_process"
import { readdir, readFile, readlink } from "node:fs/promises"
import { join } from "node:path"
import { promisify } from "node:util"
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

/**
 * Whether the process still exists. Unknown errors count as alive: callers use a negative answer
 * to justify replacing the service, so guessing "gone" is the dangerous direction.
 */
export function alive(pid: number) {
  // The registration file is plain JSON, so the pid is not guaranteed to be usable. Signalling 0
  // targets the caller's whole process group.
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return !(typeof error === "object" && error !== null && "code" in error && error.code === "ESRCH")
  }
}

/** Whether the registered process owns the listener advertised by the registration. */
export async function ownsListeningPort(info: Info) {
  const port = registeredPort(info.url)
  if (port === undefined) return false
  if (process.platform === "win32") return windowsListeners(port).then((pids) => pids.includes(info.pid))
  if (process.platform === "linux") return linuxOwnsListener(info.pid, port)
  return lsofListeners(port).then((pids) => pids?.includes(info.pid))
}

/** Ask a registered owner for its health and classify the answer. */
export async function probeResult(info: Info, timeout = defaultEnsureTiming.requestTimeout) {
  const endpoint = {
    url: info.url,
    auth: info.password === undefined ? undefined : { type: "basic", username: "opencode", password: info.password },
  } satisfies Endpoint
  const startedAt = Date.now()
  const signal = AbortSignal.timeout(timeout)
  const result = await fetch(new URL("/api/info", info.url), {
    // A socket left over from a suspend can time out without reaching the recovered service.
    headers: { ...headers(endpoint), connection: "close" },
    signal,
  })
    .then(async (response) => ({
      response,
      body: response.status === 404 ? undefined : ((await response.json()) as unknown),
    }))
    .catch(() => undefined)
  if (result === undefined) {
    const stalled = Date.now() - startedAt > timeout + 1_000
    return { service: undefined, timedOut: signal.aborted && !stalled, stalled }
  }
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
      stalled: false,
    }
  const serverInfo = decodeInfo(result.body)
  if (serverInfo === undefined) return { service: undefined, timedOut: false, stalled: false }
  if (serverInfo.pid !== info.pid) return { service: undefined, timedOut: false, stalled: false }
  if (info.version !== undefined && serverInfo.version !== info.version)
    return { service: undefined, timedOut: false, stalled: false }
  return {
    service: {
      info,
      endpoint,
      version: serverInfo.version,
      state: response.ok ? "ready" : response.status === 500 ? "failed" : "waiting",
      compatible: true,
    } satisfies LocalService,
    timedOut: false,
    stalled: false,
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

function registeredPort(url: string) {
  try {
    const parsed = new URL(url)
    const port = Number(parsed.port || (parsed.protocol === "https:" ? 443 : 80))
    return Number.isInteger(port) && port > 0 && port <= 65_535 ? port : undefined
  } catch {
    return undefined
  }
}

async function lsofListeners(port: number) {
  try {
    const result = await promisify(execFile)("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-Fp"], {
      timeout: 1_000,
      maxBuffer: 4_096,
      windowsHide: true,
    })
    return result.stdout
      .split("\n")
      .filter((line) => line.startsWith("p"))
      .map((line) => Number(line.slice(1)))
      .filter(Number.isInteger)
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") return undefined
    return []
  }
}

async function linuxOwnsListener(pid: number, port: number) {
  try {
    const inodes = new Set(
      (
        await Promise.all(
          (await readdir(`/proc/${pid}/fd`)).map((fd) =>
            readlink(`/proc/${pid}/fd/${fd}`).catch(() => ""),
          ),
        )
      )
        .map((target) => /^socket:\[(\d+)\]$/.exec(target)?.[1])
        .filter((inode): inode is string => inode !== undefined),
    )
    const tables = await Promise.all(["/proc/net/tcp", "/proc/net/tcp6"].map((file) => readFile(file, "utf8")))
    return tables.some((table) =>
      table.split("\n").some((line) => {
        const fields = line.trim().split(/\s+/)
        return (
          fields[3] === "0A" &&
          Number.parseInt(fields[1]?.split(":")[1] ?? "", 16) === port &&
          inodes.has(fields[9] ?? "")
        )
      }),
    )
  } catch {
    return false
  }
}

async function windowsListeners(port: number) {
  try {
    const result = await promisify(execFile)("netstat", ["-ano", "-p", "tcp"], {
      timeout: 1_000,
      maxBuffer: 1_048_576,
      windowsHide: true,
    })
    return result.stdout
      .split("\n")
      .map((line) => line.trim().split(/\s+/))
      .filter((fields) => fields[0] === "TCP" && fields[3] === "LISTENING" && fields[1]?.endsWith(`:${port}`))
      .map((fields) => Number(fields[4]))
      .filter(Number.isInteger)
  } catch {
    return []
  }
}
