import path from "path"
import { mkdir } from "fs/promises"
import { AshbyMockData } from "@/product/ashby-edge"
import { applyAshbyWrite, type AshbyState, type AshbyWrite } from "@/product/fixtures/mcp/ashby-mock"

export type PlannedWrite = AshbyWrite

export type AtsCache = AshbyState & { writes: AshbyWrite[] }

const ATS_FILE = path.join(".moks", "ats.json")

function asCache(value: unknown): AtsCache | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return
  const row = value as Record<string, unknown>
  if (!Array.isArray(row.jobs) || !Array.isArray(row.candidates)) return
  return {
    jobs: row.jobs as AshbyState["jobs"],
    candidates: row.candidates as AshbyState["candidates"],
    notes: Array.isArray(row.notes) ? (row.notes as AshbyState["notes"]) : [],
    writes: Array.isArray(row.writes) ? (row.writes as AshbyWrite[]) : [],
  }
}

export async function loadCache(cwd: string): Promise<AtsCache> {
  const file = path.join(cwd, ATS_FILE)
  if (await Bun.file(file).exists()) {
    const loaded = asCache(await Bun.file(file).json())
    if (loaded) return loaded
  }
  const seed = (await Bun.file(AshbyMockData).json()) as {
    jobs: AshbyState["jobs"]
    candidates: AshbyState["candidates"]
  }
  return { jobs: seed.jobs, candidates: seed.candidates, notes: [], writes: [] }
}

export async function saveCache(cwd: string, cache: AtsCache) {
  const file = path.join(cwd, ATS_FILE)
  await mkdir(path.dirname(file), { recursive: true })
  await Bun.write(file, JSON.stringify(cache, null, 2) + "\n")
}

export async function applyWrites(input: { cwd: string; writes: PlannedWrite[]; dry_run?: boolean }) {
  const dry_run = input.dry_run ?? true
  if (dry_run) return { dry_run, writes: input.writes }
  const cache = await loadCache(input.cwd)
  for (const write of input.writes) {
    applyAshbyWrite(cache, write)
    cache.writes.push(write)
  }
  await saveCache(input.cwd, cache)
  return { dry_run, writes: input.writes, cache }
}

export * as DecisionAts from "./ats"
