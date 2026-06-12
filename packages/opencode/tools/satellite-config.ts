import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs"
import { homedir } from "os"
import { join } from "path"

const CONFIG_DIR = join(homedir(), ".config", "opencode")
const CONFIG_FILE = join(CONFIG_DIR, "satellite.json")

interface SatelliteConfig {
  hetznerApiToken?: string
  cloudflareApiToken?: string
  cloudflareEmail?: string
  regruUsername?: string
  regruPassword?: string
  selectelApiToken?: string
}

function ensureDir() {
  if (!existsSync(CONFIG_DIR)) mkdirSync(CONFIG_DIR, { recursive: true })
}

function read(): SatelliteConfig {
  try {
    if (existsSync(CONFIG_FILE)) {
      let raw = readFileSync(CONFIG_FILE, "utf-8")
      if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1)
      return JSON.parse(raw)
    }
  } catch { /* ignore */ }
  return {}
}

function write(data: SatelliteConfig) {
  ensureDir()
  writeFileSync(CONFIG_FILE, JSON.stringify(data, null, 2))
}

export const tool = {
  name: "satellite-config",
  description: "Save or show API keys for Сателлит infrastructure (Hetzner, Cloudflare, Reg.ru, Selectel). All fields optional; only provided fields are saved. Call with no args to show current config (keys masked).",
  schema: {
    input: {
      hetznerApiToken: "string",
      cloudflareApiToken: "string",
      cloudflareEmail: "string",
      regruUsername: "string",
      regruPassword: "string",
      selectelApiToken: "string",
    },
    output: {
      message: "string",
      config: "string",
    },
  },
}

export default function satelliteConfig(input: {
  hetznerApiToken?: string
  cloudflareApiToken?: string
  cloudflareEmail?: string
  regruUsername?: string
  regruPassword?: string
  selectelApiToken?: string
}) {
  const current = read()
  const hasChanges = Object.values(input).some((v) => v !== undefined)

  if (hasChanges) {
    const updated: SatelliteConfig = {
      hetznerApiToken: input.hetznerApiToken ?? current.hetznerApiToken,
      cloudflareApiToken: input.cloudflareApiToken ?? current.cloudflareApiToken,
      cloudflareEmail: input.cloudflareEmail ?? current.cloudflareEmail,
      regruUsername: input.regruUsername ?? current.regruUsername,
      regruPassword: input.regruPassword ?? current.regruPassword,
      selectelApiToken: input.selectelApiToken ?? current.selectelApiToken,
    }
    write(updated)
    return { message: "Satellite config saved", config: "" }
  }

  const masked = { ...current }
  for (const key of Object.keys(masked) as (keyof SatelliteConfig)[]) {
    const val = masked[key]
    if (val && typeof val === "string" && val.length > 8)
      (masked as any)[key] = val.slice(0, 4) + "..." + val.slice(-4)
  }
  return { message: "Current satellite config", config: JSON.stringify(masked, null, 2) }
}
