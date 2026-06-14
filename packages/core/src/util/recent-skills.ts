import { readFile, writeFile, mkdir } from "fs/promises"
import { dirname } from "path"
import { Global } from "../global"

const STORAGE_FILE = "recent-skills.json"
const MAX_RECENT = 50
const TTL_MS = 30 * 24 * 60 * 60 * 1000 // 30 days

interface RecentEntry {
  /** Skill name (e.g. "commit") */
  name: string
  /** ISO timestamp of last use */
  usedAt: string
}

function filePath(): string {
  return `${Global.Path.state}/${STORAGE_FILE}`
}

// In-memory cache: loaded from disk once, reads from cache, writes are fire-and-forget
let cache: RecentEntry[] | undefined

async function loadFromDisk(): Promise<RecentEntry[]> {
  try {
    const raw = await readFile(filePath(), "utf-8")
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as RecentEntry[]) : []
  } catch {
    return []
  }
}

async function saveToDisk(entries: RecentEntry[]): Promise<void> {
  try {
    await mkdir(dirname(filePath()), { recursive: true })
    await writeFile(filePath(), JSON.stringify(entries, null, 2))
  } catch {
    // Silently fail
  }
}

function initCache(): RecentEntry[] {
  if (cache === undefined) {
    // Fire-and-forget: load from disk, update cache
    loadFromDisk().then((entries) => {
      cache = entries
    })
    // Start with empty cache, will be populated on next tick
    cache = []
  }
  return cache
}

/**
 * Return all recent skill entries, filtered by TTL and deduplicated.
 * Reads from in-memory cache (fast, synchronous).
 */
export function getRecentSkills(): Array<{ name: string; usedAt: Date }> {
  const entries = initCache()
  const now = Date.now()
  const seen = new Set<string>()
  const result: Array<{ name: string; usedAt: Date }> = []

  for (const entry of entries) {
    const ts = new Date(entry.usedAt).getTime()

    // Skip expired entries
    if (now - ts > TTL_MS) continue

    // Deduplicate by name, keep most recent
    if (seen.has(entry.name)) continue
    seen.add(entry.name)

    result.push({ name: entry.name, usedAt: new Date(entry.usedAt) })
  }

  return result
}

/**
 * Return top N recently used skill names.
 */
export function getTopRecentSkills(n: number): string[] {
  return getRecentSkills()
    .slice(0, n)
    .map((e) => e.name)
}

/**
 * Record that a skill was used (called after onSelect).
 * Updates in-memory cache immediately, persists to disk in background.
 */
export function recordSkillUsage(name: string): void {
  const entries = initCache()

  // Remove any existing entry for this skill
  const filtered = entries.filter((e) => e.name !== name)

  // Prepend new entry
  const updated: RecentEntry[] = [
    { name, usedAt: new Date().toISOString() },
    ...filtered,
  ].slice(0, MAX_RECENT)

  // Update cache synchronously
  cache = updated

  // Persist to disk in background
  saveToDisk(updated)
}
