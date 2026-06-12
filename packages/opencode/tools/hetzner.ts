const CONFIG_FILE = join(homedir(), ".config", "opencode", "satellite.json")
import { existsSync, readFileSync } from "fs"
import { homedir } from "os"
import { join } from "path"

function readJSON(filePath: string) {
  try {
    if (existsSync(filePath)) {
      let raw = readFileSync(filePath, "utf-8")
      if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1)
      return JSON.parse(raw)
    }
  } catch { /* ignore */ }
  return null
}

function getApiKey(): string {
  const envKey = process.env.HETZNER_API_TOKEN
  if (envKey) return envKey
  const cfg = readJSON(CONFIG_FILE)
  if (cfg?.hetznerApiToken) return cfg.hetznerApiToken
  return ""
}

const API = "https://api.hetzner.cloud/v1"

async function api(path: string, options?: { method?: string; body?: unknown }) {
  const token = getApiKey()
  if (!token) return { success: false, error: "HETZNER_API_TOKEN not set. Set env var or add to ~/.config/opencode/satellite.json" }

  const res = await fetch(`${API}${path}`, {
    method: options?.method || "GET",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: options?.body ? JSON.stringify(options.body) : undefined,
  })

  const data = await res.json()
  if (!res.ok) return { success: false, error: data.error?.message || res.statusText, details: data }

  return { success: true, data }
}

export const tool = {
  name: "hetzner",
  description: "Manage Hetzner Cloud servers: create, list, get, delete, reboot VPS instances.",
  schema: {
    input: {
      action: "string",
      name: "string",
      serverType: "string",
      location: "string",
      image: "string",
      serverId: "number",
      sshKeys: "string",
      userData: "string",
    },
    output: {
      success: "boolean",
      data: "string",
      error: "string",
    },
  },
}

export default async function hetzner(input: {
  action: string
  name?: string
  serverType?: string
  location?: string
  image?: string
  serverId?: number
  sshKeys?: string
  userData?: string
}) {
  switch (input.action) {
    case "list_servers": {
      const result = await api("/servers")
      if (!result.success) return result
      return { success: true, data: JSON.stringify(result.data.servers, null, 2) }
    }

    case "create_server": {
      const body: Record<string, unknown> = {
        name: input.name || `sat-${Date.now()}`,
        server_type: input.serverType || "cx22",
        location: input.location || "hel1",
        image: input.image || "ubuntu-24.04",
      }
      if (input.sshKeys) body.ssh_keys = input.sshKeys.split(",").map((s) => s.trim())
      if (input.userData) body.user_data = input.userData

      const result = await api("/servers", { method: "POST", body })
      if (!result.success) return result
      const server = result.data.server
      return {
        success: true,
        data: JSON.stringify(
          {
            id: server.id,
            name: server.name,
            status: server.status,
            ipv4: server.public_net?.ipv4?.ip,
            ipv6: server.public_net?.ipv6?.ip,
            type: server.server_type?.name,
            location: server.datacenter?.location?.name,
          },
          null,
          2,
        ),
      }
    }

    case "get_server": {
      if (!input.serverId) return { success: false, error: "serverId is required" }
      const result = await api(`/servers/${input.serverId}`)
      if (!result.success) return result
      return { success: true, data: JSON.stringify(result.data.server, null, 2) }
    }

    case "delete_server": {
      if (!input.serverId) return { success: false, error: "serverId is required" }
      const result = await api(`/servers/${input.serverId}`, { method: "DELETE" })
      if (!result.success) return result
      return { success: true, data: `Server ${input.serverId} deleted` }
    }

    case "reboot_server": {
      if (!input.serverId) return { success: false, error: "serverId is required" }
      const result = await api(`/servers/${input.serverId}/actions/reboot`, { method: "POST" })
      if (!result.success) return result
      return { success: true, data: `Server ${input.serverId} rebooting` }
    }

    case "list_locations": {
      const result = await api("/locations")
      if (!result.success) return result
      return { success: true, data: JSON.stringify(result.data.locations, null, 2) }
    }

    case "list_server_types": {
      const result = await api("/server_types")
      if (!result.success) return result
      return { success: true, data: JSON.stringify(result.data.server_types, null, 2) }
    }

    default:
      return { success: false, error: `Unknown action: ${input.action}` }
  }
}
