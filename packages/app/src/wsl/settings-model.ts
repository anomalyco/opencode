import fuzzysort from "fuzzysort"
import type {
  WslInstalledDistro,
  WslOnlineDistro,
  WslOpencodeCheck,
  WslServersPlatform,
  WslServerRuntime,
  WslServersState,
} from "./types"

export type AddServerText = {
  key: string
  params?: Record<string, string>
}

export type DistroStatusTone = "success" | "warning" | "muted"

export type DistroStatus = {
  label: AddServerText
  tone: DistroStatusTone
}

export type AddServerPrimaryButton = {
  variant: "neutral" | "contrast"
  label: AddServerText
  disabled: boolean
  action: "install-opencode" | "add" | null
  loading: boolean
  width: string | null
}

export type AddServerRuntimeState = "loading" | "pendingRestart" | "checking" | "unavailable" | "ready"

export type AddableProbePlan = {
  key: string
  distros: string[]
}

export type AutoProbePlan = { key: "runtime"; action: "probeRuntime" } | { key: "distros"; action: "refreshDistros" }

export type AddServerProbePlan =
  | { kind: "auto"; key: string; plan: AutoProbePlan }
  | { kind: "addable"; key: string; plan: AddableProbePlan }

export type WslAddServerView = "main" | "catalog"

function isHiddenDistro(name: string) {
  return /^docker-desktop(?:-data)?$/i.test(name)
}

export const wslRuntimeRetryable = (runtime: WslServerRuntime) =>
  runtime.kind === "failed" || runtime.kind === "stopped"

export function wslOpencodeAction(check?: WslOpencodeCheck) {
  if (!check) return
  if (!check.resolvedPath) return "Install OpenCode"
  if (check.matchesDesktop === false) return "Update OpenCode"
}

export function wslDistroReady(state: WslServersState | undefined, name: string) {
  const installed = state?.installed.find((item) => item.name === name)
  const probe = state?.distroProbes[name]
  if (!probe || !installed) return false
  if (installed.version === 1) return false
  return probe.canExecute && probe.hasBash && probe.hasCurl
}

export function addServerViewModel(input: {
  state: WslServersState | undefined
  view: WslAddServerView
  selectedDistro: string | null
  catalogSearch: string
  catalogTarget: string | null
  adding: boolean
  probingAddable: boolean
}) {
  const state = input.state
  const visibleInstalledDistros = (state?.installed ?? []).filter((item) => !isHiddenDistro(item.name))
  const visibleOnlineDistros = (state?.online ?? []).filter((item) => !isHiddenDistro(item.name))
  const existingServerDistros = new Set((state?.servers ?? []).map((item) => item.config.distro))
  const addableInstalledDistros = visibleInstalledDistros.filter((item) => !existingServerDistros.has(item.name))
  const selectedDistro = addServerSelectedDistro(input.selectedDistro, visibleInstalledDistros, addableInstalledDistros)
  const opencodeCheck = selectedDistro ? (state?.opencodeChecks[selectedDistro] ?? null) : null
  const installableDistros = addServerInstallableDistros(visibleInstalledDistros, visibleOnlineDistros)
  const filteredInstallableDistros = addServerFilteredInstallableDistros(installableDistros, input.catalogSearch)
  const catalogTarget = addServerCatalogTarget(input.catalogTarget, filteredInstallableDistros)
  const busy = !!state?.job || input.adding || input.probingAddable

  return {
    busy,
    runtimeState: addServerRuntimeState(state),
    visibleInstalledDistros,
    visibleOnlineDistros,
    addableInstalledDistros,
    selectedDistro,
    opencodeCheck,
    wslReady: !!state?.runtime?.available && !state?.pendingRestart,
    distroStatuses: Object.fromEntries(
      addableInstalledDistros.flatMap((item) => {
        const status = addServerDistroStatus({ state, name: item.name, probingAddable: input.probingAddable })
        if (!status) return []
        return [[item.name, status]]
      }),
    ) as Record<string, DistroStatus | undefined>,
    primaryButton: addServerPrimaryButton({
      state,
      selectedDistro,
      opencodeCheck,
      adding: input.adding,
      probingAddable: input.probingAddable,
    }),
    installableDistros,
    filteredInstallableDistros,
    catalogTarget,
    installingCatalogDistro: state?.job?.kind === "install-distro",
  }
}

