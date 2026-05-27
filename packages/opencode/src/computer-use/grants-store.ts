/**
 * Pre-authorized app grants persistence.
 *
 * Stores user-approved app grants in the yunpat-agent data directory
 * so they survive restarts without re-approval.
 */

import fs from "fs/promises"
import path from "path"
import { Global } from "@yunpat/core/global"

const GRANTS_FILE = path.join(Global.Path.data, "computer-use-grants.json")

export interface AppGrant {
  bundleId: string
  displayName: string
  tier: "read" | "click" | "full"
  grantedAt: number
}

export interface GrantsData {
  fullAccess: boolean
  apps: AppGrant[]
  version: number
}

const DEFAULT_GRANTS: GrantsData = { fullAccess: false, apps: [], version: 1 }

let cache: GrantsData | undefined

async function readGrants(): Promise<GrantsData> {
  if (cache) return cache
  try {
    const raw = await fs.readFile(GRANTS_FILE, "utf8")
    cache = JSON.parse(raw) as GrantsData
    return cache!
  } catch {
    cache = { ...DEFAULT_GRANTS }
    return cache!
  }
}

async function writeGrants(data: GrantsData): Promise<void> {
  const dir = path.dirname(GRANTS_FILE)
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(GRANTS_FILE, JSON.stringify(data, null, 2))
  cache = data
}

/** Load persisted grants into the in-memory sets. */
export async function loadPersistedGrants(): Promise<{
  fullAccess: boolean
  apps: AppGrant[]
}> {
  const data = await readGrants()
  return { fullAccess: data.fullAccess, apps: data.apps }
}

/** Persist a full-access grant. */
export async function persistFullAccess(): Promise<void> {
  const data = await readGrants()
  data.fullAccess = true
  await writeGrants(data)
}

/** Persist an app-level grant. */
export async function persistAppGrant(
  bundleId: string,
  displayName: string,
  tier: "read" | "click" | "full",
): Promise<void> {
  const data = await readGrants()
  // Upsert: update tier if already exists
  const existing = data.apps.find((a) => a.bundleId === bundleId)
  if (existing) {
    existing.tier = tier
    existing.grantedAt = Date.now()
  } else {
    data.apps.push({ bundleId, displayName, tier, grantedAt: Date.now() })
  }
  await writeGrants(data)
}

/** Revoke a specific app grant. */
export async function revokeAppGrant(bundleId: string): Promise<void> {
  const data = await readGrants()
  data.apps = data.apps.filter((a) => a.bundleId !== bundleId)
  await writeGrants(data)
}
