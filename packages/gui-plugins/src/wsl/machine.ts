import type {
  WslDistroProbe,
  WslInstalledDistro,
  WslOnlineDistro,
  WslOpencodeCheck,
  WslRuntimeCheck,
  WslServerConfig,
  WslServerRuntime,
  WslServersState,
} from "./contract"

/** A configured distro's server while no job owns it. `attempt` names the start that brought it up. */
export type WslServer =
  | { readonly kind: "stopped" }
  | { readonly kind: "failed"; readonly message: string }
  | { readonly kind: "ready"; readonly attempt: string; readonly url: string; readonly password: string }

/**
 * The one job a distro runs at a time. Its `attempt` fences completions: a result for any other attempt is stale.
 * `updating`, `starting` and `removing` own the distro's server until they settle; it is down meanwhile.
 */
export type WslDistro =
  | { readonly status: "idle"; readonly server: WslServer }
  | { readonly status: "probing"; readonly attempt: string; readonly server: WslServer }
  | { readonly status: "installing"; readonly attempt: string }
  | { readonly status: "updating"; readonly attempt: string }
  | { readonly status: "starting"; readonly attempt: string }
  | { readonly status: "removing"; readonly attempt: string }

/** WSL itself: probing the runtime, listing distros or installing WSL, one at a time. */
export type WslHost = { readonly status: "idle" } | { readonly status: "busy"; readonly attempt: string }

export type WslHostJob = "probe-runtime" | "refresh-distros" | "install-wsl"

type Data = {
  readonly runtime: WslRuntimeCheck | null
  readonly installed: readonly WslInstalledDistro[]
  readonly online: readonly WslOnlineDistro[]
  readonly distroProbes: Readonly<Record<string, WslDistroProbe>>
  readonly opencodeChecks: Readonly<Record<string, WslOpencodeCheck>>
  readonly pendingRestart: boolean
  readonly configured: readonly WslServerConfig[]
}

/** Open until main stops the servers for good, on disable, reload or quit. */
export type WslMachineState =
  | (Data & {
      readonly status: "open"
      readonly host: WslHost
      readonly distros: Readonly<Record<string, WslDistro>>
    })
  | (Data & { readonly status: "closed" })

type OpenState = Extract<WslMachineState, { status: "open" }>

/** Requests carry a fresh `attempt`, which becomes the job's attempt when the machine accepts it. */
export type WslMachineEvent =
  | { readonly type: "host"; readonly attempt: string; readonly job: WslHostJob }
  | { readonly type: "probe"; readonly distro: string; readonly attempt: string }
  | { readonly type: "install-distro"; readonly distro: string; readonly attempt: string }
  | { readonly type: "update"; readonly distro: string; readonly attempt: string }
  | { readonly type: "add"; readonly config: WslServerConfig; readonly attempt: string }
  | { readonly type: "start"; readonly id: string; readonly attempt: string }
  | { readonly type: "remove"; readonly id: string; readonly attempt: string }
  | { readonly type: "close" }
  | { readonly type: "runtime.probed"; readonly attempt: string; readonly runtime: WslRuntimeCheck }
  | { readonly type: "runtime.installed"; readonly attempt: string; readonly runtime: WslRuntimeCheck }
  | {
      readonly type: "distros.listed"
      readonly attempt: string
      readonly installed: readonly WslInstalledDistro[]
      readonly online: readonly WslOnlineDistro[]
    }
  | { readonly type: "host.failed"; readonly attempt: string; readonly message: string }
  | {
      readonly type: "distro.probed"
      readonly distro: string
      readonly attempt: string
      readonly probe: WslDistroProbe
    }
  | {
      readonly type: "cli.inspected"
      readonly distro: string
      readonly attempt: string
      readonly check: WslOpencodeCheck
    }
  | {
      readonly type: "distro.installed"
      readonly distro: string
      readonly attempt: string
      readonly installed: readonly WslInstalledDistro[]
      readonly online: readonly WslOnlineDistro[]
      readonly probe: WslDistroProbe
    }
  | {
      readonly type: "cli.installed"
      readonly distro: string
      readonly attempt: string
      readonly check: WslOpencodeCheck
    }
  | {
      readonly type: "job.failed"
      readonly distro: string
      readonly attempt: string
      readonly message: string
      readonly check?: WslOpencodeCheck
    }
  | { readonly type: "server.stopped"; readonly distro: string; readonly attempt: string }
  | {
      readonly type: "server.spawned"
      readonly distro: string
      readonly attempt: string
      readonly url: string
      readonly password: string
    }
  | { readonly type: "server.failed"; readonly distro: string; readonly attempt: string; readonly message: string }
  | {
      readonly type: "server.exited"
      readonly distro: string
      readonly attempt: string
      readonly code: number | null
      readonly signal: string | null
      readonly message: string
    }
  | { readonly type: "cli.checked"; readonly distro: string; readonly check: WslOpencodeCheck }