function addServerSelectedDistro(
  selected: string | null,
  visibleInstalledDistros: WslInstalledDistro[],
  addableInstalledDistros: WslInstalledDistro[],
) {
  if (selected && addableInstalledDistros.some((item) => item.name === selected && item.version !== 1)) return selected
  const defaultDistro = visibleInstalledDistros.find((item) => item.isDefault)
  if (
    defaultDistro &&
    defaultDistro.version !== 1 &&
    addableInstalledDistros.some((item) => item.name === defaultDistro.name)
  ) {
    return defaultDistro.name
  }
  return addableInstalledDistros.find((item) => item.version !== 1)?.name ?? null
}

function addServerRuntimeState(state: WslServersState | undefined): AddServerRuntimeState {
  if (!state) return "loading"
  if (state.pendingRestart) return "pendingRestart"
  if (!state.runtime) return "checking"
  if (!state.runtime.available) return "unavailable"
  return "ready"
}

function addServerDistroStatus(input: {
  state: WslServersState | undefined
  name: string
  probingAddable: boolean
}): DistroStatus | undefined {
  const installed = input.state?.installed.find((item) => item.name === input.name)
  if (installed?.version === 1) return { label: { key: "wsl.onboarding.distroStatus.unsupported" }, tone: "muted" }
  const job = input.state?.job
  const probe = input.state?.distroProbes[input.name]
  if (!probe) {
    if (input.probingAddable || (job?.kind === "probe-addable" && job.distros.includes(input.name))) {
      return checkingStatus()
    }
    return
  }
  if (!probe.canExecute) {
    if (!installed) {
      return { label: { key: "wsl.onboarding.distroNotInstalled", params: { distro: input.name } }, tone: "warning" }
    }
    return { label: { key: "wsl.onboarding.openDistroOnce", params: { distro: input.name } }, tone: "warning" }
  }
  if (!probe.hasBash || !probe.hasCurl) {
    return { label: { key: "wsl.onboarding.distroStatus.missingTools" }, tone: "warning" }
  }
  const check = input.state?.opencodeChecks[input.name]
  if (!check) {
    if (input.probingAddable || (job?.kind === "probe-addable" && job.distros.includes(input.name))) {
      return checkingStatus()
    }
    return
  }
  if (check.matchesDesktop === false) return { label: { key: "wsl.onboarding.updateOpencode" }, tone: "warning" }
  if (!check.resolvedPath) return { label: { key: "wsl.onboarding.distroStatus.opencodeMissing" }, tone: "warning" }
  if (check.error) return { label: { key: "wsl.onboarding.installOpencode" }, tone: "warning" }
  return { label: { key: "wsl.onboarding.distroStatus.ready" }, tone: "success" }
}

function checkingStatus(): DistroStatus {
  return { label: { key: "wsl.onboarding.distroStatus.checking" }, tone: "muted" }
}

function addServerPrimaryButton(input: {
  state: WslServersState | undefined
  selectedDistro: string | null
  opencodeCheck: WslOpencodeCheck | null
  adding: boolean
  probingAddable: boolean
}): AddServerPrimaryButton {
  const ready = !!input.selectedDistro && wslDistroReady(input.state, input.selectedDistro)
  const probingSelected = input.probingAddable && !addServerSelectedDistroSettled(input.state, input.selectedDistro)
  const probingOpencode =
    probingSelected ||
    (ready &&
      (!input.opencodeCheck ||
        (!!input.selectedDistro &&
          input.state?.job?.kind === "probe-addable" &&
          input.state.job.distros.includes(input.selectedDistro))))
  const installingOpencode =
    input.state?.job?.kind === "install-opencode" && input.state.job.distro === input.selectedDistro
  if (!ready || probingOpencode) {
    return {
      variant: "contrast",
      label: probingSelected ? { key: "wsl.onboarding.distroStatus.checking" } : { key: "wsl.server.add" },
      disabled: true,
      action: null,
      loading: probingSelected,
      width: null,
    }
  }
  if (!addServerOpencodeReady(input.opencodeCheck)) {
    const update = !!input.opencodeCheck?.resolvedPath && input.opencodeCheck.matchesDesktop === false
    return {
      variant: "neutral",
      label: installingOpencode
        ? { key: "wsl.onboarding.updatingOpencode" }
        : update
          ? { key: "wsl.onboarding.updateOpencode" }
          : { key: "wsl.onboarding.installOpencode" },
      disabled: !!input.state?.job || input.adding,
      action: "install-opencode",
      loading: installingOpencode,
      width: update ? "138px" : "129px",
    }
  }
  return {
    variant: "contrast",
    label: input.adding ? { key: "wsl.onboarding.adding" } : { key: "wsl.server.add" },
    disabled: input.adding || !!input.state?.job,
    action: "add",
    loading: input.adding,
    width: null,
  }
}

