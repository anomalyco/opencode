import { mkdir } from "fs/promises"
import { dirname } from "path"
import { Global } from "../global"

const STORAGE_FILE = "recent-skills.json"
const MAX_RECENT = 50
const TTL_MS = 30 * 24 * 60 * 60 * 1000

type RecentEntry = {
  name: string
  usedAt: string
}

const state: { cache: RecentEntry[] | undefined } = { cache: undefined }

function filePath() {
  return `${Global.Path.state}/${STORAGE_FILE}`
}

function saveToDisk(entries: RecentEntry[]) {
  const path = filePath()
  mkdir(dirname(path), { recursive: true })
    .then(() => Bun.write(path, JSON.stringify(entries, null, 2)))
    .catch(() => {})
}

function initCache(): RecentEntry[] {
  if (state.cache !== undefined) return state.cache
  state.cache = []
  Bun.file(filePath())
    .text()
    .then((raw) => {
      const parsed: unknown = JSON.parse(raw)
      if (Array.isArray(parsed)) state.cache = parsed as RecentEntry[]
    })
    .catch(() => {})
  return state.cache
}

function getRecentSkills(): RecentEntry[] {
  const now = Date.now()
  const seen = new Set<string>()
  return initCache().filter((entry) => {
    const ts = new Date(entry.usedAt).getTime()
    if (now - ts > TTL_MS) return false
    if (seen.has(entry.name)) return false
    seen.add(entry.name)
    return true
  })
}

export function getTopRecentSkills(n: number): string[] {
  return getRecentSkills()
    .slice(0, n)
    .map((e) => e.name)
}

export function recordSkillUsage(name: string): void {
  const updated = [
    { name, usedAt: new Date().toISOString() },
    ...initCache().filter((e) => e.name !== name),
  ].slice(0, MAX_RECENT)
  state.cache = updated
  saveToDisk(updated)
}
