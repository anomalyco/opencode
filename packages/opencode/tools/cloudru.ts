const CONFIG_FILE = join(homedir(), ".config", "opencode", "satellite.json")
import { existsSync, readFileSync } from "fs"
import { homedir } from "os"
import { join } from "path"

const AUTH_URL = "https://iam.api.cloud.ru/api/v1/auth/token"
const API_BASE = "https://compute.api.cloud.ru"

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

function getCredentials() {
  const keyId = process.env.CLOUDRU_KEY_ID
  const secret = process.env.CLOUDRU_KEY_SECRET
  const projectId = process.env.CLOUDRU_PROJECT_ID
  if (keyId && secret) return { keyId, secret, projectId: projectId || "" }

  const cfg = readJSON(CONFIG_FILE)
  if (cfg?.cloudruKeyId && cfg?.cloudruKeySecret)
    return { keyId: cfg.cloudruKeyId, secret: cfg.cloudruKeySecret, projectId: cfg.cloudruProjectId || "" }

  return { keyId: "", secret: "", projectId: "" }
}

let cachedToken = ""
let tokenExpiresAt = 0

async function getToken(): Promise<string> {
  if (cachedToken && Date.now() < tokenExpiresAt) return cachedToken

  const creds = getCredentials()
  if (!creds.keyId || !creds.secret) return ""

  const res = await fetch(AUTH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ keyId: creds.keyId, secret: creds.secret }),
  })

  if (!res.ok) return ""

  const data = await res.json()
  cachedToken = data.access_token || ""
  tokenExpiresAt = Date.now() + (data.expires_in || 3600) * 1000
  return cachedToken
}

async function computeApi(method: string, path: string, body?: unknown) {
  const creds = getCredentials()
  if (!creds.keyId || !creds.secret)
    return { success: false, error: "CLOUDRU_KEY_ID and CLOUDRU_KEY_SECRET not set" }

  const token = await getToken()
  if (!token) return { success: false, error: "Failed to get auth token" }

  const url = new URL(path, API_BASE)

  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  })

  if (res.status === 204) return { success: true, data: null }

  const data = await res.json().catch(() => null)
  if (!res.ok) {
    const msg = data?.detail || data?.message || data?.error || res.statusText
    return { success: false, error: msg, details: data }
  }

  return { success: true, data }
}

export const tool = {
  name: "cloudru",
  description: "Manage Cloud.ru Evolution virtual machines: create, list, get, delete VPS instances. Russian cloud provider.",
  schema: {
    input: {
      action: "string",
      name: "string",
      flavorId: "string",
      availabilityZoneId: "string",
      imageId: "string",
      vmId: "string",
      projectId: "string",
      sshKeyName: "string",
      userData: "string",
    },
    output: {
      success: "boolean",
      data: "string",
      error: "string",
    },
  },
}

export default async function cloudru(input: {
  action: string
  name?: string
  flavorId?: string
  availabilityZoneId?: string
  imageId?: string
  vmId?: string
  projectId?: string
  sshKeyName?: string
  userData?: string
}) {
  const creds = getCredentials()
  const pid = input.projectId || creds.projectId

  switch (input.action) {
    case "list_flavors": {
      const result = await computeApi("GET", `/api/v1/flavors${pid ? `?project_id=${pid}` : ""}`)
      if (!result.success) return result
      return { success: true, data: JSON.stringify(result.data, null, 2) }
    }

    case "list_zones": {
      const result = await computeApi("GET", `/api/v1/availability-zones${pid ? `?project_id=${pid}` : ""}`)
      if (!result.success) return result
      return { success: true, data: JSON.stringify(result.data, null, 2) }
    }

    case "list_vms": {
      if (!pid) return { success: false, error: "projectId required" }
      const result = await computeApi("GET", `/api/v1/vms?project_id=${pid}`)
      if (!result.success) return result
      return { success: true, data: JSON.stringify(result.data, null, 2) }
    }

    case "create_vm": {
      if (!pid) return { success: false, error: "projectId required" }
      if (!input.name || !input.flavorId || !input.imageId)
        return { success: false, error: "name, flavorId, and imageId required" }

      const disk: Record<string, unknown> = {
        name: `${input.name}-boot`,
        size: 10,
      }

      const diskTypes = await computeApi("GET", `/api/v1/disk-types?project_id=${pid}`)
      if (diskTypes.success && diskTypes.data?.items?.length) {
        disk.disk_type_id = diskTypes.data.items[0].id
      }

      const vmPayload: Record<string, unknown> = {
        project_id: pid,
        name: input.name,
        flavor_id: input.flavorId,
        image_id: input.imageId,
        availability_zone_id: input.availabilityZoneId,
        disks: [disk],
      }

      if (input.userData) {
        vmPayload.cloud_init = input.userData
      }

      const result = await computeApi("POST", `/api/v1/vms?project_id=${pid}`, [vmPayload])
      if (!result.success) return result
      return { success: true, data: JSON.stringify(result.data, null, 2) }
    }

    case "get_vm": {
      if (!input.vmId) return { success: false, error: "vmId required" }
      const result = await computeApi("GET", `/api/v1/vms/${input.vmId}${pid ? `?project_id=${pid}` : ""}`)
      if (!result.success) return result
      return { success: true, data: JSON.stringify(result.data, null, 2) }
    }

    case "delete_vm": {
      if (!input.vmId) return { success: false, error: "vmId required" }
      if (!pid) return { success: false, error: "projectId required" }
      const result = await computeApi("DELETE", `/api/v1/vms/${input.vmId}?project_id=${pid}`)
      if (!result.success) return result
      return { success: true, data: `VM ${input.vmId} deleted` }
    }

    case "list_images": {
      const result = await computeApi("GET", `/api/v1/images${pid ? `?project_id=${pid}` : ""}`)
      if (!result.success) return result
      return { success: true, data: JSON.stringify(result.data, null, 2) }
    }

    case "list_disk_types": {
      if (!pid) return { success: false, error: "projectId required" }
      const result = await computeApi("GET", `/api/v1/disk-types?project_id=${pid}`)
      if (!result.success) return result
      return { success: true, data: JSON.stringify(result.data, null, 2) }
    }

    default:
      return { success: false, error: `Unknown action: ${input.action}` }
  }
}
