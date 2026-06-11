const CONFIG_FILE = join(homedir(), ".config", "opencode", "satellite.json")
import { existsSync, readFileSync } from "fs"
import { homedir } from "os"
import { join } from "path"

function getAuth() {
  const user = process.env.REGRU_USERNAME
  const pass = process.env.REGRU_PASSWORD
  if (user && pass) return { username: user, password: pass }

  try {
    if (existsSync(CONFIG_FILE)) {
      const cfg = JSON.parse(readFileSync(CONFIG_FILE, "utf-8"))
      if (cfg.regruUsername && cfg.regruPassword)
        return { username: cfg.regruUsername, password: cfg.regruPassword }
    }
  } catch { /* ignore */ }
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
      show_input_params: "1",
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
  return { success: true, data: JSON.stringify(result.data, null, 2) }
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
      const result = await api("domain/list")
      if (!result.success) return result
      const domains = result.data?.domains || result.data
      return { success: true, data: JSON.stringify(domains, null, 2) }
    }

    case "register_domain": {
      if (!input.domainName) return { success: false, error: "domainName required" }
      return call("domain/create", { domain_name: input.domainName, period: input.period || 1 })
    }

    case "get_dns_records": {
      if (!input.domainName) return { success: false, error: "domainName required" }
      return call("domain/dns/get_records", { domain_name: input.domainName })
    }

    case "add_dns_record": {
      if (!input.domainName) return { success: false, error: "domainName required" }
      if (!input.recordType || !input.recordContent)
        return { success: false, error: "recordType and recordContent required" }
      return call("domain/dns/add_record", {
        domain_name: input.domainName,
        subdomain: input.subdomain || "@",
        record_type: input.recordType.toUpperCase(),
        record_value: input.recordContent,
      })
    }

    case "delete_dns_record": {
      if (!input.domainName) return { success: false, error: "domainName required" }
      if (!input.recordContent)
        return { success: false, error: "recordContent required to identify the record" }
      return call("domain/dns/delete_record", {
        domain_name: input.domainName,
        subdomain: input.subdomain || "@",
        record_type: input.recordType?.toUpperCase(),
        record_value: input.recordContent,
      })
    }

    default:
      return { success: false, error: `Unknown action: ${input.action}` }
  }
}