export type WslFailure =
  | { readonly kind: "busy"; readonly distro: string }
  | { readonly kind: "already-added"; readonly distro: string }
  | { readonly kind: "unavailable" }
  | { readonly kind: "error"; readonly message: string }

export type WslMachineEffect =
  | { readonly type: "host"; readonly attempt: string; readonly job: WslHostJob }
  | { readonly type: "probe-distro"; readonly distro: string; readonly attempt: string }
  | { readonly type: "inspect-cli"; readonly distro: string; readonly attempt: string }
  | { readonly type: "install-distro"; readonly distro: string; readonly attempt: string }
  | { readonly type: "install-cli"; readonly distro: string; readonly attempt: string }
  /** Stops the server of start `server`, whether it is still starting or up, then reports `server.stopped`. */
  | { readonly type: "stop"; readonly distro: string; readonly attempt: string; readonly server: string }
  | { readonly type: "spawn"; readonly distro: string; readonly attempt: string }
  | { readonly type: "check-cli"; readonly distro: string }
  | { readonly type: "persist"; readonly servers: readonly WslServerConfig[] }
  | {
      readonly type: "log"
      readonly level: "info" | "error"
      readonly message: string
      readonly data: Readonly<Record<string, string | number | null>>
    }
  | { readonly type: "resolve"; readonly attempt: string }
  | { readonly type: "reject"; readonly attempt: string; readonly failure: WslFailure }

export type WslMachineTransition = {
  readonly state: WslMachineState
  readonly effects: readonly WslMachineEffect[]
}

const STOPPED: WslServer = { kind: "stopped" }

const IDLE: WslDistro = { status: "idle", server: STOPPED }

export function createWslMachineState(configured: readonly WslServerConfig[]): WslMachineState {
  return {
    status: "open",
    runtime: null,
    installed: [],
    online: [],
    distroProbes: {},
    opencodeChecks: {},
    pendingRestart: false,
    configured,
    host: { status: "idle" },
    distros: {},
  }
}

export function transitionWslMachine(state: WslMachineState, event: WslMachineEvent): WslMachineTransition {
  if (state.status === "closed") return closed(state, event)

  if (event.type === "close") return close(state)

  if (event.type === "host") return hostRequested(state, event)

  if (event.type === "runtime.probed") {
    return hostSettled(state, event.attempt, {
      runtime: event.runtime,
      pendingRestart: state.pendingRestart && !event.runtime.available,
    })
  }

  if (event.type === "runtime.installed") {
    return hostSettled(state, event.attempt, { runtime: event.runtime, pendingRestart: !event.runtime.available })
  }

  if (event.type === "distros.listed") {
    return hostSettled(state, event.attempt, { installed: event.installed, online: event.online })
  }

  if (event.type === "host.failed") return hostFailed(state, event.attempt, event.message)

  if (event.type === "probe") return probe(state, event.distro, event.attempt)

  if (event.type === "distro.probed") return distroProbed(state, event)

  if (event.type === "cli.inspected") return cliInspected(state, event)

  if (event.type === "install-distro") return installDistro(state, event.distro, event.attempt)

  if (event.type === "distro.installed") return distroInstalled(state, event)

  if (event.type === "update") return update(state, event.distro, event.attempt)

  if (event.type === "cli.installed") return cliInstalled(state, event)

  if (event.type === "job.failed") return jobFailed(state, event)

  if (event.type === "add") return add(state, event.config, event.attempt)

  if (event.type === "start") return start(state, event.id, event.attempt)

  if (event.type === "remove") return remove(state, event.id, event.attempt)

  if (event.type === "server.stopped") return serverStopped(state, event.distro, event.attempt)

  if (event.type === "server.spawned") return serverSpawned(state, event)

  if (event.type === "server.failed") return serverFailed(state, event)

  if (event.type === "server.exited") return serverExited(state, event)

  return cliChecked(state, event.distro, event.check)
}

