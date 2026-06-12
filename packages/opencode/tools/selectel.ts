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
  const envKey = process.env.SELECTEL_API_TOKEN
  if (envKey) return envKey
  const cfg = readJSON(CONFIG_FILE)
  if (cfg?.selectelApiToken) return cfg.selectelApiToken
  return ""
}

const API = "https://api.selectel.ru/v3"

async function api(path: string, options?: { method?: string; body?: unknown }) {
  const token = getApiKey()
  if (!token) return { success: false, error: "SELECTEL_API_TOKEN not set" }

  const res = await fetch(`${API}${path}`, {
    method: options?.method || "GET",
    headers: { "X-Auth-Token": token, "Content-Type": "application/json" },
    body: options?.body ? JSON.stringify(options.body) : undefined,
  })

  if (res.status === 204) return { success: true, data: null }

  const data = await res.json().catch(() => null)
  if (!res.ok) return { success: false, error: data?.error?.message || data?.message || res.statusText, details: data }

  return { success: true, data }
}

export const tool = {
  name: "selectel",
  description: "Manage Selectel Cloud servers: create, list, get, delete VPS instances. Russian cloud provider.",
  schema: {
    input: {
      action: "string",
      name: "string",
      flavor: "string",
      region: "string",
      image: "string",
      serverId: "string",
      sshKeys: "string",
      keypairName: "string",
      networkId: "string",
    },
    output: {
      success: "boolean",
      data: "string",
      error: "string",
    },
  },
}

export default async function selectel(input: {
  action: string
  name?: string
  flavor?: string
  region?: string
  image?: string
  serverId?: string
  sshKeys?: string
  keypairName?: string
  networkId?: string
}) {
  switch (input.action) {
    case "list_servers": {
      const result = await api("/compute/servers")
      if (!result.success) return result
      return { success: true, data: JSON.stringify(result.data?.servers || result.data, null, 2) }
    }

    case "create_server": {
      const body: Record<string, unknown> = {
        name: input.name || `sat-${Date.now()}`,
        flavor: input.flavor || "2001",
        image: input.image || "ubuntu-22.04",
        key_name: input.keypairName,
      }
      if (input.networkId) body.networks = [{ uuid: input.networkId }]

      const result = await api("/compute/servers", { method: "POST", body })
      if (!result.success) return result
      return { success: true, data: JSON.stringify(result.data?.server || result.data, null, 2) }
    }

    case "get_server": {
      if (!input.serverId) return { success: false, error: "serverId required" }
      const result = await api(`/compute/servers/${input.serverId}`)
      if (!result.success) return result
      return { success: true, data: JSON.stringify(result.data?.server || result.data, null, 2) }
    }

    case "delete_server": {
      if (!input.serverId) return { success: false, error: "serverId required" }
      const result = await api(`/compute/servers/${input.serverId}`, { method: "DELETE" })
      if (!result.success) return result
      return { success: true, data: `Server ${input.serverId} deleted` }
    }

    case "list_flavors": {
      const result = await api("/compute/flavors")
      if (!result.success) return result
      return { success: true, data: JSON.stringify(result.data?.flavors || result.data, null, 2) }
    }

    case "list_images": {
      const result = await api("/compute/images")
      if (!result.success) return result
      return { success: true, data: JSON.stringify(result.data?.images || result.data, null, 2) }
    }

    default:
      return { success: false, error: `Unknown action: ${input.action}` }
  }
}
