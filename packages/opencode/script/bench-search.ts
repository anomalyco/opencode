import { Effect } from "effect"
import { Fff } from "@opencode-ai/core/filesystem/fff.bun"
import { AppRuntime } from "@/effect/app-runtime"
import { Search } from "@opencode-ai/core/filesystem/search"
import { InstanceStore } from "@/project/instance-store"

const dir = process.cwd()

const FILE_QUERIES = ["fff", "package.json", "tools/ experiment"]
const GREP_QUERIES = ["FileFinder", "import", "grep", "autocomplete"]
const GLOB_QUERIES = ["**/*.test.ts"]

const FILE_LIMIT = 100
const GREP_LIMIT = 50
const GLOB_LIMIT = 50

const run = <A>(effect: Effect.Effect<A, unknown, Search.Service>) =>
  AppRuntime.runPromise(
    InstanceStore.Service.use((store) => store.provide({ directory: dir }, effect as never)),
  ) as Promise<A>

// --- raw Fff picker ---
const t0 = performance.now()
const made = Fff.create({ basePath: dir, aiMode: true })
if (!made.ok) {
  console.error("Fff.create failed:", made.error)
  process.exit(1)
}
const picker = made.value
console.log(`picker create: ${(performance.now() - t0).toFixed(1)}ms`)

const tw = performance.now()
await picker.waitForScan(2_500)
console.log(`wait for scan: ${(performance.now() - tw).toFixed(1)}ms`)

// warmup grep to let the content index build
const tWarmup = performance.now()
picker.grep("_warmup_", { mode: "regex", maxMatchesPerFile: 1, timeBudgetMs: 1_500 })
console.log(`grep warmup: ${(performance.now() - tWarmup).toFixed(1)}ms`)

console.log()
console.log("--- raw picker (warm) ---")

for (const q of FILE_QUERIES) {
  const t = performance.now()
  const r = picker.fileSearch(q, { pageSize: Math.max(FILE_LIMIT, 100) })
  const count = r.ok ? r.value.items.length : "err"
  console.log(`[picker] fileSearch "${q}": ${(performance.now() - t).toFixed(1)}ms (${count} results)`)
}

for (const q of GREP_QUERIES) {
  const t = performance.now()
  const r = picker.grep(q, { mode: "regex", pageSize: GREP_LIMIT, timeBudgetMs: 1_500 })
  const count = r.ok ? r.value.items.length : "err"
  console.log(`[picker] grep "${q}": ${(performance.now() - t).toFixed(1)}ms (${count} matches)`)
}

picker.destroy()

// --- Ripgrep service (via Search with file:["."] to force rg path) ---
console.log()
console.log("--- Ripgrep (via Search service) ---")

// warmup
await run(Search.Service.use((svc) => svc.search({ cwd: dir, pattern: "_warmup_rg_", limit: 1, file: ["."] })))

for (const q of GREP_QUERIES) {
  const t = performance.now()
  const r = await run(Search.Service.use((svc) => svc.search({ cwd: dir, pattern: q, limit: GREP_LIMIT, file: ["."] })))
  console.log(
    `[ripgrep] grep "${q}": ${(performance.now() - t).toFixed(1)}ms (${r.items.length} total, limit is per-file not total)`,
  )
}

// --- Search service: init breakdown ---
console.log()

// 1) runtime + InstanceState + picker create + scan poll
const tRuntime = performance.now()
await run(Search.Service.use((svc) => svc.file({ cwd: dir, query: "_warmup_file_", limit: 1 })))
console.log(`[Search] init file (runtime + picker + scan): ${(performance.now() - tRuntime).toFixed(1)}ms`)

// 2) grep warmup (content index cold-start inside the Search service picker)
const tGrepWarmup = performance.now()
await run(Search.Service.use((svc) => svc.search({ cwd: dir, pattern: "_warmup_grep_", limit: 1 })))
console.log(`[Search] init grep (content index warmup):    ${(performance.now() - tGrepWarmup).toFixed(1)}ms`)

console.log()
console.log("--- Search service (warm) ---")

for (const q of FILE_QUERIES) {
  const t = performance.now()
  const r = await run(Search.Service.use((svc) => svc.file({ cwd: dir, query: q, limit: FILE_LIMIT })))
  console.log(
    `[Search.file] "${q}": ${(performance.now() - t).toFixed(1)}ms (${r?.length ?? "undefined (cache fallback)"} results)`,
  )
}

for (const q of GREP_QUERIES) {
  const t = performance.now()
  const r = await run(Search.Service.use((svc) => svc.search({ cwd: dir, pattern: q, limit: GREP_LIMIT })))
  console.log(
    `[Search.search] "${q}": ${(performance.now() - t).toFixed(1)}ms (${r.items.length} matches, engine=${r.engine})`,
  )
}

for (const q of GLOB_QUERIES) {
  const t = performance.now()
  const r = await run(Search.Service.use((svc) => svc.glob({ cwd: dir, pattern: q, limit: GLOB_LIMIT })))
  console.log(
    `[Search.glob] "${q}": ${(performance.now() - t).toFixed(1)}ms (${r.files.length} files, truncated=${r.truncated})`,
  )
}

process.exit(0)