/** What windows see: the machine's data, each configured server's runtime, and the jobs running now. */
export function toServersState(state: WslMachineState): WslServersState {
  const open = state.status === "open" ? state : undefined

  return {
    runtime: state.runtime,
    installed: state.installed,
    online: state.online,
    distroProbes: state.distroProbes,
    opencodeChecks: state.opencodeChecks,
    pendingRestart: state.pendingRestart,
    servers: state.configured.map((config) => ({
      config,
      runtime: open ? serverRuntime(distroOf(open, config.distro)) : STOPPED,
    })),
    hostJob: open?.host.status ?? "idle",
    distroJobs: Object.fromEntries(
      Object.entries(open?.distros ?? {}).flatMap(([distro, job]) =>
        job.status === "idle" ? [] : [[distro, job.status] as const],
      ),
    ),
  }
}

function closed(state: WslMachineState, event: WslMachineEvent): WslMachineTransition {
  if (
    event.type === "host" ||
    event.type === "probe" ||
    event.type === "install-distro" ||
    event.type === "update" ||
    event.type === "add" ||
    event.type === "start" ||
    event.type === "remove"
  ) {
    return next(state, [reject(event.attempt, { kind: "unavailable" })])
  }

  return next(state)
}

// Jobs still running in the driver finish into a closed machine, which ignores them; their callers hear now.
function close(state: OpenState): WslMachineTransition {
  const attempts = [
    ...(state.host.status === "busy" ? [state.host.attempt] : []),
    ...Object.values(state.distros).flatMap((job) => (job.status === "idle" ? [] : [job.attempt])),
  ]

  return next(
    {
      status: "closed",
      runtime: state.runtime,
      installed: state.installed,
      online: state.online,
      distroProbes: state.distroProbes,
      opencodeChecks: state.opencodeChecks,
      pendingRestart: state.pendingRestart,
      configured: state.configured,
    },
    attempts.map((attempt) => reject(attempt, { kind: "unavailable" })),
  )
}

// A second host request while one runs joins it: the dialog asks again once the state shows the host idle.
function hostRequested(state: OpenState, event: { attempt: string; job: WslHostJob }) {
  if (state.host.status === "busy") return next(state, [resolve(event.attempt)])

  return next({ ...state, host: { status: "busy", attempt: event.attempt } }, [
    { type: "host", attempt: event.attempt, job: event.job },
  ])
}

function hostSettled(state: OpenState, attempt: string, data: Partial<Data>) {
  if (state.host.status !== "busy" || state.host.attempt !== attempt) return next(state)

  return next({ ...state, ...data, host: { status: "idle" } }, [resolve(attempt)])
}

function hostFailed(state: OpenState, attempt: string, message: string) {
  if (state.host.status !== "busy" || state.host.attempt !== attempt) return next(state)

  return next({ ...state, host: { status: "idle" } }, [reject(attempt, { kind: "error", message })])
}

