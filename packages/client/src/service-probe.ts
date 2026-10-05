import { homedir } from "node:os"
import { join } from "node:path"
import type { Endpoint, Info } from "./service.js"
import { defaultEnsureTiming } from "./service-timing.js"

// Shared by the Effect and Promise clients. Keep this module free of Effect so the
// Promise client never loads the Effect runtime.

export type LocalService = {
  readonly info: Info
  readonly endpoint: Endpoint
  readonly version?: string
  readonly state: "ready" | "waiting" | "failed"
  readonly compatible: boolean
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
