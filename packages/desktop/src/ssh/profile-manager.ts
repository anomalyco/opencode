import { invoke } from "@tauri-apps/api/core"

export interface ConnectionProfile {
  id: string
  name: string
  host: string
  user?: string
  port?: number
  identityFile?: string
  identityFiles?: string[]
  forwardAgent?: boolean
  proxyJump?: string
  sshConfigMode?: "pass-through" | "isolation"
  remoteServerPorts: number[]
  remoteHost: string
  bootstrapEnabled: boolean
  autoReconnect: boolean
  createdAt: string
  lastUsed?: string
}

interface TauriConnectionProfile {
  id: string
  name: string
  host: string
  user?: string
  port?: number
  identity_file?: string
  identity_files?: string[]
  forward_agent?: boolean
  proxy_jump?: string
  ssh_config_mode?: string
  remote_server_ports: number[]
  remote_host: string
  bootstrap_enabled: boolean
  auto_reconnect: boolean
  created_at: string
  last_used?: string
}

function toTauriProfile(profile: ConnectionProfile): TauriConnectionProfile {
  return {
    id: profile.id,
    name: profile.name,
    host: profile.host,
    user: profile.user,
    port: profile.port,
    identity_file: profile.identityFile,
    identity_files: profile.identityFiles,
    forward_agent: profile.forwardAgent,
    proxy_jump: profile.proxyJump,
    ssh_config_mode: profile.sshConfigMode,
    remote_server_ports: profile.remoteServerPorts,
    remote_host: profile.remoteHost,
    bootstrap_enabled: profile.bootstrapEnabled,
    auto_reconnect: profile.autoReconnect,
    created_at: profile.createdAt,
    last_used: profile.lastUsed,
  }
}

function fromTauriProfile(profile: TauriConnectionProfile): ConnectionProfile {
  return {
    id: profile.id,
    name: profile.name,
    host: profile.host,
    user: profile.user,
    port: profile.port,
    identityFile: profile.identity_file,
    identityFiles: profile.identity_files,
    forwardAgent: profile.forward_agent,
    proxyJump: profile.proxy_jump,
    sshConfigMode: profile.ssh_config_mode === "pass-through" || profile.ssh_config_mode === "isolation" ? profile.ssh_config_mode : undefined,
    remoteServerPorts: profile.remote_server_ports,
    remoteHost: profile.remote_host,
    bootstrapEnabled: profile.bootstrap_enabled,
    autoReconnect: profile.auto_reconnect,
    createdAt: profile.created_at,
    lastUsed: profile.last_used,
  }
}

export interface ProfileManagerError {
  success: false
  message: string
  details?: string
}

export class ProfileManager {
  async list(): Promise<ConnectionProfile[]> {
    try {
      const profiles = await invoke<TauriConnectionProfile[]>("ssh_list_profiles")
      return profiles.map(fromTauriProfile)
    } catch (error) {
      console.error("Failed to list profiles:", error)
      return []
    }
  }

  async get(id: string): Promise<ConnectionProfile | null> {
    try {
      const profile = await invoke<TauriConnectionProfile | null>("ssh_get_profile", { id })
      return profile ? fromTauriProfile(profile) : null
    } catch (error) {
      console.error("Failed to get profile:", error)
      return null
    }
  }

  async save(profile: ConnectionProfile): Promise<void | ProfileManagerError> {
    if (!this.validate(profile)) {
      return {
        success: false,
        message: "Invalid profile: missing required fields",
        details: "Profile must have 'id', 'name', and 'host' fields",
      }
    }

    try {
      await invoke("ssh_save_profile", { profile: toTauriProfile(profile) })
    } catch (error) {
      return {
        success: false,
        message: "Failed to save profile",
        details: error instanceof Error ? error.message : String(error),
      }
    }
  }

  async delete(id: string): Promise<void | ProfileManagerError> {
    try {
      await invoke("ssh_delete_profile", { id })
    } catch (error) {
      return {
        success: false,
        message: "Failed to delete profile",
        details: error instanceof Error ? error.message : String(error),
      }
    }
  }

  private validate(profile: unknown): profile is ConnectionProfile {
    if (!profile || typeof profile !== "object") {
      return false
    }

    const p = profile as Record<string, unknown>

    if (typeof p.id !== "string" || !p.id) {
      return false
    }

    if (typeof p.name !== "string" || !p.name) {
      return false
    }

    if (typeof p.host !== "string" || !p.host) {
      return false
    }

    if (p.user !== undefined && typeof p.user !== "string") {
      return false
    }

    if (p.port !== undefined && (typeof p.port !== "number" || p.port < 1 || p.port > 65535)) {
      return false
    }

    if (p.identityFile !== undefined && typeof p.identityFile !== "string") {
      return false
    }

    if (p.proxyJump !== undefined && typeof p.proxyJump !== "string") {
      return false
    }

    if (p.sshConfigMode !== undefined && p.sshConfigMode !== "pass-through" && p.sshConfigMode !== "isolation") {
      return false
    }

    if (!Array.isArray(p.remoteServerPorts) || p.remoteServerPorts.some((port) => typeof port !== "number")) {
      return false
    }

    if (typeof p.remoteHost !== "string") {
      return false
    }

    if (typeof p.bootstrapEnabled !== "boolean") {
      return false
    }

    if (typeof p.autoReconnect !== "boolean") {
      return false
    }

    if (typeof p.createdAt !== "string") {
      return false
    }

    if (p.lastUsed !== undefined && typeof p.lastUsed !== "string") {
      return false
    }

    return true
  }
}
