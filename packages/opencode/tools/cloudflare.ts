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

function getConfig() {
  const token = process.env.CLOUDFLARE_API_TOKEN
  if (token) return { token, email: process.env.CLOUDFLARE_EMAIL || "" }

  const cfg = readJSON(CONFIG_FILE)
  if (cfg?.cloudflareApiToken) return { token: cfg.cloudflareApiToken, email: cfg.cloudflareEmail || "" }
  return { token: "", email: "" }
}

const API = "https://api.cloudflare.com/client/v4"

async function api(path: string, options?: { method?: string; body?: unknown }) {
  const { token } = getConfig()
  if (!token) return { success: false, error: "CLOUDFLARE_API_TOKEN not set" }

  const headers: Record<string, string> = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }

  const res = await fetch(`${API}${path}`, {
    method: options?.method || "GET",
    headers,
    body: options?.body ? JSON.stringify(options.body) : undefined,
  })

  const data = await res.json()
  if (!data.success) {
    const msgs = data.errors?.map((e: any) => e.message).join("; ") || res.statusText
    return { success: false, error: msgs, details: data }
  }

  return { success: true, data }
}

export const tool = {
  name: "cloudflare",
  description: "Manage Cloudflare DNS and zones: list zones, manage DNS records (A, CNAME, TXT, etc.).",
  schema: {
    input: {
      action: "string",
      zoneName: "string",
      zoneId: "string",
      recordType: "string",
      recordName: "string",
      recordContent: "string",
      recordId: "string",
      ttl: "number",
      proxied: "boolean",
    },
    output: {
      success: "boolean",
      data: "string",
      error: "string",
    },
  },
}

export default async function cloudflare(input: {
  action: string
  zoneName?: string
  zoneId?: string
  recordType?: string
  recordName?: string
  recordContent?: string
  recordId?: string
  ttl?: number
  proxied?: boolean
}) {
  switch (input.action) {
    case "list_zones": {
      let path = "/zones?per_page=50"
      if (input.zoneName) path += `&name=${input.zoneName}`
      const result = await api(path)
      if (!result.success) return result
      const zones = result.data.result.map((z: any) => ({
        id: z.id,
        name: z.name,
        status: z.status,
        plan: z.plan?.name,
      }))
      return { success: true, data: JSON.stringify(zones, null, 2) }
    }

    case "list_dns_records": {
      const zoneId = input.zoneId || (await resolveZone(input.zoneName))
      if (!zoneId) return { success: false, error: "zoneId or zoneName required" }

      let path = `/zones/${zoneId}/dns_records?per_page=100`
      if (input.recordType) path += `&type=${input.recordType}`
      if (input.recordName) path += `&name=${input.recordName}`

      const result = await api(path)
      if (!result.success) return result
      return { success: true, data: JSON.stringify(result.data.result, null, 2) }
    }

    case "create_dns_record": {
      const zoneId = input.zoneId || (await resolveZone(input.zoneName))
      if (!zoneId) return { success: false, error: "zoneId or zoneName required" }
      if (!input.recordType || !input.recordName || !input.recordContent)
        return { success: false, error: "recordType, recordName, recordContent required" }

      const result = await api(`/zones/${zoneId}/dns_records`, {
        method: "POST",
        body: {
          type: input.recordType,
          name: input.recordName,
          content: input.recordContent,
          ttl: input.ttl ?? 1,
          proxied: input.proxied ?? false,
        },
      })
      if (!result.success) return result
      return { success: true, data: JSON.stringify(result.data.result, null, 2) }
    }

    case "update_dns_record": {
      const zoneId = input.zoneId || (await resolveZone(input.zoneName))
      if (!zoneId) return { success: false, error: "zoneId or zoneName required" }
      if (!input.recordId) return { success: false, error: "recordId required" }

      const result = await api(`/zones/${zoneId}/dns_records/${input.recordId}`, {
        method: "PATCH",
        body: {
          type: input.recordType,
          name: input.recordName,
          content: input.recordContent,
          ttl: input.ttl ?? 1,
          proxied: input.proxied ?? false,
        },
      })
      if (!result.success) return result
      return { success: true, data: JSON.stringify(result.data.result, null, 2) }
    }

    case "delete_dns_record": {
      const zoneId = input.zoneId || (await resolveZone(input.zoneName))
      if (!zoneId) return { success: false, error: "zoneId or zoneName required" }
      if (!input.recordId) return { success: false, error: "recordId required" }

      const result = await api(`/zones/${zoneId}/dns_records/${input.recordId}`, { method: "DELETE" })
      if (!result.success) return result
      return { success: true, data: `DNS record ${input.recordId} deleted` }
    }

    default:
      return { success: false, error: `Unknown action: ${input.action}` }
  }
}

async function resolveZone(name?: string): Promise<string | null> {
  if (!name) return null
  const result = await api(`/zones?name=${name}`)
  if (!result.success || !result.data.result?.length) return null
  return result.data.result[0].id
}
