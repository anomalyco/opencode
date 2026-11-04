import { randomUUID } from "node:crypto"
import type { MainContext } from "@opencode/plugin/gui/main"
import type { WslOpencodeCheck, WslServerConfig } from "./contract"
import {
  createWslMachineState,
  toServersState,
  transitionWslMachine,
  type WslFailure,
  type WslHostJob,
  type WslMachineEffect,
  type WslMachineEvent,
} from "./machine"
import type { WslCliBuild, WslRuntime } from "./runtime"

type RunningSidecar = {
  stop: () => Promise<void>
  onExit: (cb: (code: number | null, signal: NodeJS.Signals | null) => void) => void
  url: string
  password: string
}

type WslServersControllerOptions = {
  cli: WslCliBuild
  runtime: WslRuntime
  t: MainContext["t"]
  log: <Data extends Readonly<Record<string, unknown>>>(level: "info" | "error", message: string, data: Data) => void
  /** Rejects once signal aborts, after any process it started has exited. */
  spawnSidecar: (distro: string, signal: AbortSignal) => Promise<RunningSidecar>
  installCli: (distro: string, cli: WslCliBuild) => Promise<void>
  readServers: () => WslServerConfig[]
  writeServers: (servers: WslServerConfig[]) => void
}

export function wslServerIdForDistro(distro: string) {
  return `wsl:${distro}`
}

