import { tmpdir } from "node:os"
import path from "node:path"
import { buildManifestEntries, selectActiveAndMinimum, type ArtifactRow } from "../src/manifest"

const argv = Bun.argv.slice(2)
const remote = argv.includes("--remote")
const local = argv.includes("--local")
const dryRun = argv.includes("--dry-run")
const verify = argv.includes("--verify")
const nsIndex = argv.indexOf("--namespace-id")
const namespaceId = nsIndex >= 0 ? argv[nsIndex + 1] : undefined

if (remote === local) {
  throw new Error(
    "Pass exactly one of --remote or --local. Usage: bun run script/backfill-manifests.ts --remote [--dry-run] [--verify] [--namespace-id <id>]",
  )
}
if (nsIndex >= 0 && (!namespaceId || namespaceId.startsWith("-"))) {
  throw new Error("--namespace-id requires a value")
}

const serviceDir = path.resolve(import.meta.dir, "..")
const locationFlag = remote ? "--remote" : "--local"
const targetArgs = namespaceId ? ["--namespace-id", namespaceId] : ["--binding", "MANIFESTS"]

async function wrangler(args: string[]) {
  const proc = Bun.spawn(["./node_modules/.bin/wrangler", ...args], {
    cwd: serviceDir,
    stdout: "pipe",
    stderr: "pipe",
  })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  if (exitCode !== 0) throw new Error(`wrangler ${args.join(" ")} failed (exit ${exitCode}):\n${stderr || stdout}`)
  return stdout
}

const raw = await wrangler(["d1", "execute", "DB", locationFlag, "--json", "--command", selectActiveAndMinimum])
const parsed = JSON.parse(raw) as Array<{ results?: ArtifactRow[] }>
const rows = parsed[0]?.results
if (!Array.isArray(rows)) throw new Error(`Unexpected wrangler d1 execute output: ${raw.slice(0, 500)}`)

const entries = buildManifestEntries(rows)
console.log(`Loaded ${rows.length} active/minimum rows from D1 -> ${entries.length} KV entries`)
entries.forEach((entry) => console.log(`  ${entry.key} (${entry.value.length} bytes)`))

if (verify) {
  const mismatches: string[] = []
  for (const entry of entries) {
    const actual = await wrangler(["kv", "key", "get", entry.key, ...targetArgs, locationFlag]).catch(() => undefined)
    if (actual !== entry.value)
      mismatches.push(
        `${entry.key}: expected ${entry.value.length}B, got ${actual === undefined ? "missing" : actual.length + "B"}`,
      )
  }
  if (mismatches.length) {
    console.error("KV does not match D1:\n" + mismatches.map((line) => `  ${line}`).join("\n"))
    process.exit(1)
  }
  console.log(`Verified ${entries.length} KV entries match D1.`)
  process.exit(0)
}

if (dryRun) {
  console.log("Dry run: skipped writing to KV.")
  process.exit(0)
}

if (!entries.length) {
  console.log("No active rows found in D1; nothing to write.")
  process.exit(0)
}

const file = path.join(tmpdir(), `opencode-update-backfill-${crypto.randomUUID()}.json`)
await Bun.write(file, JSON.stringify(entries))
await wrangler(["kv", "bulk", "put", file, ...targetArgs, locationFlag]).finally(() => Bun.file(file).delete())
console.log(`Wrote ${entries.length} KV entries.`)
