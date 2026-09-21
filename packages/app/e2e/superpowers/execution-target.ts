import os from "node:os"
import path from "node:path"

export const MANAGED_SERVICE_PORT = 4096
export const APP_DEV_PORT = 3000
const LOOPBACK_HOST = "127.0.0.1"

export type ExecutionTestTarget = {
  readonly disposable: true
  readonly directory: string
  readonly port: number
  readonly host: string
  readonly password: string
  readonly executable: string
}

export function parseExecutionTarget(raw: string | undefined): ExecutionTestTarget | undefined {
  if (raw === undefined || raw.trim() === "") return undefined
  const parsed = parseTarget(raw)
  if (parsed.disposable !== true) {
    throw new Error('Execution E2E requires an explicitly disposable target: set "disposable": true')
  }
  const directory = requireOwnedDirectory(parsed.directory)
  const port = requireDisposablePort(parsed.port)
  const host = typeof parsed.host === "string" && parsed.host !== "" ? parsed.host : LOOPBACK_HOST
  if (host !== LOOPBACK_HOST && host !== "localhost") {
    throw new Error(`Execution E2E requires a loopback disposable host, received ${host}`)
  }
  const executable =
    typeof parsed.executable === "string" && parsed.executable !== ""
      ? parsed.executable
      : process.versions.bun
        ? process.execPath
        : "bun"
  const password = typeof parsed.password === "string" && parsed.password !== "" ? parsed.password : crypto.randomUUID()
  return { disposable: true, directory, port, host, password, executable }
}

function parseTarget(raw: string): Record<string, unknown> {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch (error) {
    throw new Error(`EXECUTION_E2E_TARGET must be a JSON object: ${(error as Error).message}`)
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("EXECUTION_E2E_TARGET must be a JSON object")
  }
  return value as Record<string, unknown>
}

function requireOwnedDirectory(value: unknown) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error("Execution E2E requires an explicit owned temporary directory; refusing an implicit production path")
  }
  if (!path.isAbsolute(value)) {
    throw new Error("Execution E2E requires an absolute owned temporary directory")
  }
  const resolved = path.resolve(value)
  const temporaryRoot = path.resolve(os.tmpdir())
  if (resolved !== temporaryRoot && !resolved.startsWith(`${temporaryRoot}${path.sep}`)) {
    throw new Error(`Execution E2E requires an owned directory under ${temporaryRoot}, received ${resolved}`)
  }
  for (const forbidden of [path.parse(resolved).root, os.homedir(), process.cwd(), path.resolve(process.cwd(), "..")]) {
    if (resolved === forbidden) throw new Error(`Execution E2E refuses to own ${resolved}`)
  }
  return resolved
}

function requireDisposablePort(value: unknown) {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new Error("Execution E2E requires an explicit disposable port; refusing an implicit default")
  }
  if (value < 1024 || value > 65535) throw new Error(`Execution E2E requires a port in 1024-65535, received ${value}`)
  if (value === MANAGED_SERVICE_PORT) {
    throw new Error(`Execution E2E refuses the managed service port ${MANAGED_SERVICE_PORT}`)
  }
  if (value === APP_DEV_PORT) throw new Error(`Execution E2E refuses the app development port ${APP_DEV_PORT}`)
  return value
}
