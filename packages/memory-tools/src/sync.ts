/**
 * Cloud sync logic for AgentMemory
 *
 * Handles backup (local → Supabase) and restore (Supabase → local)
 * with conflict resolution (newest wins by timestamp).
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import { Database } from "bun:sqlite"
import path from "path"
import os from "os"
import fs from "fs"

// Row type for SQLite queries
interface SqlRow {
  id: string
  project_id: string
  session_id: string | null
  type: string
  title: string
  content: string
  metadata: string | null
  tags: string | null
  strength: number
  status: string
  time_created: number
  time_updated: number
}

// Platform-specific SQLite path detection
function getSQLitePath(): string {
  // Try OPENCODE_DB env var first
  if (process.env.OPENCODE_DB && process.env.OPENCODE_DB !== ":memory:") {
    if (path.isAbsolute(process.env.OPENCODE_DB)) {
      return process.env.OPENCODE_DB
    }
    return path.join(os.homedir(), ".opencode", process.env.OPENCODE_DB)
  }

  // Detect platform and build path
  if (process.platform === "win32") {
    return path.join(os.homedir(), "AppData", "Local", "opencode", "opencode.db")
  } else if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "opencode", "opencode.db")
  } else {
    // Linux and others
    const xdgData = process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share")
    return path.join(xdgData, "opencode", "opencode.db")
  }
}

// Config storage path
function getConfigPath(cwd: string): string {
  return path.join(cwd, ".opencode", "memory-tools.json")
}

export interface MemoryConfig {
  supabaseUrl: string
  supabaseKey: string
  syncInterval: string
}

export interface LocalMemory {
  id: string
  project_id: string
  session_id: string | null
  type: string
  title: string
  content: string
  metadata: {
    what?: string
    why?: string
    where?: string | string[]
    learned?: string
  } | null
  tags: string[] | null
  strength: number
  status: string
  time_created: number
  time_updated: number
}

export interface CloudMemory {
  id: string
  project_id: string
  session_id: string | null
  type: string
  title: string
  content: string
  metadata: {
    what?: string
    why?: string
    where?: string | string[]
    learned?: string
  } | null
  tags: string[] | null
  strength: number
  status: string
  time_created: number
  time_updated: number
}

export interface SyncResult {
  pushed: number
  restored: number
  skipped: number
}

export interface SyncStatus {
  localCount: number
  cloudCount: number
  lastSyncTime: number | null
  newerInCloud: number
  newerInLocal: number
}

// Parse interval string to milliseconds
export function parseInterval(interval: string): number | null {
  const match = interval.match(/^(\d+)(m|h|d)$/)
  if (!match) return null
  const value = parseInt(match[1]!, 10)
  switch (match[2]!) {
    case "m": return value * 60 * 1000
    case "h": return value * 60 * 60 * 1000
    case "d": return value * 24 * 60 * 60 * 1000
    default: return null
  }
}

// Config management
export async function getConfig(cwd: string): Promise<MemoryConfig | null> {
  const configPath = getConfigPath(cwd)
  if (!fs.existsSync(configPath)) return null
  const content = await fs.promises.readFile(configPath, "utf-8")
  return JSON.parse(content)
}

export async function saveConfig(cwd: string, config: MemoryConfig): Promise<void> {
  const configPath = getConfigPath(cwd)
  const dir = path.dirname(configPath)
  if (!fs.existsSync(dir)) {
    await fs.promises.mkdir(dir, { recursive: true })
  }
  await fs.promises.writeFile(configPath, JSON.stringify(config, null, 2))
}

// Get local SQLite database connection
export async function getLocalDB(cwd: string): Promise<LocalDatabase> {
  const dbPath = getSQLitePath()
  if (!fs.existsSync(dbPath)) {
    throw new Error(`Local database not found at ${dbPath}. Make sure OpenCode has been run at least once.`)
  }
  return new LocalDatabase(dbPath)
}

// Get Supabase client
export function getCloudDB(config: MemoryConfig): SupabaseClient {
  return createClient(config.supabaseUrl, config.supabaseKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  })
}

// Read all local memories
async function getLocalMemories(db: LocalDatabase, projectId: string): Promise<LocalMemory[]> {
  const rows = db.query<SqlRow>(`
    SELECT id, project_id, session_id, type, title, content, metadata, tags, strength, status, time_created, time_updated
    FROM agent_memory
    WHERE project_id = ? AND status = 'active'
  `, [projectId])

  return rows.map(row => ({
    id: row.id,
    project_id: row.project_id,
    session_id: row.session_id,
    type: row.type,
    title: row.title,
    content: row.content,
    metadata: row.metadata ? JSON.parse(row.metadata) : null,
    tags: row.tags ? JSON.parse(row.tags) : null,
    strength: row.strength,
    status: row.status,
    time_created: row.time_created,
    time_updated: row.time_updated,
  }))
}

// Read all cloud memories
async function getCloudMemories(db: SupabaseClient, projectId: string): Promise<CloudMemory[]> {
  const { data, error } = await db
    .from("agent_memory")
    .select("*")
    .eq("project_id", projectId)
    .eq("status", "active")

  if (error) throw new Error(`Failed to fetch cloud memories: ${error.message}`)

  return (data || []).map(row => ({
    id: row.id,
    project_id: row.project_id,
    session_id: row.session_id,
    type: row.type,
    title: row.title,
    content: row.content,
    metadata: row.metadata || null,
    tags: row.tags || null,
    strength: row.strength,
    status: row.status,
    time_created: row.time_created,
    time_updated: row.time_updated,
  }))
}

// Backup local memories to cloud
export async function backupToCloud(
  config: MemoryConfig,
  localDB?: LocalDatabase,
  cloudDB?: SupabaseClient,
): Promise<SyncResult> {
  const db = localDB || await getLocalDB(process.cwd())
  const supabase = cloudDB || getCloudDB(config)

  // Get all local project IDs that have memories
  const projectIdRows = db.query<{ project_id: string }>(`
    SELECT DISTINCT project_id FROM agent_memory WHERE status = 'active'
  `)
  const projectIds = projectIdRows.map(row => row.project_id)

  let pushed = 0
  let skipped = 0

  for (const projectId of projectIds) {
    const localMemories = await getLocalMemories(db, projectId)
    const cloudMemories = await getCloudMemories(supabase, projectId)
    const cloudById = new Map(cloudMemories.map(m => [m.id, m]))

    for (const memory of localMemories) {
      const cloudMemory = cloudById.get(memory.id)

      if (!cloudMemory) {
        // New memory - insert
        const { error } = await supabase.from("agent_memory").insert({
          id: memory.id,
          project_id: memory.project_id,
          session_id: memory.session_id,
          type: memory.type,
          title: memory.title,
          content: memory.content,
          metadata: memory.metadata,
          tags: memory.tags,
          strength: memory.strength,
          status: memory.status,
          time_created: memory.time_created,
          time_updated: memory.time_updated,
        })

        if (error) {
          console.error(`Failed to push memory ${memory.id}:`, error)
        } else {
          pushed++
        }
      } else if (memory.time_updated > cloudMemory.time_updated) {
        // Local is newer - update
        const { error } = await supabase
          .from("agent_memory")
          .update({
            title: memory.title,
            content: memory.content,
            metadata: memory.metadata,
            tags: memory.tags,
            strength: memory.strength,
            status: memory.status,
            time_updated: memory.time_updated,
          })
          .eq("id", memory.id)

        if (error) {
          console.error(`Failed to update memory ${memory.id}:`, error)
        } else {
          pushed++
        }
      } else {
        // Cloud is newer or same - skip
        skipped++
      }
    }
  }

  return { pushed, restored: 0, skipped }
}

// Restore cloud memories to local
export async function restoreFromCloud(
  config: MemoryConfig,
  localDB?: LocalDatabase,
  cloudDB?: SupabaseClient,
): Promise<SyncResult> {
  const db = localDB || await getLocalDB(process.cwd())
  const supabase = cloudDB || getCloudDB(config)

  // Get all cloud project IDs
  const { data: cloudProjects } = await supabase
    .from("agent_memory")
    .select("project_id")

  const projectIds = [...new Set((cloudProjects || []).map((row: any) => row.project_id))]

  let restored = 0
  let skipped = 0

  for (const projectId of projectIds) {
    const cloudMemories = await getCloudMemories(supabase, projectId)
    const localMemories = await getLocalMemories(db, projectId)
    const localById = new Map(localMemories.map(m => [m.id, m]))

    for (const memory of cloudMemories) {
      const localMemory = localById.get(memory.id)

      if (!localMemory) {
        // New in cloud - insert locally
        db.run(`
          INSERT INTO agent_memory (id, project_id, session_id, type, title, content, metadata, tags, strength, status, time_created, time_updated)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
          memory.id,
          memory.project_id,
          memory.session_id,
          memory.type,
          memory.title,
          memory.content,
          memory.metadata ? JSON.stringify(memory.metadata) : null,
          memory.tags ? JSON.stringify(memory.tags) : null,
          memory.strength,
          memory.status,
          memory.time_created,
          memory.time_updated,
        ])
        restored++
      } else if (memory.time_updated > localMemory.time_updated) {
        // Cloud is newer - update local
        db.run(`
          UPDATE agent_memory
          SET title = ?, content = ?, metadata = ?, tags = ?, strength = ?, status = ?, time_updated = ?
          WHERE id = ?
        `, [
          memory.title,
          memory.content,
          memory.metadata ? JSON.stringify(memory.metadata) : null,
          memory.tags ? JSON.stringify(memory.tags) : null,
          memory.strength,
          memory.status,
          memory.time_updated,
          memory.id,
        ])
        restored++
      } else {
        // Local is newer or same - skip
        skipped++
      }
    }
  }

  return { pushed: 0, restored, skipped }
}

// Get sync status
export async function getSyncStatus(
  config: MemoryConfig,
  localDB?: LocalDatabase,
  cloudDB?: SupabaseClient,
): Promise<SyncStatus> {
  const db = localDB || await getLocalDB(process.cwd())
  const supabase = cloudDB || getCloudDB(config)

  // Get local count
  const localRows = db.query<{ count: number }>(`
    SELECT COUNT(*) as count FROM agent_memory WHERE status = 'active'
  `)
  const localCount = localRows[0]?.count || 0

  // Get cloud count
  const { count: cloudCount } = await supabase
    .from("agent_memory")
    .select("*", { count: "exact", head: true })
    .eq("status", "active")

  // Calculate newer counts (simplified)
  let newerInCloud = 0
  let newerInLocal = 0

  // Get last sync time from config
  let lastSyncTime: number | null = null
  const configPath = getConfigPath(process.cwd())
  try {
    const configData = JSON.parse(await fs.promises.readFile(configPath, "utf-8"))
    lastSyncTime = configData.lastSyncTime || null
  } catch {
    // No sync yet
  }

  return {
    localCount,
    cloudCount: cloudCount || 0,
    lastSyncTime,
    newerInCloud,
    newerInLocal,
  }
}

// Simple SQLite wrapper for local database access
class LocalDatabase {
  private db: Database

  constructor(dbPath: string) {
    this.db = new Database(dbPath)
  }

  query<T>(sql: string, params?: unknown[]): T[] {
    const stmt = this.db.prepare(sql)
    const bindings = params as (string | number | null | bigint | boolean | Uint8Array)[]
    return (params ? stmt.all(...bindings) : stmt.all()) as T[]
  }

  run(sql: string, params?: unknown[]): void {
    const stmt = this.db.prepare(sql)
    const bindings = params as (string | number | null | bigint | boolean | Uint8Array)[]
    params ? stmt.run(...bindings) : stmt.run()
  }
}
