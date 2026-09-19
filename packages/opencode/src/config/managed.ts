export * as ConfigManaged from "./managed"

import { existsSync } from "fs"
import os from "os"
import path from "path"
import { Process } from "@/util/process"
import { parse as parseJsonc } from "jsonc-parser"

const MANAGED_PLIST_DOMAIN = "ai.opencode.managed"

// Keys injected by macOS/MDM into the managed plist that are not OpenCode config
const PLIST_META = new Set([
  "PayloadDisplayName",
  "PayloadIdentifier",
  "PayloadType",
  "PayloadUUID",
  "PayloadVersion",
  "_manualProfile",
])

function systemManagedConfigDir(): string {
  switch (process.platform) {
    case "darwin":
      return "/Library/Application Support/opencode"
    case "win32":
      return path.join(process.env.ProgramData || "C:\\ProgramData", "opencode")
    default:
      return "/etc/opencode"
  }
}

export function managedConfigDir() {
  return process.env.OPENCODE_TEST_MANAGED_CONFIG_DIR || systemManagedConfigDir()
}

export function parseManagedPlist(json: string): string {
  const raw = JSON.parse(json)
  for (const key of Object.keys(raw)) {
    if (PLIST_META.has(key)) delete raw[key]
  }
  return JSON.stringify(raw)
}

export async function readManagedPreferences() {
  if (process.platform !== "darwin") return

  const user = (() => {
    try {
      return os.userInfo().username || "user"
    } catch {
      return "user"
    }
  })()
  const paths = [
    path.join("/Library/Managed Preferences", user, `${MANAGED_PLIST_DOMAIN}.plist`),
    path.join("/Library/Managed Preferences", `${MANAGED_PLIST_DOMAIN}.plist`),
  ]

  for (const plist of paths) {
    if (!existsSync(plist)) continue
    const result = await Process.run(["plutil", "-convert", "json", "-o", "-", plist], { nothrow: true })
    if (result.code !== 0) continue
    return {
      source: `mobileconfig:${plist}`,
      text: parseManagedPlist(result.stdout.toString()),
    }
  }

  return
}

type Telemetry = {
  endpoint?: string
  headers?: string
  resourceAttributes?: string
}

const ENV = {
  endpoint: "OTEL_EXPORTER_OTLP_ENDPOINT",
  headers: "OTEL_EXPORTER_OTLP_HEADERS",
  resourceAttributes: "OTEL_RESOURCE_ATTRIBUTES",
} as const

function telemetry(input: unknown): Telemetry | undefined {
  if (!input || typeof input !== "object") return
  const root = input as Record<string, unknown>
  if (!root.telemetry || typeof root.telemetry !== "object") return
  const value = (root.telemetry as Record<string, unknown>).otlp
  if (!value || typeof value !== "object") return
  const otlp = value as Record<string, unknown>
  return {
    endpoint: typeof otlp.endpoint === "string" ? otlp.endpoint : undefined,
    headers: typeof otlp.headers === "string" ? otlp.headers : undefined,
    resourceAttributes: typeof otlp.resourceAttributes === "string" ? otlp.resourceAttributes : undefined,
  }
}

export async function readManagedTelemetry(): Promise<Telemetry | undefined> {
  let result: Telemetry | undefined
  const dir = managedConfigDir()
  for (const name of ["opencode.json", "opencode.jsonc"]) {
    const file = path.join(dir, name)
    if (!existsSync(file)) continue
    const value = telemetry(parseJsonc(await Bun.file(file).text()))
    if (value) result = { ...result, ...value }
  }
  const managed = await readManagedPreferences()
  if (!managed) return result
  return { ...result, ...telemetry(JSON.parse(managed.text)) }
}

export function applyManagedTelemetry(value?: Telemetry) {
  if (!value) return
  for (const key of Object.keys(ENV) as Array<keyof typeof ENV>) {
    const setting = value[key]
    if (setting === undefined) continue
    process.env[ENV[key]] = setting
  }
}

export async function init() {
  applyManagedTelemetry(await readManagedTelemetry())
}
