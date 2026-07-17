import { readFile } from "node:fs/promises"
import { spawn, type ChildProcess } from "node:child_process"
import { homedir } from "node:os"
import { join } from "node:path"
import type { DiscoverOptions, Endpoint, Info, EnsureOptions, StopOptions } from "../service.js"
import type { ServiceHealth, ServiceStopResponse } from "./generated/types.js"

export * from "../service.js"

// Find, start, and stop the local opencode background service.
//
// The registration file is the complete discovery contract. This module is
// intentionally implemented with Node APIs so Promise clients do not need
// Effect or @effect/platform-node at runtime.

type Contender = {
  readonly child: ChildProcess
  readonly error: () => Error | undefined
}

/** Discover a healthy, compatible local service without starting one. */
export async function discover(options: DiscoverOptions = {}) {
  return (await discoverLocal(options))?.endpoint
}

async function discoverLocal(options: DiscoverOptions) {
  const found = (await registered(options.file)).service
  if (found?.state !== "ready") return undefined
  if (options.version !== undefined && found.version !== options.version) return undefined
  return found
}

/** Ensure a healthy, compatible local service is running. */
export async function ensure(options: EnsureOptions = {}): Promise<Endpoint> {
  const deadline = Date.now() + 120_000
  const contenders = new Set<Contender>()
  let announced = false
  let lastSpawn = 0
  let spawnDelay = 5_000
  let ownerHeld = false

  const announce = (reason: "missing" | "version-mismatch", previousVersion?: string) => {
    if (announced) return
    announced = true
    options.onStart?.(reason, previousVersion)
  }
  const spawnContender = () => {
    const [command, ...args] = options.command ?? ["opencode", "serve", "--service"]
    if (command === undefined) throw new Error("Missing service command")
    try {
      const child = spawn(command, args, { detached: true, stdio: "ignore" })
      let error: Error | undefined
      child.once("error", (cause) => {
        error = new Error("Failed to start server", { cause })
      })
      child.unref()
      return { child, error: () => error }
    } catch (cause) {
      throw new Error("Failed to start server", { cause })
    }
  }

  while (true) {
    if (Date.now() >= deadline) throw new Error("Timed out waiting for the background service to start")
    const registration = await registered(options.file, true)

    if (registration.service !== undefined) {
      ownerHeld = false
      spawnDelay = 5_000
      const service = registration.service
      const compatible = !service.legacy && (options.version === undefined || service.version === options.version)
      if (compatible && service.state === "ready") return service.endpoint
      if (compatible && service.state === "failed") throw new Error("Background service failed to start")
      if (!compatible) {
        announce("version-mismatch", service.version)
        await kill(service, options).catch(() => undefined)
        lastSpawn = 0
      }
    } else {
      if (lastSpawn === 0 && registration.info !== undefined) lastSpawn = Date.now()
      const failure = [...contenders].map(contenderFailure).find((error) => error !== undefined)
      if (failure !== undefined) throw failure
      const finished = [...contenders].filter(contenderFinished)
      if (finished.some((item) => item.child.exitCode === 0)) {
        ownerHeld = true
        spawnDelay = Math.min(spawnDelay * 2, 30_000)
      }
      finished.forEach((item) => contenders.delete(item))
      // Keep one candidate plus one lock probe so a pre-lock stall cannot block recovery.
      if (contenders.size < 2 && Date.now() - lastSpawn >= spawnDelay) {
        announce("missing")
        contenders.add(spawnContender())
        lastSpawn = Date.now()
      }
    }
    await delay(1_000)
  }
}

function contenderFailure(contender: Contender) {
  const error = contender.error()
  if (error !== undefined) return error
  if (contender.child.exitCode !== null && contender.child.exitCode !== 0)
    return new Error(`Server process exited with code ${contender.child.exitCode}`)
  if (contender.child.signalCode !== null)
    return new Error(`Server process terminated by ${contender.child.signalCode}`)
  return undefined
}

function contenderFinished(contender: Contender) {
  return contender.error() !== undefined || contender.child.exitCode !== null || contender.child.signalCode !== null
}