function addServerOpencodeReady(check: WslOpencodeCheck | null) {
  return !!check?.resolvedPath && check.matchesDesktop !== false && !check.error
}

function addServerSelectedDistroSettled(state: WslServersState | undefined, selectedDistro: string | null) {
  if (!selectedDistro) return false
  const installed = state?.installed.find((item) => item.name === selectedDistro)
  if (installed?.version === 1) return false
  if (!state?.distroProbes[selectedDistro]) return false
  if (!wslDistroReady(state, selectedDistro)) return true
  return !!state.opencodeChecks[selectedDistro]
}

function addServerInstallableDistros(installedDistros: WslInstalledDistro[], onlineDistros: WslOnlineDistro[]) {
  const installed = new Set(installedDistros.map((item) => item.name))
  const hasVersionedUbuntu = onlineDistros.some((item) => /^Ubuntu-\d/.test(item.name))
  return onlineDistros
    .filter((item) => !installed.has(item.name))
    .filter((item) => item.name !== "Ubuntu" || !hasVersionedUbuntu)
}

function addServerFilteredInstallableDistros(installableDistros: WslOnlineDistro[], search: string) {
  const query = search.trim()
  if (!query) return installableDistros
  return fuzzysort.go(query, installableDistros, { keys: ["label", "name"] }).map((item) => item.obj)
}

function addServerCatalogTarget(target: string | null, distros: WslOnlineDistro[]) {
  if (target && distros.some((item) => item.name === target)) return target
  return distros[0]?.name ?? null
}

export function addableProbePlan(input: {
  state: WslServersState | undefined
  view: WslAddServerView
  adding: boolean
  selectedDistro: string | null
  addableInstalledDistros: WslInstalledDistro[]
}) {
  const state = input.state
  if (!state?.runtime?.available || state.pendingRestart || input.view !== "main" || input.adding) return
  if (state.job) return
  const ordered = input.selectedDistro
    ? [
        ...input.addableInstalledDistros.filter((item) => item.name === input.selectedDistro),
        ...input.addableInstalledDistros.filter((item) => item.name !== input.selectedDistro),
      ]
    : input.addableInstalledDistros
  const pending = ordered.flatMap((item) => {
    if (item.version === 1) return []
    if (!state.distroProbes[item.name]) return [`distro:${item.name}`]
    if (wslDistroReady(state, item.name) && !state.opencodeChecks[item.name]) return [`opencode:${item.name}`]
    return []
  })
  if (!pending.length) return
  return {
    key: pending.join("|"),
    distros: ordered.filter((item) => item.version !== 1).map((item) => item.name),
  } satisfies AddableProbePlan
}

export function autoProbePlan(input: { state: WslServersState | undefined; busy: boolean }) {
  if (!input.state || input.busy || input.state.pendingRestart) return
  if (!input.state.runtime) return { key: "runtime", action: "probeRuntime" } satisfies AutoProbePlan
  if (!input.state.runtime.available) return
  if (input.state.installed.length || input.state.online.length) return
  return { key: "distros", action: "refreshDistros" } satisfies AutoProbePlan
}

export function addServerProbePlan(input: {
  state: WslServersState | undefined
  view: WslAddServerView
  adding: boolean
  busy: boolean
  selectedDistro: string | null
  addableInstalledDistros: WslInstalledDistro[]
}) {
  const auto = autoProbePlan({ state: input.state, busy: input.busy })
  if (auto) return { kind: "auto", key: `auto:${auto.key}`, plan: auto } satisfies AddServerProbePlan
  const addable = addableProbePlan(input)
  if (addable) return { kind: "addable", key: `addable:${addable.key}`, plan: addable } satisfies AddServerProbePlan
}

export function createProbeFailureGate() {
  let failed: string | undefined
  return {
    accepts(key: string) {
      return key !== failed
    },
    settle(key: string, error?: unknown) {
      if (error) failed = key
    },
    reset() {
      failed = undefined
    },
  }
}

export async function runAddableProbePlan(input: {
  plan: AddableProbePlan
  api: Pick<WslServersPlatform, "probeAddable">
}) {
  await input.api.probeAddable(input.plan.distros)
}