// The dialog probes what it shows; a distro already running a job is checked again once it is idle.
function probe(state: OpenState, distro: string, attempt: string) {
  const current = distroOf(state, distro)

  if (current.status !== "idle") return next(state, [resolve(attempt)])
  const probing: WslDistro = { status: "probing", attempt, server: current.server }

  if (!state.distroProbes[distro]) return next(put(state, distro, probing), [{ type: "probe-distro", distro, attempt }])

  if (needsCliCheck(state, distro)) return next(put(state, distro, probing), [{ type: "inspect-cli", distro, attempt }])

  return next(state, [resolve(attempt)])
}

function distroProbed(state: OpenState, event: { distro: string; attempt: string; probe: WslDistroProbe }) {
  const current = distroOf(state, event.distro)

  if (current.status !== "probing" || current.attempt !== event.attempt) return next(state)
  const probed = { ...state, distroProbes: { ...state.distroProbes, [event.distro]: event.probe } }

  if (needsCliCheck(probed, event.distro)) {
    return next(probed, [{ type: "inspect-cli", distro: event.distro, attempt: event.attempt }])
  }

  return next(put(probed, event.distro, { status: "idle", server: current.server }), [resolve(event.attempt)])
}

function cliInspected(state: OpenState, event: { distro: string; attempt: string; check: WslOpencodeCheck }) {
  const current = distroOf(state, event.distro)

  if (current.status !== "probing" || current.attempt !== event.attempt) return next(state)
  const checked = withCheck(state, event.distro, event.check)

  return next(put(checked, event.distro, { status: "idle", server: current.server }), [resolve(event.attempt)])
}

function installDistro(state: OpenState, distro: string, attempt: string) {
  const current = distroOf(state, distro)

  if (current.status === "installing") return next(state, [resolve(attempt)])

  if (configuredDistro(state, distro)) return next(state, [reject(attempt, { kind: "already-added", distro })])

  if (current.status !== "idle") return next(state, [reject(attempt, { kind: "busy", distro })])

  return next(put(state, distro, { status: "installing", attempt }), [{ type: "install-distro", distro, attempt }])
}

function distroInstalled(
  state: OpenState,
  event: {
    distro: string
    attempt: string
    installed: readonly WslInstalledDistro[]
    online: readonly WslOnlineDistro[]
    probe: WslDistroProbe
  },
) {
  const current = distroOf(state, event.distro)

  if (current.status !== "installing" || current.attempt !== event.attempt) return next(state)

  const installed = {
    ...state,
    installed: event.installed,
    online: event.online,
    distroProbes: { ...state.distroProbes, [event.distro]: event.probe },
  }

  return next(put(installed, event.distro, IDLE), [resolve(event.attempt)])
}

// Updating stops the distro's server first, even one still starting, and starts it again once the CLI matches.
function update(state: OpenState, distro: string, attempt: string) {
  const current = distroOf(state, distro)

  if (current.status === "updating") return next(state, [resolve(attempt)])
  const updating: WslDistro = { status: "updating", attempt }

  if (current.status === "starting") {
    return next(put(state, distro, updating), [
      resolve(current.attempt),
      { type: "stop", distro, attempt, server: current.attempt },
    ])
  }

  if (current.status !== "idle") return next(state, [reject(attempt, { kind: "busy", distro })])

  if (current.server.kind === "ready") {
    return next(put(state, distro, updating), [{ type: "stop", distro, attempt, server: current.server.attempt }])
  }

  return next(put(state, distro, updating), [{ type: "install-cli", distro, attempt }])
}

// The update's caller hears once the restarted server is up or failed, as when main awaited the restart.
function cliInstalled(state: OpenState, event: { distro: string; attempt: string; check: WslOpencodeCheck }) {
  const current = distroOf(state, event.distro)

  if (current.status !== "updating" || current.attempt !== event.attempt) return next(state)
  const checked = withCheck(state, event.distro, event.check)

  if (!configuredDistro(state, event.distro)) return next(put(checked, event.distro, IDLE), [resolve(event.attempt)])

  return next(put(checked, event.distro, { status: "starting", attempt: event.attempt }), [
    { type: "spawn", distro: event.distro, attempt: event.attempt },
  ])
}