/** Stop the registered local service. */
export async function stop(options: StopOptions = {}) {
  const existing = await find(options)
  if (existing !== undefined) await kill(existing, options)
}

function fallback() {
  return join(process.env["XDG_STATE_HOME"] ?? join(homedir(), ".local", "state"), "opencode", "service.json")
}

/** Create HTTP authentication headers for a service endpoint. */
export function headers(endpoint: Endpoint) {
  if (endpoint.auth === undefined) return undefined
  return {
    authorization: "Basic " + Buffer.from(endpoint.auth.username + ":" + endpoint.auth.password).toString("base64"),
  }
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

type LocalService = {
  readonly info: Info
  readonly endpoint: Endpoint
  readonly version?: string
  readonly state: "ready" | "waiting" | "failed"
  readonly legacy: boolean
}

async function probe(info: Info, allowLegacy = false): Promise<LocalService | undefined> {
  const endpoint = {
    url: info.url,
    auth:
      info.password === undefined
        ? undefined
        : { type: "basic" as const, username: "opencode", password: info.password },
  } satisfies Endpoint
  const response = await fetch(new URL("/api/health", info.url), {
    headers: headers(endpoint),
    signal: AbortSignal.timeout(2_000),
  }).catch(() => undefined)
  const body = (await response?.json().catch(() => undefined)) as ServiceHealth | { readonly healthy: true } | undefined
  if (body !== undefined && "version" in body && "pid" in body) {
    if (body.pid !== info.pid) return undefined
    if (info.version !== undefined && body.version !== info.version) return undefined
    return {
      info,
      endpoint,
      version: body.version,
      state: response?.ok ? "ready" : response?.status === 500 ? "failed" : "waiting",
      legacy: false,
    }
  }
  if (!allowLegacy || body?.healthy !== true) return undefined
  return { info, endpoint, state: "ready", legacy: true }
}

async function registered(file?: string, allowLegacy = false) {
  const info = await read(file)
  if (info === undefined) return { info: undefined, service: undefined }
  return { info, service: await probe(info, allowLegacy) }
}

async function find(options: { readonly file?: string }) {
  return (await registered(options.file, true)).service
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

async function waitUntilStopped(pid: number) {
  for (let attempt = 0; attempt <= 100; attempt++) {
    if (stopped(pid)) return true
    if (attempt < 100) await delay(50)
  }
  return false
}

function same(left: Info, right: Info) {
  return left.id === right.id && left.version === right.version && left.url === right.url && left.pid === right.pid
}

async function kill(service: LocalService, options: { readonly file?: string }) {
  const requested = await requestStop(service)
  if (requested === "rejected") return
  if (requested === "unsupported") {
    const current = await find(options)
    if (current === undefined || !same(current.info, service.info)) return
    signal(service.info.pid, "SIGTERM")
  }
  if (await waitUntilStopped(service.info.pid)) return

  const latest = await find(options)
  if (latest === undefined || !same(latest.info, service.info)) return
  signal(service.info.pid, "SIGKILL")
  if (!(await waitUntilStopped(service.info.pid)))
    throw new Error(`Server process ${service.info.pid} is still running`)
}

async function requestStop(service: LocalService) {
  if (service.info.id === undefined || service.legacy) return "unsupported" as const
  const response = await fetch(new URL("/api/service/stop", service.info.url), {
    method: "POST",
    headers: { ...headers(service.endpoint), "content-type": "application/json" },
    body: JSON.stringify({ instanceID: service.info.id }),
    signal: AbortSignal.timeout(2_000),
  }).catch(() => undefined)
  if (response === undefined || response.status === 404 || response.status === 405) return "unsupported" as const
  const body = (await response.json().catch(() => undefined)) as ServiceStopResponse | undefined
  if (!response.ok || body?.accepted !== true) return "rejected" as const
  return "accepted" as const
}

function delay(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds))
}

/** Promise-based local service lifecycle operations. */
export const Service = { discover, ensure, stop, headers }
