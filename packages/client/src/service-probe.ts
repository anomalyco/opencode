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

/** Whether a string is a valid HTTP(S) service base URL. */
export function isServiceUrl(value: string) {
  return probeUrl(value) !== undefined
}

/** Parse and validate a local service registration JSON string. */
export function parseRegistration(text: string): Info | undefined {
  const value = parseJson(text)
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined
  if (!("url" in value) || typeof value.url !== "string" || !isServiceUrl(value.url)) return undefined
  if (!("pid" in value) || typeof value.pid !== "number" || !Number.isInteger(value.pid) || value.pid <= 0)
    return undefined
  if ("id" in value && typeof value.id !== "string") return undefined
  if ("version" in value && typeof value.version !== "string") return undefined
  if ("password" in value && typeof value.password !== "string") return undefined
  return {
    ...("id" in value && typeof value.id === "string" ? { id: value.id } : {}),
    ...("version" in value && typeof value.version === "string" ? { version: value.version } : {}),
    url: value.url,
    pid: value.pid,
    ...("password" in value && typeof value.password === "string" ? { password: value.password } : {}),
  }
}

/** Ask a registered owner for its health and classify the answer. */
export async function probeResult(info: Info, timeout = defaultEnsureTiming.requestTimeout) {
  const url = probeUrl(info.url)
  if (url === undefined) return { service: undefined, timedOut: false }
  const endpoint = {
    url: info.url,
    auth: info.password === undefined ? undefined : { type: "basic", username: "opencode", password: info.password },
  } satisfies Endpoint
  const signal = AbortSignal.timeout(timeout)
  const result = await fetch(url, { headers: headers(endpoint), signal })
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

function probeUrl(value: string) {
  if (!URL.canParse("/api/info", value)) return undefined
  const url = new URL("/api/info", value)
  if (url.protocol !== "http:" && url.protocol !== "https:") return undefined
  return url
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}