// A failed update leaves the server stopped, so the row offers to start it again.
function jobFailed(
  state: OpenState,
  event: { distro: string; attempt: string; message: string; check?: WslOpencodeCheck },
) {
  const current = distroOf(state, event.distro)

  if (
    (current.status !== "probing" && current.status !== "installing" && current.status !== "updating") ||
    current.attempt !== event.attempt
  ) {
    return next(state)
  }

  const checked = event.check ? withCheck(state, event.distro, event.check) : state
  const idle: WslDistro = current.status === "probing" ? { status: "idle", server: current.server } : IDLE

  return next(put(checked, event.distro, idle), [reject(event.attempt, { kind: "error", message: event.message })])
}

// The caller hears once the server is saved; it starts in the background.
function add(state: OpenState, config: WslServerConfig, attempt: string) {
  const distro = config.distro

  if (state.configured.some((item) => item.id === config.id || item.distro === distro)) {
    return next(state, [reject(attempt, { kind: "already-added", distro })])
  }

  if (distroOf(state, distro).status !== "idle") return next(state, [reject(attempt, { kind: "busy", distro })])
  const configured = [...state.configured, config]

  return next(put({ ...state, configured }, distro, { status: "starting", attempt }), [
    { type: "persist", servers: configured },
    { type: "spawn", distro, attempt },
    { type: "check-cli", distro },
    resolve(attempt),
  ])
}

// A start while one is starting or an update will restart it joins that; it never stacks a second server.
function start(state: OpenState, id: string, attempt: string) {
  const distro = state.configured.find((item) => item.id === id)?.distro

  if (!distro) return next(state, [resolve(attempt)])
  const current = distroOf(state, distro)

  if (current.status === "starting" || current.status === "updating") return next(state, [resolve(attempt)])

  if (current.status !== "idle") return next(state, [reject(attempt, { kind: "busy", distro })])
  const starting = put(state, distro, { status: "starting", attempt })

  if (current.server.kind === "ready") {
    return next(starting, [
      { type: "stop", distro, attempt, server: current.server.attempt },
      { type: "check-cli", distro },
    ])
  }

  return next(starting, [
    { type: "spawn", distro, attempt },
    { type: "check-cli", distro },
  ])
}

function remove(state: OpenState, id: string, attempt: string) {
  const distro = state.configured.find((item) => item.id === id)?.distro

  if (!distro) return next(state, [resolve(attempt)])
  const current = distroOf(state, distro)

  if (current.status === "removing") return next(state, [resolve(attempt)])
  const removing = put(state, distro, { status: "removing", attempt })

  if (current.status === "starting") {
    return next(removing, [resolve(current.attempt), { type: "stop", distro, attempt, server: current.attempt }])
  }

  if (current.status !== "idle") return next(state, [reject(attempt, { kind: "busy", distro })])

  if (current.server.kind === "ready") {
    return next(removing, [{ type: "stop", distro, attempt, server: current.server.attempt }])
  }

  const removed = withoutDistro(state, distro)

  return next(removed, [{ type: "persist", servers: removed.configured }, resolve(attempt)])
}

function serverStopped(state: OpenState, distro: string, attempt: string) {
  const current = distroOf(state, distro)

  if (current.status === "idle" || current.status === "probing" || current.attempt !== attempt) return next(state)

  if (current.status === "starting") return next(state, [{ type: "spawn", distro, attempt }])

  if (current.status === "updating") return next(state, [{ type: "install-cli", distro, attempt }])

  if (current.status !== "removing") return next(state)
  const removed = withoutDistro(state, distro)

  return next(removed, [{ type: "persist", servers: removed.configured }, resolve(attempt)])
}

