import { existsSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { isAbsolute, join } from "node:path"

export interface Manifest {
  readonly endpoints: {
    readonly ui: string
    readonly backend: string
  }
  readonly recording?: {
    readonly timeline: string
  }
}

export const defaults: Manifest = {
  endpoints: {
    ui: "ws://127.0.0.1:40900",
    backend: "ws://127.0.0.1:40950",
  },
}

export function resolve() {
  const name = process.env.OPENCODE_DRIVE
  if (!name) throw new Error("OPENCODE_DRIVE must contain a drive instance name")
  if (name === "1") return defaults
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(name)) throw new Error(`Invalid drive instance name: ${name}`)

  const directory =
    process.env.DRIVE_REGISTRY_DIR ??
    join(process.env.XDG_STATE_HOME ?? join(homedir(), ".local", "state"), "opencode-drive", "instances")
  const file = join(directory, `${name}.json`)
  if (!existsSync(file)) throw new Error(`Drive manifest not found: ${file}`)

  const manifest: unknown = JSON.parse(readFileSync(file, "utf8"))
  if (!isManifest(manifest)) throw new Error(`Invalid drive manifest: ${file}`)
  validateEndpoint(manifest.endpoints.ui, "ui")
  validateEndpoint(manifest.endpoints.backend, "backend")
  if (manifest.recording && !isAbsolute(manifest.recording.timeline)) {
    throw new Error(`Invalid drive recording timeline path: ${manifest.recording.timeline}`)
  }
  return manifest
}

function isManifest(value: unknown): value is Manifest {
  if (typeof value !== "object" || value === null || !("endpoints" in value)) return false
  if (typeof value.endpoints !== "object" || value.endpoints === null) return false
  return "ui" in value.endpoints && "backend" in value.endpoints
}

function validateEndpoint(value: string, name: string) {
  const endpoint = new URL(value)
  const port = Number(endpoint.port)
  if (endpoint.protocol !== "ws:" || endpoint.hostname !== "127.0.0.1" || !Number.isInteger(port) || port < 1) {
    throw new Error(`Invalid drive ${name} endpoint: ${value}`)
  }
}

export * as DriveManifest from "./manifest"
