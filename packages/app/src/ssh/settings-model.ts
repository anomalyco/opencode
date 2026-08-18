import type { SshHostProbe, SshServerRuntime, SshServersState } from "./types"

export type SshAddText = { key: string; params?: Record<string, string> }

export type SshAddPrimaryAction = "probe" | "install" | "add"

export type SshAddPrimaryButton = {
  action: SshAddPrimaryAction
  label: SshAddText
  loading: boolean
  disabled: boolean
}

export type SshProbeStatus = {
  tone: "info" | "success" | "warning" | "error"
  text: SshAddText
  detail?: string
}

export function sshRuntimeRetryable(runtime: SshServerRuntime) {
  return runtime.kind === "failed" || runtime.kind === "stopped"
}

export function sshRuntimeDisconnectable(runtime: SshServerRuntime) {
  return runtime.kind === "ready" || runtime.kind === "starting"
}

export function sshOpencodeMissing(probe: SshHostProbe | undefined, runtime?: SshServerRuntime) {
  if (runtime?.kind === "failed" && runtime.reason === "opencode-missing") return true
  return !!probe && probe.reachable && !probe.opencodePath
}

export function sshOpencodeAction(probe: SshHostProbe | undefined, runtime?: SshServerRuntime): SshAddText | null {
  if (sshOpencodeMissing(probe, runtime)) return { key: "ssh.add.installOpencode" }
  if (!probe || !probe.reachable) return null
  if (!probe.opencodeVersion || probe.matchesDesktop === false) return { key: "ssh.add.updateOpencode" }
  return null
}

/**
 * Finds the probe for what the user typed. Probes are stored under the
 * normalized host, which matches the trimmed input except for bare IPv6
 * addresses that gain brackets.
 */
export function sshProbeForHost(state: SshServersState | undefined, input: string) {
  const host = input.trim()
  if (!host) return undefined
  const probes = state?.hostProbes ?? {}
  if (probes[host]) return probes[host]
  const at = host.lastIndexOf("@")
  const user = at === -1 ? "" : host.slice(0, at + 1)
  const rest = at === -1 ? host : host.slice(at + 1)
  if (rest.includes(":") && !rest.includes("[")) {
    return probes[`${user}[${rest}]`]
  }
  return undefined
}

export function sshConfigHostSuggestions(state: SshServersState | undefined, input: string, limit = 8) {
  const hosts = state?.configHosts ?? []
  const taken = new Set(state?.servers.map((item) => item.config.host) ?? [])
  const query = input.trim().toLowerCase()
  return hosts
    .filter((host) => !taken.has(host))
    .filter((host) => !query || host.toLowerCase().includes(query))
    .slice(0, limit)
}

export function sshAddPrimaryButton(input: {
  hostInput: string
  probe: SshHostProbe | undefined
  probing: boolean
  installing: boolean
  adding: boolean
}): SshAddPrimaryButton {
  if (input.probing) {
    return { action: "probe", label: { key: "ssh.add.checking" }, loading: true, disabled: true }
  }
  if (input.installing) {
    return { action: "install", label: { key: "ssh.add.installing" }, loading: true, disabled: true }
  }
  if (input.adding) {
    return { action: "add", label: { key: "ssh.add.adding" }, loading: true, disabled: true }
  }
  const probe = input.probe
  if (probe?.reachable) {
    if (!probe.opencodePath) {
      return { action: "install", label: { key: "ssh.add.installOpencode" }, loading: false, disabled: false }
    }
    if (!probe.opencodeVersion || probe.matchesDesktop === false) {
      return { action: "install", label: { key: "ssh.add.updateOpencode" }, loading: false, disabled: false }
    }
    return { action: "add", label: { key: "ssh.add.addServer" }, loading: false, disabled: false }
  }
  return {
    action: "probe",
    label: { key: "ssh.add.connect" },
    loading: false,
    disabled: !input.hostInput.trim(),
  }
}

export function sshProbeStatus(probe: SshHostProbe | undefined, probing: boolean): SshProbeStatus | null {
  if (probing) return { tone: "info", text: { key: "ssh.add.checking" } }
  if (!probe) return null
  if (!probe.reachable) {
    return {
      tone: "error",
      text: { key: "ssh.add.status.unreachable" },
      detail: probe.error ?? undefined,
    }
  }
  if (!probe.opencodePath) {
    return { tone: "warning", text: { key: "ssh.add.status.opencodeMissing" } }
  }
  if (!probe.opencodeVersion || probe.matchesDesktop === false) {
    return {
      tone: "warning",
      text: {
        key: "ssh.add.status.opencodeMismatch",
        params: {
          version: probe.opencodeVersion ?? "?",
          expected: probe.expectedVersion ?? "?",
        },
      },
    }
  }
  return {
    tone: "success",
    text: { key: "ssh.add.status.opencodeFound", params: { version: probe.opencodeVersion } },
  }
}

export type SshRuntimeStatus = { text: SshAddText | null; message?: string }

export function sshRuntimeStatus(runtime: SshServerRuntime): SshRuntimeStatus {
  switch (runtime.kind) {
    case "starting":
      return { text: { key: "ssh.server.status.connecting" } }
    case "ready":
      return { text: null }
    case "stopped":
      return { text: { key: "ssh.server.status.disconnected" } }
    case "failed":
      return { text: null, message: runtime.message }
  }
}