// A server that comes up for a start nobody wants anymore is stopped by the job that superseded it.
function serverSpawned(state: OpenState, event: { distro: string; attempt: string; url: string; password: string }) {
  const current = distroOf(state, event.distro)

  if (current.status !== "starting" || current.attempt !== event.attempt) return next(state)
  const server: WslServer = { kind: "ready", attempt: event.attempt, url: event.url, password: event.password }

  return next(put(state, event.distro, { status: "idle", server }), [
    resolve(event.attempt),
    { type: "check-cli", distro: event.distro },
    { type: "log", level: "info", message: "wsl sidecar ready", data: { distro: event.distro, url: event.url } },
  ])
}

// A failed start answers its callers without an error: the row shows the failure and offers to retry.
function serverFailed(state: OpenState, event: { distro: string; attempt: string; message: string }) {
  const current = distroOf(state, event.distro)

  if (current.status !== "starting" || current.attempt !== event.attempt) return next(state)

  return next(put(state, event.distro, { status: "idle", server: { kind: "failed", message: event.message } }), [
    resolve(event.attempt),
    {
      type: "log",
      level: "error",
      message: "wsl sidecar failed to start",
      data: { distro: event.distro, message: event.message },
    },
  ])
}

// Only the live server's exit is a failure; a server a job stopped exits on purpose.
function serverExited(
  state: OpenState,
  event: { distro: string; attempt: string; code: number | null; signal: string | null; message: string },
) {
  const current = distroOf(state, event.distro)

  if (current.status !== "idle" && current.status !== "probing") return next(state)

  if (current.server.kind !== "ready" || current.server.attempt !== event.attempt) return next(state)

  return next(put(state, event.distro, { ...current, server: { kind: "failed", message: event.message } }), [
    {
      type: "log",
      level: "error",
      message: "wsl sidecar exited",
      data: { distro: event.distro, code: event.code, signal: event.signal },
    },
  ])
}

// Background checks never overwrite what an update or removal decides for the distro.
function cliChecked(state: OpenState, distro: string, check: WslOpencodeCheck) {
  const status = distroOf(state, distro).status

  if (!configuredDistro(state, distro) || status === "updating" || status === "removing") return next(state)

  return next(withCheck(state, distro, check))
}

function serverRuntime(job: WslDistro): WslServerRuntime {
  if (job.status === "starting") return { kind: "starting" }

  if (job.status !== "idle" && job.status !== "probing") return STOPPED

  if (job.server.kind === "ready") return { kind: "ready", url: job.server.url, password: job.server.password }

  return job.server
}

// A distro without a job is idle with no server.
function distroOf(state: OpenState, distro: string): WslDistro {
  return state.distros[distro] ?? IDLE
}

function needsCliCheck(state: OpenState, distro: string) {
  const probe = state.distroProbes[distro]

  return !!probe && probe.canExecute && probe.hasBash && probe.hasCurl && !state.opencodeChecks[distro]
}

function configuredDistro(state: OpenState, distro: string) {
  return state.configured.some((item) => item.distro === distro)
}

function put(state: OpenState, distro: string, job: WslDistro): OpenState {
  return { ...state, distros: { ...state.distros, [distro]: job } }
}

function withCheck(state: OpenState, distro: string, check: WslOpencodeCheck): OpenState {
  return { ...state, opencodeChecks: { ...state.opencodeChecks, [distro]: check } }
}

function withoutDistro(state: OpenState, distro: string): OpenState {
  return {
    ...state,
    configured: state.configured.filter((item) => item.distro !== distro),
    distros: Object.fromEntries(Object.entries(state.distros).filter(([name]) => name !== distro)),
    distroProbes: Object.fromEntries(Object.entries(state.distroProbes).filter(([name]) => name !== distro)),
    opencodeChecks: Object.fromEntries(Object.entries(state.opencodeChecks).filter(([name]) => name !== distro)),
  }
}

function resolve(attempt: string): WslMachineEffect {
  return { type: "resolve", attempt }
}

function reject(attempt: string, failure: WslFailure): WslMachineEffect {
  return { type: "reject", attempt, failure }
}

function next(state: WslMachineState, effects: readonly WslMachineEffect[] = []): WslMachineTransition {
  return { state, effects }
}
