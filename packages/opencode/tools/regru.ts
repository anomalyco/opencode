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

function getAuth() {
  const user = process.env.REGRU_USERNAME
  const pass = process.env.REGRU_PASSWORD
  if (user && pass) return { username: user, password: pass }

  const cfg = readJSON(CONFIG_FILE)
  if (cfg?.regruUsername && cfg?.regruPassword)
    return { username: cfg.regruUsername, password: cfg.regruPassword }

  return { username: "", password: "" }
}

const API = "https://api.reg.ru/api/regru2"

async function api(method: string, inputData: Record<string, unknown> = {}) {
  const auth = getAuth()
  if (!auth.username || !auth.password)
    return { success: false, error: "REGRU_USERNAME and REGRU_PASSWORD not set" }

  try {
    const body: Record<string, string> = {
      username: auth.username,
      password: auth.password,
      ...Object.fromEntries(Object.entries(inputData).map(([k, v]) => [k, String(v)])),
      output_format: "json",
      lang: "ru",
    }

    const res = await fetch(`${API}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" },
      body: new URLSearchParams(body),
    })

    const data = await res.json()
    const result = data.answer || data

    if (result.result === "error")
      return { success: false, error: result.error_text || result.error?.message || JSON.stringify(result.error || result), details: result }

    return { success: true, data: result }
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : String(e) }
  }
}

export const tool = {
  name: "regru",
  description: "Manage Russian domains via Reg.ru: check availability, register, list domains, manage DNS.",
  schema: {
    input: {
      action: "string",
      domainName: "string",
      period: "number",
      recordType: "string",
      recordName: "string",
      recordContent: "string",
      subdomain: "string",
      ipAddress: "string",
    },
    output: {
      success: "boolean",
      data: "string",
      error: "string",
    },
  },
}

async function call(method: string, params: Record<string, unknown> = {}) {
  const result = await api(method, params)
  if (!result.success) return result
  const data = result.data?.answer || result.data
  return { success: true, data: JSON.stringify(data, null, 2) }
}

export default async function regru(input: {
  action: string
  domainName?: string
  period?: number
  recordType?: string
  recordName?: string
  recordContent?: string
  subdomain?: string
  ipAddress?: string
}) {
  switch (input.action) {
    case "check_domain": {
      if (!input.domainName) return { success: false, error: "domainName required" }
      return call("domain/check", { domain_name: input.domainName })
    }

    case "list_domains": {
      const result = await api("service/get_list", { servtype: "domain" })
      if (!result.success) return result
      const services = result.data?.answer?.services || result.data?.services || []
      return { success: true, data: JSON.stringify(services, null, 2) }
    }

    case "get_dns_records": {
      if (!input.domainName) return { success: false, error: "domainName required" }
      return call("zone/get_resource_records", { domain_name: input.domainName })
    }

    case "add_dns_record": {
      if (!input.domainName) return { success: false, error: "domainName required" }
      if (!input.recordType || !input.recordContent)
        return { success: false, error: "recordType and recordContent required" }

      const type = input.recordType.toUpperCase()
      const subdomain = input.subdomain || "@"

      switch (type) {
        case "A":
          return call("zone/add_alias", { domain_name: input.domainName, subdomain, ip_address: input.recordContent })
        case "AAAA":
          return call("zone/add_aaaa", { domain_name: input.domainName, subdomain, ip_address: input.recordContent })
        case "CNAME":
          return call("zone/add_cname", { domain_name: input.domainName, subdomain, canonical_name: input.recordContent })
        case "TXT":
          return call("zone/add_txt", { domain_name: input.domainName, subdomain, text: input.recordContent })
        case "MX":
          return call("zone/add_mx", { domain_name: input.domainName, subdomain, mail_server: input.recordContent, priority: 10 })
        case "NS":
          return call("zone/add_ns", { domain_name: input.domainName, subdomain, name_server: input.recordContent })
        default:
          return { success: false, error: `Unsupported record type: ${type}` }
      }
    }

    case "delete_dns_record": {
      if (!input.domainName) return { success: false, error: "domainName required" }
      return call("zone/remove_record", {
        domain_name: input.domainName,
        subdomain: input.subdomain || "@",
        record_type: input.recordType?.toUpperCase() || "A",
        content: input.recordContent,
      })
    }

    case "clear_dns": {
      if (!input.domainName) return { success: false, error: "domainName required" }
      return call("zone/clear", { domain_name: input.domainName })
    }

    default:
      return { success: false, error: `Unknown action: ${input.action}` }
  }
}