/** Runs the WSL machine's effects and reports their outcomes back to it; the machine alone decides what is current. */
export function createWslServersController(options: WslServersControllerOptions) {
  const t = options.t
  const runtime = options.runtime
  const listeners = new Set<() => void>()
  const waiters = new Map<string, PromiseWithResolvers<void>>()
  // Process handles by start attempt, for stopping them only. Stopping one aborts its CLI discovery and health
  // polling and waits until its process exited, so a restart, reload, disable or quit never leaves a sidecar running.
  const starts = new Map<string, { readonly abort: AbortController; readonly done: Promise<void> }>()
  const running = new Map<string, RunningSidecar>()
  const halts = new Map<string, Promise<void>>()
  const current = { machine: createWslMachineState(options.readServers()) }
  const published = { state: toServersState(current.machine) }

  const dispatch = (event: WslMachineEvent) => {
    const transition = transitionWslMachine(current.machine, event)

    if (transition.state !== current.machine) {
      current.machine = transition.state
      published.state = toServersState(transition.state)
      listeners.forEach((listener) => listener())
    }

    transition.effects.forEach(run)
  }

  const request = (event: (attempt: string) => WslMachineEvent) => {
    const attempt = randomUUID()
    const waiter = Promise.withResolvers<void>()
    waiters.set(attempt, waiter)
    dispatch(event(attempt))

    return waiter.promise
  }

  const run = (effect: WslMachineEffect) => {
    if (effect.type === "resolve") return settle(effect.attempt)?.resolve()

    if (effect.type === "reject") return settle(effect.attempt)?.reject(failure(effect.failure))

    if (effect.type === "persist") return options.writeServers([...effect.servers])

    if (effect.type === "log") return options.log(effect.level, effect.message, effect.data)

    if (effect.type === "spawn") return spawn(effect.distro, effect.attempt)

    if (effect.type === "stop") {
      return void halt(effect.server).then(() =>
        dispatch({ type: "server.stopped", distro: effect.distro, attempt: effect.attempt }),
      )
    }

    if (effect.type === "check-cli") {
      return void inspectCli(effect.distro).then(
        (check) => dispatch({ type: "cli.checked", distro: effect.distro, check }),
        (error) => options.log("error", "wsl CLI check failed", { distro: effect.distro, message: message(error) }),
      )
    }

    if (effect.type === "host") {
      return void hostJob(effect.job, effect.attempt).then(dispatch, (error) =>
        dispatch({ type: "host.failed", attempt: effect.attempt, message: message(error) }),
      )
    }

    void distroJob(effect).then(dispatch, (error) =>
      dispatch({ type: "job.failed", distro: effect.distro, attempt: effect.attempt, message: message(error) }),
    )
  }

  const settle = (attempt: string) => {
    const waiter = waiters.get(attempt)
    waiters.delete(attempt)

    return waiter
  }

  const failure = (reason: WslFailure) => {
    if (reason.kind === "busy") return new Error(t("error.busy", { distro: reason.distro }))

    if (reason.kind === "already-added") return new Error(t("error.alreadyAdded", { distro: reason.distro }))

    if (reason.kind === "unavailable") return new Error(t("error.unavailable"))

    return new Error(reason.message)
  }

  const inspectCli = async (distro: string) => {
    const resolved = await runtime.resolveCli(distro)
    const version = resolved ? await runtime.readCliVersion(resolved, distro) : null

    return cliCheck(t, distro, resolved, version, options.cli.version)
  }

  const listDistros = async () => {
    const [installed, online] = await Promise.all([runtime.listInstalled(), runtime.listOnline()])

    return { installed, online }
  }

  const hostJob = async (job: WslHostJob, attempt: string): Promise<WslMachineEvent> => {
    if (job === "probe-runtime") return { type: "runtime.probed", attempt, runtime: await runtime.probeRuntime() }

    if (job === "refresh-distros") return { type: "distros.listed", attempt, ...(await listDistros()) }
    await runtime.installRuntimeElevated()

    return { type: "runtime.installed", attempt, runtime: await runtime.probeRuntime() }
  }

  const distroJob = async (
    effect: Extract<WslMachineEffect, { type: "probe-distro" | "inspect-cli" | "install-distro" | "install-cli" }>,
  ): Promise<WslMachineEvent> => {
    const distro = effect.distro
    const attempt = effect.attempt

    if (effect.type === "probe-distro") {
      return { type: "distro.probed", distro, attempt, probe: await runtime.probeDistro(distro) }
    }

    if (effect.type === "inspect-cli")
      return { type: "cli.inspected", distro, attempt, check: await inspectCli(distro) }

    if (effect.type === "install-distro") {
      await runtime.installDistro(distro)
      const lists = await listDistros()

      return { type: "distro.installed", distro, attempt, ...lists, probe: await runtime.probeDistro(distro) }
    }

    await options.installCli(distro, options.cli)
    const check = await inspectCli(distro)

    if (check.version === options.cli.version) return { type: "cli.installed", distro, attempt, check }

    const expected = options.cli.version
    const installed = check.version ?? t("error.noVersion")

    return {
      type: "job.failed",
      distro,
      attempt,
      check,
      message: t("error.updateVersion", { distro, installed, expected }),
    }
  }

  const spawn = (distro: string, attempt: string) => {
    const abort = new AbortController()
    options.log("info", "wsl sidecar starting", { distro })

    const done = options
      .spawnSidecar(distro, abort.signal)
      .then(
        (sidecar) => {
          running.set(attempt, sidecar)
          sidecar.onExit((code, signal) => {
            running.delete(attempt)
            const text = t("error.serverExited", { code: code ?? "null", signal: signal ?? "null" })
            dispatch({ type: "server.exited", distro, attempt, code, signal, message: text })
          })
          dispatch({ type: "server.spawned", distro, attempt, url: sidecar.url, password: sidecar.password })
        },
        (error) => dispatch({ type: "server.failed", distro, attempt, message: message(error) }),
      )
      .finally(() => starts.delete(attempt))

    starts.set(attempt, { abort, done })
  }

  // One stop per server, however many jobs and teardowns ask for it.
  const halt = (attempt: string) => {
    const pending = halts.get(attempt) ?? stopSidecar(attempt).finally(() => halts.delete(attempt))
    halts.set(attempt, pending)

    return pending
  }

  const stopSidecar = async (attempt: string) => {
    const start = starts.get(attempt)
    start?.abort.abort()
    await start?.done
    const sidecar = running.get(attempt)
    running.delete(attempt)
    await sidecar?.stop()
  }

  return {
    getState() {
      return published.state
    },
    subscribe(listener: () => void) {
      listeners.add(listener)

      return () => {
        listeners.delete(listener)
      }
    },

    // Starts at launch have no caller to answer.
    startConfiguredServers() {
      published.state.servers.forEach((item) => dispatch({ type: "start", id: item.config.id, attempt: randomUUID() }))
    },

    probeRuntime() {
      return request((attempt) => ({ type: "host", attempt, job: "probe-runtime" }))
    },

    refreshDistros() {
      return request((attempt) => ({ type: "host", attempt, job: "refresh-distros" }))
    },

    installWsl() {
      return request((attempt) => ({ type: "host", attempt, job: "install-wsl" }))
    },

    installDistro(distro: string) {
      return request((attempt) => ({ type: "install-distro", distro, attempt }))
    },

    async probeAddable(distros: readonly string[]) {
      await Promise.all(
        [...new Set(distros)].map((distro) => request((attempt) => ({ type: "probe", distro, attempt }))),
      )
    },

    installOpencode(distro: string) {
      return request((attempt) => ({ type: "update", distro, attempt }))
    },

    async addServer(distro: string): Promise<WslServerConfig> {
      const config: WslServerConfig = { id: wslServerIdForDistro(distro), distro }
      await request((attempt) => ({ type: "add", config, attempt }))

      return config
    },

    removeServer(id: string) {
      return request((attempt) => ({ type: "remove", id, attempt }))
    },

    startServer(id: string) {
      return request((attempt) => ({ type: "start", id, attempt }))
    },

    async stopServers() {
      dispatch({ type: "close" })
      await Promise.all([...new Set([...starts.keys(), ...running.keys(), ...halts.keys()])].map(halt))
    },
  }
}

function cliCheck(
  t: MainContext["t"],
  distro: string,
  resolvedPath: string | null,
  version: string | null,
  expectedVersion: string,
): WslOpencodeCheck {
  if (!resolvedPath) {
    return {
      distro,
      resolvedPath: null,
      version: null,
      expectedVersion,
      matchesDesktop: null,
      error: t("error.opencodeMissing"),
    }
  }

  if (!version) {
    return {
      distro,
      resolvedPath,
      version: null,
      expectedVersion,
      matchesDesktop: null,
      error: t("error.opencodeCannotRun"),
    }
  }

  return {
    distro,
    resolvedPath,
    version,
    expectedVersion,
    matchesDesktop: version === expectedVersion,
    error: null,
  }
}

function message(cause: unknown) {
  return cause instanceof Error ? cause.message : String(cause)
}
