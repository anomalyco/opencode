import { readdir, stat } from "node:fs/promises"
import path from "node:path"

// opencode writes through a temp-then-rename pair, so a crash between the two leaves
// `<file>.<pid>.tmp` or `<file>.<pid>.<uuid>.tmp` behind. They are never reused.
const ORPHANED_TEMP = /\.\d+\.(?:[0-9a-f-]{8,}\.)?tmp$/

export function isOrphanedTemp(name: string) {
  return ORPHANED_TEMP.test(name)
}

export function bytes(input: number) {
  if (input < 1024) return `${input} B`
  const units = ["KB", "MB", "GB", "TB"]
  let value = input / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value.toFixed(1)} ${units[unit]}`
}

// Read-only walk. Each top-level child is measured so the caller can see where the space went.
export async function inspect(data: string, db: string) {
  const entries = await readdir(data, { withFileTypes: true }).catch(() => [])
  const children: Array<[string, string]> = []
  let total = 0
  let orphaned = 0

  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory()) continue
    const result = await walk(path.join(data, entry.name))
    total += result.size
    orphaned += result.orphaned
    children.push([entry.name, bytes(result.size)])
  }

  const database = await sizeOf(db)
  const wal = await sizeOf(`${db}-wal`)
  const shm = await sizeOf(`${db}-shm`)
  return {
    total: total + database + wal + shm,
    children,
    orphaned,
    database: { size: bytes(database), wal: bytes(wal), shm: bytes(shm) },
    installs: await executablesOnPath(),
  }
}

async function walk(directory: string): Promise<{ size: number; orphaned: number }> {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => [])
  let size = 0
  let orphaned = 0
  for (const entry of entries) {
    const child = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      const result = await walk(child)
      size += result.size
      orphaned += result.orphaned
      continue
    }
    if (!entry.isFile()) continue
    size += await sizeOf(child)
    if (isOrphanedTemp(entry.name)) orphaned += 1
  }
  return { size, orphaned }
}

async function sizeOf(file: string) {
  const info = await stat(file).catch(() => undefined)
  return info?.isFile() ? info.size : 0
}

// A second opencode install is the failure mode behind a v1 client opening a v2 database.
export async function executablesOnPath(env: NodeJS.ProcessEnv = process.env) {
  const directories = (env.PATH ?? "").split(path.delimiter).filter(Boolean)
  const found = await Promise.all(
    directories.map(async (directory) => {
      const candidate = path.join(directory, "opencode")
      const info = await stat(candidate).catch(() => undefined)
      return info?.isFile() ? candidate : undefined
    }),
  )
  return [...new Set(found.filter((entry): entry is string => entry !== undefined))]
}
