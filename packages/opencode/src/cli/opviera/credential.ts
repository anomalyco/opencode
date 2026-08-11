import fs from "fs/promises"
import path from "path"
import { Global } from "@opencode-ai/core/global"
import { PROVIDER_ID } from "./config"

/**
 * Reads and writes the SAME `auth.json` the Effect-based `Auth` service owns, in the same
 * `{ type: "api", key, metadata }` shape and the same 0600 mode.
 *
 * Deliberately plain fs rather than the Auth service: the startup gate runs in the CLI's main
 * thread before any Effect runtime or instance exists, and standing one up purely to read one
 * record would invert that ordering. The record stays fully readable by the Auth service.
 */

const file = path.join(Global.Path.data, "auth.json")

export interface Credential {
  key: string
  projectId: string | null
  projectName: string | null
  gatewayUrl: string
}

interface ApiRecord {
  type: "api"
  key: string
  metadata?: Record<string, string>
}

async function readAll(): Promise<Record<string, unknown>> {
  try {
    const raw = await fs.readFile(file, "utf8")
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {}
  } catch {
    // Missing or unreadable auth.json simply means "not logged in".
    return {}
  }
}

export async function read(): Promise<Credential | undefined> {
  const record = (await readAll())[PROVIDER_ID] as ApiRecord | undefined
  if (!record || record.type !== "api" || typeof record.key !== "string" || record.key.length === 0) return undefined
  const metadata = record.metadata ?? {}
  return {
    key: record.key,
    projectId: metadata["projectId"] || null,
    projectName: metadata["projectName"] || null,
    gatewayUrl: metadata["gatewayUrl"] ?? "",
  }
}

export async function write(credential: Credential): Promise<void> {
  const data = await readAll()
  const metadata: Record<string, string> = { gatewayUrl: credential.gatewayUrl }
  if (credential.projectId) metadata["projectId"] = credential.projectId
  if (credential.projectName) metadata["projectName"] = credential.projectName

  const record: ApiRecord = { type: "api", key: credential.key, metadata }
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, JSON.stringify({ ...data, [PROVIDER_ID]: record }, null, 2), { mode: 0o600 })
  // writeFile only applies `mode` when it creates the file, so an existing file keeps its old
  // permissions unless we set them explicitly.
  await fs.chmod(file, 0o600).catch(() => {})
}

export async function clear(): Promise<void> {
  const data = await readAll()
  if (!(PROVIDER_ID in data)) return
  delete data[PROVIDER_ID]
  await fs.writeFile(file, JSON.stringify(data, null, 2), { mode: 0o600 })
  await fs.chmod(file, 0o600).catch(() => {})
}
